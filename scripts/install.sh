#!/bin/sh
# Install the Overseer hub on a Linux host with systemd.
#
#   curl -fsSL https://liveagent-lime.vercel.app/install.sh | sh
#   curl -fsSL https://liveagent-lime.vercel.app/install.sh | sh -s -- uninstall
#
# This file only defines functions until the last line, so a download that is
# cut short never runs half an installer. Release binaries are checked against
# the release's checksums.txt; the toolchains used by the source fallback are
# checked against pinned or officially published SHA-256 sums.
set -eu

ACTION="${1:-install}"
REPO="${OVERSEER_REPO:-ErzenXz/overseer}"
VERSION="${OVERSEER_VERSION:-latest}"
REF="${OVERSEER_REF:-main}"
ADDR="${OVERSEER_ADDR:-:4200}"
DATA_DIR="${OVERSEER_DATA_DIR:-/var/lib/overseer}"
USER_NAME="${OVERSEER_USER:-overseer}"
BIN_DIR="${OVERSEER_BIN_DIR:-/usr/local/bin}"
MANAGED_BIN_DIR="$DATA_DIR/bin"
SERVICE_NAME="${OVERSEER_SERVICE_NAME:-overseer-hub}"
UNIT_DIR="${OVERSEER_SYSTEMD_DIR:-/etc/systemd/system}"
TLS_DOMAIN="${OVERSEER_TLS_DOMAIN:-}"
TLS_EMAIL="${OVERSEER_TLS_EMAIL:-}"
INSTALL_SOURCE="${OVERSEER_INSTALL_SOURCE:-auto}"
GO_VERSION="${OVERSEER_GO_VERSION:-1.25.0}"
GO_SHA256="${OVERSEER_GO_SHA256:-}"
NODE_MAJOR="${OVERSEER_NODE_MAJOR:-20}"
PURGE="${OVERSEER_PURGE:-0}"
LOCAL_BINARY="${OVERSEER_LOCAL_BINARY:-}"
SERVICE_SHELL="${OVERSEER_SERVICE_SHELL:-/bin/sh}"
WAIT_SECONDS="${OVERSEER_WAIT_SECONDS:-15}"
INSTALLER_URL="https://liveagent-lime.vercel.app/install.sh"

log() { printf '  %s\n' "$*"; }
ok() { printf '  \342\234\223 %s\n' "$*"; }
die() { printf '\n  overseer: %s\n\n' "$*" >&2; exit 1; }
need_cmd() { command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"; }

safe_purge() {
  case "$DATA_DIR" in ""|/|/var|/var/lib|/usr|/etc|/home|/root|"$HOME") die "refusing to purge unsafe data directory: $DATA_DIR" ;; esac
  $SUDO rm -rf "$DATA_DIR"
}

uninstall_service() {
  UNIT_FILE="$UNIT_DIR/${SERVICE_NAME}.service"
  if systemctl list-unit-files "${SERVICE_NAME}.service" >/dev/null 2>&1 || [ -f "$UNIT_FILE" ]; then
    $SUDO systemctl disable --now "$SERVICE_NAME" >/dev/null 2>&1 || true
  fi
  $SUDO rm -f "$UNIT_FILE"
  $SUDO systemctl daemon-reload
  $SUDO systemctl reset-failed "$SERVICE_NAME" >/dev/null 2>&1 || true
  $SUDO rm -f "$BIN_DIR/overseer" "$MANAGED_BIN_DIR/overseer" "$MANAGED_BIN_DIR/overseer.previous" "$MANAGED_BIN_DIR/overseer.update.json"
  ok "Stopped and removed $SERVICE_NAME"
  if [ "$PURGE" = 1 ]; then
    safe_purge
    if id "$USER_NAME" >/dev/null 2>&1; then $SUDO userdel "$USER_NAME" >/dev/null 2>&1 || true; fi
    ok "Deleted data in $DATA_DIR and the $USER_NAME user"
  else
    log "Kept your data in $DATA_DIR (rerun with OVERSEER_PURGE=1 to delete it)"
  fi
}

