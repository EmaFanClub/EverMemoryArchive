import fs from "node:fs/promises";
import path from "node:path";
import {
  installerFileName,
  packageFileName,
  platformDistRoot,
  portableStageRoot,
} from "./paths";
import type { PackageKind, Platform } from "./platforms";

export async function createSelfInstaller(
  platform: Platform,
  kind: PackageKind,
  revision: string,
): Promise<string> {
  const outDir = platformDistRoot(platform);
  const archivePath = path.join(
    outDir,
    packageFileName(platform, kind, revision, "7z"),
  );
  const sevenZipPath = installerSevenZipPath(platform);
  const outputPath = path.join(
    outDir,
    installerFileName(platform, kind, revision),
  );

  const [archive, sevenZip] = await Promise.all([
    fs.readFile(archivePath),
    fs.readFile(sevenZipPath),
  ]);
  const script =
    platform.os === "win32"
      ? windowsInstaller(platform, kind, archive, sevenZip)
      : posixInstaller(platform, kind, archive, sevenZip);
  await fs.writeFile(outputPath, script, {
    mode: platform.os === "win32" ? 0o644 : 0o755,
  });
  if (platform.os !== "win32") {
    await fs.chmod(outputPath, 0o755);
  }
  return outputPath;
}

function installerSevenZipPath(platform: Platform): string {
  const binary = platform.os === "win32" ? "7za.exe" : "7zz";
  return path.join(portableStageRoot(platform), "portables", "7zip", binary);
}

function posixInstaller(
  platform: Platform,
  kind: PackageKind,
  archive: Buffer,
  sevenZip: Buffer,
): string {
  return `#!/usr/bin/env bash
set -euo pipefail

PLATFORM="${platform.id}"
KIND="${kind}"
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

DEFAULT_PARENT="\${HOME:-.}"
printf "Install parent directory [%s]: " "$DEFAULT_PARENT"
read -r INSTALL_PARENT
INSTALL_PARENT="\${INSTALL_PARENT:-$DEFAULT_PARENT}"
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
CREATE_SHORTCUT="\${CREATE_SHORTCUT:-Y}"
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
${wrapBase64(sevenZip)}
__EMA_SEVENZIP_END__
__EMA_ARCHIVE_BEGIN__
${wrapBase64(archive)}
__EMA_ARCHIVE_END__
`;
}

