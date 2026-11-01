// Orca no restaura las pestañas del navegador, los plugins no arrancan con ella, y cada pestaña es de un
// workspace: al cambiar de proyecto, la app no está. El servicio la mantiene abierta en los workspaces de
// `tabs` (policy.json). Una pestaña por workspace gasta unos 175 MB, por eso no va en todos.
// Sin `tabs`, la abre una vez por arranque de Orca, en el workspace activo.
// Cada arranque de Orca reescribe orca-runtime.json: con Orca cerrada no se llama a su CLI.
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { openTab, openTabIn, worktrees, worktreesWithTab } from './orca-tab.mjs'
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
    const { tabs } = JSON.parse(readFileSync(POLICY_FILE, 'utf8'))
    return Array.isArray(tabs) ? tabs.filter((t) => typeof t === 'string' && t.trim()) : null
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

export async function missingWorktrees(port, entries) {
  const [all, open] = await Promise.all([worktrees(), worktreesWithTab(port)])
  return all.filter((w) => !open.has(w.id) && entries.some((e) => matches(e, w))).map((w) => w.id)
}

async function openOnce(url, launch) {
  if (launch === readMark()) return
  if ((await worktreesWithTab(Number(new URL(url).port))).size === 0) await openTab(url)
  writeFileSync(markPath(), launch, { mode: 0o600 })
}

export function keepTabs(port, token) {
  const url = `http://127.0.0.1:${port}/?t=${token}`
  let busy = false
  setInterval(async () => {
    const launch = currentLaunch()
    if (busy || !launch) return
    busy = true
    try {
      const entries = wanted()
      if (!entries) await openOnce(url, launch)
      else for (const id of await missingWorktrees(port, entries)) await openTabIn(url, id)
    } catch {
      // al arrancar, la CLI de Orca tarda un poco en responder: se reintenta en la próxima vuelta
    }
    busy = false
  }, CHECK_MS).unref()
}