install_packages() {
  missing=""
  for cmd in "$@"; do command -v "$cmd" >/dev/null 2>&1 || missing="$missing $cmd"; done
  [ -n "$missing" ] || return 0
  log "Installing:$missing"
  if command -v apt-get >/dev/null 2>&1; then
    $SUDO env DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null
    for package in $missing; do
      case "$package" in curl) package="ca-certificates curl" ;; esac
      # shellcheck disable=SC2086 # word splitting is intended for "ca-certificates curl"
      $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $package >/dev/null
    done
    return
  fi
  # shellcheck disable=SC2086
  if command -v dnf >/dev/null 2>&1; then $SUDO dnf install -y -q $missing >/dev/null; return; fi
  # shellcheck disable=SC2086
  if command -v yum >/dev/null 2>&1; then $SUDO yum install -y -q $missing >/dev/null; return; fi
  # shellcheck disable=SC2086
  if command -v apk >/dev/null 2>&1; then $SUDO apk add --no-progress -q $missing >/dev/null; return; fi
  # shellcheck disable=SC2086
  if command -v pacman >/dev/null 2>&1; then $SUDO pacman -S --noconfirm --needed $missing >/dev/null; return; fi
  die "please install$missing, then run this again"
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi
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

ensure_go() {
  if command -v go >/dev/null 2>&1; then
    HAVE="$(go env GOVERSION 2>/dev/null | sed 's/^go//; s/[^0-9.].*$//')"
    if [ -n "$HAVE" ] && version_at_least "$HAVE" "$GO_VERSION"; then return; fi
  fi
  GO_ARCHIVE="go${GO_VERSION}.linux-${ARCH}.tar.gz"
  curl -fsSL "https://go.dev/dl/$GO_ARCHIVE" -o "$TMP_DIR/$GO_ARCHIVE"
  if [ -z "$GO_SHA256" ]; then
    case "$GO_VERSION:$ARCH" in
      1.25.0:amd64) GO_SHA256=2852af0cb20a13139b3448992e69b868e50ed0f8a1e5940ee1de9e19a123b613 ;;
      1.25.0:arm64) GO_SHA256=05de75d6994a2783699815ee553bd5a9327d8b79991de36e38b66862782f54ae ;;
      *) die "set OVERSEER_GO_SHA256 when overriding OVERSEER_GO_VERSION" ;;
    esac
  fi
  [ "$(sha256_file "$TMP_DIR/$GO_ARCHIVE")" = "$GO_SHA256" ] || die "Go checksum verification failed"
  mkdir -p "$TMP_DIR/toolchains"
  tar -xzf "$TMP_DIR/$GO_ARCHIVE" -C "$TMP_DIR/toolchains"
  PATH="$TMP_DIR/toolchains/go/bin:$PATH"
  export PATH
}

ensure_node() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    HAVE_NODE="$(node -v | sed 's/^v//; s/\..*$//')"
    if [ "${HAVE_NODE:-0}" -ge "$NODE_MAJOR" ]; then return; fi
  fi
  NODE_BASE="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  curl -fsSL "$NODE_BASE/SHASUMS256.txt" -o "$TMP_DIR/node-shasums.txt"
  NODE_ARCHIVE="$(awk -v arch="$ARCH" '$2 ~ ("^node-v[0-9.]+-linux-" (arch == "amd64" ? "x64" : arch) "\\.tar\\.gz$") { print $2; exit }' "$TMP_DIR/node-shasums.txt")"
  [ -n "$NODE_ARCHIVE" ] || die "could not find Node $NODE_MAJOR for linux/$ARCH"
  EXPECTED="$(awk -v file="$NODE_ARCHIVE" '$2 == file { print $1; exit }' "$TMP_DIR/node-shasums.txt")"
  curl -fsSL "$NODE_BASE/$NODE_ARCHIVE" -o "$TMP_DIR/$NODE_ARCHIVE"
  [ "$(sha256_file "$TMP_DIR/$NODE_ARCHIVE")" = "$EXPECTED" ] || die "Node checksum verification failed"
  mkdir -p "$TMP_DIR/toolchains/node"
  tar -xzf "$TMP_DIR/$NODE_ARCHIVE" -C "$TMP_DIR/toolchains/node" --strip-components=1
  PATH="$TMP_DIR/toolchains/node/bin:$PATH"
  export PATH
}

