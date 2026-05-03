@echo off
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
