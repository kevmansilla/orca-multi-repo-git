// Abre la app en una pestaña del navegador de Orca, usando su CLI.
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

// El shim va antes del PATH: un `orca` propio del usuario puede ser un launcher que agrega flags de Electron.
const CLI_DIRS = [join(homedir(), '.config/orca/linux-orca-cli-shim')]
const FALLBACK_DIRS = [join(homedir(), '.local/bin')]

function orca(args) {
  const PATH = [...CLI_DIRS, process.env.PATH, ...FALLBACK_DIRS].filter(Boolean).join(delimiter)
  // El worker corre con esta variable, y con ella el ejecutable de Orca se comporta como Node y no como la CLI.
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env
  return new Promise((resolve, reject) => {
    execFile('orca', args, { env: { ...env, PATH }, timeout: 15000 }, (error, stdout) => (error ? reject(error) : resolve(stdout)))
  })
}

// Lo que el servicio consulta cada pocos segundos va directo al socket de Orca: cada llamada a la CLI levanta un
// proceso que gasta un cuarto de segundo de CPU, y esto da unos milisegundos.
function rpc(method, params = {}) {
  const runtime = JSON.parse(readFileSync(join(homedir(), '.config/orca/orca-runtime.json'), 'utf8'))
  const endpoint = runtime.transports?.find((t) => t.kind === 'unix')?.endpoint
  if (!endpoint) return Promise.reject(new Error('Orca no expone su socket'))
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint)
    let buf = ''
    const done = (fn, value) => {
      clearTimeout(timer)
      socket.destroy()
      fn(value)
    }
    const timer = setTimeout(() => done(reject, new Error(`${method}: Orca no respondió`)), 15000)
    socket.on('error', (e) => done(reject, e))
    socket.on('data', (chunk) => {
      buf += chunk
      const end = buf.indexOf('\n')
      if (end < 0) return
      const reply = JSON.parse(buf.slice(0, end))
      if (reply.ok) done(resolve, reply.result)
      else done(reject, new Error(`${method}: ${reply.error?.message ?? 'error'}`))
    })
    socket.write(JSON.stringify({ id: randomUUID(), authToken: runtime.authToken, method, params }) + '\n')
  })
}

export const openTab = (url) => orca(['tab', 'create', '--url', url, '--json'])

// Sin cambiar el workspace que está mirando el usuario: la pestaña queda creada en segundo plano.
export const openTabIn = (url, worktreeId) => rpc('browser.tabCreate', { url, worktree: `id:${worktreeId}` })

// `ps` dice cuál es el workspace que está mirando el usuario (`isActive`); `list` no.
export async function worktrees() {
  const { worktrees: all = [] } = await rpc('worktree.ps', { limit: 1000 })
  return all.filter((w) => !w.isArchived).map((w) => ({ ...w, id: w.worktreeId }))
}

// Las pestañas de la app, en cualquier proyecto.
export async function appTabs(port) {
  const { tabs = [] } = await rpc('browser.tabList')
  return tabs.filter((t) => t.url.includes(`127.0.0.1:${port}`)).map((t) => ({ worktreeId: t.worktreeId, page: t.browserPageId }))
}

export const worktreesWithTab = async (port) => new Set((await appTabs(port)).map((t) => t.worktreeId))

export const closeTab = (page) => rpc('browser.tabClose', { page })

const FLOATING = 'id:global-floating-terminal'

// Siempre una pestaña nueva, también en la flotante: las que ya están abiertas pueden ser un ssh a un servidor, y ni
// el título ni el prompt lo dicen con certeza. Escribir ahí correría el comando en el servidor.
export const openTerminal = ({ title, command, floating = false }) =>
  orca(['terminal', 'create', ...(floating ? ['--worktree', FLOATING] : []), '--title', title, '--command', command, '--focus', '--json'])
