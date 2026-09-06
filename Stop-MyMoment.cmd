@echo off
setlocal
cd /d "%~dp0"
node scripts\stop-album.mjs
if errorlevel 1 (
  echo MyMoment stop failed. Check Docker Desktop.
  pause
  exit /b 1
)
endlocal
