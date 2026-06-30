#!/bin/bash
# Builds a real native installer (.dmg on macOS, .AppImage on Linux) using electron-builder.

cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
    echo "Node.js is required. Install it from https://nodejs.org and re-run this."
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo "Installing dependencies first..."
    npm install
fi

echo ""
echo "Building installer with electron-builder..."
echo "Output will appear in the 'dist' folder when finished."
echo ""

if [[ "$OSTYPE" == "darwin"* ]]; then
    npm run dist:mac
else
    npm run dist:linux
fi

echo ""
echo "Done. Check the 'dist' folder for the installer."
