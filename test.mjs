// Prueba las acciones de la app contra un repo descartable en una carpeta temporal. No toca los repos reales.
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const tmp = mkdtempSync(join(tmpdir(), 'mrg-test-'))
const repo = join(tmp, 'app')
const sh = (cwd, ...args) => execFileSync(args[0], args.slice(1), { cwd, stdio: 'pipe' }).toString()

sh(tmp, 'git', 'init', '-q', '--bare', '-b', 'master', 'remote.git')
sh(tmp, 'git', 'clone', '-q', 'remote.git', 'app')
sh(repo, 'git', 'config', 'user.email', 'test@example.com')
sh(repo, 'git', 'config', 'user.name', 'test')
// El ignore global de cada máquina puede esconder los .env y volver inútiles las pruebas de secretos.
sh(repo, 'git', 'config', 'core.excludesFile', '/dev/null')
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
sh(tmp, 'git', 'clone', '-q', 'remote.git', 'mixta')
writeFileSync(join(tmp, 'bases.json'), JSON.stringify({ default: 'main', repos: { app: 'master' }, diagnostico: {}, git_libre: [] }))
writeFileSync(join(tmp, 'bases-mixta.json'), JSON.stringify({ default: 'dev' }))
sh(tmp, 'git', 'clone', '-q', 'remote.git', 'editable')
sh(tmp, 'git', 'clone', '-q', 'remote.git', 'cerrada')
writeFileSync(join(tmp, 'bases-editables.json'), JSON.stringify({ default: 'master' }))
writeFileSync(join(tmp, 'settings.json'), JSON.stringify({ env: { EDITABLES: 'otro, editable' } }))
writeFileSync(join(tmp, 'repos.json'), JSON.stringify(['app', 'sin-regla', 'libre', 'mixta', 'editable', 'cerrada'].map((name) => ({ name, path: join(tmp, name) }))))
// Como el pre-push del harness: un push a una rama tiene que nombrar esa misma rama, no HEAD.
writeFileSync(join(repo, '.git/hooks/pre-push'), `#!/bin/sh
while read -r local_ref local_sha remote_ref remote_sha; do [ "$local_ref" = "$remote_ref" ] || exit 1; done
`, { mode: 0o755 })
const tickets = join(tmp, 'tickets')
mkdirSync(join(tickets, '_template'), { recursive: true })
mkdirSync(join(tickets, 'ABC-7-prueba'))
writeFileSync(join(tickets, '_template/test.md'), '# Test\n<!-- nota -->\n1. (paso)\n')
writeFileSync(join(tickets, '_template/deploy.md'), '# Deploy\n**No.**\n')
writeFileSync(join(tickets, 'ABC-7-prueba/US.md'), '# ABC-7\n\n- **Estado:** en curso\n')
writeFileSync(join(tickets, 'ABC-7-prueba/test.md'), '# Test\n1. (paso)\n')
writeFileSync(join(tickets, 'ABC-7-prueba/deploy.md'), '# Deploy\n**No.**\n- `make rebuild`\n')
const scanner = join(tmp, 'scanner.sh')
writeFileSync(scanner, `#!/bin/sh
if grep -q FALLA "$@"; then exit 3; fi
grep -l CLAVE "$@" | while read -r f; do echo "  $f:1  [token/credencial — credencial]" >&2; echo "     CLAVE-REAL" >&2; done
grep -q CLAVE "$@" && exit 1
exit 0
`, { mode: 0o755 })
writeFileSync(join(tmp, 'policy.json'), JSON.stringify({
  tickets: [{ under: tmp, dir: tickets }],
  scan: { under: tmp, run: scanner },
  rules: [
    { path: repo, bases: join(tmp, 'bases.json') },
    { path: join(tmp, 'libre'), free: true },
    { path: join(tmp, 'mixta'), bases: join(tmp, 'bases-mixta.json'), protected: ['master'] },
    { path: join(tmp, 'editable'), bases: join(tmp, 'bases-editables.json'), freeFrom: { file: join(tmp, 'settings.json'), key: 'env.EDITABLES' } },
    { path: join(tmp, 'cerrada'), bases: join(tmp, 'bases-editables.json'), freeFrom: { file: join(tmp, 'no-existe.json'), key: 'env.EDITABLES' } }
  ],
  commands: [
    { label: 'Mergear', run: 'git p -m', warn: true },
    { label: 'Continuar', run: 'git p -c', when: 'merging' },
    { label: 'Otro', run: 'git otro', under: join(tmp, 'libre') },
    { label: 'A {base}', run: 'git a', when: 'feature' }
  ],
  worktrees: { create: 'git wt {repo} {branch}', remove: 'git wt -d {repo} {branch}' }
}))
process.env.MRG_REPOS_FILE = join(tmp, 'repos.json')
process.env.MRG_POLICY_FILE = join(tmp, 'policy.json')

