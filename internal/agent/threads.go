package agent

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// Agent threads: each thread is one coding-agent CLI process driven over its
// native machine protocol (ACP, Claude stream-json, Codex app-server). The
// adapters normalise everything into protocol.ThreadEvent / ThreadState
// notifications that the hub folds into stored messages.

const (
	toolOutputCap    = 64 * 1024
	threadStartLimit = 90 * time.Second
)

// threadSink receives an adapter's normalised output.
type threadSink interface {
	event(ev protocol.ThreadEvent)
	state(st protocol.ThreadState)
}

// threadAdapter drives one coding-agent process.
type threadAdapter interface {
	// start spawns the CLI and completes its handshake; it returns the
	// agent's own session id (used to resume after a restart), if known.
	start(ctx context.Context) (string, error)
	// prompt begins a turn and returns once the agent has accepted it.
	prompt(text string) error
	cancel() error
	approve(approvalId, optionId string) error
	stop()
	alive() bool
	resumeId() string
}

// hubSink forwards adapter output to the hub as notifications.
type hubSink struct {
	a        *Agent
	threadId string
}

func (s hubSink) event(ev protocol.ThreadEvent) {
	if m, err := protocol.NewMsg(protocol.TypeThreadEvent, 0, 0, protocol.ThreadEventMsg{ThreadId: s.threadId, Event: ev}); err == nil {
		s.a.send(m)
	}
}

func (s hubSink) state(st protocol.ThreadState) {
	st.ThreadId = s.threadId
	if m, err := protocol.NewMsg(protocol.TypeThreadState, 0, 0, st); err == nil {
		s.a.send(m)
	}
}

// --- thread registry on the agent ---

// Threads outlive the hub connection: a dropped WebSocket does not kill the
// coding agent, and a later thread.start for the same id re-attaches.

func (a *Agent) thread(id string) threadAdapter {
	a.threadMu.Lock()
	defer a.threadMu.Unlock()
	return a.threads[id]
}

// threadLock serialises start/stop for one thread, so two concurrent
// thread.start calls can't spawn two processes and a stop can't miss a
// process that is still starting.
func (a *Agent) threadLock(id string) *sync.Mutex {
	a.threadMu.Lock()
	defer a.threadMu.Unlock()
	l := a.threadLocks[id]
	if l == nil {
		l = &sync.Mutex{}
		a.threadLocks[id] = l
	}
	return l
}

func (a *Agent) threadStart(req protocol.ThreadStart) (protocol.ThreadStartResult, error) {
	if req.ThreadId == "" {
		return protocol.ThreadStartResult{}, fmt.Errorf("threadId required")
	}
	lock := a.threadLock(req.ThreadId)
	lock.Lock()
	defer lock.Unlock()
	if existing := a.thread(req.ThreadId); existing != nil {
		if existing.alive() {
			return protocol.ThreadStartResult{ResumeId: existing.resumeId()}, nil
		}
		existing.stop()
	}
	cwd, err := resolveCwd(req.Cwd)
	if err != nil {
		return protocol.ThreadStartResult{}, err
	}
	req.Cwd = cwd
	ad, err := newThreadAdapter(req, hubSink{a: a, threadId: req.ThreadId})
	if err != nil {
		return protocol.ThreadStartResult{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), threadStartLimit)
	defer cancel()
	resume, err := ad.start(ctx)
	if err != nil {
		ad.stop()
		return protocol.ThreadStartResult{}, err
	}
	a.threadMu.Lock()
	a.threads[req.ThreadId] = ad
	a.threadMu.Unlock()
	return protocol.ThreadStartResult{ResumeId: resume}, nil
}

// errThreadNotRunning is matched by the hub (by text) to trigger a restart.
const errThreadNotRunning = "thread not running"

func (a *Agent) runningThread(id string) (threadAdapter, error) {
	ad := a.thread(id)
	if ad == nil || !ad.alive() {
		return nil, errors.New(errThreadNotRunning)
	}
	return ad, nil
}

func (a *Agent) threadPrompt(req protocol.ThreadPrompt) error {
	ad, err := a.runningThread(req.ThreadId)
	if err != nil {
		return err
	}
	return ad.prompt(req.Text)
}

func (a *Agent) threadCancel(req protocol.ThreadRef) error {
	ad, err := a.runningThread(req.ThreadId)
	if err != nil {
		return err
	}
	return ad.cancel()
}

func (a *Agent) threadApproval(req protocol.ThreadApproval) error {
	ad, err := a.runningThread(req.ThreadId)
	if err != nil {
		return err
	}
	return ad.approve(req.ApprovalId, req.OptionId)
}

