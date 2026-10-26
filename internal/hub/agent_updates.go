package hub

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// Agent updates: keeping the coding-agent CLIs installed on the user's
// machines current. The hub asks the npm registry for the newest release of
// each agent, compares it with what the devices report, and on request (or
// automatically, when the owner turns that on) runs the agent's own update
// command on the device. An update never runs while a session of that agent
// is working on the device; it is queued and the loop starts it as soon as
// the device is idle.

const (
	agentAutoUpdateSetting = "agent_auto_update"
	npmRegistryURL         = "https://registry.npmjs.org"

	agentLatestTTL     = 3 * time.Hour    // a good answer from the registry
	agentLatestRetry   = 15 * time.Minute // a failed lookup
	agentLatestTimeout = 5 * time.Second
	agentLatestMaxSize = 1 << 20

	agentUpdateTick      = 20 * time.Second // queue loop
	agentUpdateAutoEvery = 30 * time.Minute
	agentUpdateAutoFirst = 30 * time.Second // first automatic pass after start
	agentUpdateScanStale = 90 * time.Second // a GET older than this refreshes the detections
	agentUpdateTimeout   = 300              // seconds, per update command
	agentUpdateKeepFail  = time.Hour
	agentUpdateKeepDone  = 10 * time.Minute
	agentUpdateTail      = 400 // characters of command output kept as the message

	updAvailable = "available"
	updUpdating  = "updating"
	updQueued    = "queued"
	updFailed    = "failed"
	updUpdated   = "updated"
)

// agentUpdateSpec is one agent the hub can update: its npm package tells
// what the newest release is.
type agentUpdateSpec struct{ id, name, pkg string }

var agentUpdateSpecs = []agentUpdateSpec{
	{"claude", "Claude Code", "@anthropic-ai/claude-code"},
	{"codex", "Codex", "@openai/codex"},
	{"gemini", "Gemini CLI", "@google/gemini-cli"},
	{"opencode", "OpenCode", "opencode-ai"},
}

func agentUpdateSpecFor(id string) (agentUpdateSpec, bool) {
	for _, sp := range agentUpdateSpecs {
		if sp.id == id {
			return sp, true
		}
	}
	return agentUpdateSpec{}, false
}

// agentUpdateItem is one row of GET /api/agent-updates.
type agentUpdateItem struct {
	DeviceId   string `json:"deviceId"`
	DeviceName string `json:"deviceName"`
	Agent      string `json:"agent"`
	Name       string `json:"name"`
	Current    string `json:"current"`
	Latest     string `json:"latest"`
	State      string `json:"state"`
	Busy       int    `json:"busy"`
	Message    string `json:"message,omitempty"`
	UpdatedAt  int64  `json:"updatedAt,omitempty"`

	os string // the device's OS, for choosing the command
}

func (it agentUpdateItem) key() string { return agentUpdateKey(it.DeviceId, it.Agent) }

func agentUpdateKey(deviceId, agent string) string { return deviceId + "/" + agent }

// agentUpdateDevice is an online device as the updates see it.
type agentUpdateDevice struct{ id, name, os string }

// agentUpdateSnap is what one device last reported: the version of each
// installed, supported agent.
type agentUpdateSnap struct {
	dev      agentUpdateDevice
	versions map[string]string
}

func newAgentUpdateSnap(dev agentUpdateDevice, agents []protocol.AgentInfo) *agentUpdateSnap {
	snap := &agentUpdateSnap{dev: dev, versions: map[string]string{}}
	for _, a := range agents {
		if _, ok := agentUpdateSpecFor(a.Id); ok && a.Installed && a.Version != "" {
			snap.versions[a.Id] = a.Version
		}
	}
	return snap
}

type agentLatest struct {
	version string // empty after a failed lookup
	expires time.Time
}

