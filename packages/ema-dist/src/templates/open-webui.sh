#!/usr/bin/env bash
set -euo pipefail

URL="${1:?URL is required}"
MODE="${2:-webview}"
NODE_BIN="${3:-node}"

if [ "$MODE" = "none" ]; then
  exit 0
fi

wait_for_webui() {
  "$NODE_BIN" - "$URL" <<'NODE'
const url = process.argv[2];
const deadline = Date.now() + 30000;

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

while (Date.now() < deadline) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    if (response.status < 500) {
      process.exit(0);
    }
  } catch {
    // Keep waiting until the server starts accepting connections.
  }
  await sleep(500);
}

process.exit(1);
NODE
}

open_default_browser() {
  case "$(uname -s)" in
    Darwin)
      open "$URL" >/dev/null 2>&1 &
      return 0
      ;;
  esac

  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 &
    return 0
  fi
  if command -v gio >/dev/null 2>&1; then
    gio open "$URL" >/dev/null 2>&1 &
    return 0
  fi
  echo "No default browser opener was found. Open $URL manually." >&2
}

open_webview_window() {
  case "$(uname -s)" in
    Darwin)
      for app in "Microsoft Edge" "Google Chrome" "Chromium" "Brave Browser"; do
        if open -Ra "$app" >/dev/null 2>&1; then
          open -na "$app" --args --app="$URL" >/dev/null 2>&1 &
          return 0
        fi
      done
      ;;
    *)
      for command in microsoft-edge-stable microsoft-edge msedge google-chrome-stable google-chrome chromium chromium-browser brave-browser; do
        if command -v "$command" >/dev/null 2>&1; then
          "$command" --app="$URL" >/dev/null 2>&1 &
          return 0
        fi
      done
      ;;
  esac

  open_default_browser
}

wait_for_webui || exit 0
case "$MODE" in
  browser)
    open_default_browser
    ;;
  webview|"")
    open_webview_window
    ;;
  *)
    echo "Unknown EMA_OPEN_MODE '$MODE'; falling back to webview." >&2
    open_webview_window
    ;;
esac
