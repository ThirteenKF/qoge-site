@echo off
chcp 65001 >nul
cd /d "%~dp0.."
git config core.hooksPath tools/hooks
echo Guard installed: git commit/push now work only through tools\publish.bat
pause
