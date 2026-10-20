package hub

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/ErzenXz/overseer/internal/updater"
)

// installScript is the one-paste device joiner, served with the hub URL and
// a single-use enrollment token baked in. It must stay POSIX-sh compatible.
// Everything runs inside main, called on the last line, so a connection that
// drops mid-download never executes half a script. The agent binary is
// checked against the SHA-256 the hub publishes before it is ever run.
const installScript = `#!/bin/sh
# Overseer: connect this machine to your hub.
set -eu

HUB="%s"
TOKEN="%s"

say() { printf '  %%s\n' "$*"; }
die() { printf '\n  overseer: %%s\n\n' "$*" >&2; exit 1; }

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

main() {
  OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
  case "$OS" in linux|darwin) ;; *) die "unsupported OS: $OS (use the Windows command on Windows)" ;; esac
  case "$(uname -m)" in
    x86_64|amd64) ARCH=amd64 ;;
    aarch64|arm64) ARCH=arm64 ;;
    *) die "unsupported CPU: $(uname -m)" ;;
  esac
  command -v curl >/dev/null 2>&1 || die "curl is required"

  BIN_DIR="$HOME/.overseer/bin"
  BIN="$BIN_DIR/overseer"
  mkdir -p "$BIN_DIR"
  chmod 700 "$HOME/.overseer"
  TMP="$(mktemp "$BIN_DIR/.overseer-download.XXXXXX")"
  trap 'rm -f "$TMP"' EXIT INT TERM

  printf '\nOverseer · connecting %%s to %%s\n\n' "$(hostname 2>/dev/null || echo this machine)" "$HUB"

  curl -fsSL --retry 3 "$HUB/api/agent-binary?os=$OS&arch=$ARCH" -o "$TMP" \
    || die "could not download the agent for $OS/$ARCH from the hub"
  WANT="$(curl -fsSL --retry 3 "$HUB/api/agent-binary/sha256?os=$OS&arch=$ARCH")" \
    || die "the hub did not publish a checksum for $OS/$ARCH"
  [ "$(sha256 "$TMP")" = "$WANT" ] || die "checksum mismatch: the download was corrupted or tampered with"
  chmod 755 "$TMP"
  "$TMP" version >/dev/null 2>&1 || die "the downloaded agent does not run on this machine"
  mv -f "$TMP" "$BIN"
  say "✓ Agent downloaded and verified ($OS/$ARCH)"

  if ! ERR="$("$BIN" agent enroll --hub "$HUB" --token "$TOKEN" 2>&1 >/dev/null)"; then
    die "enrollment failed: ${ERR#overseer: }"
  fi
  say "✓ Enrolled with the hub"

  if ! ERR="$("$BIN" agent install-service 2>&1 >/dev/null)"; then
    die "could not install the background service: ${ERR#overseer: }"
  fi
  say "✓ Background service running (starts at login)"

  printf '\nDone. This machine now shows up in Machines.\n'
  printf 'Remove it any time with: %%s agent uninstall\n\n' "$BIN"
}

main "$@"
`