// agentUpdateState is the updates' in-memory state (zero value is ready to
// use). The function fields are test seams: nil means the real thing.
type agentUpdateState struct {
	mu        sync.Mutex
	items     map[string]*agentUpdateItem // updating, queued, failed and updated, by device/agent
	snaps     map[string]*agentUpdateSnap // online devices' last detections
	scannedAt time.Time
	latest    map[string]agentLatest

	scanMu     sync.Mutex // one detection pass at a time
	fetchMu    sync.Mutex // one registry pass at a time
	refreshing atomic.Bool
	autoing    atomic.Bool

	registryURL string
	httpClient  *http.Client
	clock       func() time.Time
	devices     func() []agentUpdateDevice
	detect      func(deviceId string, refresh bool) ([]protocol.AgentInfo, error)
	busy        func(deviceId, agent string) (int, error)
	online      func(deviceId string) bool
	run         func(deviceId, command string, timeoutSec int) (protocol.ExecResult, error)
}

func (u *agentUpdateState) now() time.Time {
	if u.clock != nil {
		return u.clock()
	}
	return time.Now()
}

// --- latest versions ---

func (s *Server) fetchAgentLatest(sp agentUpdateSpec) (string, error) {
	u := &s.agentUpd
	base := u.registryURL
	if base == "" {
		base = npmRegistryURL
	}
	client := u.httpClient
	if client == nil {
		client = &http.Client{Timeout: agentLatestTimeout}
	}
	ctx, cancel := context.WithTimeout(context.Background(), agentLatestTimeout)
	defer cancel()
	url := strings.TrimRight(base, "/") + "/" + strings.ReplaceAll(sp.pkg, "/", "%2F") + "/latest"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "overseer/"+s.opts.Version)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("npm registry: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("npm registry: %s", resp.Status)
	}
	var out struct {
		Version string `json:"version"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, agentLatestMaxSize)).Decode(&out); err != nil {
		return "", fmt.Errorf("npm registry: %w", err)
	}
	out.Version = strings.TrimSpace(out.Version)
	if _, _, ok := parseAgentVersion(out.Version); !ok {
		return "", errors.New("npm registry: no usable version")
	}
	return out.Version, nil
}

// ensureAgentLatest looks up every agent whose cached answer has expired, in
// parallel, and waits. A success stays for 3 h, a failure for 15 min.
func (s *Server) ensureAgentLatest() {
	u := &s.agentUpd
	u.fetchMu.Lock()
	defer u.fetchMu.Unlock()
	var wg sync.WaitGroup
	for _, sp := range agentUpdateSpecs {
		if _, fresh := u.cachedLatest(sp.id); fresh {
			continue
		}
		wg.Add(1)
		go func(sp agentUpdateSpec) {
			defer wg.Done()
			v, err := s.fetchAgentLatest(sp)
			if err != nil {
				log.Printf("agent updates: latest %s: %v", sp.id, err)
			}
			u.mu.Lock()
			if u.latest == nil {
				u.latest = map[string]agentLatest{}
			}
			ttl := agentLatestTTL
			if err != nil {
				ttl = agentLatestRetry
			}
			u.latest[sp.id] = agentLatest{version: v, expires: u.now().Add(ttl)}
			u.mu.Unlock()
		}(sp)
	}
	wg.Wait()
}

// cachedLatest is the last known newest version (possibly past its expiry,
// so the list stays complete while a refresh runs) and whether it is fresh.
func (u *agentUpdateState) cachedLatest(agent string) (string, bool) {
	u.mu.Lock()
	defer u.mu.Unlock()
	e, ok := u.latest[agent]
	return e.version, ok && u.now().Before(e.expires)
}

// --- versions ---

// parseAgentVersion reads "v1.2.3", "1.2.3-beta.1+build" or "1.2" into its
// numeric parts; pre says it carries a prerelease tag (build metadata is
// dropped).
func parseAgentVersion(v string) (parts []int, pre bool, ok bool) {
	v = strings.TrimSpace(v)
	if i := strings.IndexAny(v, " \t"); i >= 0 {
		v = v[:i]
	}
	v = strings.TrimPrefix(strings.TrimPrefix(v, "v"), "V")
	if i := strings.IndexByte(v, '+'); i >= 0 {
		v = v[:i]
	}
	if i := strings.IndexByte(v, '-'); i >= 0 {
		pre = v[i+1:] != ""
		v = v[:i]
	}
	if v == "" {
		return nil, false, false
	}
	for _, p := range strings.Split(v, ".") {
		if p == "" || len(p) > 9 {
			return nil, false, false
		}
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return nil, false, false
		}
		parts = append(parts, n)
	}
	return parts, pre, true
}

// agentVersionOlder reports whether current is behind latest. A prerelease
// is older than the release it leads up to; two prereleases of the same
// release are not ordered, and anything unparsable is never outdated.
func agentVersionOlder(current, latest string) bool {
	a, aPre, ok := parseAgentVersion(current)
	if !ok {
		return false
	}
	b, bPre, ok := parseAgentVersion(latest)
	if !ok {
		return false
	}
	for i := 0; i < max(len(a), len(b)); i++ {
		var x, y int
		if i < len(a) {
			x = a[i]
		}
		if i < len(b) {
			y = b[i]
		}
		if x != y {
			return x < y
		}
	}
	return aPre && !bPre
}

// --- update commands ---

// agentUpdateCommand is the command that updates one agent on a device of the
// given OS: a fixed catalogue, so no request input ever reaches a shell. Unix
// commands run under sh whatever the user's login shell is; Windows commands
// are PowerShell. Empty for an agent that cannot be updated.
func agentUpdateCommand(agent, osName string) string {
	if osName == "windows" {
		return agentUpdateWindows[agent]
	}
	script, ok := agentUpdateUnix[agent]
	if !ok {
		return ""
	}
	// Tools in the usual user-level homes are found even when the agent runs
	// from a service without the interactive PATH.
	return "sh -c " + shellQuote(`PATH="$PATH:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin"; export PATH; `+script)
}

const toolsPrefixUnix = `"$HOME/.overseer/tools"`

var agentUpdateUnix = map[string]string{
	"claude": `claude update`,
	// Update the way Codex was installed: Homebrew, a global npm package, or
	// else the official installer again.
	"codex": `if command -v brew >/dev/null 2>&1 && brew list codex >/dev/null 2>&1; then brew upgrade codex; ` +
		`elif command -v npm >/dev/null 2>&1 && npm ls -g @openai/codex --depth=0 >/dev/null 2>&1; then npm install -g @openai/codex@latest; ` +
		`else curl -fsSL https://chatgpt.com/codex/install.sh | sh; fi`,
	// Setup installs Gemini CLI into the Overseer tools prefix; update that
	// copy when it is the one on PATH, else the global one.
	"gemini": `command -v npm >/dev/null 2>&1 || { echo "npm not found: install Node.js first"; exit 1; }; P=` + toolsPrefixUnix + `; ` +
		`case "$(command -v gemini 2>/dev/null)" in "$P"/*) npm install --prefix "$P" @google/gemini-cli@latest;; ` +
		`*) npm install -g @google/gemini-cli@latest;; esac`,
	"opencode": `opencode upgrade`,
}

