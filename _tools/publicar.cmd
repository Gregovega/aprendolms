@echo off
REM ============================================================
REM  APRENDO LMS - PUBLICAR EN GITHUB
REM
REM  Un solo paso: ejecuta esto y pega el token cuando lo pida.
REM
REM      publicar.cmd
REM
REM  El token no se vera al pegarlo y NO queda en el historial.
REM ============================================================
chcp 65001 >nul
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0publicar.ps1" %*
set "RC=%ERRORLEVEL%"
endlocal & exit /b %RC%
