// Abre la app en una pestaña del navegador de Orca, usando su CLI.
import { execFile } from 'node:child_process'
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

export const openTab = (url) => orca(['tab', 'create', '--url', url, '--json'])

export async function tabIsOpen(port) {
  return (await orca(['tab', 'list', '--json'])).includes(`127.0.0.1:${port}`)
}
