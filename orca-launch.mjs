// Orca no restaura las pestañas del navegador, los plugins no arrancan con ella, y cada pestaña es de un
// workspace: al cambiar de proyecto, la app no está. Una pestaña gasta unos 175 MB, por eso no va en todos.
// Con `tabsIdleHours` (policy.json), sigue al trabajo: la abre en el workspace que está mirando el usuario y en
// los que tuvieron actividad reciente, y la cierra en los que llevan ese tiempo quietos. Los de `tabs` la tienen siempre.
// Sin ninguna de las dos, la abre una vez por arranque de Orca, en el workspace activo.
// Cada arranque de Orca reescribe orca-runtime.json: con Orca cerrada no se llama a su CLI.
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { appTabs, closeTab, openTab, openTabIn, worktrees, worktreesWithTab } from './orca-tab.mjs'
import { statePath } from './state.mjs'

const HOME = homedir()
const RUNTIME = join(HOME, '.config/orca/orca-runtime.json')
const POLICY_FILE = process.env.MRG_POLICY_FILE ?? join(HOME, '.config/orca-multi-repo-git/policy.json')
const CHECK_MS = 5_000
const RETRY_MS = 120_000

const markPath = () => `${statePath()}.launch`
const openedPath = () => `${statePath()}.tabs`

function readMark() {
  try {
    return readFileSync(markPath(), 'utf8')
  } catch {
    return null // nunca se abrió desde este servicio
  }
}

function currentLaunch() {
  try {
    const launch = String(statSync(RUNTIME).mtimeMs)
    process.kill(JSON.parse(readFileSync(RUNTIME, 'utf8')).pid, 0)
    return launch
  } catch {
    return null // Orca está cerrada, o todavía está arrancando
  }
}

// Se lee en cada vuelta: un cambio en policy.json entra sin reiniciar el servicio.
function wanted() {
  try {
    const { tabs, tabsIdleHours } = JSON.parse(readFileSync(POLICY_FILE, 'utf8'))
    const idleMs = Number(tabsIdleHours) > 0 ? Number(tabsIdleHours) * 3_600_000 : null
    if (!Array.isArray(tabs) && !idleMs) return null
    return { pinned: Array.isArray(tabs) ? tabs.filter((t) => typeof t === 'string' && t.trim()) : [], idleMs }
  } catch {
    return null // sin policy.json, o sin `tabs`
  }
}

const expand = (p) => resolve(p.replace(/^~(?=$|\/)/, HOME))

// Cada entrada es el nombre del workspace en Orca o su carpeta.
export function matches(entry, worktree) {
  const name = entry.trim()
  if (worktree.displayName === name) return true
  return /^[~/]/.test(name) && expand(name) === resolve(worktree.path)
}

// `since` es cuándo vio el servicio cada pestaña por primera vez: una que el usuario acaba de abrir en un
// workspace quieto no se cierra hasta que pase el mismo tiempo.
export function plan({ all, tabs, pinned, idleMs, since, now }) {
  const isPinned = (w) => pinned.some((e) => matches(e, w))
  const recent = (w) => idleMs && (w.isActive || now - (w.lastActivityAt ?? 0) < idleMs)
  const withTab = new Set(tabs.map((t) => t.worktreeId))
  const open = all.filter((w) => !withTab.has(w.id) && (isPinned(w) || recent(w))).map((w) => w.id)
  if (!idleMs) return { open, close: [] }
  const byId = new Map(all.map((w) => [w.id, w]))
  const close = tabs
    .filter((t) => {
      const w = byId.get(t.worktreeId)
      if (!w) return false // workspace archivado o de otro host: no es nuestro decidir
      return !isPinned(w) && !recent(w) && now - (since.get(t.page) ?? now) >= idleMs
    })
    .map((t) => t.page)
  return { open, close }
}

// `browser.tabList` puede no listar una pestaña que Orca sí muestra: "no figura" no quiere decir "no está".
// Solo se reabre la que figuró y dejó de figurar, porque esa sí se cerró.
// Se guarda en disco porque cada actualización del plugin reinicia el servicio y las pestañas siguen ahí.
export function settleOpened(opened, tabs) {
  const listed = new Set(tabs.map((t) => t.worktreeId))
  for (const [id, seen] of opened) {
    if (listed.has(id)) opened.set(id, true)
    else if (seen) opened.delete(id)
  }
  return opened
}

function readOpened(launch) {
  try {
    const saved = JSON.parse(readFileSync(openedPath(), 'utf8'))
    return new Map(saved.launch === launch ? saved.opened : [])
  } catch {
    return new Map() // todavía no se abrió ninguna en este arranque de Orca
  }
}

function saveOpened(launch, opened) {
  writeFileSync(openedPath(), JSON.stringify({ launch, opened: [...opened] }), { mode: 0o600 })
}

async function openOnce(url, launch) {
  if (launch === readMark()) return
  if ((await worktreesWithTab(Number(new URL(url).port))).size === 0) await openTab(url)
  writeFileSync(markPath(), launch, { mode: 0o600 })
}

export function keepTabs(port, token) {
  const url = `http://127.0.0.1:${port}/?t=${token}`
  let busy = false
  const since = new Map()
  const tried = new Map()
  setInterval(async () => {
    const launch = currentLaunch()
    if (busy || !launch) return
    busy = true
    try {
      const entries = wanted()
      if (!entries) await openOnce(url, launch)
      else {
        const [all, tabs] = await Promise.all([worktrees(), appTabs(port)])
        const now = Date.now()
        for (const t of tabs) if (!since.has(t.page)) since.set(t.page, now)
        for (const page of since.keys()) if (!tabs.some((t) => t.page === page)) since.delete(page)
        const todo = plan({ all, tabs, ...entries, since, now })
        const opened = settleOpened(readOpened(launch), tabs)
        for (const id of todo.open) {
          if (opened.has(id) || now - (tried.get(id) ?? 0) < RETRY_MS) continue
          tried.set(id, now)
          opened.set(id, false)
          saveOpened(launch, opened)
          await openTabIn(url, id).catch((e) => {
            console.error(`No se pudo abrir la pestaña en ${id}: ${e.message}`)
            if (!e.message.includes('no respondió')) opened.delete(id) // sin respuesta, Orca pudo abrirla igual
          })
        }
        saveOpened(launch, opened)
        for (const page of todo.close) await closeTab(page)
      }
    } catch {
      // al arrancar, la CLI de Orca tarda un poco en responder: se reintenta en la próxima vuelta
    }
    busy = false
  }, CHECK_MS).unref()
}
