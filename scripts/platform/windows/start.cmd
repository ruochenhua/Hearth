@echo off
setlocal
set "ROOT=%~dp0..\..\.."
cd /d "%ROOT%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" -ForceRecreate -NoBrowser -NoPause
if errorlevel 1 (
  echo 围炉相册启动失败.
  pause
  exit /b 1
)
node "%ROOT%\scripts\runtime\launch-control.mjs"
if errorlevel 1 (
  echo 围炉控制面板启动失败.
  pause
  exit /b 1
)
endlocal
