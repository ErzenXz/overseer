package updater

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"
)

// Crash-loop protection. After a swap, Install leaves a small marker next to
// the executable. Every managed start of the new version counts an attempt;
// a process that stays up long enough calls Healthy and the marker goes away.
// If the new version keeps dying before that, the next start rolls back to
// the previous verified binary instead of restarting a broken one forever.

// MaxStartAttempts is how many unhealthy starts a new version gets.
const MaxStartAttempts = 3

// HealthyAfter is how long a freshly updated process must stay up.
const HealthyAfter = 90 * time.Second

type pendingUpdate struct {
	From     string `json:"from"`
	To       string `json:"to"`
	Attempts int    `json:"attempts"`
}

func markerPath(exe string) string { return exe + ".update.json" }

func writePending(exe string, p pendingUpdate) error {
	b, err := json.Marshal(p)
	if err != nil {
		return err
	}
	tmp := markerPath(exe) + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, markerPath(exe))
}

func readPending(exe string) (pendingUpdate, bool) {
	var p pendingUpdate
	b, err := os.ReadFile(markerPath(exe))
	if err != nil || json.Unmarshal(b, &p) != nil {
		return p, false
	}
	return p, true
}

// CheckStartup must run first in a managed process. It returns rolledBack
// true when the current version failed too many times and the previous
// binary has been restored (or scheduled on Windows); the caller should then
// exit with an error so the service manager starts the restored version.
func CheckStartup(current, taskName string) (rolledBack bool, err error) {
	exe, err := currentExecutable()
	if err != nil {
		return false, err
	}
	return checkStartup(exe, current, func() error { return Rollback(taskName) })
}

func checkStartup(exe, current string, rollback func() error) (bool, error) {
	p, ok := readPending(exe)
	if !ok {
		return false, nil
	}
	if p.To != current {
		// A different binary is running (manual install, earlier rollback);
		// the marker no longer describes it.
		return false, os.Remove(markerPath(exe))
	}
	p.Attempts++
	if p.Attempts > MaxStartAttempts {
		_ = os.Remove(markerPath(exe))
		if err := rollback(); err != nil {
			return false, fmt.Errorf("%s failed %d starts and rollback to %s failed: %w", current, MaxStartAttempts, p.From, err)
		}
		return true, nil
	}
	return false, writePending(exe, p)
}

// Healthy clears the pending-update marker once the process has proven
// itself. It is cheap and safe to call when there is no marker.
func Healthy() {
	exe, err := currentExecutable()
	if err != nil {
		return
	}
	_ = os.Remove(markerPath(exe))
}

// ConfirmHealthyAfter calls Healthy once the process has stayed up for
// HealthyAfter, unless ctx ends first.
func ConfirmHealthyAfter(ctx context.Context) {
	timer := time.NewTimer(HealthyAfter)
	defer timer.Stop()
	select {
	case <-timer.C:
		Healthy()
	case <-ctx.Done():
	}
}
