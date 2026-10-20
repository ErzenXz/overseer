package agent

import (
	"bufio"
	"context"
	"encoding/hex"
	"fmt"
	"html"
	"io"
	"net"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// Port discovery for live previews: which TCP servers on this machine the
// hub's loopback-only tunnel can reach, and whether they speak HTTP. The
// OS-specific half (scanListeners, processDetails) lives in ports_*.go.

const (
	portProbeTimeout  = 800 * time.Millisecond // per HTTP probe
	portProbeBudget   = 1500 * time.Millisecond
	portProbeParallel = 8
	portScanTimeout   = 2500 * time.Millisecond
	maxPortCommand    = 200
	maxPortTitle      = 120

	portWatchEvery = 3 * time.Second  // re-scan cadence for ports.changed
	portWatchFor   = 30 * time.Second // ...while someone asked this recently
)

// listener is one raw LISTEN socket as reported by the OS.
type listener struct {
	addr    string // "127.0.0.1", "0.0.0.0", "::", "::1" or a specific IP
	port    int
	pid     int // 0 = unknown
	process string
	inode   uint64 // Linux only: maps the socket to its process
}

// procInfo is the per-process detail that is only fetched for listeners
// that survive filtering.
type procInfo struct {
	process string
	command string
	cwd     string
}

// systemProcesses are listeners nobody wants to preview.
var systemProcesses = map[string]bool{
	"sshd": true, "cupsd": true, "rpcbind": true, "mdnsresponder": true,
	"controlcenter": true, "rapportd": true, "launchd": true,
	"xvnc": true, "x11vnc": true, "websockify": true,
}

func isSystemProcess(name string) bool {
	n := strings.ToLower(name)
	return systemProcesses[n] || strings.HasPrefix(n, "systemd")
}

// keepListener applies the device-side port rules: reachable through the
// loopback tunnel, not privileged (except 80), not ours, not a system service.
func keepListener(l listener, selfPid int) bool {
	ip := net.ParseIP(l.addr)
	if ip == nil || !(ip.IsLoopback() || ip.IsUnspecified()) {
		return false
	}
	if l.port < 1 || l.port > 65535 || (l.port <= 1023 && l.port != 80) {
		return false
	}
	if l.pid != 0 && l.pid == selfPid {
		return false
	}
	if l.process != "" && isSystemProcess(l.process) {
		return false
	}
	return !slices.Contains(vncPorts, l.port)
}

// addrRank orders the addresses a port is bound on; the best one is shown.
func addrRank(addr string) int {
	switch addr {
	case "127.0.0.1":
		return 0
	case "0.0.0.0":
		return 1
	case "::1":
		return 2
	case "::":
		return 3
	}
	return 4
}

// groupListeners folds sockets into one entry per port (a server usually
// binds both IPv4 and IPv6) and reports whether IPv4 loopback reaches it.
func groupListeners(raw []listener, selfPid int) ([]listener, map[int]bool) {
	byPort := map[int]listener{}
	v4 := map[int]bool{}
	for _, l := range raw {
		if !keepListener(l, selfPid) {
			continue
		}
		if ip := net.ParseIP(l.addr); ip.To4() != nil {
			v4[l.port] = true
		}
		cur, seen := byPort[l.port]
		if !seen {
			byPort[l.port] = l
			continue
		}
		if addrRank(l.addr) < addrRank(cur.addr) {
			cur.addr = l.addr
		}
		if cur.pid == 0 && l.pid != 0 {
			cur.pid, cur.process = l.pid, l.process
		}
		byPort[l.port] = cur
	}
	out := make([]listener, 0, len(byPort))
	for _, l := range byPort {
		out = append(out, l)
	}
	slices.SortFunc(out, func(a, b listener) int { return a.port - b.port })
	return out, v4
}

// listPorts scans listeners and, when probe is set, checks which answer HTTP.
func listPorts(ctx context.Context, probe bool) ([]protocol.PortInfo, error) {
	ctx, cancel := context.WithTimeout(ctx, portScanTimeout)
	defer cancel()
	raw, err := scanListeners(ctx)
	if err != nil {
		return nil, err
	}
	listeners, v4 := groupListeners(raw, os.Getpid())
	out := make([]protocol.PortInfo, len(listeners))
	var pids []int
	for i, l := range listeners {
		out[i] = protocol.PortInfo{Port: l.port, Address: l.addr, Pid: l.pid, Process: l.process}
		if l.pid != 0 && !slices.Contains(pids, l.pid) {
			pids = append(pids, l.pid)
		}
	}
	if !probe {
		return out, nil
	}
	details := processDetails(ctx, pids)
	for i := range out {
		if d, ok := details[out[i].Pid]; ok {
			if out[i].Process == "" {
				out[i].Process = d.process
			}
			out[i].Command = truncateRunes(strings.TrimSpace(d.command), maxPortCommand)
			out[i].Cwd = d.cwd
		}
	}

	pctx, pcancel := context.WithTimeout(ctx, portProbeBudget)
	defer pcancel()
	sem := make(chan struct{}, portProbeParallel)
	var wg sync.WaitGroup
	for i := range out {
		wg.Add(1)
		go func(p *protocol.PortInfo) {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
			case <-pctx.Done():
				return
			}
			defer func() { <-sem }()
			host := "127.0.0.1"
			if !v4[p.Port] {
				host = "::1"
			}
			p.Http, p.Title = probeHTTP(pctx, host, p.Port)
		}(&out[i])
	}
	wg.Wait()
	slices.SortStableFunc(out, func(a, b protocol.PortInfo) int {
		if a.Http != b.Http {
			if a.Http {
				return -1
			}
			return 1
		}
		return a.Port - b.Port
	})
	return out, nil
}

