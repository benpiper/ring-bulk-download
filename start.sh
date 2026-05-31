#!/bin/bash

echo "===================================================="
echo "  Ring Camera Bulk Video Downloader - Startup"
echo "===================================================="
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null
then
    echo "[ERROR] Node.js is not installed or not in your PATH."
    echo "Please download and install Node.js from https://nodejs.org/"
    echo "Press Enter to exit..."
    read
    exit 1
fi

echo "[INFO] Node.js found. Checking dependencies..."
if [ ! -d "node_modules" ]; then
    echo "[INFO] First time setup: Installing dependencies..."
    echo "[INFO] This may take a minute or two to download the secure browser bundle..."
    npm install
fi

echo ""
echo "[INFO] Starting the application..."
echo "[INFO] A browser window should open automatically."
echo "[INFO] Keep this terminal window open while using the app!"
echo ""
npm start
