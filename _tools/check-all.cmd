@echo off
REM ============================================================
REM  APRENDO LMS - verificacion completa del proyecto
REM  Ejecuta check-all.ps1 evitando el bloqueo de politica de ejecucion.
REM ============================================================
chcp 65001 >nul
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-all.ps1" %*
set "RC=%ERRORLEVEL%"
endlocal & exit /b %RC%
