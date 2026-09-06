@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-start.ps1" -ForceRecreate -NoBrowser -NoPause
if errorlevel 1 (
  echo MyMoment album failed to start.
  pause
  exit /b 1
)
node scripts\launch-control.mjs
if errorlevel 1 (
  echo MyMoment control center failed to start.
  pause
  exit /b 1
)
endlocal
