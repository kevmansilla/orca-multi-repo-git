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

const FLOATING = 'global-floating-terminal'
// Solo un shell esperando: si hay un programa o un agente adelante, el comando le llegaría como si fuera texto suyo.
const AT_PROMPT = /[$#%→❯]\s*$/

const newTerminal = ({ title, command }) => orca(['terminal', 'create', '--title', title, '--command', command, '--focus', '--json'])

async function floatingAtPrompt() {
  const { terminals = [] } = JSON.parse(await orca(['terminal', 'list', '--json'])).result
  const floating = terminals.find((t) => t.worktreeId === FLOATING && t.connected && t.writable)
  if (!floating) return null
  const { tail = [] } = JSON.parse(await orca(['terminal', 'read', '--terminal', floating.handle, '--json'])).result.terminal
  const last = tail.filter((line) => line.trim()).at(-1) ?? ''
  return AT_PROMPT.test(last) ? floating.handle : null
}

// La flotante no se puede crear desde acá: si no está disponible, el comando va a una pestaña nueva.
export async function openTerminal({ title, command, floating = false }) {
  const handle = floating ? await floatingAtPrompt().catch(() => null) : null
  if (!handle) return newTerminal({ title, command })
  await orca(['terminal', 'send', '--terminal', handle, '--text', command, '--enter', '--json'])
  await orca(['terminal', 'switch', '--terminal', handle, '--json']).catch(() => {}) // solo la trae al frente
}

export async function tabIsOpen(port) {
  return (await orca(['tab', 'list', '--json'])).includes(`127.0.0.1:${port}`)
}
