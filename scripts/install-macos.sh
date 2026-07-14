#!/bin/sh
# Install or remove the Overseer hub as a macOS LaunchAgent.
set -eu

ACTION="${1:-install}"
REPO="${OVERSEER_REPO:-ErzenXz/overseer}"
VERSION="${OVERSEER_VERSION:-latest}"
ADDR="${OVERSEER_ADDR:-:4200}"
DATA_DIR="${OVERSEER_DATA_DIR:-$HOME/.overseer}"
BIN_DIR="${OVERSEER_BIN_DIR:-$HOME/.local/bin}"
PURGE="${OVERSEER_PURGE:-0}"
LOCAL_BINARY="${OVERSEER_LOCAL_BINARY:-}"
LABEL="sh.overseer.hub"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$DATA_DIR/logs"

log() { printf '%s\n' "overseer: $*"; }
die() { printf '%s\n' "overseer: $*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "this installer is for macOS"
ARCH="$(uname -m)"
case "$ARCH" in x86_64|amd64) ARCH=amd64 ;; arm64|aarch64) ARCH=arm64 ;; *) die "unsupported architecture: $ARCH" ;; esac

uninstall() {
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || launchctl unload "$PLIST" >/dev/null 2>&1 || true
  rm -f "$PLIST" "$BIN_DIR/overseer" "$BIN_DIR/overseer.previous"
  if [ "$PURGE" = "1" ]; then rm -rf "$DATA_DIR"; else log "kept data at $DATA_DIR"; fi
  log "uninstalled"
}

case "$ACTION" in install) ;; uninstall|remove) uninstall; exit 0 ;; *) die "use install or uninstall" ;; esac

mkdir -p "$BIN_DIR" "$HOME/Library/LaunchAgents" "$LOG_DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM
if [ -n "$LOCAL_BINARY" ]; then
  cp "$LOCAL_BINARY" "$TMP/overseer"
else
  if [ "$VERSION" = latest ]; then URL="https://github.com/$REPO/releases/latest/download/overseer_darwin_$ARCH"; else URL="https://github.com/$REPO/releases/download/$VERSION/overseer_darwin_$ARCH"; fi
  log "downloading macOS/$ARCH binary"
  curl -fL "$URL" -o "$TMP/overseer"
  curl -fL "$(dirname "$URL")/checksums.txt" -o "$TMP/checksums.txt"
  ASSET="overseer_darwin_$ARCH"
  EXPECTED="$(awk -v asset="$ASSET" '$2 == asset || $2 == "*" asset { print $1; exit }' "$TMP/checksums.txt")"
  [ -n "$EXPECTED" ] || die "checksums.txt does not contain $ASSET"
  ACTUAL="$(shasum -a 256 "$TMP/overseer" | awk '{print $1}')"
  [ "$ACTUAL" = "$EXPECTED" ] || die "release checksum verification failed"
fi
chmod +x "$TMP/overseer"
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || launchctl unload "$PLIST" >/dev/null 2>&1 || true
mv "$TMP/overseer" "$BIN_DIR/overseer"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$LABEL</string>
<key>ProgramArguments</key><array><string>$BIN_DIR/overseer</string><string>serve</string><string>--addr</string><string>$ADDR</string><string>--data-dir</string><string>$DATA_DIR</string></array>
<key>EnvironmentVariables</key><dict><key>OVERSEER_MANAGED</key><string>hub</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>$LOG_DIR/hub.log</string><key>StandardErrorPath</key><string>$LOG_DIR/hub.log</string>
</dict></plist>
EOF
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/$LABEL"
log "installed; open http://localhost:4200"
