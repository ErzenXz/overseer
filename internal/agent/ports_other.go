//go:build !linux && !darwin

package agent

import (
	"context"
	"net"
	"strings"

	psnet "github.com/shirou/gopsutil/v4/net"
	"github.com/shirou/gopsutil/v4/process"
)

// scanListeners uses gopsutil, which calls GetExtendedTcpTable on Windows,
// plus the process image name for each owning pid.
func scanListeners(ctx context.Context) ([]listener, error) {
	conns, err := psnet.ConnectionsWithContext(ctx, "tcp")
	if err != nil {
		return nil, err
	}
	names := map[int32]string{}
	var out []listener
	for _, c := range conns {
		if c.Status != "LISTEN" {
			continue
		}
		ip := net.ParseIP(c.Laddr.IP)
		if ip == nil {
			continue
		}
		l := listener{addr: ip.String(), port: int(c.Laddr.Port), pid: int(c.Pid)}
		if c.Pid > 0 && keepListener(l, -1) {
			name, ok := names[c.Pid]
			if !ok {
				if p, err := process.NewProcessWithContext(ctx, c.Pid); err == nil {
					name, _ = p.NameWithContext(ctx)
				}
				if strings.HasSuffix(strings.ToLower(name), ".exe") {
					name = name[:len(name)-4]
				}
				names[c.Pid] = name
			}
			l.process = name
		}
		out = append(out, l)
	}
	return out, nil
}

// processDetails reads command lines where the OS allows it. The working
// directory isn't cheaply available on Windows, so it is left unknown.
func processDetails(ctx context.Context, pids []int) map[int]procInfo {
	out := map[int]procInfo{}
	for _, pid := range pids {
		p, err := process.NewProcessWithContext(ctx, int32(pid))
		if err != nil {
			continue
		}
		cmd, _ := p.CmdlineWithContext(ctx)
		out[pid] = procInfo{command: cmd}
	}
	return out
}
