#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$APP_ROOT/ema-runtime.sh" ]; then
  # shellcheck disable=SC1091
  . "$APP_ROOT/ema-runtime.sh"
fi

SERVER_JS="$APP_ROOT/{{serverRelativePath}}"
DATA_ROOT="${EMA_DATA_ROOT:-$APP_ROOT/.ema}"
HOST="${EMA_HOST:-127.0.0.1}"
PORT="${EMA_PORT:-3000}"
MONGO_PORT="${EMA_MONGO_PORT:-27017}"
OPEN_MODE="${EMA_OPEN_MODE:-webview}"
NODE_BIN="${EMA_NODE_PATH:-}"
MONGO_BIN="${EMA_MONGO_PATH:-}"

if [ -z "$NODE_BIN" ]; then
  if [ -x "$APP_ROOT/portables/node/bin/node" ]; then
    NODE_BIN="$APP_ROOT/portables/node/bin/node"
  else
    NODE_BIN="$(command -v node || true)"
  fi
fi

if [ -z "$NODE_BIN" ]; then
  echo "Node.js was not found. Run configure.sh or put node on PATH." >&2
  exit 1
fi

mkdir -p "$DATA_ROOT/mongodb" "$DATA_ROOT/logs" "$DATA_ROOT/workspace"

MONGO_URI="${EMA_MONGO_URI:-}"
MONGO_PID=""
if [ -z "$MONGO_URI" ]; then
  if [ -z "$MONGO_BIN" ]; then
    if [ -x "$APP_ROOT/portables/mongodb/bin/mongod" ]; then
      MONGO_BIN="$APP_ROOT/portables/mongodb/bin/mongod"
    else
      MONGO_BIN="$(command -v mongod || true)"
    fi
  fi
  if [ -z "$MONGO_BIN" ]; then
    echo "MongoDB was not found. Run configure.sh, set EMA_MONGO_URI, or put mongod on PATH." >&2
    exit 1
  fi
  MONGO_URI="mongodb://127.0.0.1:$MONGO_PORT/"
  "$MONGO_BIN" --dbpath "$DATA_ROOT/mongodb" --port "$MONGO_PORT" --bind_ip 127.0.0.1 --logpath "$DATA_ROOT/logs/mongodb.log" &
  MONGO_PID="$!"
fi

cleanup() {
  if [ -n "$MONGO_PID" ]; then
    kill "$MONGO_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

export HOSTNAME="$HOST"
export PORT="$PORT"
export EMA_SERVER_MODE=prod
export EMA_SERVER_MONGO_KIND=remote
export EMA_SERVER_MONGO_URI="$MONGO_URI"
export EMA_SERVER_MONGO_DB="${EMA_MONGO_DB:-ema}"
export EMA_SERVER_DATA_ROOT="$DATA_ROOT"

WEBUI_URL="http://$HOST:$PORT/"
if [ "$OPEN_MODE" != "none" ]; then
  "$APP_ROOT/open-webui.sh" "$WEBUI_URL" "$OPEN_MODE" "$NODE_BIN" &
fi

echo "EverMemoryArchive is starting at $WEBUI_URL"
"$NODE_BIN" "$SERVER_JS"
