@echo off
setlocal
chcp 65001 >nul
title OpsPilot Demo Preflight
set "APP_DIR=%~dp0..\app"
set "SCRIPT=%~dp0tools\opspilot-preflight.js"

if not exist "%APP_DIR%\node_modules\.bin\electron.cmd" (
  echo [LOI] Khong tim thay Electron. Chay pnpm install tai repository truoc.
  pause
  exit /b 1
)
if not exist "%APP_DIR%\.out-scripts\src\main\ssh\manager.js" (
  echo Dang build cong cu kiem tra...
  pushd "%APP_DIR%"
  call pnpm.cmd exec tsc -p tsconfig.scripts.json
  if errorlevel 1 (
    popd
    echo [LOI] Build cong cu that bai.
    pause
    exit /b 1
  )
  popd
)

"%APP_DIR%\node_modules\.bin\electron.cmd" "%SCRIPT%"
echo.
echo Kiem tra da xong. Doc cac dong PASS/FAIL o tren.
pause
