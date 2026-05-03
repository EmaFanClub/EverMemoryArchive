@echo off
setlocal EnableExtensions
set "PLATFORM={{platformId}}"
set "KIND={{kind}}"
set "TMP_DIR=%TEMP%\ema-installer-%RANDOM%%RANDOM%%RANDOM%"
set "EXIT_CODE=0"

mkdir "%TMP_DIR%" >nul 2>nul
if errorlevel 1 (
  echo Failed to create temporary directory: "%TMP_DIR%"
  exit /b 1
)

set "SEVENZIP_B64=%TMP_DIR%\7za.b64"
set "ARCHIVE_B64=%TMP_DIR%\payload.b64"
set "SEVENZIP_PATH=%TMP_DIR%\7za.exe"
set "ARCHIVE_PATH=%TMP_DIR%\payload.7z"

call :extract_section EMA_SEVENZIP "%SEVENZIP_B64%" || goto fail
call :decode_base64 "%SEVENZIP_B64%" "%SEVENZIP_PATH%" || goto fail
call :extract_section EMA_ARCHIVE "%ARCHIVE_B64%" || goto fail
call :decode_base64 "%ARCHIVE_B64%" "%ARCHIVE_PATH%" || goto fail

set "DEFAULT_PARENT=%USERPROFILE%"
set /p "INSTALL_PARENT=Install parent directory [%DEFAULT_PARENT%]: "
if not defined INSTALL_PARENT set "INSTALL_PARENT=%DEFAULT_PARENT%"
mkdir "%INSTALL_PARENT%" >nul 2>nul

"%SEVENZIP_PATH%" x "%ARCHIVE_PATH%" "-o%INSTALL_PARENT%" -y
if errorlevel 1 goto fail

set "APP_DIR=%INSTALL_PARENT%\EverMemoryArchive"
set "NODE_PATH_INPUT="
set "MONGO_PATH_INPUT="
set "MONGO_URI_INPUT="
if /I "%KIND%"=="minimal" (
  set /p "NODE_PATH_INPUT=Node executable path [PATH]: "
  set /p "MONGO_PATH_INPUT=mongod executable path [PATH]: "
  set /p "MONGO_URI_INPUT=MongoDB URI [start local mongod]: "
)

set "OPEN_MODE=webview"
set /p "USE_BROWSER=Use default browser instead of app/webview window? [y/N]: "
if /I "%USE_BROWSER%"=="y" set "OPEN_MODE=browser"
if /I "%USE_BROWSER%"=="yes" set "OPEN_MODE=browser"

> "%APP_DIR%\ema-runtime.cmd" echo set "EMA_NODE_PATH=%NODE_PATH_INPUT%"
>> "%APP_DIR%\ema-runtime.cmd" echo set "EMA_MONGO_PATH=%MONGO_PATH_INPUT%"
>> "%APP_DIR%\ema-runtime.cmd" echo set "EMA_MONGO_URI=%MONGO_URI_INPUT%"
>> "%APP_DIR%\ema-runtime.cmd" echo set "EMA_HOST=127.0.0.1"
>> "%APP_DIR%\ema-runtime.cmd" echo set "EMA_PORT=3000"
>> "%APP_DIR%\ema-runtime.cmd" echo set "EMA_OPEN_MODE=%OPEN_MODE%"

set /p "CREATE_SHORTCUT=Create desktop shortcut? [Y/n]: "
if not defined CREATE_SHORTCUT set "CREATE_SHORTCUT=Y"
if /I "%CREATE_SHORTCUT%"=="y" call :create_shortcut
if /I "%CREATE_SHORTCUT%"=="yes" call :create_shortcut

echo Installed EverMemoryArchive to "%APP_DIR%"
echo Run "%APP_DIR%\start.cmd" to start.
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
set "DESKTOP=%USERPROFILE%\Desktop"
if not exist "%DESKTOP%" exit /b 0
set "SHORTCUT=%DESKTOP%\EverMemoryArchive.cmd"
> "%SHORTCUT%" echo @echo off
>> "%SHORTCUT%" echo cd /d "%APP_DIR%"
>> "%SHORTCUT%" echo call "%APP_DIR%\start.cmd"
echo Created "%SHORTCUT%"
exit /b 0

__EMA_SEVENZIP_BEGIN__
{{sevenZipBase64}}
__EMA_SEVENZIP_END__
__EMA_ARCHIVE_BEGIN__
{{archiveBase64}}
__EMA_ARCHIVE_END__
