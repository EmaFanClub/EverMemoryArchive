import fs from "node:fs/promises";
import path from "node:path";
import {
  minimalStageRoot,
  portableStageRoot,
  stageRoot,
  toPosixPath,
  workspaceRoot,
} from "./paths";
import type { PackageKind, Platform } from "./platforms";

interface StageOptions {
  readonly platform: Platform;
  readonly kind: PackageKind;
  readonly revision: string;
}

interface AppStageResult {
  readonly root: string;
  readonly serverRelativePath: string;
}

export async function stagePackage(options: StageOptions): Promise<string> {
  const root = stageRoot(options.platform, options.kind);
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true });
  const app = await copyStandaloneApp(root);
  await copyIfExists(
    path.join(workspaceRoot(), "README.md"),
    path.join(root, "README.md"),
  );
  await copyIfExists(
    path.join(workspaceRoot(), "LICENSE"),
    path.join(root, "LICENSE"),
  );
  await writeLaunchers(
    root,
    options.platform,
    options.kind,
    app.serverRelativePath,
  );
  await writePackageManifest(root, options, app.serverRelativePath);
  return root;
}

export async function refreshMinimalStageFromPortable(
  platform: Platform,
  revision: string,
): Promise<string> {
  const source = portableStageRoot(platform);
  const target = minimalStageRoot(platform);
  await fs.rm(target, { recursive: true, force: true });
  await copyDirectoryWithout(source, target, new Set(["portables"]));
  await writePackageManifest(
    target,
    {
      platform,
      kind: "minimal",
      revision,
    },
    await readServerRelativePath(target),
  );
  return target;
}

async function copyStandaloneApp(root: string): Promise<AppStageResult> {
  const workspace = workspaceRoot();
  const webuiRoot = path.join(workspace, "packages", "ema-webui");
  const standaloneRoot = path.join(webuiRoot, ".next", "standalone");
  const staticRoot = path.join(webuiRoot, ".next", "static");
  const publicRoot = path.join(webuiRoot, "public");

  if (!(await exists(standaloneRoot))) {
    throw new Error(
      "Next.js standalone output was not found. Run pnpm --filter ema-webui build first.",
    );
  }

  const appRoot = path.join(root, "app");
  await fs.cp(standaloneRoot, appRoot, {
    recursive: true,
    force: true,
    preserveTimestamps: true,
  });

  const serverPath = await findServerEntry(appRoot);
  const serverDir = path.dirname(serverPath);
  await copyIfExists(staticRoot, path.join(serverDir, ".next", "static"));
  await copyIfExists(publicRoot, path.join(serverDir, "public"));
  await copyEmaRuntimeAssets(appRoot);

  const serverRelativePath = toPosixPath(path.relative(root, serverPath));
  await fs.writeFile(
    path.join(root, "server-relpath.txt"),
    `${serverRelativePath}\n`,
  );
  return { root: appRoot, serverRelativePath };
}

async function findServerEntry(appRoot: string): Promise<string> {
  const preferred = [
    path.join(appRoot, "packages", "ema-webui", "server.js"),
    path.join(appRoot, "server.js"),
  ];
  for (const candidate of preferred) {
    if (await exists(candidate)) {
      return candidate;
    }
  }
  const found = await findFile(
    appRoot,
    (filePath) => path.basename(filePath) === "server.js",
  );
  if (!found) {
    throw new Error(
      `Could not find Next.js standalone server.js in ${appRoot}.`,
    );
  }
  return found;
}

async function copyEmaRuntimeAssets(appRoot: string): Promise<void> {
  const sourceRoot = path.join(workspaceRoot(), "packages", "ema", "src");
  const candidates = [
    path.join(appRoot, "packages", "ema", "src"),
    path.join(appRoot, "node_modules", "ema", "src"),
  ];
  for (const candidate of candidates) {
    await copyIfExists(
      path.join(sourceRoot, "prompt", "templates"),
      path.join(candidate, "prompt", "templates"),
    );
    await copySkillAssets(
      path.join(sourceRoot, "skills"),
      path.join(candidate, "skills"),
    );
  }
}

async function copySkillAssets(
  source: string,
  destination: string,
): Promise<void> {
  if (!(await exists(source))) {
    return;
  }
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    await copyIfExists(path.join(from, "SKILL.md"), path.join(to, "SKILL.md"));
    await copyIfExists(path.join(from, "assets"), path.join(to, "assets"));
  }
}