function windowsInstaller(
  platform: Platform,
  kind: PackageKind,
  archive: Buffer,
  sevenZip: Buffer,
): string {
  return `@echo off
setlocal EnableExtensions
set "PLATFORM=${platform.id}"
set "KIND=${kind}"
set "TMP_DIR=%TEMP%\\ema-installer-%RANDOM%%RANDOM%%RANDOM%"
set "EXIT_CODE=0"

mkdir "%TMP_DIR%" >nul 2>nul
if errorlevel 1 (
  echo Failed to create temporary directory: "%TMP_DIR%"
  exit /b 1
)

set "SEVENZIP_B64=%TMP_DIR%\\7za.b64"
set "ARCHIVE_B64=%TMP_DIR%\\payload.b64"
set "SEVENZIP_PATH=%TMP_DIR%\\7za.exe"
set "ARCHIVE_PATH=%TMP_DIR%\\payload.7z"

call :extract_section EMA_SEVENZIP "%SEVENZIP_B64%" || goto fail
call :decode_base64 "%SEVENZIP_B64%" "%SEVENZIP_PATH%" || goto fail
call :extract_section EMA_ARCHIVE "%ARCHIVE_B64%" || goto fail
call :decode_base64 "%ARCHIVE_B64%" "%ARCHIVE_PATH%" || goto fail

set "DEFAULT_PARENT=%USERPROFILE%"
set /p INSTALL_PARENT=Install parent directory [%DEFAULT_PARENT%]: 
if not defined INSTALL_PARENT set "INSTALL_PARENT=%DEFAULT_PARENT%"
mkdir "%INSTALL_PARENT%" >nul 2>nul

"%SEVENZIP_PATH%" x "%ARCHIVE_PATH%" "-o%INSTALL_PARENT%" -y
if errorlevel 1 goto fail

set "APP_DIR=%INSTALL_PARENT%\\EverMemoryArchive"
set "NODE_PATH_INPUT="
set "MONGO_PATH_INPUT="
set "MONGO_URI_INPUT="
if /I "%KIND%"=="minimal" (
  set /p NODE_PATH_INPUT=Node executable path [PATH]: 
  set /p MONGO_PATH_INPUT=mongod executable path [PATH]: 
  set /p MONGO_URI_INPUT=MongoDB URI [start local mongod]: 
)

set "OPEN_MODE=webview"
set /p USE_BROWSER=Use default browser instead of app/webview window? [y/N]: 
if /I "%USE_BROWSER%"=="y" set "OPEN_MODE=browser"
if /I "%USE_BROWSER%"=="yes" set "OPEN_MODE=browser"

> "%APP_DIR%\\ema-runtime.cmd" echo set "EMA_NODE_PATH=%NODE_PATH_INPUT%"
>> "%APP_DIR%\\ema-runtime.cmd" echo set "EMA_MONGO_PATH=%MONGO_PATH_INPUT%"
>> "%APP_DIR%\\ema-runtime.cmd" echo set "EMA_MONGO_URI=%MONGO_URI_INPUT%"
>> "%APP_DIR%\\ema-runtime.cmd" echo set "EMA_HOST=127.0.0.1"
>> "%APP_DIR%\\ema-runtime.cmd" echo set "EMA_PORT=3000"
>> "%APP_DIR%\\ema-runtime.cmd" echo set "EMA_OPEN_MODE=%OPEN_MODE%"

set /p CREATE_SHORTCUT=Create desktop shortcut? [Y/n]: 
if not defined CREATE_SHORTCUT set "CREATE_SHORTCUT=Y"
if /I "%CREATE_SHORTCUT%"=="y" call :create_shortcut
if /I "%CREATE_SHORTCUT%"=="yes" call :create_shortcut

echo Installed EverMemoryArchive to "%APP_DIR%"
echo Run "%APP_DIR%\\start.cmd" to start.
goto cleanup

:fail
set "EXIT_CODE=1"
echo Installation failed.
goto cleanup

:cleanup
if exist "%TMP_DIR%" rd /s /q "%TMP_DIR%" >nul 2>nul
exit /b %EXIT_CODE%

:decode_base64
certutil -f -decode "%~1" "%~2" >nul 2>nul
if errorlevel 1 (
  echo Failed to decode "%~1". certutil.exe is required on Windows.
  exit /b 1
)
exit /b 0

:extract_section
set "SECTION=%~1"
set "OUT_FILE=%~2"
set "INSIDE="
> "%OUT_FILE%" (
  for /f "usebackq delims=" %%L in ("%~f0") do (
    if "%%L"=="__%SECTION%_END__" set "INSIDE="
    if defined INSIDE echo(%%L
    if "%%L"=="__%SECTION%_BEGIN__" set "INSIDE=1"
  )
)
exit /b 0

:create_shortcut
set "DESKTOP=%USERPROFILE%\\Desktop"
if not exist "%DESKTOP%" exit /b 0
set "SHORTCUT=%DESKTOP%\\EverMemoryArchive.cmd"
> "%SHORTCUT%" echo @echo off
>> "%SHORTCUT%" echo cd /d "%APP_DIR%"
>> "%SHORTCUT%" echo call "%APP_DIR%\\start.cmd"
echo Created "%SHORTCUT%"
exit /b 0

__EMA_SEVENZIP_BEGIN__
${wrapBase64(sevenZip)}
__EMA_SEVENZIP_END__
__EMA_ARCHIVE_BEGIN__
${wrapBase64(archive)}
__EMA_ARCHIVE_END__
`;
}

function wrapBase64(value: Buffer): string {
  return value
    .toString("base64")
    .replace(/.{1,76}/gu, (chunk) => `${chunk}\n`)
    .trimEnd();
}
