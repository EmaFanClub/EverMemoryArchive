@echo off
setlocal
set "APP_ROOT=%~dp0"
call "%APP_ROOT%ema-launcher.exe" start %*
set "EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %EXIT_CODE%
