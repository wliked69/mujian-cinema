@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "NODE=%~dp0.runtime\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" --version >nul 2>nul
if errorlevel 1 goto nonode
echo === JavDB sync: fill release date / maker / girls / cover (missing entries are skipped) ===
"%NODE%" scripts\javdb-sync.mjs --only-missing --apply %*
echo.
echo plan file: data\javdb-plan.json
echo failed   : data\javdb-failed.json
goto end
:nonode
echo Node.js 22+ not found. Run start.cmd once to prepare .runtime, or install Node.js.
:end
pause
