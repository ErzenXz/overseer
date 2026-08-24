#!/bin/sh
# Install or remove the Overseer hub as a macOS LaunchAgent.
# Release binaries are preferred. When no release exists, the installer builds
# from source with temporary Go and Node toolchains and changes no system SDKs.
set -eu

ACTION="${1:-install}"
REPO="${OVERSEER_REPO:-ErzenXz/overseer}"
VERSION="${OVERSEER_VERSION:-latest}"
REF="${OVERSEER_REF:-main}"
ADDR="${OVERSEER_ADDR:-:4200}"
DATA_DIR="${OVERSEER_DATA_DIR:-$HOME/.overseer}"
BIN_DIR="${OVERSEER_BIN_DIR:-$HOME/.local/bin}"
PURGE="${OVERSEER_PURGE:-0}"
LOCAL_BINARY="${OVERSEER_LOCAL_BINARY:-}"
INSTALL_SOURCE="${OVERSEER_INSTALL_SOURCE:-auto}"
GO_VERSION="${OVERSEER_GO_VERSION:-1.25.0}"
GO_SHA256="${OVERSEER_GO_SHA256:-}"
NODE_MAJOR="${OVERSEER_NODE_MAJOR:-20}"
LABEL="${OVERSEER_SERVICE_NAME:-sh.overseer.hub}"
LAUNCH_AGENT_DIR="${OVERSEER_LAUNCH_AGENT_DIR:-$HOME/Library/LaunchAgents}"
PLIST="$LAUNCH_AGENT_DIR/$LABEL.plist"
LOG_DIR="$DATA_DIR/logs"
BIN="$BIN_DIR/overseer"
PREVIOUS_BIN="$BIN_DIR/overseer.previous"

log() { printf '%s\n' "overseer: $*"; }
die() { printf '%s\n' "overseer: $*" >&2; exit 1; }
need_cmd() { command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"; }

[ "$(uname -s)" = "Darwin" ] || die "this installer is for macOS"
ARCH="$(uname -m)"
case "$ARCH" in x86_64|amd64) ARCH=amd64 ;; arm64|aarch64) ARCH=arm64 ;; *) die "unsupported architecture: $ARCH" ;; esac
case "$INSTALL_SOURCE" in auto|binary|source) ;; *) die "OVERSEER_INSTALL_SOURCE must be auto, binary, or source" ;; esac

uninstall() {
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || launchctl unload "$PLIST" >/dev/null 2>&1 || true
  rm -f "$PLIST" "$BIN" "$PREVIOUS_BIN"
  if [ "$PURGE" = "1" ]; then
    rm -rf "$DATA_DIR"
    log "purged data at $DATA_DIR"
  else
    log "kept data at $DATA_DIR"
  fi
  log "uninstalled"
}

case "$ACTION" in install) ;; uninstall|remove) uninstall; exit 0 ;; *) die "use install or uninstall" ;; esac

need_cmd curl
need_cmd tar
need_cmd shasum
mkdir -p "$BIN_DIR" "$LAUNCH_AGENT_DIR" "$LOG_DIR"
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT INT TERM
ASSET="overseer_darwin_$ARCH"

version_at_least() {
  awk -v have="$1" -v need="$2" '
    BEGIN {
      split(have, h, "."); split(need, n, ".")
      for (i = 1; i <= 3; i++) {
        if ((h[i] + 0) > (n[i] + 0)) exit 0
        if ((h[i] + 0) < (n[i] + 0)) exit 1
      }
      exit 0
    }'
}

download_release_binary() {
  if [ "$VERSION" = latest ]; then
    URL="https://github.com/$REPO/releases/latest/download/$ASSET"
  else
    URL="https://github.com/$REPO/releases/download/$VERSION/$ASSET"
  fi
  log "trying release binary: $URL"
  if ! curl -fL "$URL" -o "$TMP/overseer"; then
    return 1
  fi
  curl -fL "$(dirname "$URL")/checksums.txt" -o "$TMP/checksums.txt" || return 1
  EXPECTED="$(awk -v asset="$ASSET" '$2 == asset || $2 == "*" asset { print $1; exit }' "$TMP/checksums.txt")"
  [ -n "$EXPECTED" ] || die "checksums.txt does not contain $ASSET"
  ACTUAL="$(shasum -a 256 "$TMP/overseer" | awk '{print $1}')"
  [ "$ACTUAL" = "$EXPECTED" ] || die "release checksum verification failed"
  chmod +x "$TMP/overseer"
}

ensure_go() {
  if command -v go >/dev/null 2>&1; then
    HAVE="$(go env GOVERSION 2>/dev/null | sed 's/^go//; s/[^0-9.].*$//')"
    if [ -n "$HAVE" ] && version_at_least "$HAVE" "$GO_VERSION"; then
      return
    fi
  fi
  log "using temporary Go $GO_VERSION toolchain"
  GO_ARCHIVE="go${GO_VERSION}.darwin-${ARCH}.tar.gz"
  curl -fL "https://go.dev/dl/$GO_ARCHIVE" -o "$TMP/$GO_ARCHIVE"
  if [ -z "$GO_SHA256" ]; then
    case "$GO_VERSION:$ARCH" in
      1.25.0:amd64) GO_SHA256=5bd60e823037062c2307c71e8111809865116714d6f6b410597cf5075dfd80ef ;;
      1.25.0:arm64) GO_SHA256=544932844156d8172f7a28f77f2ac9c15a23046698b6243f633b0a0b00c0749c ;;
      *) die "set OVERSEER_GO_SHA256 when overriding OVERSEER_GO_VERSION" ;;
    esac
  fi
  ACTUAL="$(shasum -a 256 "$TMP/$GO_ARCHIVE" | awk '{print $1}')"
  [ "$ACTUAL" = "$GO_SHA256" ] || die "Go checksum verification failed"
  mkdir -p "$TMP/toolchains"
  tar -xzf "$TMP/$GO_ARCHIVE" -C "$TMP/toolchains"
  PATH="$TMP/toolchains/go/bin:$PATH"
  export PATH
}

