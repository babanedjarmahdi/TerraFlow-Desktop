@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title TerraFlow Installer

echo.
echo  ==========================================
echo    TerraFlow - One Click Installer
echo  ==========================================
echo.

if not exist "%~dp0bin\terraflow.mjs" (
  echo  ERROR: incomplete package - bin\terraflow.mjs not found.
  echo  Make sure the full TerraFlow folder is extracted, then run this again.
  pause
  exit /b 1
)

set "NODEDIR=%LOCALAPPDATA%\Programs\TerraFlow\nodejs"
if exist "%NODEDIR%\node.exe" set "PATH=%NODEDIR%;%PATH%"

set "NMAJ=0"
where node >nul 2>nul
if errorlevel 1 goto need_node
for /f "delims=v." %%a in ('node -v 2^>nul') do set "NMAJ=%%a"
if %NMAJ% GEQ 18 goto node_ok

:need_node
echo  [1/3] Preparing the Node.js runtime (one-time)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\ensure-node.ps1"
if exist "%NODEDIR%\node.exe" set "PATH=%NODEDIR%;%PATH%"
set "NMAJ=0"
where node >nul 2>nul
if errorlevel 1 goto node_fail
for /f "delims=v." %%a in ('node -v 2^>nul') do set "NMAJ=%%a"
if %NMAJ% LSS 18 goto node_fail

:node_ok
echo  [2/3] Installing TerraFlow...
node "%~dp0bin\terraflow.mjs" setup
if errorlevel 1 (
  echo.
  echo  Installation finished with errors - see the messages above.
  pause
  exit /b 1
)

echo.
echo  [3/3] Done!
echo.
echo   TerraFlow is installed.
echo    - Double-click the "TerraFlow" icon on your Desktop to open it.
echo    - It also starts automatically when you sign in to Windows.
echo.
pause
exit /b 0

:node_fail
echo.
echo  ERROR: Node.js 18 or newer could not be prepared automatically.
echo  Install it manually from https://nodejs.org, then run this file again.
start "" "https://nodejs.org"
pause
exit /b 1