func (a *Agent) threadStop(req protocol.ThreadRef) {
	lock := a.threadLock(req.ThreadId)
	lock.Lock()
	defer lock.Unlock()
	a.threadMu.Lock()
	ad := a.threads[req.ThreadId]
	delete(a.threads, req.ThreadId)
	a.threadMu.Unlock()
	if ad != nil {
		ad.stop()
	}
}

func resolveCwd(cwd string) (string, error) {
	home, _ := os.UserHomeDir()
	switch {
	case cwd == "" || cwd == "~":
		cwd = home
	case strings.HasPrefix(cwd, "~/"):
		cwd = filepath.Join(home, cwd[2:])
	}
	cwd = filepath.Clean(cwd)
	info, err := os.Stat(cwd)
	if err != nil {
		return "", fmt.Errorf("working directory: %w", err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("working directory %s is not a directory", cwd)
	}
	return cwd, nil
}

// acpAgents maps ACP adapter ids to their CLI and candidate argument lists
// (tried in order, for CLIs whose ACP flag changed between releases).
var acpAgents = map[string]struct {
	bin  string
	args [][]string
}{
	"gemini":   {"gemini", [][]string{{"--acp"}, {"--experimental-acp"}}},
	"opencode": {"opencode", [][]string{{"acp"}}},
	"goose":    {"goose", [][]string{{"acp"}}},
	"copilot":  {"copilot", [][]string{{"--acp"}}},
	"cursor":   {"cursor-agent", [][]string{{"acp"}}},
}

func newThreadAdapter(cfg protocol.ThreadStart, sink threadSink) (threadAdapter, error) {
	switch cfg.Agent {
	case "claude":
		return newClaudeAdapter(cfg, sink), nil
	case "codex":
		return newCodexAdapter(cfg, sink), nil
	case "acp":
		words, err := splitCommandLine(cfg.Command)
		if err != nil {
			return nil, err
		}
		if len(words) == 0 {
			return nil, fmt.Errorf("command required for a custom ACP agent")
		}
		return newACPAdapter(cfg, sink, words[0], [][]string{words[1:]}), nil
	}
	spec, ok := acpAgents[cfg.Agent]
	if !ok {
		return nil, fmt.Errorf("unknown agent %q", cfg.Agent)
	}
	candidates := spec.args
	if cfg.Agent == "gemini" && cfg.Model != "" {
		candidates = nil
		for _, args := range spec.args {
			candidates = append(candidates, append(append([]string{}, args...), "--model", cfg.Model))
		}
	}
	return newACPAdapter(cfg, sink, spec.bin, candidates), nil
}

// splitCommandLine splits a command line into words, honouring single and
// double quotes and backslash escapes (no variable expansion).
func splitCommandLine(s string) ([]string, error) {
	var words []string
	var cur strings.Builder
	inWord := false
	var quote rune
	escaped := false
	for _, r := range s {
		switch {
		case escaped:
			cur.WriteRune(r)
			escaped = false
		case r == '\\' && quote != '\'':
			escaped, inWord = true, true
		case quote != 0:
			if r == quote {
				quote = 0
			} else {
				cur.WriteRune(r)
			}
		case r == '\'' || r == '"':
			quote, inWord = r, true
		case r == ' ' || r == '\t' || r == '\n':
			if inWord {
				words = append(words, cur.String())
				cur.Reset()
				inWord = false
			}
		default:
			cur.WriteRune(r)
			inWord = true
		}
	}
	if quote != 0 || escaped {
		return nil, fmt.Errorf("unterminated quote in command")
	}
	if inWord {
		words = append(words, cur.String())
	}
	return words, nil
}

// --- shared adapter state ---

// adapterBase holds what every adapter needs: message id allocation, the
// "open" streaming message, the current turn's last assistant message, and
// pending approvals.
type adapterBase struct {
	cfg  protocol.ThreadStart
	sink threadSink
	run  string // random per-process prefix so ids never collide across restarts

	started  atomic.Bool // handshake done; exits after this are reported
	stopping atomic.Bool

	mu            sync.Mutex
	seq           int
	openRole      string
	openId        string
	lastAssistant string
	turnStart     time.Time
	approvals     map[string]*pendingApproval
	resume        string
}

type pendingApproval struct {
	ch      chan string
	options []protocol.ApprovalOption
}

func newAdapterBase(cfg protocol.ThreadStart, sink threadSink) adapterBase {
	b := make([]byte, 4)
	rand.Read(b)
	return adapterBase{
		cfg:       cfg,
		sink:      sink,
		run:       hex.EncodeToString(b),
		approvals: map[string]*pendingApproval{},
		resume:    cfg.ResumeId,
	}
}

func (b *adapterBase) resumeId() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.resume
}

