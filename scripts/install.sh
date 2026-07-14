#!/bin/sh
# Install Overseer hub on a Linux systemd host.
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/ErzenXz/overseer/main/scripts/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/ErzenXz/overseer/main/scripts/install.sh | sh -s -- uninstall
set -eu

ACTION="${1:-install}"
REPO="${OVERSEER_REPO:-ErzenXz/overseer}"
VERSION="${OVERSEER_VERSION:-latest}"
ADDR="${OVERSEER_ADDR:-:4200}"
DATA_DIR="${OVERSEER_DATA_DIR:-/var/lib/overseer}"
USER_NAME="${OVERSEER_USER:-overseer}"
BIN_DIR="${OVERSEER_BIN_DIR:-/usr/local/bin}"
MANAGED_BIN_DIR="$DATA_DIR/bin"
SERVICE_NAME="${OVERSEER_SERVICE_NAME:-overseer-hub}"
TLS_DOMAIN="${OVERSEER_TLS_DOMAIN:-}"
TLS_EMAIL="${OVERSEER_TLS_EMAIL:-}"
INSTALL_SOURCE="${OVERSEER_INSTALL_SOURCE:-auto}"
GO_VERSION="${OVERSEER_GO_VERSION:-1.25.0}"
GO_ROOT="${OVERSEER_GO_ROOT:-/usr/local/go}"
PURGE="${OVERSEER_PURGE:-0}"
LOCAL_BINARY="${OVERSEER_LOCAL_BINARY:-}"
SERVICE_SHELL="${OVERSEER_SERVICE_SHELL:-/bin/sh}"

log() {
  printf '%s\n' "overseer: $*"
}

die() {
  printf '%s\n' "overseer: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

if [ "$(uname -s)" != "Linux" ]; then
  die "this installer supports Linux hosts only"
fi

if ! command -v systemctl >/dev/null 2>&1; then
  die "this installer requires systemd"
fi

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  need_cmd sudo
  SUDO="sudo"
fi

uninstall_service() {
  if systemctl list-unit-files "${SERVICE_NAME}.service" >/dev/null 2>&1 || [ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]; then
    log "stopping service: $SERVICE_NAME"
    $SUDO systemctl disable --now "$SERVICE_NAME" >/dev/null 2>&1 || true
  fi

  $SUDO rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
  $SUDO systemctl daemon-reload
  $SUDO systemctl reset-failed "$SERVICE_NAME" >/dev/null 2>&1 || true

  if [ -x "$BIN_DIR/overseer" ]; then
    log "removing binary: $BIN_DIR/overseer"
    $SUDO rm -f "$BIN_DIR/overseer"
  fi

  $SUDO rm -f "$MANAGED_BIN_DIR/overseer" "$MANAGED_BIN_DIR/overseer.previous"

  if [ "$PURGE" = "1" ]; then
    log "purging data directory: $DATA_DIR"
    $SUDO rm -rf "$DATA_DIR"
    if id "$USER_NAME" >/dev/null 2>&1; then
      log "removing service user: $USER_NAME"
      $SUDO userdel "$USER_NAME" >/dev/null 2>&1 || true
    fi
  else
    log "kept data directory: $DATA_DIR"
    log "rerun with OVERSEER_PURGE=1 to remove data and service user"
  fi

  log "uninstalled"
}

case "$ACTION" in
  install) ;;
  uninstall|remove)
    uninstall_service
    exit 0
    ;;
  *)
    die "unknown action: $ACTION (use install or uninstall)"
    ;;
esac

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) die "unsupported architecture: $ARCH" ;;
esac

OS="linux"
ASSET="overseer_${OS}_${ARCH}"
TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

