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

SEVENZIP="$TMP_DIR/7zz"
ARCHIVE="$TMP_DIR/payload.7z"
decode_section SEVENZIP "$SEVENZIP"
decode_section ARCHIVE "$ARCHIVE"
chmod +x "$SEVENZIP"

DEFAULT_PARENT="${HOME:-.}"
printf "Install parent directory [%s]: " "$DEFAULT_PARENT"
read -r INSTALL_PARENT
INSTALL_PARENT="${INSTALL_PARENT:-$DEFAULT_PARENT}"
mkdir -p "$INSTALL_PARENT"

"$SEVENZIP" x "$ARCHIVE" "-o$INSTALL_PARENT" -y
APP_DIR="$INSTALL_PARENT/EverMemoryArchive"
chmod +x "$APP_DIR/start.sh" "$APP_DIR/configure.sh" 2>/dev/null || true

NODE_PATH_INPUT=""
MONGO_PATH_INPUT=""
MONGO_URI_INPUT=""
if [ "$KIND" = "minimal" ]; then
  printf "Node executable path [PATH]: "
  read -r NODE_PATH_INPUT
  printf "mongod executable path [PATH]: "
  read -r MONGO_PATH_INPUT
  printf "MongoDB URI [start local mongod]: "
  read -r MONGO_URI_INPUT
fi

OPEN_MODE="webview"
printf "Use default browser instead of app/webview window? [y/N]: "
read -r USE_BROWSER_INPUT
case "$USE_BROWSER_INPUT" in
  y|Y|yes|YES)
    OPEN_MODE="browser"
    ;;
esac

cat > "$APP_DIR/ema-runtime.sh" <<EOF
export EMA_NODE_PATH="$NODE_PATH_INPUT"
export EMA_MONGO_PATH="$MONGO_PATH_INPUT"
export EMA_MONGO_URI="$MONGO_URI_INPUT"
export EMA_HOST="127.0.0.1"
export EMA_PORT="3000"
export EMA_OPEN_MODE="$OPEN_MODE"
EOF

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