ensure_node() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    HAVE_NODE="$(node -v | sed 's/^v//; s/\..*$//')"
    if [ "${HAVE_NODE:-0}" -ge "$NODE_MAJOR" ]; then
      return
    fi
  fi
  log "using temporary Node $NODE_MAJOR toolchain"
  NODE_BASE="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  curl -fL "$NODE_BASE/SHASUMS256.txt" -o "$TMP/node-shasums.txt"
  NODE_ARCHIVE="$(awk -v arch="$ARCH" '$2 ~ ("^node-v[0-9.]+-darwin-" arch "\\.tar\\.gz$") { print $2; exit }' "$TMP/node-shasums.txt")"
  [ -n "$NODE_ARCHIVE" ] || die "could not resolve Node $NODE_MAJOR for darwin/$ARCH"
  EXPECTED="$(awk -v file="$NODE_ARCHIVE" '$2 == file { print $1; exit }' "$TMP/node-shasums.txt")"
  curl -fL "$NODE_BASE/$NODE_ARCHIVE" -o "$TMP/$NODE_ARCHIVE"
  ACTUAL="$(shasum -a 256 "$TMP/$NODE_ARCHIVE" | awk '{print $1}')"
  [ "$ACTUAL" = "$EXPECTED" ] || die "Node checksum verification failed"
  mkdir -p "$TMP/toolchains/node"
  tar -xzf "$TMP/$NODE_ARCHIVE" -C "$TMP/toolchains/node" --strip-components=1
  PATH="$TMP/toolchains/node/bin:$PATH"
  export PATH
}

build_from_source() {
  ensure_go
  ensure_node
  SRC="$TMP/src"
  SOURCE_REF="$REF"
  if [ "$VERSION" != latest ]; then SOURCE_REF="$VERSION"; fi
  log "building from source: $REPO@$SOURCE_REF"
  mkdir -p "$SRC"
  curl -fL "https://github.com/$REPO/archive/$SOURCE_REF.tar.gz" -o "$TMP/source.tar.gz"
  tar -xzf "$TMP/source.tar.gz" -C "$SRC" --strip-components=1
  (cd "$SRC/ui" && npm install --no-audit --no-fund && npm run build)
  rm -rf "$SRC/cmd/overseer/uidist"
  mkdir -p "$SRC/cmd/overseer/uidist"
  cp -R "$SRC/ui/dist/." "$SRC/cmd/overseer/uidist/"
  (cd "$SRC" && go build -ldflags "-s -w -X main.version=$SOURCE_REF" -o "$TMP/overseer" ./cmd/overseer)
  chmod +x "$TMP/overseer"
}

install_binary() {
  if [ -n "$LOCAL_BINARY" ]; then
    [ -f "$LOCAL_BINARY" ] || die "local binary not found: $LOCAL_BINARY"
    log "using local binary: $LOCAL_BINARY"
    cp "$LOCAL_BINARY" "$TMP/overseer"
    chmod +x "$TMP/overseer"
    return
  fi
  if [ "$INSTALL_SOURCE" != source ] && download_release_binary; then return; fi
  [ "$INSTALL_SOURCE" != binary ] || die "release binary was not available"
  log "release binary unavailable; falling back to source build"
  build_from_source
}

xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\\&apos;/g"
}

install_binary
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || launchctl unload "$PLIST" >/dev/null 2>&1 || true
if [ -f "$BIN" ]; then cp "$BIN" "$PREVIOUS_BIN"; fi
mv "$TMP/overseer" "$BIN"

PLIST_BIN="$(xml_escape "$BIN")"
PLIST_ADDR="$(xml_escape "$ADDR")"
PLIST_DATA="$(xml_escape "$DATA_DIR")"
PLIST_LOG="$(xml_escape "$LOG_DIR/hub.log")"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$(xml_escape "$LABEL")</string>
<key>ProgramArguments</key><array><string>$PLIST_BIN</string><string>serve</string><string>--addr</string><string>$PLIST_ADDR</string><string>--data-dir</string><string>$PLIST_DATA</string></array>
<key>EnvironmentVariables</key><dict><key>OVERSEER_MANAGED</key><string>hub</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>$PLIST_LOG</string><key>StandardErrorPath</key><string>$PLIST_LOG</string>
</dict></plist>
EOF
if command -v plutil >/dev/null 2>&1; then plutil -lint "$PLIST" >/dev/null; fi
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/$LABEL"

INSTALLED_VERSION="$("$BIN" version 2>/dev/null | sed 's/^overseer //' || true)"
[ -n "$INSTALLED_VERSION" ] && log "installed $INSTALLED_VERSION" || log "installed overseer"
case "$ADDR" in :*) OPEN_ADDR="http://localhost$ADDR" ;; *) OPEN_ADDR="http://$ADDR" ;; esac
log "service: $LABEL"
log "open: $OPEN_ADDR"
