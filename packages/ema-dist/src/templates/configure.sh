#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ema_config_dir() {
  if [ -n "${EMA_CONFIG_HOME:-}" ]; then
    printf '%s\n' "$EMA_CONFIG_HOME"
    return
  fi
  case "$(uname -s)" in
    Darwin)
      printf '%s\n' "${HOME:-.}/Library/Application Support/ema"
      ;;
    *)
      if [ -n "${XDG_CONFIG_HOME:-}" ]; then
        printf '%s\n' "$XDG_CONFIG_HOME/ema"
      else
        printf '%s\n' "${HOME:-.}/.config/ema"
      fi
      ;;
  esac
}

prompt_value() {
  local label="$1"
  local default_value="$2"
  local input
  if [ -n "$default_value" ]; then
    printf "%s [%s]: " "$label" "$default_value" >&2
  else
    printf "%s: " "$label" >&2
  fi
  read -r input
  printf '%s\n' "${input:-$default_value}"
}

write_env_value() {
  case "$2" in
    *$'\n'*|*$'\r'*)
      echo "Refusing to write newline in $1." >&2
      exit 1
      ;;
  esac
  printf '%s=%s\n' "$1" "$2"
}

load_env_file() {
  local file="$1"
  local line key value
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in
      ""|\#*)
        continue
        ;;
      *=*)
        key="${line%%=*}"
        value="${line#*=}"
        ;;
      *)
        continue
        ;;
    esac
    case "$key" in
      EMA_INSTALL_PARENT) EMA_INSTALL_PARENT="$value" ;;
      EMA_INSTALL_DIR) EMA_INSTALL_DIR="$value" ;;
      EMA_NODE_PATH) EMA_NODE_PATH="$value" ;;
      EMA_MONGO_PATH) EMA_MONGO_PATH="$value" ;;
      EMA_MONGO_URI) EMA_MONGO_URI="$value" ;;
      EMA_HOST) EMA_HOST="$value" ;;
      EMA_PORT) EMA_PORT="$value" ;;
      EMA_OPEN_MODE) EMA_OPEN_MODE="$value" ;;
    esac
  done < "$file"
}

CONFIG_DIR="$(ema_config_dir)"
CONFIG_FILE="$CONFIG_DIR/ema-runtime.env"
if [ -f "$CONFIG_FILE" ]; then
  load_env_file "$CONFIG_FILE"
elif [ -f "$APP_ROOT/ema-runtime.env" ]; then
  load_env_file "$APP_ROOT/ema-runtime.env"
fi

NODE_PATH_INPUT="$(prompt_value "Node executable path" "${EMA_NODE_PATH:-}")"
MONGO_PATH_INPUT="$(prompt_value "mongod executable path" "${EMA_MONGO_PATH:-}")"
MONGO_URI_INPUT="$(prompt_value "MongoDB URI [start local mongod]" "${EMA_MONGO_URI:-}")"
HOST_INPUT="$(prompt_value "WebUI host" "${EMA_HOST:-127.0.0.1}")"
PORT_INPUT="$(prompt_value "WebUI port" "${EMA_PORT:-3000}")"
OPEN_MODE_INPUT="$(prompt_value "Open mode [webview/browser/none]" "${EMA_OPEN_MODE:-webview}")"
INSTALL_DIR="${EMA_INSTALL_DIR:-$APP_ROOT}"
INSTALL_PARENT="${EMA_INSTALL_PARENT:-$(dirname "$INSTALL_DIR")}"
case "$OPEN_MODE_INPUT" in
  y|Y|yes|YES)
    OPEN_MODE_INPUT="browser"
    ;;
  n|N|no|NO)
    OPEN_MODE_INPUT="webview"
    ;;
esac

mkdir -p "$CONFIG_DIR"
{
  write_env_value EMA_INSTALL_PARENT "$INSTALL_PARENT"
  write_env_value EMA_INSTALL_DIR "$INSTALL_DIR"
  write_env_value EMA_NODE_PATH "$NODE_PATH_INPUT"
  write_env_value EMA_MONGO_PATH "$MONGO_PATH_INPUT"
  write_env_value EMA_MONGO_URI "$MONGO_URI_INPUT"
  write_env_value EMA_HOST "$HOST_INPUT"
  write_env_value EMA_PORT "$PORT_INPUT"
  write_env_value EMA_OPEN_MODE "$OPEN_MODE_INPUT"
} > "$CONFIG_FILE"

echo "Wrote $CONFIG_FILE"
