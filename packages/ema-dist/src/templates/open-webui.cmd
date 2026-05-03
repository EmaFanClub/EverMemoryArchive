@echo off
setlocal EnableExtensions
set "URL=%~1"
set "MODE=%~2"
set "NODE_BIN=%~3"
if not defined MODE set "MODE=webview"
if not defined NODE_BIN set "NODE_BIN=node"
if /I "%MODE%"=="none" exit /b 0

set "WAITER=%TEMP%\ema-webui-wait-%RANDOM%%RANDOM%.js"
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

call :try_app_path "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not errorlevel 1 exit /b 0
call :try_app_path "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not errorlevel 1 exit /b 0
call :try_app_path "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not errorlevel 1 exit /b 0
call :try_app_path "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
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
