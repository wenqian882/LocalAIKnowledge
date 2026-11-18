@echo off
cd /d "%~dp0"
if exist "release\LocalAI Knowledge-win32-x64\LocalAIKnowledge.exe" (
  start "" "release\LocalAI Knowledge-win32-x64\LocalAIKnowledge.exe"
  exit /b
)
call npm.cmd start
if errorlevel 1 pause