const toolsPrefixWindows = `$prefix = Join-Path $env:LOCALAPPDATA "Overseer\tools"; `

var agentUpdateWindows = map[string]string{
	// Setup installs Claude Code on Windows into the Overseer tools prefix.
	"claude": toolsPrefixWindows + `$cmd = Get-Command claude -ErrorAction SilentlyContinue; ` +
		`if ($cmd -and $cmd.Source.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { npm install --prefix $prefix @anthropic-ai/claude-code@latest } else { claude update }; ` +
		`if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`,
	"codex": `$viaNpm = $false; if (Get-Command npm -ErrorAction SilentlyContinue) { npm ls -g @openai/codex --depth=0 *> $null; $viaNpm = ($LASTEXITCODE -eq 0) }; ` +
		`if ($viaNpm) { npm install -g @openai/codex@latest; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } } else { irm https://chatgpt.com/codex/install.ps1 | iex }`,
	"gemini": `if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm not found: install Node.js first" }; ` + toolsPrefixWindows +
		`$cmd = Get-Command gemini -ErrorAction SilentlyContinue; ` +
		`if ($cmd -and $cmd.Source.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { npm install --prefix $prefix @google/gemini-cli@latest } else { npm install -g @google/gemini-cli@latest }; ` +
		`if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`,
	"opencode": `opencode upgrade; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`,
}

var ansiRe = regexp.MustCompile("\x1b\\[[0-?]*[ -/]*[@-~]|\x1b\\][^\x07\x1b]*(?:\x07|\x1b\\\\)")

