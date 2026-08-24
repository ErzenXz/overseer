#!/bin/sh
# Deterministic installer regression harness. It simulates the exact production
# failure where GitHub has no release, then proves Linux and macOS fall back to
# a source build and generate runnable background-service definitions.
set -eu

ROOT="$(CDPATH= cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT INT TERM

MOCK_BIN="$TMP/mock-bin"
FIXTURE_ROOT="$TMP/fixture/overseer-main"
FIXTURE_ARCHIVE="$TMP/source.tar.gz"
FAKE_BINARY="$TMP/fake-overseer"
mkdir -p "$MOCK_BIN" "$FIXTURE_ROOT/ui/dist" "$FIXTURE_ROOT/cmd/overseer/uidist"
printf '<!doctype html><title>fixture</title>\n' > "$FIXTURE_ROOT/ui/dist/index.html"
printf 'placeholder\n' > "$FIXTURE_ROOT/cmd/overseer/uidist/.gitkeep"
tar -czf "$FIXTURE_ARCHIVE" -C "$TMP/fixture" overseer-main

cat > "$FAKE_BINARY" <<'EOF'
#!/bin/sh
if [ "${1:-}" = version ]; then printf '%s\n' 'overseer test-installer'; fi
EOF
chmod +x "$FAKE_BINARY"

cat > "$MOCK_BIN/curl" <<'EOF'
#!/bin/sh
url=""
out=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
case "$url" in
  */releases/*) exit 22 ;;
  */archive/*.tar.gz) cp "$INSTALLER_FIXTURE_ARCHIVE" "$out" ;;
  *) printf '%s\n' "unexpected curl URL: $url" >&2; exit 2 ;;
esac
EOF

cat > "$MOCK_BIN/go" <<'EOF'
#!/bin/sh
if [ "${1:-}" = env ] && [ "${2:-}" = GOVERSION ]; then printf '%s\n' go1.25.0; exit 0; fi
if [ "${1:-}" = build ]; then
  out=""
  shift
  while [ "$#" -gt 0 ]; do
    if [ "$1" = -o ]; then out="$2"; shift 2; else shift; fi
  done
  cp "$INSTALLER_FAKE_BINARY" "$out"
  chmod +x "$out"
  exit 0
fi
exit 2
EOF

cat > "$MOCK_BIN/node" <<'EOF'
#!/bin/sh
[ "${1:-}" = -v ] || [ "${1:-}" = --version ] || exit 2
printf '%s\n' v20.19.4
EOF

cat > "$MOCK_BIN/npm" <<'EOF'
#!/bin/sh
exit 0
EOF

cat > "$MOCK_BIN/uname" <<'EOF'
#!/bin/sh
case "${1:-}" in -s) printf '%s\n' "$INSTALLER_MOCK_OS" ;; -m) printf '%s\n' "$INSTALLER_MOCK_ARCH" ;; *) printf '%s\n' "$INSTALLER_MOCK_OS" ;; esac
EOF

cat > "$MOCK_BIN/id" <<'EOF'
#!/bin/sh
if [ "${1:-}" = -u ]; then printf '%s\n' 0; else /usr/bin/id "$@"; fi
EOF

cat > "$MOCK_BIN/getent" <<'EOF'
#!/bin/sh
printf '%s\n' "$2:x:501:20:test:$INSTALLER_TEST_HOME:/bin/sh"
EOF

cat > "$MOCK_BIN/install" <<'EOF'
#!/bin/sh
directory=0
last=""
previous=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -d) directory=1; shift ;;
    -m|-o|-g) shift 2 ;;
    -*) shift ;;
    *) previous="$last"; last="$1"; shift ;;
  esac
done
if [ "$directory" = 1 ]; then mkdir -p "$last"; else mkdir -p "$(dirname "$last")"; cp "$previous" "$last"; chmod +x "$last" 2>/dev/null || true; fi
EOF

for cmd in systemctl launchctl tmux; do
  cat > "$MOCK_BIN/$cmd" <<'EOF'
#!/bin/sh
exit 0
EOF
done
chmod +x "$MOCK_BIN"/*

export PATH="$MOCK_BIN:/usr/bin:/bin:/usr/sbin:/sbin"
export INSTALLER_FIXTURE_ARCHIVE="$FIXTURE_ARCHIVE"
export INSTALLER_FAKE_BINARY="$FAKE_BINARY"

run_linux() {
  home="$TMP/linux home"
  data="$home/data"
  bindir="$home/bin"
  units="$home/systemd"
  mkdir -p "$home"
  export HOME="$home" INSTALLER_TEST_HOME="$home" INSTALLER_MOCK_OS=Linux INSTALLER_MOCK_ARCH=x86_64
  output="$(OVERSEER_USER="$(/usr/bin/id -un)" OVERSEER_DATA_DIR="$data" OVERSEER_BIN_DIR="$bindir" OVERSEER_SYSTEMD_DIR="$units" OVERSEER_INSTALL_SOURCE=auto sh "$ROOT/scripts/install.sh" 2>&1)"
  printf '%s' "$output" | grep -q 'falling back to source build'
  [ -x "$data/bin/overseer" ]
  [ -L "$bindir/overseer" ]
  grep -q 'ExecStart=' "$units/overseer-hub.service"
  OVERSEER_USER="$(/usr/bin/id -un)" OVERSEER_DATA_DIR="$data" OVERSEER_BIN_DIR="$bindir" OVERSEER_SYSTEMD_DIR="$units" sh "$ROOT/scripts/install.sh" uninstall >/dev/null
  [ ! -e "$bindir/overseer" ]
  printf '%s\n' 'installer-linux: ok (release 404 -> source fallback -> systemd -> uninstall)'
}

run_macos() {
  home="$TMP/mac home & qa"
  data="$home/data"
  bindir="$home/bin"
  agents="$home/Launch Agents"
  mkdir -p "$home"
  export HOME="$home" INSTALLER_TEST_HOME="$home" INSTALLER_MOCK_OS=Darwin INSTALLER_MOCK_ARCH=arm64
  output="$(OVERSEER_DATA_DIR="$data" OVERSEER_BIN_DIR="$bindir" OVERSEER_LAUNCH_AGENT_DIR="$agents" OVERSEER_INSTALL_SOURCE=auto sh "$ROOT/scripts/install-macos.sh" 2>&1)"
  printf '%s' "$output" | grep -q 'falling back to source build'
  [ -x "$bindir/overseer" ]
  plist="$agents/sh.overseer.hub.plist"
  [ -f "$plist" ]
  grep -q 'ProgramArguments' "$plist"
  grep -q '&amp;' "$plist"
  OVERSEER_DATA_DIR="$data" OVERSEER_BIN_DIR="$bindir" OVERSEER_LAUNCH_AGENT_DIR="$agents" sh "$ROOT/scripts/install-macos.sh" uninstall >/dev/null
  [ ! -e "$bindir/overseer" ]
  printf '%s\n' 'installer-macos: ok (release 404 -> source fallback -> escaped launchd -> uninstall)'
}

sh -n "$ROOT/scripts/install.sh"
sh -n "$ROOT/scripts/install-macos.sh"
run_linux
run_macos
