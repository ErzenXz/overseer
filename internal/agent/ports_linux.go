package agent

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// scanListeners reads /proc/net/tcp{,6} and maps socket inodes to processes
// through /proc/*/fd. Other users' processes can't be read, so their pid
// stays unknown.
func scanListeners(ctx context.Context) ([]listener, error) {
	var raw []listener
	var firstErr error
	for _, f := range []struct {
		path string
		v6   bool
	}{{"/proc/net/tcp", false}, {"/proc/net/tcp6", true}} {
		file, err := os.Open(f.path)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		raw = append(raw, parseProcNetTCP(file, f.v6)...)
		file.Close()
	}
	if raw == nil && firstErr != nil {
		return nil, firstErr
	}

	want := map[uint64]bool{}
	for _, l := range raw {
		if l.inode != 0 && keepListener(l, -1) {
			want[l.inode] = true
		}
	}
	owners := socketOwners(ctx, want)
	names := map[int]string{}
	for i, l := range raw {
		pid := owners[l.inode]
		if pid == 0 {
			continue
		}
		if _, ok := names[pid]; !ok {
			b, _ := os.ReadFile(filepath.Join("/proc", strconv.Itoa(pid), "comm"))
			names[pid] = strings.TrimSpace(string(b))
		}
		raw[i].pid, raw[i].process = pid, names[pid]
	}
	return raw, nil
}

// socketOwners finds which pid holds each wanted socket inode.
func socketOwners(ctx context.Context, want map[uint64]bool) map[uint64]int {
	owners := map[uint64]int{}
	if len(want) == 0 {
		return owners
	}
	procs, _ := os.ReadDir("/proc")
	for _, p := range procs {
		if ctx.Err() != nil || len(owners) == len(want) {
			break
		}
		pid, err := strconv.Atoi(p.Name())
		if err != nil {
			continue
		}
		fdDir := filepath.Join("/proc", p.Name(), "fd")
		fds, err := os.ReadDir(fdDir)
		if err != nil {
			continue
		}
		for _, fd := range fds {
			link, err := os.Readlink(filepath.Join(fdDir, fd.Name()))
			if err != nil || !strings.HasPrefix(link, "socket:[") {
				continue
			}
			inode, err := strconv.ParseUint(strings.TrimSuffix(strings.TrimPrefix(link, "socket:["), "]"), 10, 64)
			if err == nil && want[inode] {
				if _, seen := owners[inode]; !seen {
					owners[inode] = pid
				}
			}
		}
	}
	return owners
}

// processDetails reads the command line and working directory from /proc.
func processDetails(_ context.Context, pids []int) map[int]procInfo {
	out := map[int]procInfo{}
	for _, pid := range pids {
		dir := filepath.Join("/proc", strconv.Itoa(pid))
		var info procInfo
		if b, err := os.ReadFile(filepath.Join(dir, "cmdline")); err == nil {
			info.command = strings.TrimSpace(strings.ReplaceAll(string(b), "\x00", " "))
		}
		if cwd, err := os.Readlink(filepath.Join(dir, "cwd")); err == nil {
			info.cwd = cwd
		}
		out[pid] = info
	}
	return out
}
