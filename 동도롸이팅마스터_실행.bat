@echo off
chcp 65001 > nul
title 동도 롸이팅 마스터 - 중학 영어작문 1등급 메이커
cd /d "%~dp0"

echo =======================================================
echo   동도 롸이팅 마스터 윈도우 데스크톱 앱을 실행합니다...
echo =======================================================

python desktop_app.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo 데스크톱 창 실행 중 오류가 발생했습니다. 브라우저 모드로 전환합니다...
    start "" http://localhost:8000
    python server.py 8000
)