install_packages() {
  missing=""
  for cmd in "$@"; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      missing="$missing $cmd"
    fi
  done
  [ -n "$missing" ] || return 0

  if command -v apt-get >/dev/null 2>&1; then
    log "installing packages:$missing"
    $SUDO env DEBIAN_FRONTEND=noninteractive apt-get update
    case " $missing " in
      *" curl "*) $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl ;;
    esac
    case " $missing " in *" git "*) $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y git ;; esac
    case " $missing " in *" make "*) $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y make ;; esac
    case " $missing " in *" tar "*) $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y tar ;; esac
    case " $missing " in *" tmux "*) $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y tmux ;; esac
    case " $missing " in *" go "*) $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y golang-go ;; esac
    case " $missing " in *" node "*) $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs ;; esac
    case " $missing " in *" npm "*) $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y npm ;; esac
    return 0
  fi

  if command -v dnf >/dev/null 2>&1; then
    log "installing packages:$missing"
    case " $missing " in *" curl "*) $SUDO dnf install -y ca-certificates curl ;; esac
    case " $missing " in *" git "*) $SUDO dnf install -y git ;; esac
    case " $missing " in *" make "*) $SUDO dnf install -y make ;; esac
    case " $missing " in *" tar "*) $SUDO dnf install -y tar ;; esac
    case " $missing " in *" tmux "*) $SUDO dnf install -y tmux ;; esac
    case " $missing " in *" go "*) $SUDO dnf install -y golang ;; esac
    case " $missing " in *" node "*) $SUDO dnf install -y nodejs ;; esac
    case " $missing " in *" npm "*) $SUDO dnf install -y npm ;; esac
    return 0
  fi

  if command -v yum >/dev/null 2>&1; then
    log "installing packages:$missing"
    case " $missing " in *" curl "*) $SUDO yum install -y ca-certificates curl ;; esac
    case " $missing " in *" git "*) $SUDO yum install -y git ;; esac
    case " $missing " in *" make "*) $SUDO yum install -y make ;; esac
    case " $missing " in *" tar "*) $SUDO yum install -y tar ;; esac
    case " $missing " in *" tmux "*) $SUDO yum install -y tmux ;; esac
    case " $missing " in *" go "*) $SUDO yum install -y golang ;; esac
    case " $missing " in *" node "*) $SUDO yum install -y nodejs ;; esac
    case " $missing " in *" npm "*) $SUDO yum install -y npm ;; esac
    return 0
  fi

  die "cannot install missing commands:$missing; install them and rerun"
}

version_at_least() {
  awk -v have="$1" -v need="$2" '
    BEGIN {
      split(have, h, ".")
      split(need, n, ".")
      for (i = 1; i <= 3; i++) {
        hv = h[i] + 0
        nv = n[i] + 0
        if (hv > nv) exit 0
        if (hv < nv) exit 1
      }
      exit 0
    }'
}

go_is_new_enough() {
  if ! command -v go >/dev/null 2>&1; then
    return 1
  fi
  HAVE="$(go env GOVERSION 2>/dev/null | sed 's/^go//; s/[^0-9.].*$//')"
  [ -n "$HAVE" ] && version_at_least "$HAVE" "$GO_VERSION"
}

ensure_go() {
  install_packages curl tar
  if go_is_new_enough; then
    return 0
  fi

  log "installing Go ${GO_VERSION}"
  GO_TARBALL="go${GO_VERSION}.linux-${ARCH}.tar.gz"
  curl -fL "https://go.dev/dl/${GO_TARBALL}" -o "$TMP_DIR/${GO_TARBALL}"
  $SUDO rm -rf "$GO_ROOT"
  $SUDO tar -C "$(dirname "$GO_ROOT")" -xzf "$TMP_DIR/${GO_TARBALL}"
  $SUDO ln -sf "$GO_ROOT/bin/go" /usr/local/bin/go
  $SUDO ln -sf "$GO_ROOT/bin/gofmt" /usr/local/bin/gofmt
}

ensure_node() {
  install_packages node npm
  NODE_MAJOR="$(node -v 2>/dev/null | sed 's/^v//; s/\..*$//')"
  if [ "${NODE_MAJOR:-0}" -lt 18 ]; then
    die "Node.js 18 or newer is required to build from source; install Node 20 or publish a release binary"
  fi
}

download_release_binary() {
  if [ "$VERSION" = "latest" ]; then
    URL="https://github.com/${REPO}/releases/latest/download/${ASSET}"
  else
    URL="https://github.com/${REPO}/releases/download/${VERSION}/${ASSET}"
  fi

  log "trying release binary: $URL"
  if curl -fL "$URL" -o "$TMP_DIR/overseer"; then
    CHECKSUM_URL="$(dirname "$URL")/checksums.txt"
    curl -fL "$CHECKSUM_URL" -o "$TMP_DIR/checksums.txt" || return 1
    EXPECTED="$(awk -v asset="$ASSET" '$2 == asset || $2 == "*" asset { print $1; exit }' "$TMP_DIR/checksums.txt")"
    [ -n "$EXPECTED" ] || die "checksums.txt does not contain $ASSET"
    if command -v sha256sum >/dev/null 2>&1; then
      ACTUAL="$(sha256sum "$TMP_DIR/overseer" | awk '{print $1}')"
    else
      ACTUAL="$(shasum -a 256 "$TMP_DIR/overseer" | awk '{print $1}')"
    fi
    [ "$ACTUAL" = "$EXPECTED" ] || die "release checksum verification failed"
    chmod +x "$TMP_DIR/overseer"
    return 0
  fi
  return 1
}