download_release_binary() {
  if [ "$VERSION" = latest ]; then URL="https://github.com/$REPO/releases/latest/download/$ASSET"; else URL="https://github.com/$REPO/releases/download/$VERSION/$ASSET"; fi
  curl -fsSL --retry 3 "$URL" -o "$TMP_DIR/overseer" 2>/dev/null || return 1
  curl -fsSL --retry 3 "$(dirname "$URL")/checksums.txt" -o "$TMP_DIR/checksums.txt" 2>/dev/null || return 1
  EXPECTED="$(awk -v asset="$ASSET" '$2 == asset || $2 == "*" asset { print $1; exit }' "$TMP_DIR/checksums.txt")"
  [ -n "$EXPECTED" ] || die "the release's checksums.txt does not list $ASSET"
  [ "$(sha256_file "$TMP_DIR/overseer")" = "$EXPECTED" ] || die "checksum mismatch: the download was corrupted or tampered with"
  chmod +x "$TMP_DIR/overseer"
  ok "Downloaded and verified the $VERSION release (linux/$ARCH)"
}

build_from_source() {
  install_packages curl tar
  SOURCE_REF="$REF"
  if [ "$VERSION" != latest ]; then SOURCE_REF="$VERSION"; fi
  log "No release binary available; falling back to source build of $REPO@$SOURCE_REF (2-5 minutes)"
  BUILD_LOG="$TMP_DIR/build.log"
  if ! (
    ensure_go
    ensure_node
    SRC="$TMP_DIR/src"
    mkdir -p "$SRC"
    curl -fsSL "https://github.com/$REPO/archive/$SOURCE_REF.tar.gz" -o "$TMP_DIR/source.tar.gz"
    tar -xzf "$TMP_DIR/source.tar.gz" -C "$SRC" --strip-components=1
    (cd "$SRC/ui" && { npm ci --no-audit --no-fund || npm install --no-audit --no-fund; } && npm run build)
    rm -rf "$SRC/cmd/overseer/uidist"
    mkdir -p "$SRC/cmd/overseer/uidist"
    cp -R "$SRC/ui/dist/." "$SRC/cmd/overseer/uidist/"
    (cd "$SRC" && go build -ldflags "-s -w -X main.version=$SOURCE_REF" -o "$TMP_DIR/overseer" ./cmd/overseer)
  ) >"$BUILD_LOG" 2>&1; then
    tail -n 30 "$BUILD_LOG" >&2
    die "the source build failed (last lines above)"
  fi
  chmod +x "$TMP_DIR/overseer"
  ok "Built Overseer from source"
}

install_binary() {
  if [ -n "$LOCAL_BINARY" ]; then
    [ -f "$LOCAL_BINARY" ] || die "local binary not found: $LOCAL_BINARY"
    cp "$LOCAL_BINARY" "$TMP_DIR/overseer"
    chmod +x "$TMP_DIR/overseer"
    ok "Using local binary $LOCAL_BINARY"
    return
  fi
  install_packages curl
  if [ "$INSTALL_SOURCE" != source ] && download_release_binary; then return; fi
  [ "$INSTALL_SOURCE" != binary ] || die "no release binary is available for linux/$ARCH"
  build_from_source
}

unit_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/%/%%/g'; }

