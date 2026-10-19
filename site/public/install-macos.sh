#!/bin/sh
# Install the Overseer hub on macOS as a LaunchAgent (no sudo needed).
#
#   curl -fsSL https://liveagent-lime.vercel.app/install-macos.sh | sh
#   curl -fsSL https://liveagent-lime.vercel.app/install-macos.sh | sh -s -- uninstall
#
# This file only defines functions until the last line, so a download that is
# cut short never runs half an installer. Release binaries are checked against
# the release's checksums.txt. When no release exists it builds from source
# with temporary, checksum-verified Go and Node toolchains and leaves your
# system untouched.
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
WAIT_SECONDS="${OVERSEER_WAIT_SECONDS:-15}"
PLIST="$LAUNCH_AGENT_DIR/$LABEL.plist"
LOG_DIR="$DATA_DIR/logs"
BIN="$BIN_DIR/overseer"
PREVIOUS_BIN="$BIN_DIR/overseer.previous"
INSTALLER_URL="https://liveagent-lime.vercel.app/install-macos.sh"

log() { printf '  %s\n' "$*"; }
ok() { printf '  \342\234\223 %s\n' "$*"; }
die() { printf '\n  overseer: %s\n\n' "$*" >&2; exit 1; }
need_cmd() { command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"; }

stop_service() {
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || launchctl unload "$PLIST" >/dev/null 2>&1 || true
}

uninstall() {
  stop_service
  rm -f "$PLIST" "$BIN" "$PREVIOUS_BIN" "$BIN.update.json"
  ok "Stopped and removed $LABEL"
  if [ "$PURGE" = "1" ]; then
    case "$DATA_DIR" in ""|/|"$HOME") die "refusing to purge unsafe data directory: $DATA_DIR" ;; esac
    rm -rf "$DATA_DIR"
    ok "Deleted data in $DATA_DIR"
  else
    log "Kept your data in $DATA_DIR (rerun with OVERSEER_PURGE=1 to delete it)"
  fi
}

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

sha256_file() { shasum -a 256 "$1" | awk '{print $1}'; }

download_release_binary() {
  if [ "$VERSION" = latest ]; then
    URL="https://github.com/$REPO/releases/latest/download/$ASSET"
  else
    URL="https://github.com/$REPO/releases/download/$VERSION/$ASSET"
  fi
  curl -fsSL --retry 3 "$URL" -o "$TMP/overseer" 2>/dev/null || return 1
  curl -fsSL --retry 3 "$(dirname "$URL")/checksums.txt" -o "$TMP/checksums.txt" 2>/dev/null || return 1
  EXPECTED="$(awk -v asset="$ASSET" '$2 == asset || $2 == "*" asset { print $1; exit }' "$TMP/checksums.txt")"
  [ -n "$EXPECTED" ] || die "the release's checksums.txt does not list $ASSET"
  [ "$(sha256_file "$TMP/overseer")" = "$EXPECTED" ] || die "checksum mismatch: the download was corrupted or tampered with"
  chmod +x "$TMP/overseer"
  ok "Downloaded and verified the $VERSION release (darwin/$ARCH)"
}

ensure_go() {
  if command -v go >/dev/null 2>&1; then
    HAVE="$(go env GOVERSION 2>/dev/null | sed 's/^go//; s/[^0-9.].*$//')"
    if [ -n "$HAVE" ] && version_at_least "$HAVE" "$GO_VERSION"; then return; fi
  fi
  GO_ARCHIVE="go${GO_VERSION}.darwin-${ARCH}.tar.gz"
  curl -fsSL "https://go.dev/dl/$GO_ARCHIVE" -o "$TMP/$GO_ARCHIVE"
  if [ -z "$GO_SHA256" ]; then
    case "$GO_VERSION:$ARCH" in
      1.25.0:amd64) GO_SHA256=5bd60e823037062c2307c71e8111809865116714d6f6b410597cf5075dfd80ef ;;
      1.25.0:arm64) GO_SHA256=544932844156d8172f7a28f77f2ac9c15a23046698b6243f633b0a0b00c0749c ;;
      *) die "set OVERSEER_GO_SHA256 when overriding OVERSEER_GO_VERSION" ;;
    esac
  fi
  [ "$(sha256_file "$TMP/$GO_ARCHIVE")" = "$GO_SHA256" ] || die "Go checksum verification failed"
  mkdir -p "$TMP/toolchains"
  tar -xzf "$TMP/$GO_ARCHIVE" -C "$TMP/toolchains"
  PATH="$TMP/toolchains/go/bin:$PATH"
  export PATH
}

