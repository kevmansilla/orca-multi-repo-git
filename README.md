# Multi Repo Git

Plugin para [Orca](https://github.com/stablyai/orca): un Source Control al estilo VS Code con todos tus proyectos, agrupados igual que en Orca. Cambios, commits, ramas e historial, sin entrar repo por repo.

La app corre en una pestaña del navegador de Orca, porque los paneles laterales de los plugins no pueden ejecutar git. Escucha solo en `127.0.0.1` y usa un token que cambia en cada arranque.

## Instalación

Necesitás Orca 1.4.245 o más nuevo.

1. Cloná el repo:

   ```bash
   git clone git@github.com:kevmansilla/orca-multi-repo-git.git ~/orca-plugins/multi-repo-git
   ```

2. Agregá esa carpeta a `devPluginPaths` en la configuración de Orca.
3. Aprobá el plugin cuando Orca lo pida, en Settings → Plugins.

## Cómo se abre

Con `Ctrl+Shift+J`, buscando **Source Control: Abrir**. También desde Settings → Plugins.

El atajo `Ctrl+Alt+Shift+G` no funciona con el foco en una terminal: Orca solo pasa los atajos de plugins cuando el foco está en otra parte.

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
