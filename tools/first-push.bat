@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo === QOGE: first push to GitHub ===
where git >nul 2>&1 || (echo [!] Git not found. Install from https://git-scm.com and run again. & pause & exit /b 1)
echo.
echo [1/5] Checking SSH access to GitHub...
ssh -o StrictHostKeyChecking=accept-new -T git@github.com
echo.
if exist .git (echo [2/5] Repo already initialized) else (git init -b main)
git config core.autocrlf true
git config user.name "ThirteenKF"
git config user.email "zasadayourock@gmail.com"
echo [3/5] Committing files...
git add -A
git commit -m "Initial commit: QOGE landing page"
echo [4/5] Linking to github.com/ThirteenKF/qoge-site ...
git remote remove origin >nul 2>&1
git remote add origin git@github.com:ThirteenKF/qoge-site.git
echo [5/5] Pushing...
git push -u origin main
echo.
if %errorlevel%==0 (echo DONE: https://github.com/ThirteenKF/qoge-site) else (echo [!] Push failed - send a screenshot of this window to Claude)
pause
