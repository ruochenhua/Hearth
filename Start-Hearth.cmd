@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\platform\windows-start.ps1" -ForceRecreate -NoBrowser -NoPause
if errorlevel 1 (
  echo 围炉相册启动失败.
  pause
  exit /b 1
)
node scripts\runtime\launch-control.mjs
if errorlevel 1 (
  echo 围炉控制面板启动失败.
  pause
  exit /b 1
)
endlocal
