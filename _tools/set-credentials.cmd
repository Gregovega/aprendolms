@echo off
REM ============================================================
REM  APRENDO LMS - activador de credenciales
REM
REM  Este envoltorio existe por una razon concreta: Windows
REM  bloquea los scripts .ps1 por politica de ejecucion. Aqui se
REM  ejecuta con -ExecutionPolicy Bypass SOLO para este script,
REM  sin cambiar la configuracion de tu equipo.
REM
REM  Uso:
REM    set-credentials.cmd -Show
REM    set-credentials.cmd -TestOnly
REM    set-credentials.cmd -SupabaseUrl "https://xxx.supabase.co" -SupabaseAnonKey "eyJ..."
REM ============================================================
chcp 65001 >nul
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0set-credentials.ps1" %*
set "RC=%ERRORLEVEL%"
endlocal & exit /b %RC%