func (b *adapterBase) setResumeId(id string) {
	b.mu.Lock()
	changed := id != "" && id != b.resume
	if changed {
		b.resume = id
	}
	b.mu.Unlock()
	if changed {
		b.sink.state(protocol.ThreadState{ResumeId: id})
	}
}

// newId allocates a fresh message id.
func (b *adapterBase) newId(kind string) string {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.seq++
	return fmt.Sprintf("%s-%s%d", b.run, kind, b.seq)
}

// scopedId namespaces an id supplied by the agent (tool call ids etc.).
func (b *adapterBase) scopedId(kind, id string) string {
	return b.run + "-" + kind + "-" + id
}

// chunk appends streamed text to the open message of role, starting a new
// message when the role changed or something else was emitted in between.
func (b *adapterBase) chunk(role, text string) {
	if text == "" {
		return
	}
	b.mu.Lock()
	if b.openRole != role || b.openId == "" {
		b.seq++
		b.openRole = role
		b.openId = fmt.Sprintf("%s-%s%d", b.run, role[:1], b.seq)
	}
	id := b.openId
	if role == "assistant" {
		b.lastAssistant = id
	}
	b.mu.Unlock()
	b.sink.event(protocol.ThreadEvent{Id: id, Role: role, Text: text, Append: true})
}

// closeChunk ends the open streaming message.
func (b *adapterBase) closeChunk() {
	b.mu.Lock()
	b.openRole, b.openId = "", ""
	b.mu.Unlock()
}

// emit sends a complete (non-streamed) event and closes any open chunk.
func (b *adapterBase) emit(ev protocol.ThreadEvent) {
	b.mu.Lock()
	b.openRole, b.openId = "", ""
	if ev.Role == "assistant" {
		b.lastAssistant = ev.Id
	}
	b.mu.Unlock()
	if ev.Tool != nil && len(ev.Tool.Output) > toolOutputCap {
		ev.Tool.Output = truncateUTF8(ev.Tool.Output, toolOutputCap) + "\n… (output truncated)"
	}
	b.sink.event(ev)
}

func (b *adapterBase) emitError(text string) {
	b.emit(protocol.ThreadEvent{Id: b.newId("err"), Role: "error", Text: text})
}

func (b *adapterBase) setStatus(status, errText string) {
	b.sink.state(protocol.ThreadState{Status: status, Error: errText})
}

// beginTurn resets per-turn bookkeeping.
func (b *adapterBase) beginTurn() {
	b.mu.Lock()
	b.openRole, b.openId = "", ""
	b.lastAssistant = ""
	b.turnStart = time.Now()
	b.mu.Unlock()
}

// finishTurn stamps the turn's duration on its final assistant message (or a
// status message when the turn produced no text) and reports idle.
func (b *adapterBase) finishTurn(durationMs int64) {
	b.mu.Lock()
	last := b.lastAssistant
	if durationMs <= 0 && !b.turnStart.IsZero() {
		durationMs = max(time.Since(b.turnStart).Milliseconds(), 1)
	}
	b.lastAssistant = ""
	b.openRole, b.openId = "", ""
	b.mu.Unlock()
	if last != "" {
		b.sink.event(protocol.ThreadEvent{Id: last, DurationMs: durationMs})
	} else {
		b.sink.event(protocol.ThreadEvent{Id: b.newId("done"), Role: "status", Text: "Done", DurationMs: durationMs})
	}
	if !b.stopping.Load() {
		b.setStatus("idle", "")
	}
}

// askApproval surfaces an approval request and blocks until the hub answers,
// the request is cancelled (returns ""), or ctx ends.
func (b *adapterBase) askApproval(ctx context.Context, req protocol.ThreadApprovalRequest) string {
	p := &pendingApproval{ch: make(chan string, 1), options: req.Options}
	b.mu.Lock()
	b.approvals[req.Id] = p
	b.mu.Unlock()
	b.emit(protocol.ThreadEvent{Id: req.Id, Role: "approval", Approval: &req})
	b.setStatus("waiting", "")

	var choice string
	select {
	case choice = <-p.ch:
	case <-ctx.Done():
	}
	b.mu.Lock()
	delete(b.approvals, req.Id)
	remaining := len(b.approvals)
	b.mu.Unlock()

	resolved := choice
	if resolved == "" {
		resolved = "cancelled"
		for _, o := range req.Options {
			if strings.HasPrefix(o.Kind, "reject") {
				resolved = o.Id
				break
			}
		}
	}
	b.sink.event(protocol.ThreadEvent{Id: req.Id, Approval: &protocol.ThreadApprovalRequest{Id: req.Id, Resolved: resolved}})
	if remaining == 0 && choice != "" && !b.stopping.Load() {
		b.setStatus("working", "")
	}
	return choice
}

