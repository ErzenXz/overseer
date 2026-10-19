//go:build !windows

package agent

import (
	"os/exec"
	"syscall"
	"time"
)

// setProcGroup puts the child in its own process group so stopping a thread
// also takes down whatever the coding agent spawned (shells, MCP servers).
func setProcGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// killProcessTree asks the process group to exit, then forces it after a
// grace period. done is closed once the child has been reaped.
func killProcessTree(cmd *exec.Cmd, done <-chan struct{}) {
	if cmd.Process == nil {
		return
	}
	pgid := -cmd.Process.Pid
	_ = syscall.Kill(pgid, syscall.SIGTERM)
	select {
	case <-done:
	case <-time.After(2 * time.Second):
	}
	// The group may outlive the leader (orphaned grandchildren), so always
	// finish with SIGKILL; ESRCH just means everything already exited.
	_ = syscall.Kill(pgid, syscall.SIGKILL)
}
