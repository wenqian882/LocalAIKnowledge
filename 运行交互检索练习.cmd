@echo off
setlocal
chcp 65001 >nul
python -X utf8 "%~dp0learning\interactive-07\ask.py"
set "lesson_exit=%ERRORLEVEL%"
pause
exit /b %lesson_exit%