async function writeLaunchers(
  root: string,
  platform: Platform,
  kind: PackageKind,
  serverRelativePath: string,
): Promise<void> {
  await fs.writeFile(
    path.join(root, "start.sh"),
    posixStartScript(serverRelativePath),
    {
      mode: 0o755,
    },
  );
  await fs.writeFile(path.join(root, "open-webui.sh"), posixOpenWebuiScript(), {
    mode: 0o755,
  });
  await fs.writeFile(path.join(root, "configure.sh"), posixConfigureScript(), {
    mode: 0o755,
  });
  await fs.writeFile(
    path.join(root, "start.cmd"),
    windowsStartScript(serverRelativePath),
  );
  await fs.writeFile(
    path.join(root, "open-webui.cmd"),
    windowsOpenWebuiScript(),
  );
  await fs.writeFile(
    path.join(root, "configure.cmd"),
    windowsConfigureScript(),
  );
  if (platform.os !== "win32") {
    await fs.chmod(path.join(root, "start.sh"), 0o755);
    await fs.chmod(path.join(root, "open-webui.sh"), 0o755);
    await fs.chmod(path.join(root, "configure.sh"), 0o755);
  }
  await fs.writeFile(
    path.join(root, "INSTALL.txt"),
    installText(platform, kind),
  );
}