const { fillCommand, prUrl, shellQuote, startServer } = await import('./server.mjs')
const opened = []
const { port, token, close } = await startServer({ terminal: async (t) => opened.push(t) })
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
  check('bases y protected se combinan', all[3].base === 'dev' && all[3].branch === 'master' && all[3].protected)
  check('con protected, un push a la base no se avisa como despliegue', all[3].deploys === false)
  check('freeFrom libera los repos de la lista y mantiene el aviso', all[4].branch === 'master' && !all[4].protected && all[4].deploys === true)
  const editablePush = (await call('/api/push?repo=editable'))[1]
  check('el push a la base de un repo que despliega se avisa', editablePush.deploysBase === 'master')
  check('si la lista de freeFrom no se puede leer, sigue protegido', all[5].branch === 'master' && all[5].protected)
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
  const noRemote = await call('/api/action', { repo: 'app', action: 'pull' })
  check('pull sin rama remota explica que falta el push', noRemote[0] === 400 && noRemote[1].error.includes('Push'))
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
  writeFileSync(join(repo, '.env'), 'CLAVE=x\n')
  writeFileSync(join(repo, '.env.example'), 'CLAVE=\n')
  writeFileSync(join(repo, 'ok ñ.txt'), 'ok\n')
  mkdirSync(join(repo, 'conf'))
  writeFileSync(join(repo, 'conf/prod.pem'), 'x\n')
  const blocked = await call('/api/action', { repo: 'app', action: 'stage_all' })
  check('frena agregar todo con secretos, también dentro de una carpeta nueva', blocked[0] === 409 && blocked[1].sensitive.join() === '.env,conf/prod.pem')
  check('al frenar no agrega nada', !(await state()).staged.length)
  check('frena un archivo secreto suelto', (await act('stage', { path: '.env' })) === 409)
  check('frena una carpeta con un secreto adentro', (await act('stage', { path: 'conf/' })) === 409)
  check('agrega el resto sin los secretos', (await act('stage_all', { allow: 'skip' })) === 200)
  s = await state()
  check('el resto queda staged y los secretos no', s.staged.map((f) => f.p).sort().join() === '.env.example,ok ñ.txt' && s.changes.some((f) => f.p === '.env' && f.sensitive))
  check('.env.example no se marca como secreto', !s.staged.some((f) => f.sensitive))
  check('agrega el secreto si se confirma', (await act('stage', { path: '.env', allow: 'all' })) === 200)
  check('commit con el secreto', (await act('commit', { message: 'con secreto' })) === 200)
  const preview = (await call('/api/push?repo=app'))[1]
  check('la vista previa del push lista commits y secretos', preview.count === 1 && preview.commits[0].t === 'con secreto' && preview.sensitive.join() === '.env')
  await act('create_branch', { branch: 'abc-7-prueba' })
  check('une la rama con su ticket', (await state()).ticket?.id === 'ABC-7' && (await state()).ticket.state === 'en curso')
  check('test.md igual a la plantilla cuenta como faltante', (await state()).ticket.testMissing === true)
  check('deploy.md con pasos propios queda pendiente', (await state()).ticket.deployPending === true)
  writeFileSync(join(tickets, 'ABC-7-prueba/deploy.md'), '- **Estado:** ejecutado 2026-01-01\n- `make rebuild`\n')
  check('deploy.md ejecutado deja de estar pendiente', (await state()).ticket.deployPending === false)
  writeFileSync(join(repo, 'clave.txt'), 'CLAVE=abc\n')
  await act('stage', { path: 'clave.txt' })
  await act('commit', { message: 'agrega clave' })
  const dirty = (await call('/api/push?repo=app'))[1]
  check('encuentra datos sensibles en lo agregado', dirty.contentHits.join() === 'clave.txt: token/credencial')
  check('no devuelve el valor encontrado', !JSON.stringify(dirty).includes('CLAVE-REAL'))
  sh(repo, 'git', 'branch', '--set-upstream-to=origin/master')
  const crossed = await state()
  check('detecta una rama que sigue a otra', crossed.crossedUpstream === 'origin/master')
  const crossedPush = (await call('/api/push?repo=app'))[1]
  check('con upstream cruzado la vista previa no se compara contra esa otra rama', crossedPush.crossedUpstream === 'origin/master' && crossedPush.isNew === true)
  check('el push corrige el upstream y no toca master', (await act('push')) === 200 && (await state()).upstream === 'origin/abc-7-prueba' && !sh(tmp, 'git', '--git-dir=remote.git', 'log', 'master', '--format=%s').includes('agrega clave'))
  writeFileSync(join(repo, 'limpio.txt'), 'nada\n')
  await act('stage', { path: 'limpio.txt' })
  await act('commit', { message: 'limpio' })
  const clean = (await call('/api/push?repo=app'))[1]
  check('lo ya subido no se vuelve a señalar', clean.contentHits.length === 0 && !clean.scanFailed)
  writeFileSync(join(repo, 'roto.txt'), 'FALLA\n')
  await act('stage', { path: 'roto.txt' })
  await act('commit', { message: 'roto' })
  check('avisa si el scanner falla', (await call('/api/push?repo=app'))[1].scanFailed === true)
  await act('switch', { branch: 'master' })
  check('no hay vista previa de push en rama protegida', (await call('/api/push?repo=app'))[0] === 400)
  appendFileSync(join(repo, 'a.txt'), 'descartar\n')
  writeFileSync(join(repo, 'nuevo.txt'), 'x\n')
  check('descarta un cambio', (await act('discard', { path: 'a.txt' })) === 200 && !readFileSync(join(repo, 'a.txt'), 'utf8').includes('descartar'))
  check('borra un archivo nuevo', (await act('discard', { path: 'nuevo.txt' })) === 200 && !existsSync(join(repo, 'nuevo.txt')))
  check('borra una carpeta nueva', (await act('discard', { path: 'conf/' })) === 200 && !existsSync(join(repo, 'conf')))
  check('rechaza descartar lo que no cambió', (await act('discard', { path: 'a.txt' })) === 400)
  check('fetch de todos los repos', (await call('/api/fetch-all', {}))[1].failed === 0)
  check('no repite el fetch enseguida', (await call('/api/fetch-all', {}))[1].skipped === true)
  check('link de PR en GitHub', prUrl('git@github.com:a/b.git', 'x/y', 'main') === 'https://github.com/a/b/compare/main...x/y?expand=1')
  check('link de PR en Bitbucket', prUrl('https://u:t@bitbucket.org/a/b.git', 'x', 'dev') === 'https://bitbucket.org/a/b/pull-requests/new?source=x&t=1')
  check('sin link de PR en un host desconocido', prUrl('git@mi-alias:a/b.git', 'x', 'main') === null)
  const repoInfo = await state()
  check('muestra solo los comandos que aplican', repoInfo.commands.map((c) => c.label).join() === 'Mergear')
  check('marca el repo que despliega', repoInfo.deploys === true)
  const run = async (body) => (await call('/api/run', { repo: 'app', ...body }))[0]
  check('abre la terminal con el comando configurado', (await run({ command: 0 })) === 200 && opened.at(-1).command === `cd ${shellQuote(repo)} && git p -m`)
  check('rechaza un comando desconocido', (await run({ command: 9 })) === 400)
  check('rechaza un comando de otro repo', (await run({ command: 2 })) === 400)
  check('rechaza crear worktree con rama inválida', (await run({ command: 'wt-create', branch: '-x; rm' })) === 400)
  check('crea worktree con el comando configurado', (await run({ command: 'wt-create', branch: 'rama-wt' })) === 200 && opened.at(-1).command === `git wt ${shellQuote(repo)} 'rama-wt'`)
  check('rechaza borrar el repo principal como worktree', (await run({ command: 'wt-remove' })) === 400)
  check('escapa comillas al armar el comando', fillCommand('x {branch}', { branch: "a'b" }) === `x 'a'\\''b'`)
  sh(repo, 'git', 'worktree', 'add', '-q', '-b', 'rama-real', join(tmp, 'wt-real'), 'HEAD')
  const withWt = (await call('/api/repos?fresh=1'))[1]
  const wt = withWt.find((r) => r.worktreeOf === 'app')
  check('lista el worktree debajo de su repo', wt?.branch === 'rama-real' && wt.key === join(tmp, 'wt-real'))
  check('el worktree hereda las reglas de su repo', wt?.base === 'master' && wt.deploys === true)
  check('borra un worktree con el comando configurado', (await call('/api/run', { repo: wt.key, command: 'wt-remove' }))[0] === 200 && opened.at(-1).command === `git wt -d ${shellQuote(repo)} 'rama-real'`)
  sh(repo, 'git', 'worktree', 'add', '-q', '--detach', join(tmp, 'wt-suelto'), 'HEAD')
  const suelto = (await call('/api/repos?fresh=1'))[1].find((r) => r.key === join(tmp, 'wt-suelto'))
  check('borra un worktree detached por la ruta', (await call('/api/run', { repo: suelto.key, command: 'wt-remove' }))[0] === 200 && opened.at(-1).command === `git -C ${shellQuote(repo)} worktree remove ${shellQuote(suelto.key)}`)
  check('con force confirmado, lo borra aunque tenga cambios', (await call('/api/run', { repo: suelto.key, command: 'wt-remove', force: true }))[0] === 200 && opened.at(-1).command === `git -C ${shellQuote(repo)} worktree remove --force ${shellQuote(suelto.key)}`)
  check('force que no es true no fuerza', (await call('/api/run', { repo: suelto.key, command: 'wt-remove', force: 'true' }))[0] === 200 && !opened.at(-1).command.includes('--force'))
  check('el nombre del botón usa la base del repo', withWt.find((r) => r.key === 'libre').commands.some((c) => c.label === 'A master'))
  check('no ofrece el comando de rama parado en una protegida', !withWt[0].commands.some((c) => c.label === 'A master'))
  writeFileSync(join(repo, '.git', 'MERGE_HEAD'), 'x')
  check('ofrece continuar con un merge frenado', (await call('/api/repos?fresh=1'))[1][0].commands.some((c) => c.label === 'Continuar'))
  rmSync(join(repo, '.git', 'MERGE_HEAD'))
  const wtMerge = join(tmp, 'wt-merge')
  const merged = async () => (await call('/api/repos?fresh=1'))[1].find((r) => r.key === wtMerge).merged
  sh(repo, 'git', 'fetch', '-q', 'origin')
  sh(repo, 'git', 'worktree', 'add', '-q', '-b', 'rama-merge', wtMerge, 'origin/master')
  check('una rama recién sacada de la base no figura como mergeada', (await merged()) === null)
  writeFileSync(join(wtMerge, 'm.txt'), 'm\n')
  sh(wtMerge, 'git', 'add', 'm.txt')
  sh(wtMerge, 'git', 'commit', '-qm', 'para mergear')
  check('con commits propios sin mergear no figura como mergeada', (await merged()) === null)
  // Un merge --no-ff a master sin checkoutearla: en este punto master puede estar abierta en el repo de prueba.
  const mergeCommit = sh(repo, 'git', 'commit-tree', 'rama-merge^{tree}', '-p', 'origin/master', '-p', 'rama-merge', '-m', 'merge').trim()
  sh(repo, 'git', 'update-ref', 'refs/heads/master', mergeCommit)
  check('mergeada en la base local y sin push', (await merged()) === 'local')
  sh(repo, 'git', 'update-ref', 'refs/remotes/origin/master', mergeCommit)
  check('mergeada y pusheada', (await merged()) === 'remote')
  const policyFile = process.env.MRG_POLICY_FILE
  const policyBefore = readFileSync(policyFile, 'utf8')
  writeFileSync(policyFile, JSON.stringify({ ...JSON.parse(policyBefore), standingBranches: ['rama-merge'] }))
  const standing = (await call('/api/repos?fresh=1'))[1].find((r) => r.key === wtMerge)
  check('una rama fija (standingBranches) no figura como mergeada ni ofrece el comando de rama', standing.merged === null && !standing.commands.some((c) => c.label.startsWith('A ')))
  writeFileSync(policyFile, policyBefore)
  const { matches } = await import('./orca-launch.mjs')
  const ws = { displayName: 'Proyecto-Bot-Wp', path: join(homedir(), 'Proyecto') }
  check('la pestaña fija reconoce el workspace por nombre', matches('Proyecto-Bot-Wp', ws))
  check('la pestaña fija reconoce el workspace por carpeta', matches('~/Proyecto/', ws) && matches(ws.path, ws))
  check('la pestaña fija no toma otro workspace', !matches('Proyecto', ws) && !matches('~/Proyecto/otro', ws))
  const { plan, pendingTabs, markTried, parseOpened } = await import('./orca-launch.mjs')
  const H = 3_600_000
  const now = 10 * H
  const w = (id, ago) => ({ id, displayName: id, path: '/x/' + id, lastActivityAt: now - ago })
  const wts = [w('activo', 0.1 * H), w('quieto', 5 * H), w('fijo', 9 * H)]
  const tab = (id) => ({ worktreeId: id, page: 'p-' + id })
  const viejas = new Map([['p-quieto', now - 3 * H], ['p-fijo', now - 9 * H]])
  const auto = plan({ all: wts, tabs: [tab('quieto'), tab('fijo')], pinned: ['fijo'], idleMs: 2 * H, since: viejas, now })
  check('abre la app donde hubo actividad reciente', auto.open.join() === 'activo')
  check('la cierra donde está quieto, salvo en los fijos', auto.close.join() === 'p-quieto')
  const recien = plan({ all: wts, tabs: [tab('quieto')], pinned: [], idleMs: 2 * H, since: new Map([['p-quieto', now - 0.5 * H]]), now })
  check('no cierra una pestaña que el usuario acaba de abrir', recien.close.length === 0)
  const fijos = plan({ all: wts, tabs: [tab('quieto')], pinned: ['fijo'], idleMs: null, since: viejas, now })
  const M = 60_000
  const abiertas = new Map()
  markTried(abiertas, 'sin-listar', now)
  check('no repite enseguida una pestaña que intentó abrir', pendingTabs(['sin-listar', 'nuevo'], abiertas, [], now + M, 2 * H).join() === 'nuevo')
  check('reintenta una pestaña que nunca apareció', pendingTabs(['sin-listar'], abiertas, [], now + 2 * M, 2 * H).join() === 'sin-listar')
  markTried(abiertas, 'sin-listar', now + 2 * M)
  markTried(abiertas, 'sin-listar', now + 4 * M)
  check('después de tres intentos espera como una cerrada', pendingTabs(['sin-listar'], abiertas, [], now + 7 * M, 2 * H).length === 0 &&
    pendingTabs(['sin-listar'], abiertas, [], now + 4 * M + 2 * H, 2 * H).join() === 'sin-listar')
  check('no reabre enseguida una pestaña que figuró y dejó de figurar', pendingTabs(['listada'], abiertas, [{ worktreeId: 'listada' }], now, 2 * H).length === 0 &&
    pendingTabs(['listada'], abiertas, [], now + 5 * M, 2 * H).length === 0)
  check('la cerrada vuelve pasado tabsIdleHours', pendingTabs(['listada'], abiertas, [], now + 2 * H, 2 * H).join() === 'listada')
  check('lee el estado viejo como pestañas recién cerradas', parseOpened('{"launch":"1","worktrees":["a"]}', '1', now).get('a').seen === true)
  check('el estado de otro arranque de Orca no cuenta', parseOpened('{"launch":"1","worktrees":{"a":{"at":0,"tries":1,"seen":false}}}', '2', now).size === 0)
  check('un estado ilegible arranca de cero', parseOpened('{roto', '1', now).size === 0)
  const mirando = plan({ all: [{ ...w('quieto', 5 * H), isActive: true }], tabs: [], pinned: [], idleMs: 2 * H, since: viejas, now })
  check('abre la app en el workspace que está mirando, aunque esté quieto', mirando.open.join() === 'quieto')
  check('sin tabsIdleHours solo abre los fijos y no cierra nada', fijos.open.join() === 'fijo' && fijos.close.length === 0)
} finally {
  close()
}
console.log(failures ? `\n${failures} FALLAS` : '\nTODO OK')
process.exit(failures ? 1 : 0)
