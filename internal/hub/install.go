package hub

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// installScript is the one-paste device joiner, served with the enrollment
// token and hub URL baked in. It must stay POSIX-sh compatible.
const installScript = `#!/bin/sh
# Overseer device installer — https://overseer.sh
set -eu

HUB="%s"
TOKEN="%s"

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "overseer: unsupported architecture: $ARCH" >&2; exit 1 ;;
esac
case "$OS" in
  linux|darwin) ;;
  *) echo "overseer: unsupported OS: $OS (Linux and macOS only for now)" >&2; exit 1 ;;
esac

BIN_DIR="$HOME/.overseer/bin"
mkdir -p "$BIN_DIR"
BIN="$BIN_DIR/overseer"

echo "→ downloading overseer agent for $OS/$ARCH from the hub..."
if ! curl -fSL "$HUB/api/agent-binary?os=$OS&arch=$ARCH" -o "$BIN.tmp"; then
  echo "overseer: hub has no binary for $OS/$ARCH." >&2
  echo "Place one at <hub data dir>/binaries/overseer_${OS}_${ARCH} (see README) and retry." >&2
  exit 1
fi
mv "$BIN.tmp" "$BIN"
chmod +x "$BIN"

echo "→ enrolling this device with the hub..."
"$BIN" agent enroll --hub "$HUB" --token "$TOKEN"

echo "→ installing background service..."
"$BIN" agent install-service

echo ""
echo "✓ Done. This device is now connected to Overseer."
echo "  It should appear on your dashboard within a few seconds."
`

// isSimpleToken reports whether s is a short alphanumeric token (letters,
// digits, and a couple of safe separators) — used to sanitize values that flow
// into filesystem paths, shell scripts, or redirect URLs.
func isSimpleToken(s string) bool {
	if s == "" || len(s) > 64 {
		return false
	}
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_', r == '-', r == '.':
		default:
			return false
		}
	}
	return true
}

// handleInstallScript serves GET /install/<token>.sh.
func (s *Server) handleInstallScript(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/install/")
	token, ok := strings.CutSuffix(name, ".sh")
	// The token is interpolated into a shell script served for `| sh`, so it
	// must not contain quotes or other shell metacharacters.
	if !ok || !isSimpleToken(token) {
		httpError(w, http.StatusNotFound, "not found")
		return
	}
	// The token is validated at enroll time (single round trip keeps this
	// endpoint dumb); a bogus token just yields a script that fails to enroll.
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	base := fmt.Sprintf("%s://%s", scheme, r.Host)
	w.Header().Set("Content-Type", "text/x-shellscript; charset=utf-8")
	fmt.Fprintf(w, installScript, base, token)
}

// handleAgentBinary serves the overseer binary for a requested platform:
// the hub's own executable when the platform matches, otherwise a
// cross-compiled binary dropped into <data-dir>/binaries/.
func (s *Server) handleAgentBinary(w http.ResponseWriter, r *http.Request) {
	osName := r.URL.Query().Get("os")
	arch := r.URL.Query().Get("arch")
	if osName == "" || arch == "" {
		httpError(w, http.StatusBadRequest, "os and arch required")
		return
	}
	// os/arch become part of a filesystem path and a redirect URL, so keep them
	// strictly alphanumeric — otherwise "arch=../../etc/passwd" would escape the
	// binaries directory into an arbitrary pre-auth file read.
	if !isSimpleToken(osName) || !isSimpleToken(arch) {
		httpError(w, http.StatusBadRequest, "invalid os or arch")
		return
	}
	if osName == runtime.GOOS && arch == runtime.GOARCH {
		exe, err := os.Executable()
		if err == nil {
			if resolved, rerr := filepath.EvalSymlinks(exe); rerr == nil {
				exe = resolved
			}
			w.Header().Set("Content-Type", "application/octet-stream")
			http.ServeFile(w, r, exe)
			return
		}
	}
	// A binary manually dropped into the data dir wins (useful for air-gapped
	// LANs or custom builds).
	candidate := filepath.Join(s.opts.DataDir, "binaries", fmt.Sprintf("overseer_%s_%s", osName, arch))
	if _, err := os.Stat(candidate); err == nil {
		w.Header().Set("Content-Type", "application/octet-stream")
		http.ServeFile(w, r, candidate)
		return
	}
	// Otherwise redirect the installer to the matching GitHub release asset so
	// cross-platform joins work without the hub carrying every binary. Prefer
	// the release matching the hub's own version; fall back to latest.
	if s.opts.GithubRepo != "" {
		asset := fmt.Sprintf("overseer_%s_%s", osName, arch)
		tag := "latest/download"
		if v := s.opts.Version; v != "" && strings.HasPrefix(v, "v") && !strings.Contains(v, "-") {
			tag = "download/" + v
		}
		url := fmt.Sprintf("https://github.com/%s/releases/%s/%s", s.opts.GithubRepo, tag, asset)
		http.Redirect(w, r, url, http.StatusFound)
		return
	}
	httpError(w, http.StatusNotFound, fmt.Sprintf(
		"no binary for %s/%s — cross-compile with `GOOS=%s GOARCH=%s go build -o %s ./cmd/overseer`, then retry",
		osName, arch, osName, arch, candidate))
}
