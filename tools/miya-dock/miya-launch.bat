@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%..\.."
set "MAX_RETRIES=6"
set "RETRY_WAIT_SECONDS=4"
if defined MIYA_DOCK_MAX_RETRIES set "MAX_RETRIES=%MIYA_DOCK_MAX_RETRIES%"
if defined MIYA_DOCK_RETRY_WAIT_SECONDS set "RETRY_WAIT_SECONDS=%MIYA_DOCK_RETRY_WAIT_SECONDS%"
set /a ATTEMPT=1

echo [miya-dock] ensuring gateway and launching dock...

:retry_launch
echo [miya-dock] attempt %ATTEMPT%/%MAX_RETRIES% ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_ROOT%\miya-src\tools\miya-dock\miya-dock.ps1" -ProjectRoot "%PROJECT_ROOT%" -TryStartGateway
if not errorlevel 1 (
  echo [miya-dock] ready.
  exit /b 0
)

if %ATTEMPT% GEQ %MAX_RETRIES% (
  echo [miya-dock] launch failed after %MAX_RETRIES% attempts.
  exit /b 1
)

echo [miya-dock] gateway not ready yet, waiting %RETRY_WAIT_SECONDS%s then retry...
timeout /t %RETRY_WAIT_SECONDS% /nobreak >nul
set /a ATTEMPT+=1
goto :retry_launch
