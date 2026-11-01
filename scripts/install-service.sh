#!/usr/bin/env bash
# Instala el servidor como servicio de usuario de systemd, con puerto y token fijos.
set -euo pipefail

NAME=orca-multi-repo-git
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}"
ENV_FILE="$CONFIG/$NAME/service.env"
UNIT="$CONFIG/systemd/user/$NAME.service"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEFAULT_PORT=37321

url() {
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  echo "http://127.0.0.1:$MRG_PORT/?t=$MRG_TOKEN"
}

case "${1:-install}" in
  url)
    url
    exit 0
    ;;
  remove)
    systemctl --user disable --now "$NAME" 2>/dev/null || true
    rm -f "$UNIT" "$ENV_FILE"
    systemctl --user daemon-reload
    echo "Servicio desinstalado."
    exit 0
    ;;
  install) ;;
  *)
    echo "Uso: $0 [install|url|remove]" >&2
    exit 2
    ;;
esac

command -v systemctl >/dev/null || { echo "Este instalador necesita systemd." >&2; exit 1; }
NODE="$(command -v node)" || { echo "No encontré node." >&2; exit 1; }
"$NODE" -e "require('node:sqlite')" 2>/dev/null || { echo "Hace falta Node 22.5 o más nuevo." >&2; exit 1; }

mkdir -p "$(dirname "$ENV_FILE")" "$(dirname "$UNIT")"
if [ ! -f "$ENV_FILE" ]; then
  # El token se conserva entre instalaciones: si cambia, la pestaña guardada deja de funcionar.
  TOKEN="$("$NODE" -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))")"
  (umask 077 && printf 'MRG_PORT=%s\nMRG_TOKEN=%s\n' "$DEFAULT_PORT" "$TOKEN" > "$ENV_FILE")
fi

cat > "$UNIT" <<UNIT_EOF
[Unit]
Description=Source Control para Orca

[Service]
EnvironmentFile=$ENV_FILE
ExecStart=$NODE --no-warnings $ROOT/daemon.mjs
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
UNIT_EOF

systemctl --user daemon-reload
systemctl --user enable "$NAME" >/dev/null 2>&1
systemctl --user restart "$NAME"
echo "Servicio activo. Para ver la dirección: bash $ROOT/scripts/install-service.sh url"
