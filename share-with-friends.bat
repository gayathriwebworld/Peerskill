@echo off
title PeerSkill - link for friends
cd /d "%~dp0"
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo.
  echo Installing the free sharing tool, one time only...
  winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
  echo.
  echo Done. Close this window and double-click share-with-friends.bat again.
  pause
  exit /b
)
echo.
echo Make sure start-peerskill.bat is running in another window first.
echo.
echo Look for a link ending in  trycloudflare.com  below. Open it yourself, then send it to your friends.
echo Keep this window open while your friends use the website. The link changes each time.
echo.
cloudflared tunnel --url http://localhost:3000
pause
