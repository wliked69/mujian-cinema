@echo off
cd /d "%~dp0"
start "" powershell.exe -NoLogo -NoProfile -Sta -ExecutionPolicy Bypass -File "%~dp0scripts\javdb-ui.ps1"
