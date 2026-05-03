#!/usr/bin/env bash
set -euo pipefail

PLATFORM="{{platformId}}"
KIND="{{kind}}"
TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

extract_section() {
  awk "/^__EMA_$1_BEGIN__$/ {flag=1; next} /^__EMA_$1_END__$/ {flag=0} flag {print}" "$0"
}

decode_section() {
  if base64 --help 2>/dev/null | grep -q -- "--decode"; then
    extract_section "$1" | base64 --decode > "$2"
  else
    extract_section "$1" | base64 -D > "$2"
  fi
}

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

SEVENZIP="$TMP_DIR/7zz"
ARCHIVE="$TMP_DIR/payload.7z"
decode_section SEVENZIP "$SEVENZIP"
decode_section ARCHIVE "$ARCHIVE"
chmod +x "$SEVENZIP"

CONFIG_DIR="$(ema_config_dir)"
CONFIG_FILE="$CONFIG_DIR/ema-runtime.env"
if [ -f "$CONFIG_FILE" ]; then
  load_env_file "$CONFIG_FILE"
fi

DEFAULT_PARENT="${EMA_INSTALL_PARENT:-${HOME:-.}}"
INSTALL_PARENT="$(prompt_value "Install parent directory" "$DEFAULT_PARENT")"
mkdir -p "$INSTALL_PARENT"

"$SEVENZIP" x "$ARCHIVE" "-o$INSTALL_PARENT" -y
APP_DIR="$INSTALL_PARENT/EverMemoryArchive"
chmod +x "$APP_DIR/start.sh" "$APP_DIR/configure.sh" 2>/dev/null || true

NODE_PATH_INPUT=""
MONGO_PATH_INPUT=""
MONGO_URI_INPUT=""
if [ "$KIND" = "minimal" ]; then
  NODE_PATH_INPUT="$(prompt_value "Node executable path" "${EMA_NODE_PATH:-}")"
  MONGO_PATH_INPUT="$(prompt_value "mongod executable path" "${EMA_MONGO_PATH:-}")"
  MONGO_URI_INPUT="$(prompt_value "MongoDB URI [start local mongod]" "${EMA_MONGO_URI:-}")"
fi

OPEN_MODE="$(prompt_value "Open mode [webview/browser/none]" "${EMA_OPEN_MODE:-webview}")"
case "$OPEN_MODE" in
  y|Y|yes|YES)
    OPEN_MODE="browser"
    ;;
  n|N|no|NO)
    OPEN_MODE="webview"
    ;;
esac

mkdir -p "$CONFIG_DIR"
{
  write_env_value EMA_INSTALL_PARENT "$INSTALL_PARENT"
  write_env_value EMA_INSTALL_DIR "$APP_DIR"
  write_env_value EMA_NODE_PATH "$NODE_PATH_INPUT"
  write_env_value EMA_MONGO_PATH "$MONGO_PATH_INPUT"
  write_env_value EMA_MONGO_URI "$MONGO_URI_INPUT"
  write_env_value EMA_HOST "${EMA_HOST:-127.0.0.1}"
  write_env_value EMA_PORT "${EMA_PORT:-3000}"
  write_env_value EMA_OPEN_MODE "$OPEN_MODE"
} > "$CONFIG_FILE"
echo "Wrote $CONFIG_FILE"

printf "Create shortcut? [Y/n]: "
read -r CREATE_SHORTCUT
CREATE_SHORTCUT="${CREATE_SHORTCUT:-Y}"
case "$CREATE_SHORTCUT" in
  y|Y|yes|YES)
    if [ "$PLATFORM" = "darwin-x64" ] || [ "$PLATFORM" = "darwin-arm64" ]; then
      SHORTCUT="$HOME/Desktop/EverMemoryArchive.command"
      cat > "$SHORTCUT" <<EOF
#!/usr/bin/env bash
cd "$APP_DIR"
exec ./start.sh
EOF
      chmod +x "$SHORTCUT"
    else
      mkdir -p "$HOME/.local/share/applications"
      DESKTOP_FILE="$HOME/.local/share/applications/evermemoryarchive.desktop"
      cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=EverMemoryArchive
Exec=$APP_DIR/start.sh
Path=$APP_DIR
Terminal=true
Categories=Utility;
EOF
      if [ -d "$HOME/Desktop" ]; then
        cp "$DESKTOP_FILE" "$HOME/Desktop/EverMemoryArchive.desktop"
        chmod +x "$HOME/Desktop/EverMemoryArchive.desktop"
      fi
    fi
    ;;
esac

echo "Installed EverMemoryArchive to $APP_DIR"
echo "Run $APP_DIR/start.sh to start."
exit 0

__EMA_SEVENZIP_BEGIN__
{{sevenZipBase64}}
__EMA_SEVENZIP_END__
__EMA_ARCHIVE_BEGIN__
{{archiveBase64}}
__EMA_ARCHIVE_END__