ensure_node() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    HAVE_NODE="$(node -v | sed 's/^v//; s/\..*$//')"
    if [ "${HAVE_NODE:-0}" -ge "$NODE_MAJOR" ]; then return; fi
  fi
  NODE_BASE="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  curl -fsSL "$NODE_BASE/SHASUMS256.txt" -o "$TMP/node-shasums.txt"
  NODE_ARCH="$ARCH"
  [ "$ARCH" != amd64 ] || NODE_ARCH=x64
  NODE_ARCHIVE="$(awk -v arch="$NODE_ARCH" '$2 ~ ("^node-v[0-9.]+-darwin-" arch "\\.tar\\.gz$") { print $2; exit }' "$TMP/node-shasums.txt")"
  [ -n "$NODE_ARCHIVE" ] || die "could not find Node $NODE_MAJOR for darwin/$ARCH"
  EXPECTED="$(awk -v file="$NODE_ARCHIVE" '$2 == file { print $1; exit }' "$TMP/node-shasums.txt")"
  curl -fsSL "$NODE_BASE/$NODE_ARCHIVE" -o "$TMP/$NODE_ARCHIVE"
  [ "$(sha256_file "$TMP/$NODE_ARCHIVE")" = "$EXPECTED" ] || die "Node checksum verification failed"
  mkdir -p "$TMP/toolchains/node"
  tar -xzf "$TMP/$NODE_ARCHIVE" -C "$TMP/toolchains/node" --strip-components=1
  PATH="$TMP/toolchains/node/bin:$PATH"
  export PATH
}

build_from_source() {
  SOURCE_REF="$REF"
  if [ "$VERSION" != latest ]; then SOURCE_REF="$VERSION"; fi
  log "No release binary available; falling back to source build of $REPO@$SOURCE_REF (2-5 minutes)"
  BUILD_LOG="$TMP/build.log"
  if ! (
    ensure_go
    ensure_node
    SRC="$TMP/src"
    mkdir -p "$SRC"
    curl -fsSL "https://github.com/$REPO/archive/$SOURCE_REF.tar.gz" -o "$TMP/source.tar.gz"
    tar -xzf "$TMP/source.tar.gz" -C "$SRC" --strip-components=1
    (cd "$SRC/ui" && { npm ci --no-audit --no-fund || npm install --no-audit --no-fund; } && npm run build)
    rm -rf "$SRC/cmd/overseer/uidist"
    mkdir -p "$SRC/cmd/overseer/uidist"
    cp -R "$SRC/ui/dist/." "$SRC/cmd/overseer/uidist/"
    (cd "$SRC" && go build -ldflags "-s -w -X main.version=$SOURCE_REF" -o "$TMP/overseer" ./cmd/overseer)
  ) >"$BUILD_LOG" 2>&1; then
    tail -n 30 "$BUILD_LOG" >&2
    die "the source build failed (last lines above)"
  fi
  chmod +x "$TMP/overseer"
  ok "Built Overseer from source"
}

install_binary() {
  if [ -n "$LOCAL_BINARY" ]; then
    [ -f "$LOCAL_BINARY" ] || die "local binary not found: $LOCAL_BINARY"
    cp "$LOCAL_BINARY" "$TMP/overseer"
    chmod +x "$TMP/overseer"
    ok "Using local binary $LOCAL_BINARY"
    return
  fi
  if [ "$INSTALL_SOURCE" != source ] && download_release_binary; then return; fi
  [ "$INSTALL_SOURCE" != binary ] || die "no release binary is available for darwin/$ARCH"
  build_from_source
}

xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\\&apos;/g"
}

