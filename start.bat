@echo off
:: ─────────────────────────────────────────────────────────────
::  YT Downloader — Auto Setup & Run (Windows)
::  Just double-click start.bat  OR  run it in cmd
:: ─────────────────────────────────────────────────────────────

title YT Downloader Setup

echo.
echo   YT Downloader - Setup
echo   ─────────────────────────────
echo.

:: ── Check Python ─────────────────────────────────────────────
echo [1/3] Checking Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo   ERROR: Python not found.
    echo   Download from https://www.python.org/downloads/
    echo   Make sure to check "Add Python to PATH" during install.
    pause
    exit /b 1
)
echo   Python found.

:: ── Virtual environment ───────────────────────────────────────
echo.
echo [2/3] Setting up environment...

if not exist "venv\" (
    python -m venv venv
)

call venv\Scripts\activate.bat
python -m pip install --upgrade pip --quiet
pip install -r requirements.txt --quiet

echo   Packages installed.

:: ── Create downloads folder ───────────────────────────────────
if not exist "downloads\" mkdir downloads

:: ── Start server ──────────────────────────────────────────────
echo.
echo [3/3] Starting server...
echo.
echo   Ready!  Open: http://localhost:5000
echo   Press Ctrl+C to stop.
echo.

python app.py

pause
