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

call :set_config_dir
set "CONFIG_FILE=%EMA_CONFIG_DIR%\ema-runtime.env"
if exist "%CONFIG_FILE%" call :load_env_file "%CONFIG_FILE%"

set "DEFAULT_PARENT=%EMA_INSTALL_PARENT%"
if not defined DEFAULT_PARENT set "DEFAULT_PARENT=%USERPROFILE%"
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
  call :prompt NODE_PATH_INPUT "Node executable path" "%EMA_NODE_PATH%"
  call :prompt MONGO_PATH_INPUT "mongod executable path" "%EMA_MONGO_PATH%"
  call :prompt MONGO_URI_INPUT "MongoDB URI [start local mongod]" "%EMA_MONGO_URI%"
)

call :prompt OPEN_MODE "Open mode [webview/browser/none]" "%EMA_OPEN_MODE%"
if not defined OPEN_MODE set "OPEN_MODE=webview"
if /I "%OPEN_MODE%"=="y" set "OPEN_MODE=browser"
if /I "%OPEN_MODE%"=="yes" set "OPEN_MODE=browser"
if /I "%OPEN_MODE%"=="n" set "OPEN_MODE=webview"
if /I "%OPEN_MODE%"=="no" set "OPEN_MODE=webview"
if not defined EMA_HOST set "EMA_HOST=127.0.0.1"
if not defined EMA_PORT set "EMA_PORT=3000"

mkdir "%EMA_CONFIG_DIR%" >nul 2>nul
set "EMA_INSTALL_PARENT=%INSTALL_PARENT%"
set "EMA_INSTALL_DIR=%APP_DIR%"
set "EMA_NODE_PATH=%NODE_PATH_INPUT%"
set "EMA_MONGO_PATH=%MONGO_PATH_INPUT%"
set "EMA_MONGO_URI=%MONGO_URI_INPUT%"
set "EMA_OPEN_MODE=%OPEN_MODE%"
type nul > "%CONFIG_FILE%"
call :write_env_value EMA_INSTALL_PARENT
call :write_env_value EMA_INSTALL_DIR
call :write_env_value EMA_NODE_PATH
call :write_env_value EMA_MONGO_PATH
call :write_env_value EMA_MONGO_URI
call :write_env_value EMA_HOST
call :write_env_value EMA_PORT
call :write_env_value EMA_OPEN_MODE
echo Wrote "%CONFIG_FILE%"

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

:set_config_dir
if defined EMA_CONFIG_HOME (
  set "EMA_CONFIG_DIR=%EMA_CONFIG_HOME%"
) else if defined APPDATA (
  set "EMA_CONFIG_DIR=%APPDATA%\ema"
) else (
  set "EMA_CONFIG_DIR=%USERPROFILE%\.config\ema"
)
exit /b 0

:load_env_file
if not exist "%~1" exit /b 0
for /f "usebackq eol=# tokens=1* delims==" %%A in ("%~1") do (
  if /I "%%~A"=="EMA_INSTALL_PARENT" set "EMA_INSTALL_PARENT=%%B"
  if /I "%%~A"=="EMA_INSTALL_DIR" set "EMA_INSTALL_DIR=%%B"
  if /I "%%~A"=="EMA_NODE_PATH" set "EMA_NODE_PATH=%%B"
  if /I "%%~A"=="EMA_MONGO_PATH" set "EMA_MONGO_PATH=%%B"
  if /I "%%~A"=="EMA_MONGO_URI" set "EMA_MONGO_URI=%%B"
  if /I "%%~A"=="EMA_HOST" set "EMA_HOST=%%B"
  if /I "%%~A"=="EMA_PORT" set "EMA_PORT=%%B"
  if /I "%%~A"=="EMA_OPEN_MODE" set "EMA_OPEN_MODE=%%B"
)
exit /b 0

:write_env_value
set "ENV_NAME=%~1"
setlocal EnableDelayedExpansion
>> "%CONFIG_FILE%" echo(!ENV_NAME!=!%ENV_NAME%!
endlocal
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
