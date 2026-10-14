@echo off
title PeerSkill
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed yet. Opening the download page.
  echo Install the LTS version, then double-click this file again.
  start https://nodejs.org
  pause
  exit /b
)
set SEED_DEMO=1
start "" /b cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"
echo.
echo PeerSkill is starting. Keep this window open while you use the website.
node server.js
echo.
echo PeerSkill has stopped.
pause
