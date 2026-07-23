@echo off
chcp 65001 >nul
title WHOSCOFFEE
cd /d "%~dp0"
echo.
echo   WHOSCOFFEE 시작 중...
node server.js
echo.
echo   서버가 종료되었습니다. 아무 키나 누르면 창이 닫힙니다.
pause >nul