// probeClient never reuses connections or follows redirects: a redirect is
// already proof the port speaks HTTP.
var probeClient = &http.Client{
	Timeout: portProbeTimeout,
	Transport: &http.Transport{
		Proxy:             nil,
		DisableKeepAlives: true,
		DialContext:       (&net.Dialer{Timeout: portProbeTimeout}).DialContext,
	},
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

// probeHTTP sends GET / and returns whether an HTTP response came back and,
// for an HTML page, its <title>.
func probeHTTP(ctx context.Context, host string, port int) (bool, string) {
	addr := net.JoinHostPort(host, strconv.Itoa(port))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+addr+"/", nil)
	if err != nil {
		return false, ""
	}
	req.Host = "localhost:" + strconv.Itoa(port) // pass dev servers' host checks
	req.Header.Set("Accept", "text/html,*/*")
	req.Header.Set("User-Agent", "Overseer port probe")
	resp, err := probeClient.Do(req)
	if err != nil {
		return false, ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !strings.Contains(strings.ToLower(resp.Header.Get("Content-Type")), "html") {
		return true, ""
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	return true, extractTitle(body)
}

// extractTitle returns the text of the first <title> element, unescaped,
// whitespace-collapsed and capped.
func extractTitle(body []byte) string {
	lower := strings.ToLower(string(body))
	start := strings.Index(lower, "<title")
	if start < 0 {
		return ""
	}
	gt := strings.IndexByte(lower[start:], '>')
	if gt < 0 {
		return ""
	}
	start += gt + 1
	end := strings.Index(lower[start:], "</title")
	if end < 0 {
		return ""
	}
	title := html.UnescapeString(string(body[start : start+end]))
	return truncateRunes(strings.Join(strings.Fields(title), " "), maxPortTitle)
}

func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return strings.TrimSpace(string(r[:n]))
}

// --- parsers (OS-independent so they can be tested anywhere) ---

// parseProcNetTCP reads /proc/net/tcp or /proc/net/tcp6 and returns the
// sockets in LISTEN state (st 0A) with their inode.
func parseProcNetTCP(r io.Reader, v6 bool) []listener {
	var out []listener
	sc := bufio.NewScanner(r)
	first := true
	for sc.Scan() {
		if first { // header
			first = false
			continue
		}
		f := strings.Fields(sc.Text())
		if len(f) < 10 || f[3] != "0A" {
			continue
		}
		hostHex, portHex, ok := strings.Cut(f[1], ":")
		if !ok {
			continue
		}
		port, err := strconv.ParseUint(portHex, 16, 16)
		if err != nil {
			continue
		}
		ip := decodeProcAddr(hostHex, v6)
		if ip == nil {
			continue
		}
		inode, _ := strconv.ParseUint(f[9], 10, 64)
		out = append(out, listener{addr: ip.String(), port: int(port), inode: inode})
	}
	return out
}

// decodeProcAddr decodes the kernel's hex address: 32-bit words in host
// (little-endian on every platform Overseer ships for) byte order.
func decodeProcAddr(h string, v6 bool) net.IP {
	b, err := hex.DecodeString(h)
	if err != nil || (v6 && len(b) != 16) || (!v6 && len(b) != 4) {
		return nil
	}
	for i := 0; i+4 <= len(b); i += 4 {
		b[i], b[i+1], b[i+2], b[i+3] = b[i+3], b[i+2], b[i+1], b[i]
	}
	return net.IP(b)
}

// parseLsof reads `lsof -nP -iTCP -sTCP:LISTEN -FpcnTt` output: a p (pid)
// and c (command) line per process, then f/t/n/T lines per socket.
func parseLsof(out string) []listener {
	var res []listener
	var pid int
	var process, typ, name string
	inFile := false
	flush := func() {
		if inFile && name != "" {
			if l, ok := parseLsofName(name, typ); ok {
				l.pid, l.process = pid, process
				res = append(res, l)
			}
		}
		inFile, typ, name = false, "", ""
	}
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimRight(line, "\r")
		if line == "" {
			continue
		}
		v := line[1:]
		switch line[0] {
		case 'p':
			flush()
			pid, _ = strconv.Atoi(v)
			process = ""
		case 'c':
			process = v
		case 'f':
			flush()
			inFile = true
		case 't':
			typ = v
		case 'n':
			name = v
		}
	}
	flush()
	return res
}

