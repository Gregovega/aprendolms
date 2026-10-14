@echo off
REM ============================================================
REM  APRENDO LMS - servidor local de pruebas
REM  Ejecuta serve.ps1 evitando el bloqueo de politica de ejecucion.
REM
REM  Uso:
REM    serve.cmd                  puerto 8080
REM    serve.cmd -Puerto 5500
REM    serve.cmd -AbrirNavegador
REM ============================================================
chcp 65001 >nul
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" %*
set "RC=%ERRORLEVEL%"
endlocal & exit /b %RC%
