@echo off
title YT Downloader

echo.
echo   YT Downloader - Auto Setup
echo   ─────────────────────────────
echo.

echo [1/3] Checking Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo   ERROR: Python not found.
    echo   Download: https://www.python.org/downloads/
    echo   Check "Add Python to PATH" during install.
    pause & exit /b 1
)
echo   Python found.

echo.
echo [2/3] Setting up environment...
if not exist "venv\" ( python -m venv venv )
call venv\Scripts\activate.bat
python -m pip install --upgrade pip --quiet
pip install -r requirements.txt --quiet
echo   Packages ready.

if not exist "downloads\" mkdir downloads

echo.
echo [3/3] Starting server...
echo.
echo   Open: http://localhost:5000
echo   Press Ctrl+C to stop.
echo.

python app.py
pause