// agentUpdateFailure is the message for a failed command: the end of its
// combined output without colour codes, or the exit code when it said nothing.
func agentUpdateFailure(res protocol.ExecResult) string {
	out := ansiRe.ReplaceAllString(res.Stdout+"\n"+res.Stderr, "")
	out = strings.ReplaceAll(strings.ReplaceAll(out, "\r\n", "\n"), "\r", "\n")
	out = strings.TrimSpace(out)
	if out == "" {
		return fmt.Sprintf("The update command failed (exit code %d)", res.ExitCode)
	}
	if r := []rune(out); len(r) > agentUpdateTail {
		out = "…" + strings.TrimSpace(string(r[len(r)-agentUpdateTail:]))
	}
	return out
}

// --- seams ---

func (s *Server) agentUpdateDevices() []agentUpdateDevice {
	if f := s.agentUpd.devices; f != nil {
		return f()
	}
	names := map[string]string{}
	if list, err := s.store.ListDevices(); err == nil {
		for _, d := range list {
			names[d.Id] = d.Name
		}
	}
	var out []agentUpdateDevice
	for _, c := range s.registry.all() {
		name := names[c.deviceId]
		if name == "" {
			name = c.hello.Hostname
		}
		out = append(out, agentUpdateDevice{id: c.deviceId, name: name, os: c.hello.OS})
	}
	return out
}

func (s *Server) agentUpdateDetect(deviceId string, refresh bool) ([]protocol.AgentInfo, error) {
	if f := s.agentUpd.detect; f != nil {
		return f(deviceId, refresh)
	}
	c := s.registry.get(deviceId)
	if c == nil {
		return nil, errors.New("device is offline")
	}
	return s.deviceAgents(c, refresh)
}

// agentUpdateBusy counts the sessions of an agent on a device that are in the
// middle of something.
func (s *Server) agentUpdateBusy(deviceId, agent string) (int, error) {
	if f := s.agentUpd.busy; f != nil {
		return f(deviceId, agent)
	}
	var n int
	err := s.store.db.QueryRow(`SELECT COUNT(*) FROM threads WHERE device_id = ? AND agent = ? AND archived = 0
		AND status IN ('working', 'starting', 'waiting')`, deviceId, agent).Scan(&n)
	return n, err
}

func (s *Server) agentUpdateOnline(deviceId string) bool {
	if f := s.agentUpd.online; f != nil {
		return f(deviceId)
	}
	return s.registry.get(deviceId) != nil
}

func (s *Server) agentUpdateExec(deviceId, command string, timeoutSec int) (protocol.ExecResult, error) {
	if f := s.agentUpd.run; f != nil {
		return f(deviceId, command, timeoutSec)
	}
	c := s.registry.get(deviceId)
	if c == nil {
		return protocol.ExecResult{}, errors.New("device is offline")
	}
	return s.execOnDevice(c, command, "", timeoutSec)
}

// --- detections ---

// scanAgentUpdates asks every online device which agents it has (through the
// short-lived detection cache the composer uses). A device that does not
// answer keeps its previous entry; a device that went offline is dropped.
func (s *Server) scanAgentUpdates() {
	u := &s.agentUpd
	u.scanMu.Lock()
	defer u.scanMu.Unlock()
	devs := s.agentUpdateDevices()
	snaps := make([]*agentUpdateSnap, len(devs))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)
	for i, d := range devs {
		wg.Add(1)
		go func(i int, d agentUpdateDevice) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			if agents, err := s.agentUpdateDetect(d.id, false); err == nil {
				snaps[i] = newAgentUpdateSnap(d, agents)
			}
		}(i, d)
	}
	wg.Wait()
	u.mu.Lock()
	defer u.mu.Unlock()
	next := map[string]*agentUpdateSnap{}
	for i, d := range devs {
		switch old := u.snaps[d.id]; {
		case snaps[i] != nil:
			next[d.id] = snaps[i]
		case old != nil:
			old.dev = d
			next[d.id] = old
		}
	}
	u.snaps = next
	u.scannedAt = u.now()
}

