@echo off
echo ====================================================
echo   Ring Camera Bulk Video Downloader - Startup
echo ====================================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in your PATH.
    echo Please download and install Node.js from https://nodejs.org/
    echo Press any key to exit...
    pause >nul
    exit /b
)

echo [INFO] Node.js found. Checking dependencies...
if not exist "node_modules" (
    echo [INFO] First time setup: Installing dependencies...
    echo [INFO] This may take a minute or two to download the secure browser bundle...
    call npm install
)

echo.
echo [INFO] Starting the application...
echo [INFO] A browser window should open automatically.
echo [INFO] Keep this command prompt window open while using the app!
echo.
call npm start
