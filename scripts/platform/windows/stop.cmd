@echo off
setlocal
set "ROOT=%~dp0..\..\.."
cd /d "%ROOT%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
if errorlevel 1 (
  echo 围炉停止失败，请检查 Docker Desktop。
  pause
  exit /b 1
)
endlocal
