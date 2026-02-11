#!/bin/bash

#################################################
# Overseer Uninstall Script
#################################################

set -e

OVERSEER_DIR="${OVERSEER_DIR:-$HOME/overseer}"

echo "⚠️  This will completely remove Overseer from your system."
echo "   Directory: $OVERSEER_DIR"
echo ""
read -p "Are you sure you want to continue? (y/N) " -n 1 -r
echo

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Uninstall cancelled."
    exit 1
fi

echo ""
echo "🗑️ Uninstalling Overseer..."

# Stop services
if command -v systemctl >/dev/null 2>&1; then
    echo "Stopping services..."
    sudo systemctl stop overseer-web overseer-bot 2>/dev/null || true
    sudo systemctl disable overseer-web overseer-bot 2>/dev/null || true
    
    echo "Removing service files..."
    sudo rm -f /etc/systemd/system/overseer-web.service
    sudo rm -f /etc/systemd/system/overseer-bot.service
    sudo systemctl daemon-reload
fi

# Remove installation directory
if [ -d "$OVERSEER_DIR" ]; then
    echo "Removing installation directory..."
    rm -rf "$OVERSEER_DIR"
fi

# Remove from bashrc
if grep -q "overseer" "$HOME/.bashrc" 2>/dev/null; then
    echo "Cleaning up bashrc..."
    sed -i '/# Overseer/d' "$HOME/.bashrc"
    sed -i '/overseer/d' "$HOME/.bashrc"
fi

echo ""
echo "✅ Overseer has been uninstalled."
echo "   Your data has been removed."