# service_path keeps the absolute entries of your PATH so the hub's own agent
# finds Claude Code, Codex, Node and friends; launchd would otherwise start it
# with a bare system PATH.
service_path() {
  printf '%s' "$BIN_DIR:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH:/usr/bin:/bin:/usr/sbin:/sbin" |
    tr ':' '\n' | awk 'substr($0, 1, 1) == "/" && !seen[$0]++' | paste -sd: -
}

install_service() {
  stop_service
  if [ -f "$BIN" ]; then cp "$BIN" "$PREVIOUS_BIN"; fi
  # A manual (re)install replaces any update in progress.
  rm -f "$BIN.update.json"
  mv "$TMP/overseer" "$BIN"

  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$(xml_escape "$LABEL")</string>
<key>ProgramArguments</key><array><string>$(xml_escape "$BIN")</string><string>serve</string><string>--addr</string><string>$(xml_escape "$ADDR")</string><string>--data-dir</string><string>$(xml_escape "$DATA_DIR")</string></array>
<key>EnvironmentVariables</key><dict><key>OVERSEER_MANAGED</key><string>hub</string><key>PATH</key><string>$(xml_escape "$(service_path)")</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>$(xml_escape "$LOG_DIR/hub.log")</string><key>StandardErrorPath</key><string>$(xml_escape "$LOG_DIR/hub.log")</string>
</dict></plist>
EOF
  if command -v plutil >/dev/null 2>&1; then plutil -lint "$PLIST" >/dev/null || die "generated an invalid LaunchAgent at $PLIST"; fi
  launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load "$PLIST"
  launchctl kickstart -k "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  ok "Installed the $LABEL LaunchAgent (starts at login, updates itself)"
}

wait_until_up() {
  case "$ADDR" in *:*) PORT="${ADDR##*:}" ;; *) PORT=4200 ;; esac
  i=0
  while [ "$i" -lt "$WAIT_SECONDS" ]; do
    if curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/api/me" 2>/dev/null; then return 0; fi
    i=$((i + 1))
    sleep 1
  done
  return 1
}

lan_ip() {
  ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  printf '%s' "${ip:-localhost}"
}

finish() {
  case "$ADDR" in :*) URL="http://$(lan_ip)$ADDR" ;; *) URL="http://$ADDR" ;; esac
  STATE="is running"
  if ! wait_until_up; then
    STATE="is installed but has not answered yet; check: tail -n 50 \"$LOG_DIR/hub.log\""
  fi
  CODE="$(cat "$DATA_DIR/setup-code" 2>/dev/null || true)"
  printf '\nOverseer hub %s.\n\n' "$STATE"
  if [ -n "$CODE" ]; then
    printf '  Open    %s/?setup=%s\n' "$URL" "$CODE"
    printf '  Code    %s   (only for choosing your password the first time)\n\n' "$CODE"
  else
    printf '  Open    %s\n\n' "$URL"
  fi
  printf '  Logs    tail -f "%s"\n' "$LOG_DIR/hub.log"
  printf '  Remove  curl -fsSL %s | sh -s -- uninstall\n\n' "$INSTALLER_URL"
}

main() {
  [ "$(uname -s)" = "Darwin" ] || die "this installer is for macOS (use install.sh on Linux, install.ps1 on Windows)"
  ARCH="$(uname -m)"
  case "$ARCH" in x86_64|amd64) ARCH=amd64 ;; arm64|aarch64) ARCH=arm64 ;; *) die "unsupported CPU: $ARCH" ;; esac
  case "$INSTALL_SOURCE" in auto|binary|source) ;; *) die "OVERSEER_INSTALL_SOURCE must be auto, binary, or source" ;; esac

  case "$ACTION" in
    install) ;;
    uninstall|remove) printf '\nRemoving the Overseer hub\n\n'; uninstall; printf '\n'; return 0 ;;
    *) die "unknown action: $ACTION (use install or uninstall)" ;;
  esac

  need_cmd curl
  need_cmd tar
  need_cmd shasum
  mkdir -p "$BIN_DIR" "$LAUNCH_AGENT_DIR" "$LOG_DIR"
  chmod 700 "$DATA_DIR"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT INT TERM
  ASSET="overseer_darwin_$ARCH"

  printf '\nInstalling the Overseer hub\n\n'
  install_binary
  install_service
  finish
}

main "$@"