// windowsInstallScript is the PowerShell one-paste device joiner for Windows.
// Like the POSIX script, it verifies the binary before running it.
const windowsInstallScript = `& {
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Hub = "%s"
$Token = "%s"

function Say([string]$Text) { Write-Host "  $Text" }
# Fail stops the install without closing a pasted-into PowerShell window.
function Fail([string]$Text) { throw [System.Exception]::new("overseer-abort: $Text") }
# Quiet runs a native command whose output and errors don't matter.
function Quiet([scriptblock]$Command) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  try { & $Command 2>&1 | Out-Null } catch { } finally { $ErrorActionPreference = $previous }
}

$Tmp = $null
try {
  $RawArch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
  $Arch = switch -Regex ($RawArch.ToLowerInvariant()) { "amd64|x64" { "amd64"; break } "arm64" { "arm64"; break } default { Fail "unsupported CPU: $RawArch" } }

  $BinDir = Join-Path $env:LOCALAPPDATA "Overseer\bin"
  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  $Bin = Join-Path $BinDir "overseer.exe"
  $Tmp = Join-Path $BinDir (".overseer-download-" + [Guid]::NewGuid().ToString("N") + ".exe")

  Write-Host ""
  Write-Host "Overseer - connecting $env:COMPUTERNAME to $Hub"
  Write-Host ""

  try { Invoke-WebRequest -UseBasicParsing -Uri "$Hub/api/agent-binary?os=windows&arch=$Arch" -OutFile $Tmp }
  catch { Fail "could not download the agent for windows/$Arch from the hub" }
  try { $Want = ([string](Invoke-WebRequest -UseBasicParsing -Uri "$Hub/api/agent-binary/sha256?os=windows&arch=$Arch").Content).Trim().ToLowerInvariant() }
  catch { Fail "the hub did not publish a checksum for windows/$Arch" }
  $Got = (Get-FileHash -Algorithm SHA256 $Tmp).Hash.ToLowerInvariant()
  if ($Got -ne $Want) { Fail "checksum mismatch: the download was corrupted or tampered with" }
  & $Tmp version | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "the downloaded agent does not run on this machine" }
  Quiet { schtasks.exe /End /TN OverseerAgent }
  Move-Item -Force $Tmp $Bin
  Say "OK  Agent downloaded and verified (windows/$Arch)"

  & $Bin agent enroll --hub $Hub --token $Token | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "enrollment failed (links expire after 15 minutes and work once; create a new one)" }
  Say "OK  Enrolled with the hub"

  & $Bin agent install-service | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "could not install the background task" }
  Say "OK  Background task running (starts at sign-in)"

  Write-Host ""
  Write-Host "Done. This machine now shows up in Machines."
  Write-Host "Remove it any time with: & '$Bin' agent uninstall"
  Write-Host ""
} catch {
  $message = $_.Exception.Message -replace '^overseer-abort: ', ''
  Write-Host ""
  Write-Host "  overseer: $message" -ForegroundColor Red
  Write-Host ""
} finally {
  if ($Tmp) { Remove-Item -Force -ErrorAction SilentlyContinue $Tmp }
}
}
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

// handleInstallScript serves GET /install/<token>.sh and
// GET /install/<token>.ps1.
func (s *Server) handleInstallScript(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/install/")
	token, ok := strings.CutSuffix(name, ".sh")
	format := "sh"
	if !ok {
		token, ok = strings.CutSuffix(name, ".ps1")
		format = "ps1"
	}
	// The token is interpolated into a shell script served for `| sh`, so it
	// must not contain quotes or other shell metacharacters.
	if !ok || !isSimpleToken(token) {
		httpError(w, http.StatusNotFound, "not found")
		return
	}
	// The token is validated at enroll time (single round trip keeps this
	// endpoint dumb); a bogus token just yields a script that fails to enroll.
	// Behind Tailscale Serve or another TLS proxy the request arrives as
	// plain HTTP; the command must still point at the https:// address.
	base := requestBaseURL(r)
	if format == "ps1" {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprintf(w, windowsInstallScript, base, token)
		return
	}
	w.Header().Set("Content-Type", "text/x-shellscript; charset=utf-8")
	fmt.Fprintf(w, installScript, base, token)
}

// agentBinary says where the binary for a platform comes from: a local file
// (the hub's own executable, or one dropped into <data-dir>/binaries/) or a
// GitHub release asset.
type agentBinary struct {
	path  string // local file, when set
	repo  string // otherwise a release asset in repo
	tag   string // "" means the latest release
	asset string
}

func (b agentBinary) releaseURL() string {
	if b.tag == "" {
		return fmt.Sprintf("https://github.com/%s/releases/latest/download/%s", b.repo, b.asset)
	}
	return fmt.Sprintf("https://github.com/%s/releases/download/%s/%s", b.repo, b.tag, b.asset)
}

func (s *Server) resolveAgentBinary(osName, arch string) (agentBinary, error) {
	// os/arch become part of a filesystem path and a redirect URL, so keep them
	// strictly alphanumeric — otherwise "arch=../../etc/passwd" would escape the
	// binaries directory into an arbitrary pre-auth file read.
	if !isSimpleToken(osName) || !isSimpleToken(arch) {
		return agentBinary{}, fmt.Errorf("invalid os or arch")
	}
	asset := fmt.Sprintf("overseer_%s_%s", osName, arch)
	// A binary manually dropped into the data dir wins (useful for air-gapped
	// LANs or custom builds).
	candidate := filepath.Join(s.opts.DataDir, "binaries", asset)
	if _, err := os.Stat(candidate); err == nil {
		return agentBinary{path: candidate, asset: asset}, nil
	}
	if osName == runtime.GOOS && arch == runtime.GOARCH {
		if exe, err := os.Executable(); err == nil {
			if resolved, rerr := filepath.EvalSymlinks(exe); rerr == nil {
				exe = resolved
			}
			return agentBinary{path: exe, asset: asset}, nil
		}
	}
	// Otherwise use the matching GitHub release so cross-platform joins work
	// without the hub carrying every binary. Prefer the release matching the
	// hub's own version; fall back to latest for development builds.
	if s.opts.GithubRepo != "" {
		tag := ""
		if v := s.opts.Version; strings.HasPrefix(v, "v") && !strings.Contains(v, "-") {
			tag = v
		}
		return agentBinary{repo: s.opts.GithubRepo, tag: tag, asset: asset}, nil
	}
	return agentBinary{}, fmt.Errorf("no binary for %s/%s — cross-compile with `GOOS=%s GOARCH=%s go build -o %s ./cmd/overseer`, then retry",
		osName, arch, osName, arch, candidate)
}

// handleAgentBinary serves the overseer binary for a requested platform.
func (s *Server) handleAgentBinary(w http.ResponseWriter, r *http.Request) {
	osName, arch := r.URL.Query().Get("os"), r.URL.Query().Get("arch")
	if osName == "" || arch == "" {
		httpError(w, http.StatusBadRequest, "os and arch required")
		return
	}
	bin, err := s.resolveAgentBinary(osName, arch)
	if err != nil {
		httpError(w, http.StatusNotFound, err.Error())
		return
	}
	if bin.path != "" {
		w.Header().Set("Content-Type", "application/octet-stream")
		http.ServeFile(w, r, bin.path)
		return
	}
	http.Redirect(w, r, bin.releaseURL(), http.StatusFound)
}

// handleAgentBinarySum serves the SHA-256 of exactly the binary
// handleAgentBinary would serve, so installers can verify before running it.
func (s *Server) handleAgentBinarySum(w http.ResponseWriter, r *http.Request) {
	osName, arch := r.URL.Query().Get("os"), r.URL.Query().Get("arch")
	bin, err := s.resolveAgentBinary(osName, arch)
	if err != nil {
		httpError(w, http.StatusNotFound, err.Error())
		return
	}
	var sum string
	if bin.path != "" {
		sum, err = fileSHA256(bin.path)
	} else {
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		sum, err = updater.AssetChecksum(ctx, bin.repo, bin.tag, bin.asset)
	}
	if err != nil {
		httpError(w, http.StatusBadGateway, "checksum unavailable: "+err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	fmt.Fprintln(w, sum)
}

// fileSHA256 hashes a file, remembering results by path, size and mtime so
// repeated installs don't re-read a 30 MB binary.
var sumCache sync.Map

func fileSHA256(path string) (string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	key := fmt.Sprintf("%s|%d|%d", path, info.Size(), info.ModTime().UnixNano())
	if v, ok := sumCache.Load(key); ok {
		return v.(string), nil
	}
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	sum := hex.EncodeToString(h.Sum(nil))
	sumCache.Store(key, sum)
	return sum, nil
}
