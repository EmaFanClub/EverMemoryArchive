@echo off
setlocal EnableExtensions
set "APP_ROOT=%~dp0"
call "%APP_ROOT%ema-launcher.exe" configure %*
set "EXIT_CODE=%ERRORLEVEL%"
endlocal
exit /b %EXIT_CODE%
