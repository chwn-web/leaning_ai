@echo off
REM 计划任务入口：静默跑备份，输出进 .tmp-backup.log
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0session-backup.ps1" -Quiet
exit /b %ERRORLEVEL%