// kickAgentRefresh brings the detections and the latest versions up to date
// in the background when they are stale, at most one run at a time. GET uses
// it so the page never waits on a device or the registry.
func (s *Server) kickAgentRefresh() {
	u := &s.agentUpd
	u.mu.Lock()
	stale := u.scannedAt.IsZero() || u.now().Sub(u.scannedAt) > agentUpdateScanStale
	u.mu.Unlock()
	for _, sp := range agentUpdateSpecs {
		if _, fresh := u.cachedLatest(sp.id); !fresh {
			stale = true
		}
	}
	if !stale || !u.refreshing.CompareAndSwap(false, true) {
		return
	}
	go func() {
		defer u.refreshing.Store(false)
		var wg sync.WaitGroup
		wg.Add(1)
		go func() {
			defer wg.Done()
			s.ensureAgentLatest()
		}()
		s.scanAgentUpdates()
		wg.Wait()
	}()
}

// --- the list ---

// agentUpdateItems is everything the page shows: updates that are available
// (derived from the detections and the latest versions), those in flight or
// queued, and recent failures and successes, by device name then agent.
func (s *Server) agentUpdateItems() []agentUpdateItem {
	u := &s.agentUpd
	now := u.now()
	u.mu.Lock()
	for key, it := range u.items {
		old := (it.State == updFailed && now.Sub(time.Unix(it.UpdatedAt, 0)) > agentUpdateKeepFail) ||
			(it.State == updUpdated && now.Sub(time.Unix(it.UpdatedAt, 0)) > agentUpdateKeepDone)
		// A failure the person fixed by hand no longer needs showing.
		if cur := u.snaps[it.DeviceId]; it.State == updFailed && cur != nil && cur.versions[it.Agent] != "" &&
			!agentVersionOlder(cur.versions[it.Agent], it.Latest) {
			old = true
		}
		if old {
			delete(u.items, key)
		}
	}
	out := []agentUpdateItem{}
	for _, it := range u.items {
		out = append(out, *it)
	}
	for id, snap := range u.snaps {
		for _, sp := range agentUpdateSpecs {
			current := snap.versions[sp.id]
			latest := u.latest[sp.id].version
			if current == "" || u.items[agentUpdateKey(id, sp.id)] != nil || !agentVersionOlder(current, latest) {
				continue
			}
			out = append(out, agentUpdateItem{DeviceId: id, DeviceName: snap.dev.name, Agent: sp.id, Name: sp.name,
				Current: current, Latest: latest, State: updAvailable, os: snap.dev.os})
		}
	}
	u.mu.Unlock()
	for i := range out {
		out[i].Busy, _ = s.agentUpdateBusy(out[i].DeviceId, out[i].Agent)
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.DeviceName != b.DeviceName {
			return a.DeviceName < b.DeviceName
		}
		if a.Agent != b.Agent {
			return a.Agent < b.Agent
		}
		return a.DeviceId < b.DeviceId
	})
	return out
}

type agentUpdateBody struct {
	Auto      bool              `json:"auto"`
	CheckedAt int64             `json:"checkedAt"`
	Items     []agentUpdateItem `json:"items"`
}

func (s *Server) agentUpdateBody() agentUpdateBody {
	items := s.agentUpdateItems()
	u := &s.agentUpd
	u.mu.Lock()
	var checked int64
	if !u.scannedAt.IsZero() {
		checked = u.scannedAt.Unix()
	}
	u.mu.Unlock()
	return agentUpdateBody{Auto: s.agentAutoUpdate(), CheckedAt: checked, Items: items}
}

func (s *Server) agentAutoUpdate() bool {
	v, _ := s.store.Setting(agentAutoUpdateSetting)
	return v == "true"
}

// --- running updates ---

// startAgentUpdate starts an update, or queues it when a session of that
// agent is busy on the device. An update already updating or queued is left
// alone, so the same device and agent never update twice at once.
func (s *Server) startAgentUpdate(it agentUpdateItem) bool {
	u := &s.agentUpd
	busy, err := s.agentUpdateBusy(it.DeviceId, it.Agent)
	wait := err != nil || busy > 0 // when in doubt, do not touch a running session's CLI
	u.mu.Lock()
	if cur := u.items[it.key()]; cur != nil && (cur.State == updUpdating || cur.State == updQueued) {
		u.mu.Unlock()
		return false
	}
	if u.items == nil {
		u.items = map[string]*agentUpdateItem{}
	}
	it.State, it.Message, it.UpdatedAt, it.Busy = updUpdating, "", u.now().Unix(), 0
	if wait {
		it.State = updQueued
	}
	u.items[it.key()] = &it
	u.mu.Unlock()
	if !wait {
		go s.runAgentUpdate(it)
	}
	return true
}

