@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File %~dp0tools\start-public-tunnel.ps1 -Name VITE -LocalPort 33026
echo.
pause
