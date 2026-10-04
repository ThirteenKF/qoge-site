@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo === QOGE: publish changes ===
git add -A
git diff --cached --quiet && (echo Nothing to commit. & pause & exit /b 0)
if exist tools\commit-message.txt (
  git commit -F tools\commit-message.txt
  del tools\commit-message.txt
) else (
  git commit -m "Update site"
)
git pull --rebase origin main
git push origin main
echo.
if %errorlevel%==0 (echo DONE) else (echo [!] Push failed - send a screenshot to Claude)
pause
