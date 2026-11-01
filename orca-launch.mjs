// Orca no restaura las pestañas del navegador, y los plugins no arrancan con ella: el servicio abre la suya.
// Cada arranque de Orca reescribe orca-runtime.json, así que mirar su fecha alcanza y no gasta nada.
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { openTab, tabIsOpen } from './orca-tab.mjs'
import { statePath } from './state.mjs'

const RUNTIME = join(homedir(), '.config/orca/orca-runtime.json')
const CHECK_MS = 5_000
const TRIES = 20
const RETRY_MS = 3_000

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

async function open(port, token) {
  const url = `http://127.0.0.1:${port}/?t=${token}`
  for (let i = 0; i < TRIES; i++) {
    try {
      if (!(await tabIsOpen(port))) await openTab(url)
      return
    } catch {
      await sleep(RETRY_MS) // al arrancar, la CLI de Orca tarda un poco en responder
    }
  }
}

export function openOnOrcaStart(port, token) {
  let busy = false
  setInterval(async () => {
    const launch = currentLaunch()
    if (busy || !launch || launch === readMark()) return
    busy = true
    await open(port, token)
    writeFileSync(markPath(), launch, { mode: 0o600 })
    busy = false
  }, CHECK_MS).unref()
}
