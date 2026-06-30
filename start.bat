@echo off
title Liqu Companion - Launcher
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo [Liqu Companion] Node.js is not installed or not on your PATH.
    echo Download it from https://nodejs.org ^(LTS version^), install it,
    echo then double-click this file again.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo.
    echo [Liqu Companion] First run detected - installing dependencies...
    echo This downloads Electron and may take a few minutes.
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo [Liqu Companion] npm install failed. Check your internet connection and try again.
        echo.
        pause
        exit /b 1
    )

    echo.
    echo ============================================================
    echo   First-time setup
    echo ============================================================
    echo.
    set /p MAKESHORTCUT="Create a Desktop shortcut to launch Liqu? (y/n): "
    if /i "%MAKESHORTCUT%"=="y" (
        powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Liqu Companion.lnk'); $s.TargetPath='%~f0'; $s.WorkingDirectory='%~dp0'; $s.Save()"
        echo Desktop shortcut created.
    )
    echo.
    echo You can enable "Open on system startup" any time from
    echo Settings ^> System inside the app itself.
    echo.
)

echo.
echo [Liqu Companion] Starting...
call npm start
