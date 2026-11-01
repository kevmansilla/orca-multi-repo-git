// Proceso aparte para el servidor: Orca mata al worker a los 5 minutos sin eventos, y el uso de la app no cuenta.
// Se apaga solo cuando pasan IDLE_MS sin pedidos; la pestaña abierta le manda un ping cada minuto.
import { rmSync } from 'node:fs'
import { readState, serverStamp, statePath, writeState } from './state.mjs'
import { startServer } from './server.mjs'

const IDLE_MS = 10 * 60_000

function stop() {
  if (readState()?.pid === process.pid) rmSync(statePath(), { force: true })
  process.exit(0)
}

const { port, token } = await startServer({ idleMs: IDLE_MS, onIdle: stop })
writeState({ pid: process.pid, port, token, stamp: serverStamp() })
process.on('SIGTERM', stop)