// runQueuedAgentUpdates starts every queued update whose device is online and
// has no busy session of that agent.
func (s *Server) runQueuedAgentUpdates() {
	u := &s.agentUpd
	u.mu.Lock()
	var queued []agentUpdateItem
	for _, it := range u.items {
		if it.State == updQueued {
			queued = append(queued, *it)
		}
	}
	u.mu.Unlock()
	for _, it := range queued {
		if !s.agentUpdateOnline(it.DeviceId) {
			continue
		}
		if busy, err := s.agentUpdateBusy(it.DeviceId, it.Agent); err != nil || busy > 0 {
			continue
		}
		u.mu.Lock()
		cur := u.items[it.key()]
		if cur == nil || cur.State != updQueued {
			u.mu.Unlock()
			continue
		}
		cur.State, cur.UpdatedAt = updUpdating, u.now().Unix()
		u.mu.Unlock()
		go s.runAgentUpdate(it)
	}
}

// runAgentUpdate runs the update command on the device, then asks the device
// again which version it has, and records the outcome.
func (s *Server) runAgentUpdate(it agentUpdateItem) {
	command := agentUpdateCommand(it.Agent, it.os)
	if command == "" {
		s.finishAgentUpdate(it, updFailed, it.Current, "This agent cannot be updated from here")
		return
	}
	res, err := s.agentUpdateExec(it.DeviceId, command, agentUpdateTimeout)
	switch {
	case err != nil:
		s.finishAgentUpdate(it, updFailed, it.Current, err.Error())
		return
	case res.ExitCode != 0:
		s.finishAgentUpdate(it, updFailed, it.Current, agentUpdateFailure(res))
		return
	}
	agents, err := s.agentUpdateDetect(it.DeviceId, true)
	if err != nil {
		s.finishAgentUpdate(it, updFailed, it.Current, "Updated, but the new version could not be read: "+err.Error())
		return
	}
	var now string
	for _, a := range agents {
		if a.Id == it.Agent && a.Installed {
			now = a.Version
		}
	}
	s.updateAgentSnap(it.DeviceId, agents)
	switch {
	case now == "":
		s.finishAgentUpdate(it, updFailed, it.Current, "Updated, but the new version could not be read")
	case now == it.Current:
		s.finishAgentUpdate(it, updFailed, it.Current, "Still on "+now+" after updating")
	default:
		s.finishAgentUpdate(it, updUpdated, now, "")
	}
}

// updateAgentSnap folds a fresh detection into the device's entry.
func (s *Server) updateAgentSnap(deviceId string, agents []protocol.AgentInfo) {
	u := &s.agentUpd
	u.mu.Lock()
	defer u.mu.Unlock()
	if old := u.snaps[deviceId]; old != nil {
		u.snaps[deviceId] = newAgentUpdateSnap(old.dev, agents)
	}
}

func (s *Server) finishAgentUpdate(it agentUpdateItem, state, current, message string) {
	u := &s.agentUpd
	if state == updFailed {
		log.Printf("agent updates: %s on %s: %s", it.Agent, it.DeviceName, message)
	}
	u.mu.Lock()
	defer u.mu.Unlock()
	it.State, it.Current, it.Message, it.UpdatedAt = state, current, message, u.now().Unix()
	if u.items == nil {
		u.items = map[string]*agentUpdateItem{}
	}
	u.items[it.key()] = &it
}

// startAgentUpdates starts the available updates (and, when retry is set, the
// failed ones) that match the filters (empty = all) and returns how many it
// accepted.
func (s *Server) startAgentUpdates(deviceId, agent string, retry bool) int {
	n := 0
	for _, it := range s.agentUpdateItems() {
		if (it.State != updAvailable && !(retry && it.State == updFailed)) ||
			(deviceId != "" && it.DeviceId != deviceId) || (agent != "" && it.Agent != agent) {
			continue
		}
		if s.startAgentUpdate(it) {
			n++
		}
	}
	return n
}

