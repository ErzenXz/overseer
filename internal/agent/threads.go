package agent

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
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
	// prompt begins a turn (or steers the running one, where the agent can)
	// and returns once the agent has accepted it.
	prompt(p promptInput) error
	cancel() error
	approve(approvalId, optionId string) error
	answer(questionId string, answers []string, text string) error
	// compact summarises the conversation to free context; undo drops the
	// last turn. Both return a notSupported error where the CLI lacks it.
	compact() error
	undo() error
	stop()
	alive() bool
	resumeId() string
	// update applies changed settings to the running process where the CLI
	// allows it; it reports whether a restart (with resume) is still needed.
	update(s threadSettings) (restart bool)
}

// threadSettings are the per-thread choices that can change mid-session.
type threadSettings struct {
	Model  string
	Effort string
	Fast   bool
	Mode   string // agent-native mode id; empty = derive from Access
	Access string
}

// promptInput is one user prompt as the adapters see it.
type promptInput struct {
	Text      string
	MessageId string // hub user message id (Codex clientUserMessageId)
	Images    []promptImage
}

type promptImage struct {
	Path string
	Mime string
	Data []byte
}

const (
	maxPromptImages    = 10
	maxPromptImageSize = 20 * 1024 * 1024
)

var imageTypes = map[string]string{
	".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
}

// loadPromptImages reads image files for a prompt. Relative paths resolve
// against cwd; only files under cwd or the home directory are allowed.
func loadPromptImages(cwd string, paths []string) ([]promptImage, error) {
	if len(paths) > maxPromptImages {
		return nil, fmt.Errorf("at most %d images per prompt", maxPromptImages)
	}
	home, _ := os.UserHomeDir()
	var out []promptImage
	for _, p := range paths {
		if !filepath.IsAbs(p) {
			p = filepath.Join(cwd, p)
		}
		p = filepath.Clean(p)
		if !pathWithin(p, cwd) && !pathWithin(p, home) {
			return nil, fmt.Errorf("image outside the working directory and home: %s", p)
		}
		mime := imageTypes[strings.ToLower(filepath.Ext(p))]
		if mime == "" {
			return nil, fmt.Errorf("unsupported image type: %s", filepath.Base(p))
		}
		info, err := os.Stat(p)
		if err != nil {
			return nil, fmt.Errorf("image: %w", err)
		}
		if !info.Mode().IsRegular() || info.Size() > maxPromptImageSize {
			return nil, fmt.Errorf("image %s is not a regular file under %d MB", filepath.Base(p), maxPromptImageSize>>20)
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return nil, fmt.Errorf("image: %w", err)
		}
		out = append(out, promptImage{Path: p, Mime: mime, Data: data})
	}
	return out, nil
}

