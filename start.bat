@echo off
cd /d "%~dp0"

rem Update to the latest version before starting (needs Git; skipped if it isn't installed).
where git >nul 2>nul && (
  echo Checking for updates...
  git pull --ff-only --quiet || echo Could not update - starting the current version.
)

rem Push-to-talk key on this PC. To change it, create my-settings.bat next to this file
rem containing e.g.:  set PTT_KEY=Mouse4     (options: ` F8 Mouse4 Mouse5 CapsLock Numpad0 off)
set PTT_KEY=`
if exist my-settings.bat call my-settings.bat

node server.js --ptt=%PTT_KEY%
pause
