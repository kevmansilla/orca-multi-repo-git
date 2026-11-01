// Dónde deja el servidor su puerto y su token para que el worker lo reutilice. El token es secreto: archivo 0600.
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'orca-multi-repo-git')
const CODE = ['server.mjs', 'daemon.mjs', 'state.mjs', 'index.html', 'orca-launch.mjs', 'orca-tab.mjs'].map((f) => fileURLToPath(new URL(`./${f}`, import.meta.url)))

export const statePath = () => join(DIR, 'server.json')

// Cambia cuando cambia el código, para no reutilizar un servidor viejo después de actualizar el plugin.
export const serverStamp = () => CODE.map((f) => statSync(f).mtimeMs).join('-')

export function readState() {
  try {
    return JSON.parse(readFileSync(statePath(), 'utf8'))
  } catch {
    return null // todavía no hay servidor, o el archivo quedó a medio borrar
  }
}

export function writeState(state) {
  mkdirSync(DIR, { recursive: true, mode: 0o700 })
  const tmp = `${statePath()}.${process.pid}`
  writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 })
  renameSync(tmp, statePath())
}