func pathWithin(p, base string) bool {
	if base == "" {
		return false
	}
	rel, err := filepath.Rel(base, p)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// notSupported is the error for a feature agent's CLI lacks (409 at the hub).
func notSupported(feature, agent string) error {
	return fmt.Errorf("%s %s %s", feature, protocol.ErrNotSupported, agent)
}

func settingsOf(cfg protocol.ThreadStart) threadSettings {
	return threadSettings{Model: cfg.Model, Effort: cfg.Effort, Fast: cfg.Fast, Mode: cfg.Mode, Access: cfg.Access}
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
	res := protocol.ThreadStartResult{ResumeId: resume}
	if f, ok := ad.(interface{ forkedFresh() bool }); ok {
		res.ForkFallback = f.forkedFresh()
	}
	return res, nil
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
	in := promptInput{Text: req.Text, MessageId: req.MessageId}
	if len(req.Images) > 0 {
		cwd := ""
		if b, ok := ad.(interface{ workDir() string }); ok {
			cwd = b.workDir()
		}
		if in.Images, err = loadPromptImages(cwd, req.Images); err != nil {
			return err
		}
	}
	return ad.prompt(in)
}

func (a *Agent) threadAnswer(req protocol.ThreadAnswer) error {
	ad, err := a.runningThread(req.ThreadId)
	if err != nil {
		return err
	}
	return ad.answer(req.QuestionId, req.Answers, req.Text)
}

func (a *Agent) threadCompact(req protocol.ThreadRef) error {
	ad, err := a.runningThread(req.ThreadId)
	if err != nil {
		return err
	}
	return ad.compact()
}

func (a *Agent) threadUndo(req protocol.ThreadRef) error {
	ad, err := a.runningThread(req.ThreadId)
	if err != nil {
		return err
	}
	return ad.undo()
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

func (a *Agent) threadUpdate(req protocol.ThreadUpdate) (protocol.ThreadUpdateResult, error) {
	ad, err := a.runningThread(req.ThreadId)
	if err != nil {
		return protocol.ThreadUpdateResult{}, err
	}
	restart := ad.update(threadSettings{Model: req.Model, Effort: req.Effort, Fast: req.Fast, Mode: req.Mode, Access: req.Access})
	return protocol.ThreadUpdateResult{Restart: restart}, nil
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

// acpAgents maps the built-in ACP adapter ids to their CLI and candidate
// argument lists (tried in order, for CLIs whose ACP flag changed between
// releases). Other catalog agents arrive with their launch command.
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

// nativeAgents have their own adapters instead of ACP.
var nativeAgents = map[string]bool{"claude": true, "codex": true}

// acpLaunch resolves an ACP agent to its CLI and candidate argument lists:
// built-in ids use their own table; "acp" and any other (catalog) id run the
// command the hub sent.
func acpLaunch(agent, command string) (string, [][]string, error) {
	if spec, ok := acpAgents[agent]; ok {
		return spec.bin, spec.args, nil
	}
	if nativeAgents[agent] {
		return "", nil, fmt.Errorf("%s is not an ACP agent", agent)
	}
	if strings.TrimSpace(command) == "" {
		if agent == "acp" {
			return "", nil, fmt.Errorf("command required for a custom ACP agent")
		}
		return "", nil, fmt.Errorf("unknown agent %q", agent)
	}
	words, err := splitCommandLine(command)
	if err != nil {
		return "", nil, err
	}
	if len(words) == 0 {
		return "", nil, fmt.Errorf("command required for a custom ACP agent")
	}
	return words[0], [][]string{words[1:]}, nil
}

func newThreadAdapter(cfg protocol.ThreadStart, sink threadSink) (threadAdapter, error) {
	switch cfg.Agent {
	case "claude":
		return newClaudeAdapter(cfg, sink), nil
	case "codex":
		return newCodexAdapter(cfg, sink), nil
	}
	bin, candidates, err := acpLaunch(cfg.Agent, cfg.Command)
	if err != nil {
		return nil, err
	}
	if cfg.Agent == "gemini" && cfg.Model != "" {
		withModel := make([][]string, 0, len(candidates))
		for _, args := range candidates {
			withModel = append(withModel, append(append([]string{}, args...), "--model", cfg.Model))
		}
		candidates = withModel
	}
	return newACPAdapter(cfg, sink, bin, candidates), nil
}

// splitCommandLine splits a command line into words (see
// protocol.SplitCommandLine).
func splitCommandLine(s string) ([]string, error) { return protocol.SplitCommandLine(s) }

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
	questions     map[string]*pendingQuestion
	resume        string
	set           threadSettings // current settings (updated live by update)
	forkFallback  bool           // a fork was asked for but a fresh session started
}

func (b *adapterBase) forkedFresh() bool { return b.forkFallback }

type pendingQuestion struct {
	ch       chan questionReply
	canceled chan struct{}
	once     sync.Once
	q        protocol.ThreadQuestion
}

type questionReply struct {
	answers []string
	text    string
}

func (b *adapterBase) workDir() string { return b.cfg.Cwd }

// publishMeta reports the running agent's capabilities and commands.
func (b *adapterBase) publishMeta(caps protocol.ThreadCapabilities, commands []protocol.AgentCommand) {
	b.sink.state(protocol.ThreadState{Capabilities: &caps, Commands: commands})
}

// askQuestion surfaces a question and blocks until the hub answers (ok) or
// the request is cancelled / ctx ends.
func (b *adapterBase) askQuestion(ctx context.Context, q protocol.ThreadQuestion) (answers []string, text string, ok bool) {
	if q.Options == nil {
		q.Options = []protocol.QuestionOption{}
	}
	p := &pendingQuestion{ch: make(chan questionReply, 1), canceled: make(chan struct{}), q: q}
	b.mu.Lock()
	b.questions[q.Id] = p
	b.mu.Unlock()
	b.emit(protocol.ThreadEvent{Id: q.Id, Role: "question", Text: q.Text, Question: &q})
	b.setStatus("waiting", "")

	var reply questionReply
	select {
	case reply = <-p.ch:
		ok = true
	case <-p.canceled:
	case <-ctx.Done():
	}
	b.mu.Lock()
	delete(b.questions, q.Id)
	remaining := len(b.questions) + len(b.approvals)
	b.mu.Unlock()
	answered := append([]string{}, reply.answers...)
	if reply.text != "" {
		answered = append(answered, reply.text)
	}
	if !ok {
		answered = []string{"(cancelled)"}
	}
	b.sink.event(protocol.ThreadEvent{Id: q.Id, Question: &protocol.ThreadQuestion{Id: q.Id, Answered: answered}})
	if remaining == 0 && ok && !b.stopping.Load() {
		b.setStatus("working", "")
	}
	return reply.answers, reply.text, ok
}

func (b *adapterBase) answer(questionId string, answers []string, text string) error {
	b.mu.Lock()
	p := b.questions[questionId]
	b.mu.Unlock()
	if p == nil {
		return fmt.Errorf("no pending question %q", questionId)
	}
	valid := map[string]bool{}
	for _, o := range p.q.Options {
		valid[o.Id] = true
	}
	for _, a := range answers {
		if !valid[a] {
			return fmt.Errorf("unknown option %q", a)
		}
	}
	if len(answers) > 1 && !p.q.Multiple {
		return fmt.Errorf("question takes one answer")
	}
	if text != "" && !p.q.AllowText {
		return fmt.Errorf("question does not take free text")
	}
	if len(answers) == 0 && text == "" {
		return fmt.Errorf("answer required")
	}
	select {
	case p.ch <- questionReply{answers: answers, text: text}:
	default:
	}
	return nil
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
		questions: map[string]*pendingQuestion{},
		resume:    cfg.ResumeId,
		set:       settingsOf(cfg),
	}
}

func (b *adapterBase) settings() threadSettings {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.set
}

func (b *adapterBase) setSettings(s threadSettings) {
	b.mu.Lock()
	b.set = s
	b.mu.Unlock()
}

// fullAccess reports whether permission prompts are auto-approved.
func (b *adapterBase) fullAccess() bool { return b.settings().Access == "full" }

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

// cancelApprovals releases every blocked approval with "" (cancelled) and
// every pending question as unanswered.
func (b *adapterBase) cancelApprovals() {
	b.mu.Lock()
	pending := make([]*pendingApproval, 0, len(b.approvals))
	for _, p := range b.approvals {
		pending = append(pending, p)
	}
	questions := make([]*pendingQuestion, 0, len(b.questions))
	for _, q := range b.questions {
		questions = append(questions, q)
	}
	b.mu.Unlock()
	for _, p := range pending {
		select {
		case p.ch <- "":
		default:
		}
	}
	for _, q := range questions {
		q.once.Do(func() { close(q.canceled) })
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
