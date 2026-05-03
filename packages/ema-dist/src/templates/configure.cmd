@echo off
setlocal EnableExtensions
set "APP_ROOT=%~dp0"

call :set_config_dir
if exist "%EMA_CONFIG_DIR%\ema-runtime.cmd" (
  call "%EMA_CONFIG_DIR%\ema-runtime.cmd"
) else if exist "%APP_ROOT%ema-runtime.cmd" (
  call "%APP_ROOT%ema-runtime.cmd"
)

call :prompt EMA_NODE_PATH "Node executable path" "%EMA_NODE_PATH%"
call :prompt EMA_MONGO_PATH "mongod executable path" "%EMA_MONGO_PATH%"
call :prompt EMA_MONGO_URI "MongoDB URI [start local mongod]" "%EMA_MONGO_URI%"
call :prompt EMA_HOST "WebUI host" "%EMA_HOST%"
call :prompt EMA_PORT "WebUI port" "%EMA_PORT%"
call :prompt EMA_OPEN_MODE "Open mode [webview/browser/none]" "%EMA_OPEN_MODE%"

if not defined EMA_HOST set "EMA_HOST=127.0.0.1"
if not defined EMA_PORT set "EMA_PORT=3000"
if not defined EMA_OPEN_MODE set "EMA_OPEN_MODE=webview"
if /I "%EMA_OPEN_MODE%"=="y" set "EMA_OPEN_MODE=browser"
if /I "%EMA_OPEN_MODE%"=="yes" set "EMA_OPEN_MODE=browser"
if /I "%EMA_OPEN_MODE%"=="n" set "EMA_OPEN_MODE=webview"
if /I "%EMA_OPEN_MODE%"=="no" set "EMA_OPEN_MODE=webview"

set "EMA_INSTALL_DIR=%APP_ROOT%"
if "%EMA_INSTALL_DIR:~-1%"=="\" set "EMA_INSTALL_DIR=%EMA_INSTALL_DIR:~0,-1%"
if not defined EMA_INSTALL_PARENT for %%I in ("%EMA_INSTALL_DIR%\..") do set "EMA_INSTALL_PARENT=%%~fI"

mkdir "%EMA_CONFIG_DIR%" >nul 2>nul
(
  echo set "EMA_INSTALL_PARENT=%EMA_INSTALL_PARENT%"
  echo set "EMA_INSTALL_DIR=%EMA_INSTALL_DIR%"
  echo set "EMA_NODE_PATH=%EMA_NODE_PATH%"
  echo set "EMA_MONGO_PATH=%EMA_MONGO_PATH%"
  echo set "EMA_MONGO_URI=%EMA_MONGO_URI%"
  echo set "EMA_HOST=%EMA_HOST%"
  echo set "EMA_PORT=%EMA_PORT%"
  echo set "EMA_OPEN_MODE=%EMA_OPEN_MODE%"
) > "%EMA_CONFIG_DIR%\ema-runtime.cmd"

echo Wrote "%EMA_CONFIG_DIR%\ema-runtime.cmd"
endlocal
exit /b 0

:set_config_dir
if defined EMA_CONFIG_HOME (
  set "EMA_CONFIG_DIR=%EMA_CONFIG_HOME%"
) else if defined APPDATA (
  set "EMA_CONFIG_DIR=%APPDATA%\ema"
) else (
  set "EMA_CONFIG_DIR=%USERPROFILE%\.config\ema"
)
exit /b 0

:prompt
set "PROMPT_VAR=%~1"
set "PROMPT_LABEL=%~2"
set "PROMPT_DEFAULT=%~3"
set "PROMPT_INPUT="
if defined PROMPT_DEFAULT (
  set /p "PROMPT_INPUT=%PROMPT_LABEL% [%PROMPT_DEFAULT%]: "
) else (
  set /p "PROMPT_INPUT=%PROMPT_LABEL%: "
)
if defined PROMPT_INPUT (
  set "%PROMPT_VAR%=%PROMPT_INPUT%"
) else (
  set "%PROMPT_VAR%=%PROMPT_DEFAULT%"
)
exit /b 0
