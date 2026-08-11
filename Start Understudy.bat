@echo off
title Understudy
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the free LTS installer from https://nodejs.org
  echo then double-click this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run - installing dependencies. This takes a minute or two...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed - see the messages above.
    pause
    exit /b 1
  )
)

echo Starting Understudy... your browser will open in a moment.
echo Keep this window open while you use the app. Closing it stops Understudy.
node server.js --open
pause