// --- background loop ---

// runAgentUpdates starts queued updates as their devices go idle and, when
// automatic updates are on, looks for new ones every 30 minutes.
func (s *Server) runAgentUpdates(ctx context.Context) {
	ticker := time.NewTicker(agentUpdateTick)
	defer ticker.Stop()
	nextAuto := time.Now().Add(agentUpdateAutoFirst)
	for {
		select {
		case <-ticker.C:
		case <-ctx.Done():
			return
		}
		s.runQueuedAgentUpdates()
		if now := time.Now(); !now.Before(nextAuto) {
			nextAuto = now.Add(agentUpdateAutoEvery)
			if s.agentAutoUpdate() && s.agentUpd.autoing.CompareAndSwap(false, true) {
				go func() {
					defer s.agentUpd.autoing.Store(false)
					s.autoUpdateAgents()
				}()
			}
		}
	}
}

// autoUpdateAgents is one automatic pass: look at every online device, then
// start what POST /api/agent-updates would for the available items.
func (s *Server) autoUpdateAgents() {
	s.scanAgentUpdates()
	s.ensureAgentLatest()
	if n := s.startAgentUpdates("", "", false); n > 0 {
		log.Printf("agent updates: automatic pass started %d update(s)", n)
	}
}

// --- HTTP ---

// routesAgentUpdates registers the agent-update routes.
func (s *Server) routesAgentUpdates(m *http.ServeMux) {
	m.HandleFunc("GET /api/agent-updates", s.requireAuth(s.handleGetAgentUpdates))
	m.HandleFunc("POST /api/agent-updates", s.requireOwner(s.handleStartAgentUpdates))
	m.HandleFunc("PUT /api/agent-updates/settings", s.requireOwner(s.handlePutAgentUpdateSettings))
}

func (s *Server) handleGetAgentUpdates(w http.ResponseWriter, r *http.Request) {
	s.kickAgentRefresh()
	writeJSON(w, s.agentUpdateBody())
}

func (s *Server) handleStartAgentUpdates(w http.ResponseWriter, r *http.Request) {
	var in struct {
		DeviceId string `json:"deviceId"`
		Agent    string `json:"agent"`
	}
	if err := readJSON(r, &in); err != nil && !errors.Is(err, io.EOF) {
		httpError(w, http.StatusBadRequest, "invalid request")
		return
	}
	var target []string
	if in.Agent != "" {
		sp, ok := agentUpdateSpecFor(in.Agent)
		if !ok {
			httpError(w, http.StatusBadRequest, "unknown agent")
			return
		}
		target = append(target, sp.name)
	}
	if in.DeviceId != "" {
		d, err := s.store.DeviceById(in.DeviceId)
		if err != nil {
			httpError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if d == nil {
			httpError(w, http.StatusNotFound, "device not found")
			return
		}
		target = append(target, "on "+d.Name)
	}
	// Only the very first request waits, to have something to act on: later
	// ones use the detections and versions the page was showing.
	u := &s.agentUpd
	u.mu.Lock()
	scanned := !u.scannedAt.IsZero()
	u.mu.Unlock()
	if !scanned {
		s.scanAgentUpdates()
	}
	s.ensureAgentLatest()
	n := s.startAgentUpdates(in.DeviceId, in.Agent, true)
	if len(target) == 0 {
		target = append(target, "all")
	}
	s.audit(r, "agent.update", strings.Join(target, " "), fmt.Sprintf("%d started", n))
	writeJSON(w, s.agentUpdateBody())
}

func (s *Server) handlePutAgentUpdateSettings(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Auto *bool `json:"auto"`
	}
	if err := readJSON(r, &in); err != nil || in.Auto == nil {
		httpError(w, http.StatusBadRequest, "auto is required")
		return
	}
	value := "false"
	if *in.Auto {
		value = "true"
	}
	if err := s.store.SetSetting(agentAutoUpdateSetting, value); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.audit(r, "agent.update.auto", "", map[bool]string{true: "on", false: "off"}[*in.Auto])
	writeJSON(w, s.agentUpdateBody())
}
