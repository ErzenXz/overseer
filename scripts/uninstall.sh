#!/bin/bash

#################################################
# MyBot Uninstall Script
#################################################

set -e

MYBOT_DIR="${MYBOT_DIR:-$HOME/mybot}"

echo "⚠️  This will completely remove MyBot from your system."
echo "   Directory: $MYBOT_DIR"
echo ""
read -p "Are you sure you want to continue? (y/N) " -n 1 -r
echo

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Uninstall cancelled."
    exit 1
fi

echo ""
echo "🗑️ Uninstalling MyBot..."

# Stop services
if command -v systemctl >/dev/null 2>&1; then
    echo "Stopping services..."
    sudo systemctl stop mybot-web mybot-bot 2>/dev/null || true
    sudo systemctl disable mybot-web mybot-bot 2>/dev/null || true
    
    echo "Removing service files..."
    sudo rm -f /etc/systemd/system/mybot-web.service
    sudo rm -f /etc/systemd/system/mybot-bot.service
    sudo systemctl daemon-reload
fi

# Remove installation directory
if [ -d "$MYBOT_DIR" ]; then
    echo "Removing installation directory..."
    rm -rf "$MYBOT_DIR"
fi

# Remove from bashrc
if grep -q "mybot" "$HOME/.bashrc" 2>/dev/null; then
    echo "Cleaning up bashrc..."
    sed -i '/# MyBot/d' "$HOME/.bashrc"
    sed -i '/mybot/d' "$HOME/.bashrc"
fi

echo ""
echo "✅ MyBot has been uninstalled."
echo "   Your data has been removed."
