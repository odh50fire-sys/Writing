# 프로젝트 개발 및 관리 규칙 (Project Rules)

## 1. 웹 & 윈도우 프로그램(데스크톱 앱) 동시 동기화 원칙 (Web & Desktop Parity)
- 모든 수정 및 신규 기능은 웹 브라우저(`web/`)와 윈도우 데스크톱 프로그램(`desktop_app.py`) 모두에 공통으로 즉각 적용되어야 합니다.
- 백엔드(`server.py`) 및 프론트엔드(`web/`)의 단일 소스 아키텍처를 유지하여 동기화를 보장합니다.

## 2. GitHub 소스코드 자동 백업 및 한글 커밋 원칙 (Git & GitHub Automation)
- 원격 저장소: https://github.com/odh50fire-sys/Writing
- 매 작업 완료 시 변경 내역을 커밋하고 GitHub에 push합니다.
- 커밋 메시지는 반드시 간결하고 명확한 한글로 작성합니다.
