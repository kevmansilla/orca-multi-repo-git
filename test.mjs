// Prueba las acciones de la app contra un repo descartable en una carpeta temporal. No toca los repos reales.
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmp = mkdtempSync(join(tmpdir(), 'mrg-test-'))
const repo = join(tmp, 'app')
const sh = (cwd, ...args) => execFileSync(args[0], args.slice(1), { cwd, stdio: 'pipe' }).toString()

sh(tmp, 'git', 'init', '-q', '--bare', '-b', 'master', 'remote.git')
sh(tmp, 'git', 'clone', '-q', 'remote.git', 'app')
sh(repo, 'git', 'config', 'user.email', 'test@example.com')
sh(repo, 'git', 'config', 'user.name', 'test')
sh(repo, 'git', 'switch', '-q', '-c', 'master')
writeFileSync(join(repo, 'a.txt'), '1\n')
sh(repo, 'git', 'add', '.')
sh(repo, 'git', 'commit', '-qm', 'init')
sh(repo, 'git', 'push', '-q', '-u', 'origin', 'master')
sh(repo, 'git', 'switch', '-q', '-c', 'otra')
sh(repo, 'git', 'push', '-q', '-u', 'origin', 'otra')
sh(repo, 'git', 'switch', '-q', 'master')
sh(repo, 'git', 'branch', '-q', '-D', 'otra')
sh(tmp, 'git', 'clone', '-q', 'remote.git', 'sin-regla')
sh(tmp, 'git', 'clone', '-q', 'remote.git', 'libre')
writeFileSync(join(tmp, 'bases.json'), JSON.stringify({ default: 'main', repos: { app: 'master' }, diagnostico: {}, git_libre: [] }))
writeFileSync(join(tmp, 'repos.json'), JSON.stringify(['app', 'sin-regla', 'libre'].map((name) => ({ name, path: join(tmp, name) }))))
writeFileSync(join(tmp, 'policy.json'), JSON.stringify({ rules: [{ path: repo, bases: join(tmp, 'bases.json') }, { path: join(tmp, 'libre'), free: true }] }))
process.env.MRG_REPOS_FILE = join(tmp, 'repos.json')
process.env.MRG_POLICY_FILE = join(tmp, 'policy.json')

const { startServer } = await import('./server.mjs')
const { port, token, close } = await startServer()
const base = `http://127.0.0.1:${port}`
let failures = 0

function check(label, ok) {
  if (!ok) failures++
  console.log(ok ? 'ok   ' : 'FALLA', label)
}
async function call(path, body, tok = token) {
  const r = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Token': tok, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  return [r.status, await r.json()]
}
const act = async (action, extra = {}) => (await call('/api/action', { repo: 'app', action, ...extra }))[0]
const state = async () => (await call('/api/repos'))[1][0]
const head = () => sh(repo, 'git', 'rev-parse', 'HEAD')

try {
  check('rechaza token incorrecto', (await call('/api/repos', null, 'x'))[0] === 403)
  const all = (await call('/api/repos'))[1]
  check('sin regla, la rama por defecto queda protegida', all[1].branch === 'master' && all[1].protected)
  check('una regla explícita puede liberar un repo', all[2].branch === 'master' && !all[2].protected)
  appendFileSync(join(repo, 'a.txt'), '2\n')
  writeFileSync(join(repo, 'nuevo ñ.txt'), 'x\n')
  let s = await state()
  check('master figura protegida', s.protected && s.branch === 'master')
  check('lista los dos archivos', s.changes.length === 2)
  check('diff de archivo nuevo', (await call('/api/diff?repo=app&path=' + encodeURIComponent('nuevo ñ.txt')))[1].diff.includes('+x'))
  check('rechaza ruta desconocida', (await act('stage', { path: '../etc/passwd' })) === 400)
  check('stage', (await act('stage', { path: 'a.txt' })) === 200 && (await state()).staged.length === 1)
  check('unstage', (await act('unstage', { path: 'a.txt' })) === 200 && !(await state()).staged.length)
  await act('stage', { path: 'a.txt' })
  const before = head()
  check('bloquea commit en master', (await act('commit', { message: 'no' })) === 400)
  check('bloquea push en master', (await act('push')) === 400)
  check('master no se movió', before === head())
  check('rechaza nombre de rama inválido', (await act('create_branch', { branch: '-x' })) === 400)
  check('crea rama desde origin/master', (await act('create_branch', { branch: 'rama-prueba' })) === 200)
  s = await state()
  check('la rama nueva no está protegida y conserva lo staged', s.branch === 'rama-prueba' && !s.protected && s.staged.length === 1)
  check('commit sin mensaje falla', (await act('commit', { message: ' ' })) === 400)
  check('commit en la rama', (await act('commit', { message: 'prueba' })) === 200)
  check('push de la rama', (await act('push')) === 200 && (await state()).upstream === 'origin/rama-prueba')
  check('stage de todo y commit', (await act('stage_all')) === 200 && (await act('commit', { message: 'dos' })) === 200)
  check('cambia a rama remota', (await act('switch', { branch: 'origin/otra' })) === 200 && (await state()).branch === 'otra')
  check('rechaza rama inexistente', (await act('switch', { branch: 'nada' })) === 400)
  check('fetch', (await act('fetch')) === 200)
  check('pull', (await act('pull')) === 200)
  const log = (await call('/api/history?repo=app'))[1]
  check('historial', log[0].t === 'init')
  check('detalle de commit', (await call(`/api/commit?repo=app&h=${log[0].h}`))[0] === 200)
  check('rechaza hash inválido', (await call('/api/commit?repo=app&h=HEAD'))[0] === 400)
} finally {
  close()
}
console.log(failures ? `\n${failures} FALLAS` : '\nTODO OK')
process.exit(failures ? 1 : 0)
