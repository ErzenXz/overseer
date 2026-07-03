package agent

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// managedEnv is set in the installed service definition. Self-update only runs
// when it is present, so a foreground `overseer agent run` is never replaced
// out from under the user.
const managedEnv = "OVERSEER_MANAGED"

// maybeSelfUpdate replaces the running binary with the hub's build when they
// differ, and reports whether the caller should exit so the service manager
// restarts into the new binary.
//
// It is deliberately conservative: it acts only when running under the managed
// service, the hub advertises a real release version (vX.Y.Z), that version
// differs from ours, and it hasn't already tried this process lifetime.
func (a *Agent) maybeSelfUpdate(hubVersion string) bool {
	if os.Getenv(managedEnv) != "1" {
		return false
	}
	a.mu.Lock()
	tried := a.triedUpdate
	a.triedUpdate = true
	a.mu.Unlock()
	if tried {
		return false
	}
	if hubVersion == "" || hubVersion == a.version {
		return false
	}
	// Only chase tagged releases; dev/commit builds (no leading "v") are skipped
	// to avoid update loops between unversioned binaries.
	if !strings.HasPrefix(hubVersion, "v") {
		return false
	}

	if err := a.downloadAndReplace(); err != nil {
		log.Printf("self-update to %s failed (continuing on %s): %v", hubVersion, a.version, err)
		return false
	}
	log.Printf("self-updated %s -> %s; restarting", a.version, hubVersion)
	return true
}

// downloadAndReplace fetches the agent binary for this platform from the hub
// and atomically swaps it in for the current executable.
func (a *Agent) downloadAndReplace() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if resolved, rerr := filepath.EvalSymlinks(exe); rerr == nil {
		exe = resolved
	}

	url := fmt.Sprintf("%s/api/agent-binary?os=%s&arch=%s", strings.TrimRight(a.cfg.HubURL, "/"), runtime.GOOS, runtime.GOARCH)
	client := &http.Client{Timeout: 5 * time.Minute} // follows the hub's redirect to GitHub releases
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("hub returned %s", resp.Status)
	}

	// Stage into the same directory so the rename is atomic (same filesystem).
	tmp, err := os.CreateTemp(filepath.Dir(exe), ".overseer-update-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // no-op after a successful rename

	if _, err := io.Copy(tmp, resp.Body); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpName, 0o755); err != nil {
		return err
	}
	// Renaming over a running executable is allowed on Linux/macOS; the running
	// process keeps the old inode until it exits.
	if err := os.Rename(tmpName, exe); err != nil {
		return err
	}
	return nil
}
