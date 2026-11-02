# Multi Repo Git

Plugin para [Orca](https://github.com/stablyai/orca): un Source Control al estilo VS Code con todos tus proyectos, agrupados igual que en Orca. Cambios, commits, ramas e historial, sin entrar repo por repo.

La app corre en una pestaña del navegador de Orca, porque los paneles laterales de los plugins no pueden ejecutar git. Escucha solo en `127.0.0.1` y usa un token que cambia en cada arranque.

## Instalación

Necesitás Orca 1.4.245 o más nuevo.

1. Cloná el repo:

   ```bash
   git clone git@github.com:kevmansilla/orca-multi-repo-git.git ~/orca-plugins/multi-repo-git
   ```

2. En Orca, abrí Settings → Plugins y tocá **Turn on plugins** si están apagados.
3. En **Development folders…**, agregá esa carpeta.
4. Revisá el plugin y habilitalo. Es de acceso completo: corre con tus permisos.

## Cómo se abre

Con `Ctrl+Shift+J`, buscando **Git: Source Control de todos los repos**. También desde Settings → Plugins.

El atajo `Ctrl+Alt+Shift+G` no funciona con el foco en una terminal: Orca solo pasa los atajos de plugins cuando el foco está en otra parte.

## Dejarla siempre disponible (opcional, Linux)

Sin esto, el servidor arranca con el comando y se apaga tras 10 minutos sin uso. Para que la pestaña se abra sola cada vez que abrís Orca, instalá el servicio de usuario de `systemd`. Necesita Node 22.5 o más nuevo.

```bash
bash scripts/install-service.sh          # instala y arranca
bash scripts/install-service.sh url      # muestra la dirección para abrir en el navegador de Orca
bash scripts/install-service.sh remove   # lo desinstala
```

El servidor queda siempre encendido, con unos 80 MB de memoria. Usa un puerto y un token fijos, guardados con permisos `0600` en `~/.config/orca-multi-repo-git/service.env`. Al actualizar el plugin se reinicia solo.

### En qué proyectos aparece

Cada pestaña del navegador de Orca es de un workspace: al cambiar de proyecto, la de otro no se ve. Cada una gasta unos 175 MB, por eso no va en todos. Con `tabsIdleHours` en `policy.json`, la app sigue a tu trabajo:

```json
{ "tabsIdleHours": 2, "tabs": ["Proyecto-Bot-Wp"] }
```

- Aparece sola en los workspaces con actividad en las últimas `tabsIdleHours` horas (según la última actividad que registra Orca), sin cambiarte de proyecto.
- Se cierra sola en los que llevan ese tiempo quietos. Una pestaña que abriste a mano dura por lo menos ese tiempo antes de cerrarse.
- Los de `tabs` (nombre en Orca o carpeta) la tienen siempre. Es opcional.

Cada workspace la recibe una sola vez por arranque de Orca: si la cerrás, no vuelve hasta el próximo arranque.

Sin `tabsIdleHours`, la mantiene solo en los de `tabs`. Sin ninguna de las dos, la abre una vez por arranque de Orca, en el workspace activo.

## Protección

Sin configurar nada, no se puede commitear ni pushear en `main`, `master` ni en la rama por defecto del remoto. El cambio sale de una rama nueva, creada desde esa base.

Para ajustarlo, copiá `policy.example.json` a `~/.config/orca-multi-repo-git/policy.json`. Gana la primera regla que coincida:

| Regla | Efecto |
| --- | --- |
| `"free": true` | Sin ramas protegidas |
| `"protected"` y `"base"` | Protege esas ramas y crea las nuevas desde `base` |
| `"bases"` | Lee la base de cada repo de un JSON: `{ "default": "main", "repos": { "web": "master" } }` |
| `"bases"` y `"protected"` | Lo mismo, y protege también esas ramas. Para cuando lo desplegado no es la base, como `dev` → `main` |
| `"bases"` y `"freeFrom"` | Deja sin ramas protegidas a los repos de una lista externa: `{ "file": "~/config.json", "key": "env.REPOS" }`. La clave puede tener un array o nombres separados por comas. Si no se puede leer, siguen protegidos |

Cada regla se aplica con `path` (ese repo) o `under` (todo lo que esté adentro). `exclude` oculta las carpetas con ese nombre.

La protección es de esta app: no frena un `git push` hecho desde la terminal.

## Comandos propios

Podés agregar botones que abren una terminal de Orca en el repo y corren tus comandos. Se configuran en `policy.json`; sin eso no aparece ninguno.

| Campo | Efecto |
| --- | --- |
| `label`, `run` | Texto del botón, que acepta `{base}`, y comando a correr |
| `hint` | Explicación que aparece al pasar el mouse |
| `under` | Solo para los repos dentro de esa carpeta |
| `when: "merging"` | Solo con un merge o cherry-pick frenado |
| `when: "feature"` | Solo parado en una rama no protegida |
| `warn: true` | Pide confirmación en repos con regla `bases` |

Con `"terminal": "floating"`, cada comando abre una pestaña nueva en la terminal flotante de Orca, sin tocar las que ya están abiertas.

Con `"pullRequests": false` se oculta el botón Abrir PR.

`worktrees` define `create` y `remove`, con `{repo}`, `{path}` y `{branch}` como variables. Los comandos corren con tus permisos, y la protección de ramas de la app no los alcanza.

## Tickets

`"tickets": [{ "under": "~/trabajo", "dir": "~/trabajo/harness/tickets" }]` une cada rama con la carpeta de su ticket. De `ABC-123-algo` busca `ABC-123-*` en `dir` y en `dir/_archivo`, y muestra el estado de `US.md` (`- **Estado:** en curso`). También avisa si `test.md` no tiene nada propio o si `deploy.md` tiene pasos sin ejecutar. Lo que coincide con `_template/` no cuenta.

## Secretos

Antes de agregar archivos como `.env`, `*.pem` o `credentials`, la app pide confirmación. Agregar todo ofrece dejarlos afuera. Antes de cada push muestra el remoto y los commits, y avisa si tocan archivos así, si el push despliega o si la rama sigue a otra.

Se detectan por nombre, no por contenido: un secreto en un archivo común no se ve, salvo que configures `scan`.

`"scan": { "under": "~/trabajo", "run": "~/bin/mi-scanner" }` revisa antes del push las líneas agregadas. El programa recibe rutas de archivos y sale con 0 si no hay nada, o con 1 si encontró algo. Para ver qué encontró, tiene que imprimir `ruta:línea  [tipo]`; la app muestra el archivo y el tipo, nunca el valor. Si el programa falla, la app lo avisa y no deja de pedir confirmación.

## Pruebas

```bash
node test.mjs
```

Corren contra repos temporales y no tocan los tuyos. El aviso `ExperimentalWarning` de SQLite es normal.

## Licencia

MIT
