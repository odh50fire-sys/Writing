@echo off
chcp 65001 > nul
title 동도 롸이팅 마스터 - 중학 영어작문 시스템

echo ========================================================
echo   [동도 롸이팅 마스터] 프로그램을 실행합니다...
echo   대구 동도중학교 서술형 및 수행평가 대비 30분 영작 시스템
echo ========================================================
echo.

:: 기본 브라우저에서 2초 후 자동 열기
start "" cmd /c "timeout /t 2 /nobreak > nul & start http://localhost:8000"

:: 파이썬 로컬 서버 구동
python server.py 8000

pause
