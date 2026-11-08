@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0"
if exist "%~dp0ScreenRoom.exe" goto launch
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-control-panel.ps1"
if errorlevel 1 (
  echo Failed to build the control panel. Install Node.js 22+ and run: node server.mjs
  pause
  exit /b 1
)
:launch
start "" "%~dp0ScreenRoom.exe"
