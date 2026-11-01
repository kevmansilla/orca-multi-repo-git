// Worker del plugin: asegura que la app local esté corriendo y la abre en una pestaña del navegador de Orca.
// Es una pestaña y no un panel porque los paneles no pueden conectarse a nada ni ejecutar procesos.
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { openTab } from './orca-tab.mjs'
import { readState, serverStamp } from './state.mjs'

const DAEMON = fileURLToPath(new URL('./daemon.mjs', import.meta.url))
const START_TRIES = 50

async function alive(state) {
  if (!state) return false
  try {
    const r = await fetch(`http://127.0.0.1:${state.port}/api/ping`, { headers: { 'X-Token': state.token } })
    return r.ok
  } catch {
    return false // un puerto cerrado significa que ese servidor ya se apagó
  }
}

const responds = async (state) => state?.stamp === serverStamp() && (await alive(state))

// Solo se apaga si responde con su token: el pid de un servidor caído pudo pasar a otro proceso.
async function retire(state) {
  if (!(await alive(state))) return
  try {
    process.kill(state.pid, 'SIGTERM') // un servidor de otra versión no debe seguir atendiendo pestañas viejas
  } catch {
    // se apagó entre la consulta y la señal
  }
}

async function ensureServer() {
  const current = readState()
  if (current?.managed && (await alive(current))) return current // el servicio se actualiza solo
  if (await responds(current)) return current
  await retire(current)
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
