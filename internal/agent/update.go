package agent

import (
	"context"
	"log"
	"os"
	"runtime"
	"time"

	"github.com/ErzenXz/overseer/internal/updater"
)

// managedEnv is set by the installed service definition. Foreground debug
// agents never replace themselves.
const managedEnv = "OVERSEER_MANAGED"

// maybeSelfUpdate installs the exact stable release advertised by the hub.
// It never downgrades and every download is checksum + version verified by the
// shared updater package before the current executable is touched.
func (a *Agent) maybeSelfUpdate(ctx context.Context, hubVersion, repo string) bool {
	if os.Getenv(managedEnv) == "" || repo == "" || !updater.IsNewer(hubVersion, a.version) {
		return false
	}

	a.mu.Lock()
	if time.Now().Before(a.nextUpdateAttempt) {
		a.mu.Unlock()
		return false
	}
	// A failure can be retried without reconnecting, but avoid hammering GitHub
	// or flapping a device when a release asset is temporarily unavailable.
	a.nextUpdateAttempt = time.Now().Add(time.Hour)
	a.mu.Unlock()

	release, err := updater.ForVersion(ctx, repo, hubVersion, runtime.GOOS, runtime.GOARCH)
	if err == nil {
		err = updater.Install(ctx, release, os.Getenv("OVERSEER_WINDOWS_TASK"))
	}
	if err != nil {
		log.Printf("self-update to %s failed (continuing on %s): %v", hubVersion, a.version, err)
		return false
	}
	log.Printf("self-update staged %s -> %s; restarting", a.version, hubVersion)
	return true
}

// autoUpdateLoop retries a failed fleet update while a connection remains
// healthy. A successful swap closes the socket; runOnce observes the flag and
// exits so the service manager can restart the verified binary.
func (a *Agent) autoUpdateLoop(ctx context.Context, hubVersion, repo string) {
	ticker := time.NewTicker(15 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			if a.maybeSelfUpdate(ctx, hubVersion, repo) {
				a.mu.Lock()
				a.updateApplied = true
				conn := a.conn
				a.mu.Unlock()
				if conn != nil {
					conn.Close()
				}
				return
			}
		case <-ctx.Done():
			return
		}
	}
}
