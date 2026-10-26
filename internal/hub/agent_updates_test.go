package hub

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

func TestAgentVersionOlder(t *testing.T) {
	for _, c := range []struct {
		current, latest string
		want            bool
	}{
		{"1.2.3", "1.2.4", true},
		{"1.2.3", "1.2.3", false},
		{"1.2.4", "1.2.3", false},
		{"1.9.0", "1.10.0", true}, // numeric, not lexical
		{"0.99.9", "1.0.0", true},
		{"2.1.76", "2.1.76", false},
		{"1.2", "1.2.1", true},
		{"1.2.0", "1.2", false},
		{"v1.2.3", "1.2.4", true},
		{"1.2.3+build.5", "1.2.3", false}, // build metadata is ignored
		{"1.2.3+build.5", "1.2.4+other", true},
		{"1.3.0-beta.1", "1.3.0", true}, // a prerelease is behind its release
		{"1.3.0", "1.3.0-beta.1", false},
		{"1.3.0-beta.1", "1.3.0-beta.2", false}, // prereleases of one release are not ordered
		{"1.2.9-rc.1", "1.3.0", true},
		{"1.4.0-nightly", "1.3.0", false},
		{"", "1.0.0", false},
		{"1.0.0", "", false},
		{"unknown", "1.0.0", false},
		{"1.x.0", "1.0.1", false},
		{"1..0", "1.0.1", false},
		{"99999999999.0.0", "1.0.0", false},
	} {
		if got := agentVersionOlder(c.current, c.latest); got != c.want {
			t.Errorf("agentVersionOlder(%q, %q) = %v, want %v", c.current, c.latest, got, c.want)
		}
	}
}

// fakeNpm answers the registry's /<package>/latest like npm does and counts
// the requests per package.
type fakeNpm struct {
	*httptest.Server
	mu      sync.Mutex
	version map[string]string // escaped package path -> version ("" = answer 500)
	hits    map[string]int
	agent   string // last User-Agent
}

func newFakeNpm(t *testing.T, versions map[string]string) *fakeNpm {
	f := &fakeNpm{version: versions, hits: map[string]int{}}
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		path := r.URL.EscapedPath()
		f.hits[path]++
		f.agent = r.Header.Get("User-Agent")
		v := f.version[path]
		if v == "" {
			http.Error(w, "nope", http.StatusInternalServerError)
			return
		}
		w.Write([]byte(`{"name":"pkg","version":"` + v + `"}`))
	}))
	t.Cleanup(f.Close)
	return f
}

func (f *fakeNpm) count(path string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.hits[path]
}

const (
	npmClaude   = "/@anthropic-ai%2Fclaude-code/latest"
	npmCodex    = "/@openai%2Fcodex/latest"
	npmGemini   = "/@google%2Fgemini-cli/latest"
	npmOpencode = "/opencode-ai/latest"
)

func allLatest(v string) map[string]string {
	return map[string]string{npmClaude: v, npmCodex: v, npmGemini: v, npmOpencode: v}
}

func TestAgentLatestIsCached(t *testing.T) {
	versions := allLatest("2.0.0")
	versions[npmOpencode] = "" // fails
	npm := newFakeNpm(t, versions)
	srv := newTestServer(t, "v9.9.9")
	u := &srv.agentUpd
	u.registryURL = npm.URL
	var offset atomic.Int64
	start := time.Now()
	u.clock = func() time.Time { return start.Add(time.Duration(offset.Load())) }

	srv.ensureAgentLatest()
	if v, fresh := u.cachedLatest("claude"); v != "2.0.0" || !fresh {
		t.Fatalf("claude latest = %q fresh=%v", v, fresh)
	}
	if v, fresh := u.cachedLatest("opencode"); v != "" || !fresh {
		t.Fatalf("a failed lookup is cached as empty: %q fresh=%v", v, fresh)
	}
	if npm.agent != "overseer/v9.9.9" {
		t.Errorf("User-Agent = %q", npm.agent)
	}
	// The scoped package name is sent with its slash encoded.
	if npm.count(npmClaude) != 1 || npm.count(npmCodex) != 1 || npm.count(npmGemini) != 1 {
		t.Fatalf("hits: %v", npm.hits)
	}

	offset.Store(int64(10 * time.Minute))
	srv.ensureAgentLatest()
	if npm.count(npmClaude) != 1 || npm.count(npmOpencode) != 1 {
		t.Fatalf("answers should be cached after 10 min: %v", npm.hits)
	}

	offset.Store(int64(16 * time.Minute)) // the failure is retried, the success is not
	srv.ensureAgentLatest()
	if npm.count(npmClaude) != 1 || npm.count(npmOpencode) != 2 {
		t.Fatalf("after 16 min: %v", npm.hits)
	}

	offset.Store(int64(2*time.Hour + 59*time.Minute))
	srv.ensureAgentLatest()
	if npm.count(npmClaude) != 1 {
		t.Fatalf("a good answer lives 3 h: %v", npm.hits)
	}
	// Past its expiry the old value still serves while it is refreshed.
	offset.Store(int64(3*time.Hour + time.Minute))
	if v, fresh := u.cachedLatest("claude"); v != "2.0.0" || fresh {
		t.Fatalf("expired entry = %q fresh=%v", v, fresh)
	}
	npm.mu.Lock()
	npm.version[npmClaude] = "2.1.0"
	npm.mu.Unlock()
	srv.ensureAgentLatest()
	if v, _ := u.cachedLatest("claude"); v != "2.1.0" || npm.count(npmClaude) != 2 {
		t.Fatalf("refresh: %q %v", v, npm.hits)
	}
}

