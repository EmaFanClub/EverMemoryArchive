#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
URL="${1:?URL is required}"
MODE="${2:-webview}"
NODE_BIN="${3:-node}"

if [ "$MODE" = "none" ]; then
  exit 0
fi

"$NODE_BIN" "$APP_ROOT/launcher/open-webui.mjs" "$URL" "$MODE"
