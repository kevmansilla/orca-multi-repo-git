// Orca no restaura las pestañas del navegador, los plugins no arrancan con ella, y cada pestaña es de un
// workspace: al cambiar de proyecto, la app no está. Una pestaña gasta unos 175 MB, por eso no va en todos.
// Con `tabsIdleHours` (policy.json), sigue al trabajo: la abre en el workspace que está mirando el usuario y en
// los que tuvieron actividad reciente, y la cierra en los que llevan ese tiempo quietos. Los de `tabs` la tienen siempre.
// Una que se intentó abrir y no apareció se reintenta; una que estuvo y la cerraste vuelve recién pasado ese tiempo.
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
// Los reintentos seguidos de una pestaña que nunca apareció. Después espera como una que se cerró.
const MAX_TRIES = 3
// Cuánto tarda en volver una pestaña cerrada, si policy.json no tiene `tabsIdleHours`.
const REOPEN_DEFAULT_MS = 2 * 3_600_000

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

// `opened` es, por workspace, el estado de la pestaña en este arranque de Orca: {at, tries, seen}. `seen` dice si
// figuró en `browser.tabList` (que en Orca 1.4.245 lista todas las de cada workspace, también en segundo plano);
// `at` es la última vez que se la vio o se intentó abrirla. Una que nunca figuró se reintenta cada RETRY_MS, hasta
// MAX_TRIES; una que figuró y ya no está la cerró alguien, y vuelve recién `reopenMs` después de la última vez que se vio.
export function pendingTabs(ids, opened, tabs, now, reopenMs) {
  for (const t of tabs) opened.set(t.worktreeId, { at: now, tries: 0, seen: true })
  const listed = new Set(tabs.map((t) => t.worktreeId))
  return ids.filter((id) => {
    if (listed.has(id)) return false
    const entry = opened.get(id)
    if (!entry) return true
    const wait = !entry.seen && entry.tries < MAX_TRIES ? RETRY_MS : reopenMs
    return now - entry.at >= wait
  })
}

export function markTried(opened, id, now) {
  const entry = opened.get(id)
  opened.set(id, { at: now, tries: entry && !entry.seen ? entry.tries + 1 : 1, seen: false })
}

// Se guarda en disco porque cada actualización del plugin reinicia el servicio y las pestañas siguen ahí.
export function parseOpened(text, launch, now) {
  let saved
  try {
    saved = JSON.parse(text)
  } catch {
    return new Map() // archivo roto: se arranca de cero
  }
  if (!saved || saved.launch !== launch) return new Map()
  // El formato viejo era la lista de los que ya la recibieron: se toman como cerradas recién.
  if (Array.isArray(saved.worktrees)) return new Map(saved.worktrees.map((id) => [id, { at: now, tries: 0, seen: true }]))
  return new Map(Object.entries(saved.worktrees ?? {}))
}

function readOpened(launch, now) {
  try {
    return parseOpened(readFileSync(openedPath(), 'utf8'), launch, now)
  } catch {
    return new Map() // todavía no se abrió ninguna en este arranque de Orca
  }
}

function saveOpened(launch, opened) {
  writeFileSync(openedPath(), JSON.stringify({ launch, worktrees: Object.fromEntries(opened) }), { mode: 0o600 })
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
        const opened = readOpened(launch, now)
        for (const id of pendingTabs(todo.open, opened, tabs, now, entries.idleMs ?? REOPEN_DEFAULT_MS)) {
          markTried(opened, id, now)
          saveOpened(launch, opened)
          // Si falla, o si Orca no responde pero la abrió igual, la próxima vuelta lo ve en la lista.
          await openTabIn(url, id).catch((e) => console.error(`No se pudo abrir la pestaña en ${id}: ${e.message}`))
        }
        for (const page of todo.close) {
          await closeTab(page)
          opened.delete(tabs.find((t) => t.page === page)?.worktreeId)
        }
        saveOpened(launch, opened)
      }
    } catch {
      // al arrancar, la CLI de Orca tarda un poco en responder: se reintenta en la próxima vuelta
    }
    busy = false
  }, CHECK_MS).unref()
}