func (b *adapterBase) approve(approvalId, optionId string) error {
	b.mu.Lock()
	p := b.approvals[approvalId]
	b.mu.Unlock()
	if p == nil {
		return fmt.Errorf("no pending approval %q", approvalId)
	}
	valid := false
	for _, o := range p.options {
		if o.Id == optionId {
			valid = true
		}
	}
	if !valid {
		return fmt.Errorf("unknown option %q", optionId)
	}
	select {
	case p.ch <- optionId:
	default:
	}
	return nil
}

// cancelApprovals releases every blocked approval with "" (cancelled).
func (b *adapterBase) cancelApprovals() {
	b.mu.Lock()
	pending := make([]*pendingApproval, 0, len(b.approvals))
	for _, p := range b.approvals {
		pending = append(pending, p)
	}
	b.mu.Unlock()
	for _, p := range pending {
		select {
		case p.ch <- "":
		default:
		}
	}
}

// optionKind returns the kind of optionId among options.
func optionKind(options []protocol.ApprovalOption, optionId string) string {
	for _, o := range options {
		if o.Id == optionId {
			return o.Kind
		}
	}
	return ""
}

// watchExit reports an unexpected process exit as an error state.
func (b *adapterBase) watchExit(p *agentProcess, onExit func()) {
	go func() {
		<-p.done
		if onExit != nil {
			onExit()
		}
		b.cancelApprovals()
		if b.started.Load() && !b.stopping.Load() {
			msg := p.exitError()
			b.emitError(msg)
			b.setStatus("error", msg)
		}
	}()
}

func truncateUTF8(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && n < len(s) && (s[n]&0xC0) == 0x80 {
		n--
	}
	return s[:n]
}

// clip shortens a display string to n bytes with an ellipsis.
func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return truncateUTF8(s, n) + "…"
}

// --- loose JSON helpers (agent protocols evolve; be tolerant) ---

type jsonObj = map[string]any

func decodeObj(raw json.RawMessage) jsonObj {
	var m jsonObj
	json.Unmarshal(raw, &m)
	if m == nil {
		m = jsonObj{}
	}
	return m
}

// jStr returns the first string value found under keys.
func jStr(m jsonObj, keys ...string) string {
	for _, k := range keys {
		if s, ok := m[k].(string); ok && s != "" {
			return s
		}
	}
	return ""
}

func jObj(m jsonObj, key string) jsonObj {
	if o, ok := m[key].(map[string]any); ok {
		return o
	}
	return jsonObj{}
}

func jArr(m jsonObj, key string) []any {
	a, _ := m[key].([]any)
	return a
}

func jNum(m jsonObj, keys ...string) (float64, bool) {
	for _, k := range keys {
		if f, ok := m[k].(float64); ok {
			return f, true
		}
	}
	return 0, false
}

func jBool(m jsonObj, key string) bool {
	b, _ := m[key].(bool)
	return b
}

// compactJSON renders v as one-line JSON for display.
func compactJSON(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return string(b)
}

// --- agents.detect ---

var detectAgents = []struct{ id, bin string }{
	{"claude", "claude"},
	{"codex", "codex"},
	{"gemini", "gemini"},
	{"opencode", "opencode"},
	{"goose", "goose"},
	{"copilot", "copilot"},
	{"cursor", "cursor-agent"},
}

var versionRe = regexp.MustCompile(`\d+\.\d+(?:\.\d+)?[0-9A-Za-z.+-]*`)

func (a *Agent) detectAgents() protocol.AgentsDetectResult {
	out := make([]protocol.AgentInfo, len(detectAgents))
	var wg sync.WaitGroup
	for i, d := range detectAgents {
		out[i] = protocol.AgentInfo{Id: d.id}
		path, err := exec.LookPath(d.bin)
		if err != nil {
			continue
		}
		out[i].Installed = true
		wg.Add(1)
		go func(i int, path string) {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, path, "--version")
			cmd.Env = agentEnv()
			b, _ := cmd.Output()
			out[i].Version = versionRe.FindString(string(b))
		}(i, path)
	}
	wg.Wait()
	// A custom ACP command line can always be attempted.
	out = append(out, protocol.AgentInfo{Id: "acp", Installed: true})
	return protocol.AgentsDetectResult{Agents: out}
}
