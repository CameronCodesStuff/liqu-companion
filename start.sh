#!/bin/bash
# Liqu Companion - Launcher
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
    echo ""
    echo "[Liqu Companion] Node.js is not installed."
    echo "Install it from https://nodejs.org (LTS version), then run this script again."
    echo ""
    read -p "Press Enter to close..."
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo ""
    echo "[Liqu Companion] First run detected - installing dependencies..."
    echo "This downloads Electron and may take a few minutes."
    echo ""
    npm install
    if [ $? -ne 0 ]; then
        echo ""
        echo "[Liqu Companion] npm install failed. Check your internet connection and try again."
        echo ""
        read -p "Press Enter to close..."
        exit 1
    fi

    echo ""
    echo "============================================================"
    echo "  First-time setup"
    echo "============================================================"
    echo ""
    read -p "Create a desktop launcher for Liqu? (y/n): " MAKESHORTCUT
    if [[ "$MAKESHORTCUT" =~ ^[Yy]$ ]]; then
        DIR="$(pwd)"
        if [[ "$OSTYPE" == "linux"* ]] && [ -d "$HOME/Desktop" ]; then
            cat > "$HOME/Desktop/liqu-companion.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Liqu Companion
Exec=bash "$DIR/start.sh"
Path=$DIR
Terminal=false
Categories=Utility;
EOF
            chmod +x "$HOME/Desktop/liqu-companion.desktop"
            echo "Desktop launcher created."
        elif [[ "$OSTYPE" == "darwin"* ]] && [ -d "$HOME/Desktop" ]; then
            ln -sf "$DIR/start.sh" "$HOME/Desktop/Liqu Companion.command"
            chmod +x "$HOME/Desktop/Liqu Companion.command"
            echo "Desktop launcher created (Liqu Companion.command)."
        fi
    fi
    echo ""
    echo 'You can enable "Open on system startup" any time from'
    echo "Settings > System inside the app itself."
    echo ""
fi

echo ""
echo "[Liqu Companion] Starting..."
npm start
