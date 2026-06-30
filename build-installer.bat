@echo off
title Liqu Companion - Build Installer
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is required. Install it from https://nodejs.org and re-run this.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Installing dependencies first...
    call npm install
)

echo.
echo Building the Windows installer (Liqu Companion Setup .exe)...
echo.
echo The finished installer is a normal setup wizard that lets the user:
echo   - choose the install folder
echo   - create desktop / start-menu shortcuts
echo   - launch the app when setup finishes
echo It also registers an uninstaller in "Add or Remove Programs".
echo.
echo Output appears in the "dist" folder when finished.
echo.
call npm run dist:win

echo.
echo Done. Look in the "dist" folder for "Liqu Companion Setup x.x.x.exe".
pause
