@echo off
setlocal
chcp 65001 >nul
python -X utf8 "%~dp0learning\fast-track-06\practice.py"
set "lesson_exit=%ERRORLEVEL%"
pause
exit /b %lesson_exit%
