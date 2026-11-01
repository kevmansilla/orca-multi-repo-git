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

Con `Ctrl+Shift+J`, buscando **Source Control: Abrir**. También desde Settings → Plugins.

El atajo `Ctrl+Alt+Shift+G` no funciona con el foco en una terminal: Orca solo pasa los atajos de plugins cuando el foco está en otra parte.

## Dejarla siempre disponible (opcional, Linux)

Sin esto, el servidor arranca con el comando y se apaga tras 10 minutos sin uso. Para que la pestaña se abra sola cada vez que abrís Orca, instalá el servicio de usuario de `systemd`. Necesita Node 22.5 o más nuevo.

```bash
bash scripts/install-service.sh          # instala y arranca
bash scripts/install-service.sh url      # muestra la dirección para abrir en el navegador de Orca
bash scripts/install-service.sh remove   # lo desinstala
```

El servidor queda siempre encendido, con unos 80 MB de memoria. Usa un puerto y un token fijos, guardados con permisos `0600` en `~/.config/orca-multi-repo-git/service.env`. Al actualizar el plugin se reinicia solo. La pestaña se abre en el workspace activo, no vuelve a la posición donde la tenías.

## Protección

Sin configurar nada, no se puede commitear ni pushear en `main`, `master` ni en la rama por defecto del remoto. El cambio sale de una rama nueva, creada desde esa base.

Para ajustarlo, copiá `policy.example.json` a `~/.config/orca-multi-repo-git/policy.json`. Gana la primera regla que coincida:

| Regla | Efecto |
| --- | --- |
| `"free": true` | Sin ramas protegidas |
| `"protected"` y `"base"` | Protege esas ramas y crea las nuevas desde `base` |
| `"bases"` | Lee la base de cada repo de un JSON: `{ "default": "main", "repos": { "web": "master" } }` |

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

Con `"terminal": "floating"`, los comandos corren en la terminal flotante de Orca si está esperando un comando. Si no, o si tiene un programa abierto, se abre una pestaña nueva.

`worktrees` define `create` y `remove`, con `{repo}`, `{path}` y `{branch}` como variables. Los comandos corren con tus permisos, y la protección de ramas de la app no los alcanza.

## Secretos

Antes de agregar archivos como `.env`, `*.pem` o `credentials`, la app pide confirmación. Agregar todo ofrece dejarlos afuera. Antes de cada push muestra el remoto y los commits, y avisa si tocan archivos así.

Se detectan por nombre, no por contenido: un secreto en un archivo común no se ve.

## Pruebas

```bash
node test.mjs
```

Corren contra repos temporales y no tocan los tuyos. El aviso `ExperimentalWarning` de SQLite es normal.

## Licencia

MIT