install_service() {
  install_packages tmux
  if ! id "$USER_NAME" >/dev/null 2>&1; then
    [ -x "$SERVICE_SHELL" ] || die "service shell not found: $SERVICE_SHELL"
    $SUDO useradd --system --home "$DATA_DIR" --shell "$SERVICE_SHELL" "$USER_NAME"
  else
    current_shell="$(getent passwd "$USER_NAME" | awk -F: '{print $7}')"
    case "$current_shell" in */nologin|*/false) $SUDO usermod --shell "$SERVICE_SHELL" "$USER_NAME" ;; esac
  fi
  $SUDO install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "$DATA_DIR"
  $SUDO install -d -m 755 -o "$USER_NAME" -g "$USER_NAME" "$MANAGED_BIN_DIR"
  $SUDO install -d -m 755 "$BIN_DIR"
  $SUDO install -d -m 755 "$UNIT_DIR"
  $SUDO systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
  if [ -f "$MANAGED_BIN_DIR/overseer" ]; then $SUDO cp "$MANAGED_BIN_DIR/overseer" "$MANAGED_BIN_DIR/overseer.previous"; fi
  # A manual (re)install replaces any update in progress.
  $SUDO rm -f "$MANAGED_BIN_DIR/overseer.update.json"
  $SUDO install -m 755 -o "$USER_NAME" -g "$USER_NAME" "$TMP_DIR/overseer" "$MANAGED_BIN_DIR/overseer"
  $SUDO ln -sfn "$MANAGED_BIN_DIR/overseer" "$BIN_DIR/overseer"

  E_BIN="$(unit_escape "$MANAGED_BIN_DIR/overseer")"
  E_DATA="$(unit_escape "$DATA_DIR")"
  E_ADDR="$(unit_escape "$ADDR")"
  UNIT="$TMP_DIR/${SERVICE_NAME}.service"
  {
    cat <<EOF
[Unit]
Description=Overseer hub
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$E_DATA
UMask=0077
EOF
    if [ -n "$TLS_DOMAIN" ]; then
      [ -n "$TLS_EMAIL" ] || die "OVERSEER_TLS_EMAIL is required when OVERSEER_TLS_DOMAIN is set"
      printf '%s\n' 'AmbientCapabilities=CAP_NET_BIND_SERVICE' 'CapabilityBoundingSet=CAP_NET_BIND_SERVICE'
      printf 'ExecStart="%s" serve --data-dir "%s" --tls-domain "%s" --tls-email "%s"\n' "$E_BIN" "$E_DATA" "$(unit_escape "$TLS_DOMAIN")" "$(unit_escape "$TLS_EMAIL")"
    else
      printf 'ExecStart="%s" serve --addr "%s" --data-dir "%s"\n' "$E_BIN" "$E_ADDR" "$E_DATA"
    fi
    cat <<EOF
Environment=OVERSEER_MANAGED=hub
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  } > "$UNIT"
  $SUDO install -m 644 "$UNIT" "$UNIT_DIR/${SERVICE_NAME}.service"
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable "$SERVICE_NAME" >/dev/null 2>&1
  $SUDO systemctl restart "$SERVICE_NAME"
  ok "Installed the $SERVICE_NAME service (starts on boot, updates itself)"
}

# wait_until_up polls the hub's local health endpoint for a few seconds.
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
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  [ -n "$ip" ] || ip="$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit }}')"
  printf '%s' "${ip:-<this-machine>}"
}

finish() {
  if [ -n "$TLS_DOMAIN" ]; then
    URL="https://$TLS_DOMAIN"
  else
    case "$ADDR" in :*) URL="http://$(lan_ip)$ADDR" ;; *) URL="http://$ADDR" ;; esac
  fi
  STATE="is running"
  if [ -z "$TLS_DOMAIN" ] && ! wait_until_up; then
    STATE="is installed but has not answered yet; check: journalctl -u $SERVICE_NAME -n 50"
  fi
  CODE="$($SUDO cat "$DATA_DIR/setup-code" 2>/dev/null || true)"
  printf '\nOverseer hub %s.\n\n' "$STATE"
  if [ -n "$CODE" ]; then
    printf '  Open    %s/?setup=%s\n' "$URL" "$CODE"
    printf '  Code    %s   (only for choosing your password the first time)\n\n' "$CODE"
  else
    printf '  Open    %s\n\n' "$URL"
  fi
  printf '  Status  systemctl status %s\n' "$SERVICE_NAME"
  printf '  Logs    journalctl -u %s -f\n' "$SERVICE_NAME"
  printf '  Remove  curl -fsSL %s | sh -s -- uninstall\n\n' "$INSTALLER_URL"
}

main() {
  [ "$(uname -s)" = Linux ] || die "this installer is for Linux (use install-macos.sh on macOS, install.ps1 on Windows)"
  command -v systemctl >/dev/null 2>&1 || die "this installer needs systemd"
  case "$INSTALL_SOURCE" in auto|binary|source) ;; *) die "OVERSEER_INSTALL_SOURCE must be auto, binary, or source" ;; esac
  case "$USER_NAME:$SERVICE_NAME" in *[!a-zA-Z0-9_.:-]*) die "service user/name contains unsupported characters" ;; esac

  SUDO=""
  if [ "$(id -u)" -ne 0 ]; then need_cmd sudo; SUDO=sudo; fi

  case "$ACTION" in
    install) ;;
    uninstall|remove) printf '\nRemoving the Overseer hub\n\n'; uninstall_service; printf '\n'; return 0 ;;
    *) die "unknown action: $ACTION (use install or uninstall)" ;;
  esac

  ARCH="$(uname -m)"
  case "$ARCH" in x86_64|amd64) ARCH=amd64 ;; aarch64|arm64) ARCH=arm64 ;; *) die "unsupported CPU: $ARCH" ;; esac
  ASSET="overseer_linux_$ARCH"
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

  printf '\nInstalling the Overseer hub\n\n'
  install_binary
  install_service
  finish
}

main "$@"