build_from_source() {
  install_packages git make
  ensure_go
  ensure_node

  SRC="$TMP_DIR/src"
  REF="${OVERSEER_REF:-main}"
  if [ "$VERSION" != "latest" ]; then
    REF="$VERSION"
  fi

  log "building from source: ${REPO}@${REF}"
  git clone --depth 1 --branch "$REF" "https://github.com/${REPO}.git" "$SRC"
  (cd "$SRC" && make VERSION="$REF")
  cp "$SRC/overseer" "$TMP_DIR/overseer"
  chmod +x "$TMP_DIR/overseer"
}

install_binary() {
  if [ -n "$LOCAL_BINARY" ]; then
    [ -f "$LOCAL_BINARY" ] || die "local binary not found: $LOCAL_BINARY"
    log "using local binary: $LOCAL_BINARY"
    cp "$LOCAL_BINARY" "$TMP_DIR/overseer"
    chmod +x "$TMP_DIR/overseer"
    return 0
  fi

  install_packages curl
  if [ "$INSTALL_SOURCE" != "source" ] && download_release_binary; then
    return 0
  fi

  if [ "$INSTALL_SOURCE" = "binary" ]; then
    die "release binary was not available"
  fi

  log "release binary unavailable; falling back to source build"
  build_from_source
}

install_service() {
  install_packages tmux

  if ! id "$USER_NAME" >/dev/null 2>&1; then
    log "creating service user: $USER_NAME"
    [ -x "$SERVICE_SHELL" ] || die "service shell not found: $SERVICE_SHELL"
    $SUDO useradd --system --home "$DATA_DIR" --shell "$SERVICE_SHELL" "$USER_NAME"
  else
    current_shell="$(getent passwd "$USER_NAME" | awk -F: '{print $7}')"
    case "$current_shell" in
      */nologin|*/false)
        [ -x "$SERVICE_SHELL" ] || die "service shell not found: $SERVICE_SHELL"
        log "updating service user shell: $USER_NAME -> $SERVICE_SHELL"
        $SUDO usermod --shell "$SERVICE_SHELL" "$USER_NAME"
        ;;
    esac
  fi

  $SUDO install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "$DATA_DIR"
  $SUDO install -d -m 755 -o "$USER_NAME" -g "$USER_NAME" "$MANAGED_BIN_DIR"
  $SUDO systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
  $SUDO install -m 755 -o "$USER_NAME" -g "$USER_NAME" "$TMP_DIR/overseer" "$MANAGED_BIN_DIR/overseer"
  $SUDO install -d -m 755 "$BIN_DIR"
  $SUDO ln -sfn "$MANAGED_BIN_DIR/overseer" "$BIN_DIR/overseer"

  SERVE_ARGS="serve --addr ${ADDR} --data-dir ${DATA_DIR}"
  CAPABILITY_LINES=""
  if [ -n "$TLS_DOMAIN" ]; then
    [ -n "$TLS_EMAIL" ] || die "OVERSEER_TLS_EMAIL is required when OVERSEER_TLS_DOMAIN is set"
    SERVE_ARGS="serve --data-dir ${DATA_DIR} --tls-domain ${TLS_DOMAIN} --tls-email ${TLS_EMAIL}"
    CAPABILITY_LINES="AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE"
  fi

  UNIT="$TMP_DIR/${SERVICE_NAME}.service"
  {
    cat <<EOF
[Unit]
Description=Overseer hub
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${USER_NAME}
WorkingDirectory=${DATA_DIR}
EOF
    if [ -n "$CAPABILITY_LINES" ]; then
      printf '%s\n' "$CAPABILITY_LINES"
    fi
    cat <<EOF
Environment=OVERSEER_MANAGED=hub
ExecStart=${MANAGED_BIN_DIR}/overseer ${SERVE_ARGS}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  } > "$UNIT"

  $SUDO install -m 644 "$UNIT" "/etc/systemd/system/${SERVICE_NAME}.service"
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable "$SERVICE_NAME"
  $SUDO systemctl restart "$SERVICE_NAME"
}

install_binary
install_service

INSTALLED_VERSION="$("$MANAGED_BIN_DIR"/overseer version 2>/dev/null | sed 's/^overseer //' || true)"
if [ -n "$INSTALLED_VERSION" ]; then
  log "installed $INSTALLED_VERSION"
else
  log "installed overseer"
fi
log "service: $SERVICE_NAME"
log "status: systemctl status $SERVICE_NAME"
if [ -n "$TLS_DOMAIN" ]; then
  log "open: https://$TLS_DOMAIN"
else
  log "open: http://<this-host>${ADDR}"
fi
