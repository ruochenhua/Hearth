@echo off
setlocal
cd /d "%~dp0"
node scripts\stop-album.mjs
if errorlevel 1 (
  echo 围炉停止失败，请检查 Docker Desktop。
  pause
  exit /b 1
)
endlocal
