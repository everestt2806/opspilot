@echo off
setlocal
set "OPSPILOT_C01_DEPLOY_ONLY=1"
pushd "%~dp0..\app" || (
  echo [LOI] Khong tim thay thu muc source OpsPilot.
  pause
  exit /b 1
)
echo Dang mo OpsPilot Demo. Lan dau co the mat 30-60 giay de build...
call pnpm.cmd start
set "OPSPILOT_EXIT=%ERRORLEVEL%"
popd
if not "%OPSPILOT_EXIT%"=="0" (
  echo [LOI] OpsPilot dung voi ma %OPSPILOT_EXIT%.
  pause
)
exit /b %OPSPILOT_EXIT%