func TestAgentLatestRejectsGarbage(t *testing.T) {
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"version":"not a version"}`))
	}))
	defer bad.Close()
	srv := newTestServer(t, "test")
	srv.agentUpd.registryURL = bad.URL
	if v, err := srv.fetchAgentLatest(agentUpdateSpecs[0]); err == nil {
		t.Fatalf("garbage accepted: %q", v)
	}
}

func TestAgentUpdateCommands(t *testing.T) {
	for _, sp := range agentUpdateSpecs {
		for _, osName := range []string{"linux", "darwin", "windows"} {
			if agentUpdateCommand(sp.id, osName) == "" {
				t.Errorf("no update command for %s on %s", sp.id, osName)
			}
		}
	}
	// Only the catalogue's agents have a command, so request input can never
	// become one.
	for _, id := range []string{"", "goose", "claude; rm -rf ~", "$(reboot)", "../claude", "CLAUDE"} {
		for _, osName := range []string{"linux", "windows", "$(id)"} {
			if cmd := agentUpdateCommand(id, osName); cmd != "" {
				if _, ok := agentUpdateSpecFor(id); !ok {
					t.Errorf("command for unsupported agent %q on %q: %s", id, osName, cmd)
				}
			}
		}
	}
	// An unknown OS is treated like unix, never executed differently by input.
	if !strings.HasPrefix(agentUpdateCommand("claude", "plan9"), "sh -c ") {
		t.Error("unix commands run under sh")
	}

	unix := func(agent string) string { return agentUpdateCommand(agent, "linux") }
	for agent, want := range map[string][]string{
		"claude":   {`"$B" update`, "brew upgrade --cask claude-code", `npm install -g --prefix "${R%%/lib/node_modules/*}"`, "apt-get install -y --only-upgrade claude-code", "sudo -n true", "OVERSEER_NEEDS_TERMINAL:"},
		"codex":    {"brew list codex", "brew upgrade codex", "npm ls -g @openai/codex", "npm install -g @openai/codex@latest", "curl -fsSL https://chatgpt.com/codex/install.sh | sh"},
		"gemini":   {"npm install -g @google/gemini-cli@latest", `npm install --prefix "$P" @google/gemini-cli@latest`, `.overseer/tools`},
		"opencode": {"opencode upgrade"},
	} {
		for _, w := range want {
			if !strings.Contains(unix(agent), w) {
				t.Errorf("unix %s command lacks %q:\n%s", agent, w, unix(agent))
			}
		}
	}
	windows := func(agent string) string { return agentUpdateCommand(agent, "windows") }
	for agent, want := range map[string][]string{
		"claude":   {"claude update", `Overseer\tools`},
		"codex":    {"npm install -g @openai/codex@latest", "irm https://chatgpt.com/codex/install.ps1 | iex"},
		"gemini":   {"npm install -g @google/gemini-cli@latest", `Overseer\tools`, "--prefix $prefix"},
		"opencode": {"opencode upgrade"},
	} {
		for _, w := range want {
			if !strings.Contains(windows(agent), w) {
				t.Errorf("windows %s command lacks %q:\n%s", agent, w, windows(agent))
			}
		}
		if strings.Contains(windows(agent), "sh -c") {
			t.Errorf("windows %s command goes through sh", agent)
		}
	}
}

func TestAgentUpdateFailureMessage(t *testing.T) {
	long := strings.Repeat("x", 900) + "\x1b[31mred tail\x1b[0m\r\nlast line\r\n"
	msg := agentUpdateFailure(protocol.ExecResult{ExitCode: 1, Stdout: "ignored start\n", Stderr: long})
	if strings.Contains(msg, "\x1b") || strings.Contains(msg, "\r") {
		t.Errorf("control characters survived: %q", msg)
	}
	if !strings.HasSuffix(msg, "red tail\nlast line") || !strings.HasPrefix(msg, "…") {
		t.Errorf("message should be the end of the output: %q", msg)
	}
	if n := len([]rune(msg)); n > agentUpdateTail+1 {
		t.Errorf("message is %d characters", n)
	}
	if strings.Contains(msg, "ignored start") {
		t.Error("the start of the output was kept")
	}
	if got := agentUpdateFailure(protocol.ExecResult{ExitCode: 7}); !strings.Contains(got, "exit code 7") {
		t.Errorf("empty output: %q", got)
	}
	if got := agentUpdateFailure(protocol.ExecResult{ExitCode: 1, Stdout: "short\n", Stderr: "\x1b]0;title\x07boom"}); got != "short\n\nboom" {
		t.Errorf("short output: %q", got)
	}
}

// updEnv is a hub with one fake online device whose Claude Code is behind.
type updEnv struct {
	*teamEnv
	npm      *fakeNpm
	busy     atomic.Int32
	online   atomic.Bool
	ran      atomic.Int32
	execErr  atomic.Pointer[error]
	execRes  atomic.Pointer[protocol.ExecResult]
	detected atomic.Pointer[string] // the version the device reports for claude
	mu       sync.Mutex
	commands []string
	detects  atomic.Int32
	device   string
}

const testName = "Laptop"

func newUpdEnv(t *testing.T) *updEnv {
	t.Helper()
	e := &updEnv{teamEnv: newTeamEnv(t), npm: newFakeNpm(t, allLatest("2.0.0"))}
	id, _, err := e.srv.store.CreateDevice(testName, "laptop", "linux", "amd64", false)
	if err != nil {
		t.Fatal(err)
	}
	e.device = id
	e.online.Store(true)
	old := "1.0.0"
	e.detected.Store(&old)
	u := &e.srv.agentUpd
	u.registryURL = e.npm.URL
	u.devices = func() []agentUpdateDevice {
		if !e.online.Load() {
			return nil
		}
		return []agentUpdateDevice{{id: e.device, name: testName, os: "linux"}}
	}
	u.detect = func(id string, refresh bool) ([]protocol.AgentInfo, error) {
		e.detects.Add(1)
		return []protocol.AgentInfo{
			{Id: "claude", Installed: true, Version: *e.detected.Load()},
			{Id: "codex", Installed: false},
			{Id: "goose", Installed: true, Version: "0.0.1"}, // not supported: never listed
			{Id: "acp", Installed: true},
		}, nil
	}
	u.busy = func(id, agent string) (int, error) { return int(e.busy.Load()), nil }
	u.online = func(string) bool { return e.online.Load() }
	u.run = func(id, command string, timeoutSec int) (protocol.ExecResult, error) {
		e.ran.Add(1)
		e.mu.Lock()
		e.commands = append(e.commands, command)
		e.mu.Unlock()
		if err := e.execErr.Load(); err != nil {
			return protocol.ExecResult{}, *err
		}
		if res := e.execRes.Load(); res != nil {
			return *res, nil
		}
		v := "2.0.0" // the update worked
		e.detected.Store(&v)
		return protocol.ExecResult{}, nil
	}
	return e
}

func (e *updEnv) post(body any) agentUpdateBody {
	e.t.Helper()
	st, out := e.do(e.owner, "POST", "/api/agent-updates", body)
	if st != 200 {
		e.t.Fatalf("POST: %d %s", st, out)
	}
	return decode[agentUpdateBody](e.teamEnv, out)
}

func (e *updEnv) get() (agentUpdateBody, string) {
	e.t.Helper()
	st, out := e.do(e.owner, "GET", "/api/agent-updates", nil)
	if st != 200 {
		e.t.Fatalf("GET: %d %s", st, out)
	}
	return decode[agentUpdateBody](e.teamEnv, out), out
}

// wait polls until the single item reaches state.
func (e *updEnv) wait(state string) agentUpdateItem {
	e.t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		items := e.srv.agentUpdateItems()
		if len(items) == 1 && items[0].State == state {
			return items[0]
		}
		if time.Now().After(deadline) {
			e.t.Fatalf("never reached %q: %+v", state, items)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func (e *updEnv) commandCount() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return len(e.commands)
}

func TestAgentUpdatesListAvailable(t *testing.T) {
	e := newUpdEnv(t)
	e.srv.scanAgentUpdates()
	e.srv.ensureAgentLatest()
	body, raw := e.get()
	if body.Auto || body.CheckedAt == 0 {
		t.Fatalf("auto=%v checkedAt=%d", body.Auto, body.CheckedAt)
	}
	if len(body.Items) != 1 {
		t.Fatalf("items: %s", raw)
	}
	it := body.Items[0]
	if it.DeviceId != e.device || it.DeviceName != testName || it.Agent != "claude" || it.Name != "Claude Code" ||
		it.Current != "1.0.0" || it.Latest != "2.0.0" || it.State != "available" || it.Busy != 0 || it.UpdatedAt != 0 {
		t.Fatalf("item: %+v", it)
	}
	if strings.Contains(raw, `"message"`) || strings.Contains(raw, `"updatedAt"`) {
		t.Errorf("empty message and updatedAt are omitted: %s", raw)
	}
	if e.ran.Load() != 0 {
		t.Fatal("listing must not run anything")
	}

	// Up to date, or an offline device, lists nothing, and as [] not null.
	v := "2.0.0"
	e.detected.Store(&v)
	e.srv.scanAgentUpdates()
	if _, raw := e.get(); !strings.Contains(raw, `"items":[]`) {
		t.Fatalf("up to date: %s", raw)
	}
	old := "1.0.0"
	e.detected.Store(&old)
	e.online.Store(false)
	e.srv.scanAgentUpdates()
	if body, raw := e.get(); len(body.Items) != 0 || !strings.Contains(raw, `"items":[]`) {
		t.Fatalf("offline device: %s", raw)
	}
}

func TestAgentUpdatesGetDoesNotWait(t *testing.T) {
	e := newUpdEnv(t)
	// Nothing detected yet: GET answers at once with what it has, and the
	// refresh happens behind it.
	body, raw := e.get()
	if len(body.Items) != 0 || body.CheckedAt != 0 || !strings.Contains(raw, `"items":[]`) {
		t.Fatalf("first GET: %s", raw)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		if body, _ := e.get(); len(body.Items) == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the background refresh never listed the update")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestAgentUpdateQueuesWhileBusy(t *testing.T) {
	e := newUpdEnv(t)
	e.busy.Store(2)
	body := e.post(map[string]string{})
	if len(body.Items) != 1 || body.Items[0].State != "queued" || body.Items[0].Busy != 2 {
		t.Fatalf("busy device: %+v", body.Items)
	}
	// The loop leaves it alone while a session is busy, or the device is away.
	e.srv.runQueuedAgentUpdates()
	time.Sleep(50 * time.Millisecond)
	if e.ran.Load() != 0 {
		t.Fatal("ran an update while a session was busy")
	}
	e.busy.Store(0)
	e.online.Store(false)
	e.srv.runQueuedAgentUpdates()
	time.Sleep(50 * time.Millisecond)
	if e.ran.Load() != 0 {
		t.Fatal("ran an update on an offline device")
	}
	// Asking again while it waits changes nothing.
	e.online.Store(true)
	e.busy.Store(1)
	if body := e.post(map[string]string{"deviceId": e.device, "agent": "claude"}); len(body.Items) != 1 || body.Items[0].State != "queued" {
		t.Fatalf("second POST: %+v", body.Items)
	}
	if e.ran.Load() != 0 {
		t.Fatal("ran an update while a session was busy")
	}

	// The session finishes: the next pass runs it, once.
	e.busy.Store(0)
	e.srv.runQueuedAgentUpdates()
	e.srv.runQueuedAgentUpdates()
	it := e.wait("updated")
	if it.Current != "2.0.0" || it.Latest != "2.0.0" || it.UpdatedAt == 0 || it.Message != "" {
		t.Fatalf("updated item: %+v", it)
	}
	if e.commandCount() != 1 || !strings.Contains(e.commands[0], `"$B" update`) {
		t.Fatalf("commands: %q", e.commands)
	}
	if e.detects.Load() < 2 {
		t.Error("the device was not asked again after the update")
	}
	// A finished update is not offered again.
	if body, _ := e.get(); len(body.Items) != 1 || body.Items[0].State != "updated" {
		t.Fatalf("after: %+v", body.Items)
	}
	if body := e.post(map[string]string{}); len(body.Items) != 1 || body.Items[0].State != "updated" || e.commandCount() != 1 {
		t.Fatalf("POST after: %+v", body.Items)
	}
}

func TestAgentUpdateRunsAtOnceWhenIdle(t *testing.T) {
	e := newUpdEnv(t)
	e.post(map[string]string{"deviceId": e.device})
	e.wait("updated")
	if e.commandCount() != 1 {
		t.Fatalf("commands: %q", e.commands)
	}

	// Done items are dropped after ten minutes.
	e.srv.agentUpd.clock = func() time.Time { return time.Now().Add(11 * time.Minute) }
	if items := e.srv.agentUpdateItems(); len(items) != 0 {
		t.Fatalf("after 11 min: %+v", items)
	}
}

func TestAgentUpdateFailureAndRetry(t *testing.T) {
	e := newUpdEnv(t)
	res := protocol.ExecResult{ExitCode: 1, Stderr: strings.Repeat("a", 800) + "\x1b[1mEACCES permission denied\x1b[0m\n"}
	e.execRes.Store(&res)
	e.post(map[string]string{})
	it := e.wait("failed")
	if !strings.HasSuffix(it.Message, "EACCES permission denied") || len([]rune(it.Message)) > agentUpdateTail+1 || strings.Contains(it.Message, "\x1b") {
		t.Fatalf("message: %q", it.Message)
	}
	if it.Current != "1.0.0" || it.UpdatedAt == 0 {
		t.Fatalf("failed item: %+v", it)
	}

	// A failure is retried only when asked.
	e.srv.runQueuedAgentUpdates()
	e.srv.autoUpdateAgents() // a pass does not retry a failure either
	time.Sleep(50 * time.Millisecond)
	if e.commandCount() != 1 {
		t.Fatalf("failure retried by itself: %q", e.commands)
	}
	e.execRes.Store(nil)
	e.post(map[string]string{"agent": "claude"})
	if it := e.wait("updated"); it.Current != "2.0.0" {
		t.Fatalf("retry: %+v", it)
	}
	if e.commandCount() != 2 {
		t.Fatalf("commands: %q", e.commands)
	}
}

func TestAgentUpdateFailedItemExpires(t *testing.T) {
	e := newUpdEnv(t)
	err := errors.New("device is offline")
	e.execErr.Store(&err)
	e.post(map[string]string{})
	if it := e.wait("failed"); it.Message != "device is offline" {
		t.Fatalf("message: %q", it.Message)
	}
	e.srv.agentUpd.clock = func() time.Time { return time.Now().Add(61 * time.Minute) }
	e.srv.agentUpd.mu.Lock()
	e.srv.agentUpd.scannedAt = e.srv.agentUpd.clock() // detections are fresh at that point
	e.srv.agentUpd.mu.Unlock()
	// After an hour the failure is gone and the update is on offer again,
	// which is what the next automatic pass picks up.
	if items := e.srv.agentUpdateItems(); len(items) != 1 || items[0].State != "available" {
		t.Fatalf("after 61 min: %+v", items)
	}
}

func TestAgentUpdateNeedsAChangedVersion(t *testing.T) {
	e := newUpdEnv(t)
	same := protocol.ExecResult{} // the command "worked" but nothing changed
	e.execRes.Store(&same)
	e.post(map[string]string{})
	it := e.wait("failed")
	if it.Message != "Still on 1.0.0 after updating" {
		t.Fatalf("message: %q", it.Message)
	}
}

// When the updater ran but changed nothing, what it printed is the reason.
func TestAgentUpdateStillOnSaysWhy(t *testing.T) {
	e := newUpdEnv(t)
	res := protocol.ExecResult{Stdout: "Warning: claude is managed by another tool\n"}
	e.execRes.Store(&res)
	e.post(map[string]string{})
	it := e.wait("failed")
	if it.Message != "Still on 1.0.0 after updating. The updater said: Warning: claude is managed by another tool" {
		t.Fatalf("message: %q", it.Message)
	}
}

// A machine whose own updater says it is current (Claude Code's stable
// channel lags the registry) is not a failure, and isn't offered again until
// a newer release appears.
func TestAgentUpdateUpToDateOnItsChannel(t *testing.T) {
	e := newUpdEnv(t)
	res := protocol.ExecResult{Stdout: "Current version: 1.0.0\nClaude Code is up to date (1.0.0)\n"}
	e.execRes.Store(&res)
	e.post(map[string]string{})
	it := e.wait("updated")
	if it.Current != "1.0.0" || !strings.Contains(it.Message, "update channel") {
		t.Fatalf("held item: %+v", it)
	}
	// Once the "updated" row expires, nothing is on offer for that release.
	later := time.Now().Add(agentUpdateKeepDone + time.Minute)
	e.srv.agentUpd.clock = func() time.Time { return later }
	e.srv.agentUpd.mu.Lock()
	e.srv.agentUpd.scannedAt = later
	e.srv.agentUpd.mu.Unlock()
	if items := e.srv.agentUpdateItems(); len(items) != 0 {
		t.Fatalf("held update offered again: %+v", items)
	}
	// A newer release is offered again.
	e.srv.agentUpd.mu.Lock()
	for id, l := range e.srv.agentUpd.latest {
		l.version = "3.0.0"
		e.srv.agentUpd.latest[id] = l
	}
	e.srv.agentUpd.mu.Unlock()
	if items := e.srv.agentUpdateItems(); len(items) != 1 || items[0].State != "available" || items[0].Latest != "3.0.0" {
		t.Fatalf("after a newer release: %+v", items)
	}
}

// The Claude Code command updates the copy on PATH the way it was installed.
func TestClaudeUpdateFollowsTheInstall(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix shell script")
	}
	script := agentUpdateCommand("claude", "linux")
	fake := func(t *testing.T, dir, name, body string) string {
		t.Helper()
		p := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("#!/bin/sh\n"+body+"\n"), 0o755); err != nil {
			t.Fatal(err)
		}
		return p
	}
	cases := []struct{ name, target, want string }{
		{"native", ".local/share/claude/versions/2.1.0", "NATIVE update"},
		{"npm global", "lib/node_modules/@anthropic-ai/claude-code/cli.js", "NPM install -g --prefix {home} @anthropic-ai/claude-code@latest"},
		{"npm local prefix", ".overseer/tools/node_modules/@anthropic-ai/claude-code/cli.js", "NPM install --prefix {home}/.overseer/tools @anthropic-ai/claude-code@latest"},
		{"homebrew stable", "Caskroom/claude-code/2.1.0/claude", "BREW upgrade --cask claude-code"},
		{"homebrew latest", "Caskroom/claude-code@latest/2.1.0/claude", "BREW upgrade --cask claude-code@latest"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			home := t.TempDir()
			tools := filepath.Join(home, "fakebin")
			fake(t, tools, "npm", `echo "NPM $*"`)
			fake(t, tools, "brew", `echo "BREW $*"`)
			target := fake(t, home, c.target, `echo "NATIVE $*"`)
			bin := filepath.Join(home, "bin")
			os.MkdirAll(bin, 0o755)
			if err := os.Symlink(target, filepath.Join(bin, "claude")); err != nil {
				t.Fatal(err)
			}
			cmd := exec.Command("sh", "-c", script)
			cmd.Env = []string{"HOME=" + home, "PATH=" + bin + ":" + tools + ":/usr/bin:/bin"}
			out, err := cmd.CombinedOutput()
			real, _ := filepath.EvalSymlinks(home) // the prefix comes from the resolved path
			want := strings.ReplaceAll(c.want, "{home}", real)
			if err != nil || strings.TrimSpace(string(out)) != want {
				t.Fatalf("%v: %q, want %q", err, out, want)
			}
		})
	}
}

func TestAgentUpdateNeverRunsTwiceAtOnce(t *testing.T) {
	e := newUpdEnv(t)
	release := make(chan struct{})
	var started atomic.Int32
	e.srv.agentUpd.run = func(id, command string, timeoutSec int) (protocol.ExecResult, error) {
		started.Add(1)
		<-release
		v := "2.0.0"
		e.detected.Store(&v)
		return protocol.ExecResult{}, nil
	}
	e.post(map[string]string{})
	e.wait("updating")
	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			e.srv.startAgentUpdates("", "", true)
			e.srv.runQueuedAgentUpdates()
			e.srv.autoUpdateAgents()
		}()
	}
	wg.Wait()
	if body := e.post(map[string]string{}); len(body.Items) != 1 || body.Items[0].State != "updating" {
		t.Fatalf("while updating: %+v", body.Items)
	}
	close(release)
	e.wait("updated")
	if started.Load() != 1 {
		t.Fatalf("the update ran %d times", started.Load())
	}
}

func TestAgentUpdateAutoPass(t *testing.T) {
	e := newUpdEnv(t)
	if e.srv.agentAutoUpdate() {
		t.Fatal("auto updates are off by default")
	}
	e.busy.Store(1)
	e.srv.autoUpdateAgents()
	// A busy device is queued like a POST would.
	if it := e.srv.agentUpdateItems(); len(it) != 1 || it[0].State != "queued" || e.ran.Load() != 0 {
		t.Fatalf("auto pass on a busy device: %+v", it)
	}
	e.busy.Store(0)
	e.srv.runQueuedAgentUpdates()
	e.wait("updated")
}

func TestAgentUpdateSettingsAndPermissions(t *testing.T) {
	e := newUpdEnv(t)
	body, _ := e.get()
	if body.Auto {
		t.Fatal("auto updates default to off")
	}
	st, out := e.do(e.owner, "PUT", "/api/agent-updates/settings", map[string]bool{"auto": true})
	if st != 200 || !decode[agentUpdateBody](e.teamEnv, out).Auto {
		t.Fatalf("PUT on: %d %s", st, out)
	}
	if v, _ := e.srv.store.Setting(agentAutoUpdateSetting); v != "true" {
		t.Fatalf("stored %q", v)
	}
	if body, _ := e.get(); !body.Auto {
		t.Fatal("auto did not stick")
	}
	st, out = e.do(e.owner, "PUT", "/api/agent-updates/settings", map[string]bool{"auto": false})
	if st != 200 || decode[agentUpdateBody](e.teamEnv, out).Auto {
		t.Fatalf("PUT off: %d %s", st, out)
	}
	if st, _ := e.do(e.owner, "PUT", "/api/agent-updates/settings", map[string]string{}); st != 400 {
		t.Errorf("PUT without auto: %d", st)
	}
	if n := countRows(t, e.srv, `SELECT COUNT(*) FROM audit_log WHERE action = 'agent.update.auto'`); n != 2 {
		t.Errorf("audit rows for the setting: %d", n)
	}

	// Validation.
	if st, _ := e.do(e.owner, "POST", "/api/agent-updates", map[string]string{"agent": "goose"}); st != 400 {
		t.Errorf("unsupported agent: %d", st)
	}
	if st, _ := e.do(e.owner, "POST", "/api/agent-updates", map[string]string{"deviceId": "nope"}); st != 404 {
		t.Errorf("unknown device: %d", st)
	}
	if e.ran.Load() != 0 {
		t.Fatal("a rejected request ran something")
	}

	// Anyone signed in can look; only owners change anything.
	sam := e.join("Sam", "sams-password-1")
	if st, _ := e.do(sam, "GET", "/api/agent-updates", nil); st != 200 {
		t.Errorf("member GET: %d", st)
	}
	for _, rt := range []struct{ method, path string }{{"POST", "/api/agent-updates"}, {"PUT", "/api/agent-updates/settings"}} {
		if st, _ := e.do(sam, rt.method, rt.path, map[string]any{"auto": true}); st != 403 {
			t.Errorf("member %s %s: %d", rt.method, rt.path, st)
		}
		if st, _ := e.do(newClient(), rt.method, rt.path, map[string]any{"auto": true}); st != 401 {
			t.Errorf("anonymous %s %s: %d", rt.method, rt.path, st)
		}
	}
	if st, _ := e.do(newClient(), "GET", "/api/agent-updates", nil); st != 401 {
		t.Errorf("anonymous GET: %d", st)
	}
	if e.ran.Load() != 0 {
		t.Fatal("a refused request ran something")
	}
}

func TestAgentUpdateStartIsAudited(t *testing.T) {
	e := newUpdEnv(t)
	e.post(map[string]string{"deviceId": e.device, "agent": "claude"})
	e.wait("updated")
	var target, detail string
	if err := e.srv.store.db.QueryRow(`SELECT target, detail FROM audit_log WHERE action = 'agent.update'`).Scan(&target, &detail); err != nil {
		t.Fatal(err)
	}
	if target != "Claude Code on "+testName || detail != "1 started" {
		t.Errorf("audit: %q %q", target, detail)
	}
}

func TestAgentUpdateBusyCountsRunningSessions(t *testing.T) {
	srv := newTestServer(t, "test")
	add := func(id, agent, status string, archived bool) {
		t.Helper()
		if err := srv.store.CreateThread(&Thread{Id: id, Title: id, DeviceId: "d1", Agent: agent, Cwd: "/", Access: "full", Status: status, Archived: archived}); err != nil {
			t.Fatal(err)
		}
	}
	add("t1", "claude", "working", false)
	add("t2", "claude", "starting", false)
	add("t3", "claude", "waiting", false)
	add("t4", "claude", "idle", false)
	add("t5", "claude", "working", true) // archived: not busy
	add("t6", "codex", "working", false) // another agent
	if n, err := srv.agentUpdateBusy("d1", "claude"); err != nil || n != 3 {
		t.Fatalf("busy = %d, %v; want 3", n, err)
	}
	if n, _ := srv.agentUpdateBusy("d2", "claude"); n != 0 {
		t.Fatalf("other device busy = %d", n)
	}
}

func TestAgentTerminalCommand(t *testing.T) {
	needs := protocol.ExecResult{ExitCode: 3, Stdout: "some output\n" + agentNeedsTerminal + "apt\n"}
	if cmd, ok := agentTerminalCommand("claude", needs); !ok || cmd != claudePackageCommands["apt"] {
		t.Fatalf("apt: %q %v", cmd, ok)
	}
	for _, res := range []protocol.ExecResult{
		{Stdout: agentNeedsTerminal + "rm -rf /"}, // never a command from the device
		{Stdout: "plain failure"},
	} {
		if cmd, ok := agentTerminalCommand("claude", res); ok {
			t.Fatalf("%q gave %q", res.Stdout, cmd)
		}
	}
	if _, ok := agentTerminalCommand("codex", needs); ok {
		t.Fatal("only Claude Code has package commands")
	}
}

// Without root or passwordless sudo, a packaged Claude Code fails with the
// command to run in a terminal; after the person runs it, a recheck clears it.
func TestAgentUpdateNeedsTerminalThenRecheck(t *testing.T) {
	e := newUpdEnv(t)
	res := protocol.ExecResult{ExitCode: 3, Stdout: agentNeedsTerminal + "apt\n"}
	e.execRes.Store(&res)
	e.post(map[string]string{})
	it := e.wait("failed")
	if it.Command != claudePackageCommands["apt"] || !strings.Contains(it.Message, "password") {
		t.Fatalf("failed item: %+v", it)
	}
	v := "2.0.0" // they ran it by hand
	e.detected.Store(&v)
	body := e.post(map[string]any{"deviceId": e.device, "agent": "claude", "recheck": true})
	if len(body.Items) != 0 {
		t.Fatalf("after recheck: %+v", body.Items)
	}
	if st, _ := e.do(e.owner, "POST", "/api/agent-updates", map[string]any{"recheck": true}); st != 400 {
		t.Fatalf("recheck without a target: %d", st)
	}
}

// The package branch of the Claude Code script: as a person without
// passwordless sudo it asks for a terminal; with it, it upgrades the package.
func TestClaudeUpdatePackageBranch(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix shell script")
	}
	run := func(t *testing.T, sudoWorks bool) (string, int) {
		t.Helper()
		home := t.TempDir()
		real, _ := filepath.EvalSymlinks(home)
		tools := filepath.Join(home, "fakebin")
		write := func(path, body string) {
			os.MkdirAll(filepath.Dir(path), 0o755)
			if err := os.WriteFile(path, []byte("#!/bin/sh\n"+body+"\n"), 0o755); err != nil {
				t.Fatal(err)
			}
		}
		write(filepath.Join(tools, "dpkg"), `exit 0`)
		write(filepath.Join(tools, "id"), `echo 1000`)
		if sudoWorks {
			write(filepath.Join(tools, "sudo"), `[ "$1" = "-n" ] && shift; [ "$1" = "true" ] && exit 0; exec "$@"`)
		} else {
			write(filepath.Join(tools, "sudo"), `exit 1`)
		}
		write(filepath.Join(tools, "apt-get"), `echo "APT $*"`)
		target := filepath.Join(home, "usr/bin/claude-real")
		write(target, `echo "NATIVE $*"`)
		bin := filepath.Join(home, "bin")
		os.MkdirAll(bin, 0o755)
		os.Symlink(target, filepath.Join(bin, "claude"))
		// Point the package branch at this fake /usr.
		script := strings.Replace(agentUpdateCommand("claude", "linux"), "/usr/*)", real+"/usr/*)", 1)
		cmd := exec.Command("sh", "-c", script)
		cmd.Env = []string{"HOME=" + home, "PATH=" + bin + ":" + tools + ":/usr/bin:/bin"}
		out, _ := cmd.CombinedOutput()
		return strings.TrimSpace(string(out)), cmd.ProcessState.ExitCode()
	}
	if out, code := run(t, false); code != 3 || out != agentNeedsTerminal+"apt" {
		t.Fatalf("no sudo: %d %q", code, out)
	}
	out, code := run(t, true)
	if code != 0 || !strings.Contains(out, "APT update") || !strings.Contains(out, "APT install -y --only-upgrade claude-code") {
		t.Fatalf("passwordless sudo: %d %q", code, out)
	}
}
