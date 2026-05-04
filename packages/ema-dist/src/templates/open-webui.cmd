@echo off
setlocal EnableExtensions
set "APP_ROOT=%~dp0"
set "URL=%~1"
set "MODE=%~2"
set "NODE_BIN=%~3"
if not defined MODE set "MODE=webview"
if not defined NODE_BIN set "NODE_BIN=node"
if /I "%MODE%"=="none" exit /b 0
if not defined URL exit /b 0

"%NODE_BIN%" "%APP_ROOT%launcher\open-webui.mjs" "%URL%" "%MODE%"
exit /b 0
