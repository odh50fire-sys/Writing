@echo off
chcp 65001 > nul
title 동도 롸이팅 마스터 - 중학 영어작문 1등급 메이커
cd /d "%~dp0"

where pythonw >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    start "" pythonw desktop_app.py
    exit
)

where pyw >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    start "" pyw desktop_app.py
    exit
)

start "" python desktop_app.py
exit
