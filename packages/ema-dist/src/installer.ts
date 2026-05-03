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
  return `$ErrorActionPreference = "Stop"
$Platform = "${platform.id}"
$Kind = "${kind}"
$SevenZipBase64 = @'
${wrapBase64(sevenZip)}
'@
$ArchiveBase64 = @'
${wrapBase64(archive)}
'@

$TempDir = Join-Path $env:TEMP ("ema-installer-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
try {
  $SevenZipPath = Join-Path $TempDir "7za.exe"
  $ArchivePath = Join-Path $TempDir "payload.7z"
  [IO.File]::WriteAllBytes($SevenZipPath, [Convert]::FromBase64String(($SevenZipBase64 -replace "\\s", "")))
  [IO.File]::WriteAllBytes($ArchivePath, [Convert]::FromBase64String(($ArchiveBase64 -replace "\\s", "")))

  $DefaultParent = $env:USERPROFILE
  $InstallParent = Read-Host "Install parent directory [$DefaultParent]"
  if ([string]::IsNullOrWhiteSpace($InstallParent)) {
    $InstallParent = $DefaultParent
  }
  New-Item -ItemType Directory -Force -Path $InstallParent | Out-Null

  & $SevenZipPath x $ArchivePath "-o$InstallParent" -y
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  $AppDir = Join-Path $InstallParent "EverMemoryArchive"
  $NodePath = ""
  $MongoPath = ""
  $MongoUri = ""
  if ($Kind -eq "minimal") {
    $NodePath = Read-Host "Node executable path [PATH]"
    $MongoPath = Read-Host "mongod executable path [PATH]"
    $MongoUri = Read-Host "MongoDB URI [start local mongod]"
  }

  $UseBrowser = Read-Host "Use default browser instead of app/webview window? [y/N]"
  $OpenMode = "webview"
  if ($UseBrowser -match "^(y|yes)$") {
    $OpenMode = "browser"
  }

  $RuntimeCmd = @(
    'set "EMA_NODE_PATH=' + ($NodePath -replace '"', '') + '"',
    'set "EMA_MONGO_PATH=' + ($MongoPath -replace '"', '') + '"',
    'set "EMA_MONGO_URI=' + ($MongoUri -replace '"', '') + '"',
    'set "EMA_HOST=127.0.0.1"',
    'set "EMA_PORT=3000"',
    'set "EMA_OPEN_MODE=' + $OpenMode + '"'
  ) -join [Environment]::NewLine
  Set-Content -LiteralPath (Join-Path $AppDir "ema-runtime.cmd") -Value $RuntimeCmd -Encoding ASCII

  $CreateShortcut = Read-Host "Create desktop shortcut? [Y/n]"
  if ([string]::IsNullOrWhiteSpace($CreateShortcut) -or $CreateShortcut -match "^(y|yes)$") {
    $Desktop = [Environment]::GetFolderPath("Desktop")
    $ShortcutPath = Join-Path $Desktop "EverMemoryArchive.lnk"
    $Shell = New-Object -ComObject WScript.Shell
    $Shortcut = $Shell.CreateShortcut($ShortcutPath)
    $Shortcut.TargetPath = Join-Path $AppDir "start.cmd"
    $Shortcut.WorkingDirectory = $AppDir
    $Shortcut.Save()
  }

  Write-Host "Installed EverMemoryArchive to $AppDir"
  $StartCmd = Join-Path $AppDir "start.cmd"
  Write-Host "Run $StartCmd to start."
} finally {
  Remove-Item -LiteralPath $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
`;
}

function wrapBase64(value: Buffer): string {
  return value
    .toString("base64")
    .replace(/.{1,76}/gu, (chunk) => `${chunk}\n`)
    .trimEnd();
}
