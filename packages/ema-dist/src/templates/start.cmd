@echo off
setlocal
set "APP_ROOT=%~dp0"
if exist "%APP_ROOT%ema-runtime.cmd" call "%APP_ROOT%ema-runtime.cmd"

set "SERVER_JS=%APP_ROOT%{{serverRelativePath}}"
if not defined EMA_DATA_ROOT set "EMA_DATA_ROOT=%APP_ROOT%.ema"
if not defined EMA_HOST set "EMA_HOST=127.0.0.1"
if not defined EMA_PORT set "EMA_PORT=3000"
if not defined EMA_MONGO_PORT set "EMA_MONGO_PORT=27017"
if not defined EMA_OPEN_MODE set "EMA_OPEN_MODE=webview"

set "NODE_BIN=%EMA_NODE_PATH%"
if not defined NODE_BIN if exist "%APP_ROOT%portables\node\node.exe" set "NODE_BIN=%APP_ROOT%portables\node\node.exe"
if not defined NODE_BIN for %%I in (node.exe) do set "NODE_BIN=%%~$PATH:I"
if not defined NODE_BIN (
  echo Node.js was not found. Run configure.cmd or put node on PATH.
  exit /b 1
)

if not exist "%EMA_DATA_ROOT%\mongodb" mkdir "%EMA_DATA_ROOT%\mongodb"
if not exist "%EMA_DATA_ROOT%\logs" mkdir "%EMA_DATA_ROOT%\logs"
if not exist "%EMA_DATA_ROOT%\workspace" mkdir "%EMA_DATA_ROOT%\workspace"

if not defined EMA_MONGO_URI (
  set "MONGO_BIN=%EMA_MONGO_PATH%"
  if not defined MONGO_BIN if exist "%APP_ROOT%portables\mongodb\bin\mongod.exe" set "MONGO_BIN=%APP_ROOT%portables\mongodb\bin\mongod.exe"
  if not defined MONGO_BIN for %%I in (mongod.exe) do set "MONGO_BIN=%%~$PATH:I"
  if not defined MONGO_BIN (
    echo MongoDB was not found. Run configure.cmd, set EMA_MONGO_URI, or put mongod on PATH.
    exit /b 1
  )
  set "EMA_MONGO_URI=mongodb://127.0.0.1:%EMA_MONGO_PORT%/"
  start "EMA MongoDB" /B "%MONGO_BIN%" --dbpath "%EMA_DATA_ROOT%\mongodb" --port "%EMA_MONGO_PORT%" --bind_ip 127.0.0.1 --logpath "%EMA_DATA_ROOT%\logs\mongodb.log"
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
