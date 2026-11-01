// Orca no restaura las pestañas del navegador, los plugins no arrancan con ella, y cada pestaña es de un
// workspace: al cambiar de proyecto, la app no está. Una pestaña gasta unos 175 MB, por eso no va en todos.
// Con `tabsIdleHours` (policy.json), sigue al trabajo: la abre en los workspaces con actividad reciente y la
// cierra en los que llevan ese tiempo quietos. Los de `tabs` la tienen siempre.
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

const markPath = () => `${statePath()}.launch`

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
  const recent = (w) => idleMs && now - (w.lastActivityAt ?? 0) < idleMs
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

async function openOnce(url, launch) {
  if (launch === readMark()) return
  if ((await worktreesWithTab(Number(new URL(url).port))).size === 0) await openTab(url)
  writeFileSync(markPath(), launch, { mode: 0o600 })
}

export function keepTabs(port, token) {
  const url = `http://127.0.0.1:${port}/?t=${token}`
  let busy = false
  const since = new Map()
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
        for (const id of todo.open) await openTabIn(url, id)
        for (const page of todo.close) await closeTab(page)
      }
    } catch {
      // al arrancar, la CLI de Orca tarda un poco en responder: se reintenta en la próxima vuelta
    }
    busy = false
  }, CHECK_MS).unref()
}
