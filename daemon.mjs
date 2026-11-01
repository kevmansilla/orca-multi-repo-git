// Proceso aparte para el servidor: Orca mata al worker a los 5 minutos sin eventos, y el uso de la app no cuenta.
// Se apaga solo cuando pasan IDLE_MS sin pedidos; la pestaña abierta le manda un ping cada minuto.
import { rmSync } from 'node:fs'
import { keepTabs } from './orca-launch.mjs'
import { readState, serverStamp, statePath, writeState } from './state.mjs'
import { startServer } from './server.mjs'

const IDLE_MS = 10 * 60_000
const CODE_CHECK_MS = 15_000
// Con puerto fijo lo administra un servicio: no se apaga por inactividad y conserva la dirección de la pestaña.
const FIXED_PORT = Number(process.env.MRG_PORT) || 0
const managed = FIXED_PORT > 0

function stop() {
  if (readState()?.pid === process.pid) rmSync(statePath(), { force: true })
  process.exit(0)
}

const { port, token } = await startServer({ port: FIXED_PORT, idleMs: managed ? 0 : IDLE_MS, onIdle: stop })
const stamp = serverStamp()
writeState({ pid: process.pid, port, token, stamp, managed })
process.on('SIGTERM', stop)
// El servicio lo vuelve a levantar, así una actualización del plugin entra sin pasos a mano.
if (managed) {
  setInterval(() => serverStamp() !== stamp && stop(), CODE_CHECK_MS).unref()
  keepTabs(port, token)
}
