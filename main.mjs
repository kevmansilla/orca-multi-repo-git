// Worker del plugin: asegura que la app local esté corriendo y la abre en una pestaña del navegador de Orca.
// Es una pestaña y no un panel porque los paneles no pueden conectarse a nada ni ejecutar procesos.
import { execFile, spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { readState, serverStamp } from './state.mjs'

const DAEMON = fileURLToPath(new URL('./daemon.mjs', import.meta.url))
// El shim va antes del PATH: un `orca` propio del usuario puede ser un launcher que agrega flags de Electron.
const CLI_DIRS = [join(homedir(), '.config/orca/linux-orca-cli-shim')]
const FALLBACK_DIRS = [join(homedir(), '.local/bin')]
const START_TRIES = 50

function openTab(url) {
  const PATH = [...CLI_DIRS, process.env.PATH, ...FALLBACK_DIRS].filter(Boolean).join(delimiter)
  // El worker corre con esta variable, y con ella el ejecutable de Orca se comporta como Node y no como la CLI.
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env
  return new Promise((resolve, reject) => {
    execFile('orca', ['tab', 'create', '--url', url, '--json'], { env: { ...env, PATH }, timeout: 15000 }, (error) =>
      error ? reject(error) : resolve()
    )
  })
}

async function responds(state) {
  if (!state || state.stamp !== serverStamp()) return false
  try {
    const r = await fetch(`http://127.0.0.1:${state.port}/api/ping`, { headers: { 'X-Token': state.token } })
    return r.ok
  } catch {
    return false // un puerto cerrado significa que ese servidor ya se apagó
  }
}

async function ensureServer() {
  const current = readState()
  if (await responds(current)) return current
  spawn(process.execPath, [DAEMON], { detached: true, stdio: 'ignore', env: process.env }).unref()
  for (let i = 0; i < START_TRIES; i++) {
    await sleep(100)
    const state = readState()
    if (await responds(state)) return state
  }
  throw new Error('el servidor de la app no arrancó')
}

export default function activate(orca) {
  orca.commands.register('open', async () => {
    const { port, token } = await ensureServer()
    const url = `http://127.0.0.1:${port}/?t=${token}`
    try {
      await openTab(url)
      return 'Source Control abierto en una pestaña del navegador.'
    } catch (error) {
      orca.log(`no se pudo abrir la pestaña: ${error.message}`)
      return `No pude abrir la pestaña. Abrí esta URL en el navegador de Orca: ${url}`
    }
  })
}
