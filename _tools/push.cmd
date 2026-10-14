@echo off
REM ============================================================
REM  APRENDO LMS - publicar en GitHub
REM  Ejecuta push.ps1 evitando el bloqueo de politica de ejecucion.
REM ============================================================
chcp 65001 >nul
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0push.ps1" %*
set "RC=%ERRORLEVEL%"
endlocal & exit /b %RC%
