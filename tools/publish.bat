@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo === QOGE: publish changes ===
git add -A
git diff --cached --quiet
if %errorlevel%==0 (
  echo No new file changes to commit.
  goto push
)
if exist tools\commit-message.txt (
  git commit -F tools\commit-message.txt
  del tools\commit-message.txt
) else (
  git commit -m "Update site"
)
:push
echo.
echo --- syncing with GitHub ---
git pull --rebase origin main
git push origin main
set RESULT=%errorlevel%
echo.
git status -sb
git log --oneline -3
echo.
if %RESULT%==0 (echo DONE) else (echo [!] Push failed - send a screenshot to Claude)
pause
