#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
read -r -p "Node executable path [PATH or portable]: " NODE_PATH_INPUT
read -r -p "mongod executable path [PATH or portable]: " MONGO_PATH_INPUT
read -r -p "MongoDB URI [start local mongod]: " MONGO_URI_INPUT
read -r -p "WebUI host [127.0.0.1]: " HOST_INPUT
read -r -p "WebUI port [3000]: " PORT_INPUT
read -r -p "Use default browser instead of app/webview window? [y/N]: " USE_BROWSER_INPUT

OPEN_MODE="webview"
case "$USE_BROWSER_INPUT" in
  y|Y|yes|YES)
    OPEN_MODE="browser"
    ;;
esac

cat > "$APP_ROOT/ema-runtime.sh" <<EOF
export EMA_NODE_PATH="$NODE_PATH_INPUT"
export EMA_MONGO_PATH="$MONGO_PATH_INPUT"
export EMA_MONGO_URI="$MONGO_URI_INPUT"
export EMA_HOST="${HOST_INPUT:-127.0.0.1}"
export EMA_PORT="${PORT_INPUT:-3000}"
export EMA_OPEN_MODE="$OPEN_MODE"
EOF

echo "Wrote $APP_ROOT/ema-runtime.sh"
