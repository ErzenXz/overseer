package agent

import (
	"context"
	"errors"
	"os/exec"
)

// scanListeners asks lsof for TCP sockets in LISTEN state. Without root it
// only sees this user's processes, which is where dev servers live.
func scanListeners(ctx context.Context) ([]listener, error) {
	out, err := exec.CommandContext(ctx, "lsof", "-nP", "-iTCP", "-sTCP:LISTEN", "-FpcnTt").Output()
	// lsof exits 1 when nothing is listening (or on harmless warnings), so
	// only a failure to run it at all is an error.
	var exit *exec.ExitError
	if err != nil && !errors.As(err, &exit) {
		return nil, err
	}
	return parseLsof(string(out)), nil
}

// processDetails fetches command lines (ps) and working directories (lsof)
// for all pids in two calls.
func processDetails(ctx context.Context, pids []int) map[int]procInfo {
	out := map[int]procInfo{}
	if len(pids) == 0 {
		return out
	}
	list := joinPids(pids)
	if b, err := exec.CommandContext(ctx, "ps", "-o", "pid=,command=", "-p", list).Output(); err == nil || len(b) > 0 {
		for pid, cmd := range parsePsCommands(string(b)) {
			info := out[pid]
			info.command = cmd
			out[pid] = info
		}
	}
	if b, err := exec.CommandContext(ctx, "lsof", "-a", "-p", list, "-d", "cwd", "-Fpn").Output(); err == nil || len(b) > 0 {
		for pid, cwd := range parseLsofCwd(string(b)) {
			info := out[pid]
			info.cwd = cwd
			out[pid] = info
		}
	}
	return out
}
