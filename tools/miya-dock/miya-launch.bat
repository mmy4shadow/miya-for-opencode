@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%..\.."

echo [miya-dock] ensuring gateway and launching dock...
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%miya-dock.ps1" -ProjectRoot "%PROJECT_ROOT%" -TryStartGateway
if errorlevel 1 (
  echo [miya-dock] launch failed.
  exit /b 1
)

echo [miya-dock] ready.
exit /b 0
