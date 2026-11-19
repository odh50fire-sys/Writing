@echo off
chcp 65001 > nul
title 동도 롸이팅 마스터 - 중학 영어작문 1등급 메이커
cd /d "%~dp0"

:: 1. 작업표시줄 고정 연동용 바로가기 및 시작메뉴 등록 확인/자동 생성
if not exist "%~dp0동도 롸이팅 마스터.lnk" (
    powershell -ExecutionPolicy Bypass -File "%~dp0create_pinned_shortcut.ps1" >nul 2>nul
)
if not exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\동도 롸이팅 마스터.lnk" (
    powershell -ExecutionPolicy Bypass -File "%~dp0create_pinned_shortcut.ps1" >nul 2>nul
)

:: 2. 등록된 바로가기(.lnk)를 통해 실행 (작업표시줄 고정 시 아이콘 및 실행 경로 100% 영구 유지)
if exist "%~dp0동도 롸이팅 마스터.lnk" (
    start "" "%~dp0동도 롸이팅 마스터.lnk"
    exit
)

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