async function writePackageManifest(
  root: string,
  options: StageOptions,
  serverRelativePath: string,
): Promise<void> {
  await fs.writeFile(
    path.join(root, "ema-package.json"),
    `${JSON.stringify(
      {
        name: "EverMemoryArchive",
        revision: options.revision,
        platform: options.platform.id,
        platformLabel: options.platform.label,
        kind: options.kind,
        serverRelativePath,
        portableMongoBundled:
          options.kind === "portable" && options.platform.canBundleMongo,
        portableMongoNote: options.platform.mongoNote,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
}

async function readServerRelativePath(root: string): Promise<string> {
  return (
    await fs.readFile(path.join(root, "server-relpath.txt"), "utf8")
  ).trim();
}

function posixStartScript(serverRelativePath: string): string {
  return `#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$APP_ROOT/ema-runtime.sh" ]; then
  # shellcheck disable=SC1091
  . "$APP_ROOT/ema-runtime.sh"
fi

SERVER_JS="$APP_ROOT/${serverRelativePath}"
DATA_ROOT="\${EMA_DATA_ROOT:-$APP_ROOT/.ema}"
HOST="\${EMA_HOST:-127.0.0.1}"
PORT="\${EMA_PORT:-3000}"
MONGO_PORT="\${EMA_MONGO_PORT:-27017}"
OPEN_MODE="\${EMA_OPEN_MODE:-webview}"
NODE_BIN="\${EMA_NODE_PATH:-}"
MONGO_BIN="\${EMA_MONGO_PATH:-}"

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

MONGO_URI="\${EMA_MONGO_URI:-}"
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
export EMA_SERVER_MONGO_DB="\${EMA_MONGO_DB:-ema}"
export EMA_SERVER_DATA_ROOT="$DATA_ROOT"

WEBUI_URL="http://$HOST:$PORT/"
if [ "$OPEN_MODE" != "none" ]; then
  "$APP_ROOT/open-webui.sh" "$WEBUI_URL" "$OPEN_MODE" "$NODE_BIN" &
fi

echo "EverMemoryArchive is starting at $WEBUI_URL"
"$NODE_BIN" "$SERVER_JS"
`;
}

function windowsStartScript(serverRelativePath: string): string {
  const windowsServerPath = serverRelativePath.split("/").join("\\");
  return `@echo off
setlocal
set "APP_ROOT=%~dp0"
if exist "%APP_ROOT%ema-runtime.cmd" call "%APP_ROOT%ema-runtime.cmd"

set "SERVER_JS=%APP_ROOT%${windowsServerPath}"
if not defined EMA_DATA_ROOT set "EMA_DATA_ROOT=%APP_ROOT%.ema"
if not defined EMA_HOST set "EMA_HOST=127.0.0.1"
if not defined EMA_PORT set "EMA_PORT=3000"
if not defined EMA_MONGO_PORT set "EMA_MONGO_PORT=27017"
if not defined EMA_OPEN_MODE set "EMA_OPEN_MODE=webview"

set "NODE_BIN=%EMA_NODE_PATH%"
if not defined NODE_BIN if exist "%APP_ROOT%portables\\node\\node.exe" set "NODE_BIN=%APP_ROOT%portables\\node\\node.exe"
if not defined NODE_BIN for %%I in (node.exe) do set "NODE_BIN=%%~$PATH:I"
if not defined NODE_BIN (
  echo Node.js was not found. Run configure.cmd or put node on PATH.
  exit /b 1
)

if not exist "%EMA_DATA_ROOT%\\mongodb" mkdir "%EMA_DATA_ROOT%\\mongodb"
if not exist "%EMA_DATA_ROOT%\\logs" mkdir "%EMA_DATA_ROOT%\\logs"
if not exist "%EMA_DATA_ROOT%\\workspace" mkdir "%EMA_DATA_ROOT%\\workspace"

if not defined EMA_MONGO_URI (
  set "MONGO_BIN=%EMA_MONGO_PATH%"
  if not defined MONGO_BIN if exist "%APP_ROOT%portables\\mongodb\\bin\\mongod.exe" set "MONGO_BIN=%APP_ROOT%portables\\mongodb\\bin\\mongod.exe"
  if not defined MONGO_BIN for %%I in (mongod.exe) do set "MONGO_BIN=%%~$PATH:I"
  if not defined MONGO_BIN (
    echo MongoDB was not found. Run configure.cmd, set EMA_MONGO_URI, or put mongod on PATH.
    exit /b 1
  )
  set "EMA_MONGO_URI=mongodb://127.0.0.1:%EMA_MONGO_PORT%/"
  start "EMA MongoDB" /B "%MONGO_BIN%" --dbpath "%EMA_DATA_ROOT%\\mongodb" --port "%EMA_MONGO_PORT%" --bind_ip 127.0.0.1 --logpath "%EMA_DATA_ROOT%\\logs\\mongodb.log"
)

set "HOSTNAME=%EMA_HOST%"
set "PORT=%EMA_PORT%"
set "EMA_SERVER_MODE=prod"
set "EMA_SERVER_MONGO_KIND=remote"
set "EMA_SERVER_MONGO_DB=ema"
set "EMA_SERVER_DATA_ROOT=%EMA_DATA_ROOT%"
set "EMA_SERVER_MONGO_URI=%EMA_MONGO_URI%"
set "EMA_WEBUI_URL=http://%EMA_HOST%:%EMA_PORT%/"

if /I not "%EMA_OPEN_MODE%"=="none" (
  start "" /B "%APP_ROOT%open-webui.cmd" "%EMA_WEBUI_URL%" "%EMA_OPEN_MODE%" "%NODE_BIN%"
)

echo EverMemoryArchive is starting at %EMA_WEBUI_URL%
"%NODE_BIN%" "%SERVER_JS%"
endlocal
`;
}

function posixOpenWebuiScript(): string {
  return `#!/usr/bin/env bash
set -euo pipefail

URL="\${1:?URL is required}"
MODE="\${2:-webview}"
NODE_BIN="\${3:-node}"

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
`;
}

function windowsOpenWebuiScript(): string {
  return `@echo off
setlocal EnableExtensions
set "URL=%~1"
set "MODE=%~2"
set "NODE_BIN=%~3"
if not defined MODE set "MODE=webview"
if not defined NODE_BIN set "NODE_BIN=node"
if /I "%MODE%"=="none" exit /b 0

set "WAITER=%TEMP%\\ema-webui-wait-%RANDOM%%RANDOM%.js"
> "%WAITER%" echo const url = process.argv[2];
>> "%WAITER%" echo const deadline = Date.now() + 30000;
>> "%WAITER%" echo const sleep = ms =^> new Promise^(resolve =^> setTimeout^(resolve, ms^)^);
>> "%WAITER%" echo ^(async ^(^) =^> {
>> "%WAITER%" echo   while ^(Date.now^(^) ^< deadline^) {
>> "%WAITER%" echo     try {
>> "%WAITER%" echo       const response = await fetch^(url, { signal: AbortSignal.timeout^(1000^) }^);
>> "%WAITER%" echo       if ^(response.status ^< 500^) process.exit^(0^);
>> "%WAITER%" echo     } catch {}
>> "%WAITER%" echo     await sleep^(500^);
>> "%WAITER%" echo   }
>> "%WAITER%" echo   process.exit^(1^);
>> "%WAITER%" echo }^)^(^);

"%NODE_BIN%" "%WAITER%" "%URL%" >nul 2>nul
set "WAIT_EXIT=%ERRORLEVEL%"
del "%WAITER%" >nul 2>nul
if not "%WAIT_EXIT%"=="0" exit /b 0

if /I "%MODE%"=="browser" goto open_default_browser

call :try_app_path "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe"
if not errorlevel 1 exit /b 0
call :try_app_path "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe"
if not errorlevel 1 exit /b 0
call :try_app_path "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"
if not errorlevel 1 exit /b 0
call :try_app_path "%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"
if not errorlevel 1 exit /b 0
call :try_app_command msedge.exe
if not errorlevel 1 exit /b 0
call :try_app_command chrome.exe
if not errorlevel 1 exit /b 0
call :try_app_command chromium.exe
if not errorlevel 1 exit /b 0
call :try_app_command brave.exe
if not errorlevel 1 exit /b 0

:open_default_browser
start "" "%URL%"
exit /b 0

:try_app_path
if not exist "%~1" exit /b 1
start "" "%~1" --app="%URL%"
exit /b 0

:try_app_command
where "%~1" >nul 2>nul || exit /b 1
start "" "%~1" --app="%URL%"
exit /b 0
`;
}

function posixConfigureScript(): string {
  return `#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
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
export EMA_HOST="\${HOST_INPUT:-127.0.0.1}"
export EMA_PORT="\${PORT_INPUT:-3000}"
export EMA_OPEN_MODE="$OPEN_MODE"
EOF

echo "Wrote $APP_ROOT/ema-runtime.sh"
`;
}

function windowsConfigureScript(): string {
  return `@echo off
setlocal
set "APP_ROOT=%~dp0"
set /p EMA_NODE_PATH=Node executable path [PATH or portable]: 
set /p EMA_MONGO_PATH=mongod executable path [PATH or portable]: 
set /p EMA_MONGO_URI=MongoDB URI [start local mongod]: 
set /p EMA_HOST=WebUI host [127.0.0.1]: 
set /p EMA_PORT=WebUI port [3000]: 
set /p USE_BROWSER=Use default browser instead of app/webview window? [y/N]: 
if not defined EMA_HOST set "EMA_HOST=127.0.0.1"
if not defined EMA_PORT set "EMA_PORT=3000"
set "EMA_OPEN_MODE=webview"
if /I "%USE_BROWSER%"=="y" set "EMA_OPEN_MODE=browser"
if /I "%USE_BROWSER%"=="yes" set "EMA_OPEN_MODE=browser"
(
  echo set "EMA_NODE_PATH=%EMA_NODE_PATH%"
  echo set "EMA_MONGO_PATH=%EMA_MONGO_PATH%"
  echo set "EMA_MONGO_URI=%EMA_MONGO_URI%"
  echo set "EMA_HOST=%EMA_HOST%"
  echo set "EMA_PORT=%EMA_PORT%"
  echo set "EMA_OPEN_MODE=%EMA_OPEN_MODE%"
) > "%APP_ROOT%ema-runtime.cmd"
echo Wrote %APP_ROOT%ema-runtime.cmd
endlocal
`;
}

function installText(platform: Platform, kind: PackageKind): string {
  const launcher =
    platform.os === "win32"
      ? "start.cmd"
      : platform.os === "darwin"
        ? "start.sh"
        : "start.sh";
  return `EverMemoryArchive ${kind} package for ${platform.label}

Run ${launcher} to start the WebUI.

By default the launcher opens the WebUI in an app/webview-style browser window
without the normal browser toolbar. Set EMA_OPEN_MODE=browser to use the system
default browser, or EMA_OPEN_MODE=none to skip opening a window.

portable:
  Bundles Node.js and MongoDB when the platform has upstream MongoDB binaries.

minimal:
  Run configure.sh/configure.cmd to set Node.js and MongoDB paths, or put node
  and mongod on PATH. You may also set EMA_MONGO_URI to use an external MongoDB.
`;
}

async function copyIfExists(
  source: string,
  destination: string,
): Promise<void> {
  if (!(await exists(source))) {
    return;
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(source, destination, {
    recursive: true,
    force: true,
    preserveTimestamps: true,
  });
}

async function copyDirectoryWithout(
  source: string,
  destination: string,
  excludedNames: Set<string>,
): Promise<void> {
  await fs.mkdir(destination, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (excludedNames.has(entry.name)) {
      continue;
    }
    await fs.cp(
      path.join(source, entry.name),
      path.join(destination, entry.name),
      {
        recursive: true,
        force: true,
        preserveTimestamps: true,
      },
    );
  }
}

async function findFile(
  root: string,
  predicate: (filePath: string) => boolean,
): Promise<string | null> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await findFile(entryPath, predicate);
      if (nested) {
        return nested;
      }
      continue;
    }
    if (predicate(entryPath)) {
      return entryPath;
    }
  }
  return null;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