// parseLsofName splits "127.0.0.1:5173", "[::1]:5173" or "*:5173".
func parseLsofName(name, typ string) (listener, bool) {
	i := strings.LastIndexByte(name, ':')
	if i < 0 {
		return listener{}, false
	}
	port, err := strconv.Atoi(name[i+1:])
	if err != nil {
		return listener{}, false
	}
	host := strings.Trim(name[:i], "[]")
	if host == "*" {
		host = "0.0.0.0"
		if typ == "IPv6" {
			host = "::"
		}
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return listener{}, false
	}
	return listener{addr: ip.String(), port: port}, true
}

// parseLsofCwd reads `lsof -a -p PIDS -d cwd -Fpn` output into pid -> cwd.
func parseLsofCwd(out string) map[int]string {
	res := map[int]string{}
	pid := 0
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimRight(line, "\r")
		if len(line) < 2 {
			continue
		}
		switch line[0] {
		case 'p':
			pid, _ = strconv.Atoi(line[1:])
		case 'n':
			if pid != 0 {
				res[pid] = line[1:]
			}
		}
	}
	return res
}

// parsePsCommands reads `ps -o pid=,command= -p PIDS` output.
func parsePsCommands(out string) map[int]string {
	res := map[int]string{}
	for _, line := range strings.Split(out, "\n") {
		f := strings.Fields(line)
		if len(f) < 2 {
			continue
		}
		if pid, err := strconv.Atoi(f[0]); err == nil {
			res[pid] = strings.Join(f[1:], " ")
		}
	}
	return res
}

func joinPids(pids []int) string {
	s := make([]string, len(pids))
	for i, p := range pids {
		s[i] = strconv.Itoa(p)
	}
	return strings.Join(s, ",")
}

// --- ports.list + ports.changed ---

// portsList answers ports.list and keeps a light watcher running for a while
// so the hub hears about servers starting or stopping.
func (a *Agent) portsList(id uint64) {
	ports, err := listPorts(context.Background(), true)
	if ports == nil {
		ports = []protocol.PortInfo{}
	}
	a.reply(id, ports, err)
	if err == nil {
		a.watchPorts(portSignature(ports))
	}
}

func portSignature(ports []protocol.PortInfo) string {
	nums := make([]int, len(ports))
	for i, p := range ports {
		nums[i] = p.Port
	}
	slices.Sort(nums)
	return fmt.Sprint(nums)
}

// watchPorts re-scans every few seconds (without HTTP probes) while ports
// were asked for recently, and sends ports.changed when the set differs.
func (a *Agent) watchPorts(baseline string) {
	a.portsMu.Lock()
	a.portsAsked = time.Now()
	if a.portsWatching {
		a.portsMu.Unlock()
		return
	}
	a.portsWatching = true
	a.portsMu.Unlock()

	go func() {
		last := baseline
		ticker := time.NewTicker(portWatchEvery)
		defer ticker.Stop()
		for range ticker.C {
			a.portsMu.Lock()
			idle := time.Since(a.portsAsked) > portWatchFor
			if idle {
				a.portsWatching = false
			}
			a.portsMu.Unlock()
			if idle {
				return
			}
			ports, err := listPorts(context.Background(), false)
			if err != nil {
				continue
			}
			if sig := portSignature(ports); sig != last {
				last = sig
				a.send(protocol.Msg{Type: protocol.TypePortsChanged})
			}
		}
	}()
}
