//go:build windows

package agent

import (
	"os/exec"
	"time"
)

func setProcGroup(cmd *exec.Cmd) {}

// killProcessTree kills the agent process. Windows has no process groups in
// the unix sense; child processes of npm shims may survive, which is an
// accepted limitation.
func killProcessTree(cmd *exec.Cmd, done <-chan struct{}) {
	if cmd.Process == nil {
		return
	}
	_ = cmd.Process.Kill()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
	}
}
