package hub

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/gorilla/websocket"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// Agent threads: the hub stores each thread and its folded messages, starts
// and resumes the coding agent on the device, and pushes changes to browsers.

// agentKind describes one adapter the device agent can drive.
type agentKind struct {
	Id       string   `json:"id"`
	Name     string   `json:"name"`
	Protocol string   `json:"protocol"` // native | acp
	Models   []string `json:"models,omitempty"`
}

var agentKinds = []agentKind{
	{Id: "claude", Name: "Claude Code", Protocol: "native", Models: []string{"sonnet", "opus", "haiku"}},
	{Id: "codex", Name: "Codex", Protocol: "native"},
	{Id: "gemini", Name: "Gemini CLI", Protocol: "acp"},
	{Id: "opencode", Name: "OpenCode", Protocol: "acp"},
	{Id: "goose", Name: "Goose", Protocol: "acp"},
	{Id: "copilot", Name: "GitHub Copilot", Protocol: "acp"},
	{Id: "cursor", Name: "Cursor Agent", Protocol: "acp"},
	{Id: "acp", Name: "Custom ACP agent", Protocol: "acp"},
}

func validAgentKind(id string) bool {
	for _, k := range agentKinds {
		if k.Id == id {
			return true
		}
	}
	return false
}

func validAccess(a string) bool {
	return a == "ask" || a == "edits" || a == "auto" || a == "full"
}

const (
	maxPromptBytes   = 256 * 1024
	threadsDebounce  = 500 * time.Millisecond
	threadStartWait  = 120 * time.Second
	threadPromptWait = 60 * time.Second
	errNotRunning    = "thread not running" // matches the agent's error text
)

// threadRuntime is the hub's in-memory view of one thread's agent process.
type threadRuntime struct {
	mu       sync.Mutex  // serialises start/prompt delivery
	conn     *agentConn  // connection the agent process was started over
	restart  atomic.Bool // access/model changed: restart before the next prompt
	deviceId string      // owner, cached so events can be checked cheaply

	tmu     sync.Mutex
	turn    string // id of the latest user message
	turnSet bool
}

type threadSub struct {
	ch   chan []byte
	kick chan struct{} // closed when the subscriber fell behind
	once sync.Once
}

type threadService struct {
	s *Server

	mu       sync.Mutex
	runtimes map[string]*threadRuntime
	subs     map[string]map[*threadSub]struct{}
	lastPub  map[string]time.Time
	timers   map[string]*time.Timer
}

func newThreadService(s *Server) *threadService {
	return &threadService{
		s:        s,
		runtimes: map[string]*threadRuntime{},
		subs:     map[string]map[*threadSub]struct{}{},
		lastPub:  map[string]time.Time{},
		timers:   map[string]*time.Timer{},
	}
}

func (ts *threadService) runtime(id string) *threadRuntime {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	rt := ts.runtimes[id]
	if rt == nil {
		rt = &threadRuntime{}
		ts.runtimes[id] = rt
	}
	return rt
}

// currentTurn returns the latest user message id, loading it once from the store.
func (ts *threadService) currentTurn(id string) string {
	rt := ts.runtime(id)
	rt.tmu.Lock()
	defer rt.tmu.Unlock()
	if !rt.turnSet {
		rt.turn, _ = ts.s.store.LastUserMessageId(id)
		rt.turnSet = true
	}
	return rt.turn
}

// --- browser push ---

func (ts *threadService) subscribe(id string) *threadSub {
	sub := &threadSub{ch: make(chan []byte, 256), kick: make(chan struct{})}
	ts.mu.Lock()
	if ts.subs[id] == nil {
		ts.subs[id] = map[*threadSub]struct{}{}
	}
	ts.subs[id][sub] = struct{}{}
	ts.mu.Unlock()
	return sub
}

func (ts *threadService) unsubscribe(id string, sub *threadSub) {
	ts.mu.Lock()
	delete(ts.subs[id], sub)
	if len(ts.subs[id]) == 0 {
		delete(ts.subs, id)
	}
	ts.mu.Unlock()
}

// push sends a payload to every browser watching the thread. A subscriber
// that can't keep up is disconnected (it re-snapshots on reconnect) rather
// than silently missing a message.
func (ts *threadService) push(id string, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	ts.mu.Lock()
	defer ts.mu.Unlock()
	for sub := range ts.subs[id] {
		select {
		case sub.ch <- b:
		default:
			sub.once.Do(func() { close(sub.kick) })
		}
	}
}

func (ts *threadService) pushMessage(id string, m *ThreadMessage) {
	ts.push(id, map[string]any{"type": "message", "message": m})
}

// pushThread re-reads the thread and sends it to watchers, then announces
// the change on the events bus (debounced).
func (ts *threadService) pushThread(id string) {
	if t, err := ts.s.store.ThreadById(id); err == nil && t != nil {
		ts.push(id, map[string]any{"type": "thread", "thread": t})
	}
	ts.changed(id, false)
}

// changed publishes threads.changed, at most once per threadsDebounce per
// thread with a trailing publish so the final state always goes out.
func (ts *threadService) changed(id string, immediate bool) {
	publish := func() { ts.s.events.publish(event{Type: "threads.changed", ThreadId: id}) }
	ts.mu.Lock()
	defer ts.mu.Unlock()
	if immediate {
		if t := ts.timers[id]; t != nil {
			t.Stop()
			delete(ts.timers, id)
		}
		ts.lastPub[id] = time.Now()
		go publish()
		return
	}
	if ts.timers[id] != nil {
		return // a trailing publish is already scheduled
	}
	since := time.Since(ts.lastPub[id])
	if since >= threadsDebounce {
		ts.lastPub[id] = time.Now()
		go publish()
		return
	}
	ts.timers[id] = time.AfterFunc(threadsDebounce-since, func() {
		ts.mu.Lock()
		delete(ts.timers, id)
		ts.lastPub[id] = time.Now()
		ts.mu.Unlock()
		publish()
	})
}

// forget drops all in-memory state for a deleted thread.
func (ts *threadService) forget(id string) {
	ts.mu.Lock()
	for sub := range ts.subs[id] {
		sub.once.Do(func() { close(sub.kick) })
	}
	delete(ts.subs, id)
	delete(ts.runtimes, id)
	if t := ts.timers[id]; t != nil {
		t.Stop()
		delete(ts.timers, id)
	}
	delete(ts.lastPub, id)
	ts.mu.Unlock()
}

// --- state changes ---

func (ts *threadService) setStatus(id, status, errText string) {
	if err := ts.s.store.SetThreadStatus(id, status, errText); err != nil {
		log.Printf("thread %s: set status: %v", id, err)
		return
	}
	ts.pushThread(id)
}

// appendEvent folds one event into the store and pushes the result.
func (ts *threadService) appendEvent(id string, ev protocol.ThreadEvent) *ThreadMessage {
	now := time.Now()
	msg, err := ts.s.store.ApplyThreadEvent(id, ev, ts.currentTurn(id), now)
	if err != nil {
		if err != errThreadGone {
			log.Printf("thread %s: storing event: %v", id, err)
		}
		return nil
	}
	ts.pushMessage(id, msg)
	if bumped, _ := ts.s.store.TouchThread(id, now.Unix()); bumped {
		ts.pushThread(id)
	}
	return msg
}

// recordUser stores a user prompt and makes it the current turn.
func (ts *threadService) recordUser(id, text string) {
	msgId := "u-" + randomToken()[:12]
	rt := ts.runtime(id)
	rt.tmu.Lock()
	rt.turn, rt.turnSet = msgId, true
	rt.tmu.Unlock()
	ts.appendEvent(id, protocol.ThreadEvent{Id: msgId, Role: "user", Text: text})
}

// ownedBy reports whether thread id belongs to deviceId (events from other
// devices are dropped so one machine can't write into another's threads).
func (ts *threadService) ownedBy(id, deviceId string) bool {
	ts.mu.Lock()
	rt := ts.runtimes[id]
	ts.mu.Unlock()
	if rt != nil {
		rt.tmu.Lock()
		cached := rt.deviceId
		rt.tmu.Unlock()
		if cached != "" {
			return cached == deviceId
		}
	}
	// Only known threads get a runtime, so a device can't grow the map with
	// made-up ids.
	t, err := ts.s.store.ThreadById(id)
	if err != nil || t == nil {
		return false
	}
	rt = ts.runtime(id)
	rt.tmu.Lock()
	rt.deviceId = t.DeviceId
	rt.tmu.Unlock()
	return t.DeviceId == deviceId
}

// onAgentEvent handles a thread.event notification from a device.
func (ts *threadService) onAgentEvent(c *agentConn, data json.RawMessage) {
	var m protocol.ThreadEventMsg
	if json.Unmarshal(data, &m) != nil || m.ThreadId == "" || m.Event.Id == "" {
		return
	}
	if !ts.ownedBy(m.ThreadId, c.deviceId) {
		return
	}
	ts.appendEvent(m.ThreadId, m.Event)
}

// onAgentState handles a thread.state notification from a device.
func (ts *threadService) onAgentState(c *agentConn, data json.RawMessage) {
	var st protocol.ThreadState
	if json.Unmarshal(data, &st) != nil || st.ThreadId == "" {
		return
	}
	if !ts.ownedBy(st.ThreadId, c.deviceId) {
		return
	}
	store := ts.s.store
	if st.ResumeId != "" {
		store.SetThreadResumeId(st.ThreadId, st.ResumeId)
	}
	if st.Usage != nil {
		store.SetThreadUsage(st.ThreadId, *st.Usage)
	}
	if st.Status != "" {
		store.SetThreadStatus(st.ThreadId, st.Status, st.Error)
	}
	if st.Status != "" || st.Usage != nil {
		ts.pushThread(st.ThreadId)
	}
}

// --- driving the device agent ---

// startOn sends thread.start for t over c, resuming the agent's own session
// when one is stored.
func (ts *threadService) startOn(t *Thread, c *agentConn) error {
	if t.Status != "starting" {
		ts.setStatus(t.Id, "starting", "")
	}
	ctx, cancel := contextWithTimeout(threadStartWait)
	defer cancel()
	var res protocol.ThreadStartResult
	err := c.requestInto(ctx, protocol.TypeThreadStart, protocol.ThreadStart{
		ThreadId:   t.Id,
		Agent:      t.Agent,
		Command:    t.Command,
		Cwd:        t.Cwd,
		Model:      t.Model,
		Access:     t.Access,
		ResumeId:   t.ResumeId,
		McpServers: ts.s.agentMcpServers(),
	}, &res)
	if err != nil {
		return err
	}
	if res.ResumeId != "" && res.ResumeId != t.ResumeId {
		ts.s.store.SetThreadResumeId(t.Id, res.ResumeId)
		t.ResumeId = res.ResumeId
	}
	ts.ensureTerminal(t, c)
	return nil
}

// ensureTerminal gives the thread a tmux shell in its cwd for the Shell tab.
func (ts *threadService) ensureTerminal(t *Thread, c *agentConn) {
	if t.Terminal != "" || !c.hello.Tmux {
		return
	}
	name := "thread-" + t.Id[:8]
	req := protocol.SessionCreate{Name: name, Kind: "shell"}
	if strings.HasPrefix(t.Cwd, "/") {
		req.Cwd = t.Cwd
	}
	ctx, cancel := deviceCtx()
	defer cancel()
	if err := c.requestInto(ctx, protocol.TypeSessionCreate, req, nil); err != nil && !strings.Contains(err.Error(), "duplicate") {
		return
	}
	if ts.s.store.SetThreadTerminal(t.Id, name) == nil {
		t.Terminal = name
		ts.s.events.publish(event{Type: "sessions.changed", DeviceId: c.deviceId})
	}
}

// deliver makes sure the thread's agent is running and hands it the prompt.
func (ts *threadService) deliver(id, text string) {
	rt := ts.runtime(id)
	rt.mu.Lock()
	defer rt.mu.Unlock()

	t, err := ts.s.store.ThreadById(id)
	if err != nil || t == nil {
		return
	}
	c := ts.s.registry.get(t.DeviceId)
	if c == nil {
		ts.setStatus(id, "error", "device is offline")
		return
	}
	if rt.restart.Swap(false) && rt.conn != nil {
		ctx, cancel := deviceCtx()
		c.requestInto(ctx, protocol.TypeThreadStop, protocol.ThreadRef{ThreadId: id}, nil)
		cancel()
		rt.conn = nil
	}
	for attempt := 0; attempt < 2; attempt++ {
		if rt.conn != c {
			err := ts.startOn(t, c)
			if err != nil && t.ResumeId != "" && ts.s.registry.get(t.DeviceId) == c &&
				!strings.Contains(err.Error(), "disconnected") && !errors.Is(err, context.DeadlineExceeded) {
				// The agent's saved session may be gone (expired, other
				// machine, CLI reinstalled): fall back to a fresh one.
				t.ResumeId = ""
				ts.s.store.SetThreadResumeId(id, "")
				if err = ts.startOn(t, c); err == nil {
					ts.appendEvent(id, protocol.ThreadEvent{Id: "s-" + randomToken()[:12], Role: "status",
						Text: "Could not resume the previous agent session; started a new one."})
				}
			}
			if err != nil {
				ts.appendEvent(id, protocol.ThreadEvent{Id: "e-" + randomToken()[:12], Role: "error", Text: err.Error()})
				ts.setStatus(id, "error", err.Error())
				return
			}
			rt.conn = c
		}
		// Mark working before the agent can possibly report idle.
		ts.setStatus(id, "working", "")
		ctx, cancel := contextWithTimeout(threadPromptWait)
		err := c.requestInto(ctx, protocol.TypeThreadPrompt, protocol.ThreadPrompt{ThreadId: id, Text: text}, nil)
		cancel()
		if err == nil {
			return
		}
		if strings.Contains(err.Error(), errNotRunning) {
			rt.conn = nil // agent process is gone: restart (resuming) and retry once
			t, _ = ts.s.store.ThreadById(id)
			if t == nil {
				return
			}
			continue
		}
		ts.appendEvent(id, protocol.ThreadEvent{Id: "e-" + randomToken()[:12], Role: "error", Text: err.Error()})
		ts.setStatus(id, "error", err.Error())
		return
	}
}

// --- creation (shared by the API and automations) ---

type threadInput struct {
	DeviceId     string `json:"deviceId"`
	Agent        string `json:"agent"`
	Command      string `json:"command"`
	Cwd          string `json:"cwd"`
	Prompt       string `json:"prompt"`
	Model        string `json:"model"`
	Access       string `json:"access"`
	Title        string `json:"title"`
	AutomationId string `json:"-"`
}

// validate normalises in and returns a user-facing problem, if any.
func (in *threadInput) validate() string {
	in.DeviceId = strings.TrimSpace(in.DeviceId)
	in.Agent = strings.TrimSpace(in.Agent)
	in.Command = strings.TrimSpace(in.Command)
	in.Cwd = strings.TrimSpace(in.Cwd)
	in.Model = strings.TrimSpace(in.Model)
	in.Title = strings.TrimSpace(in.Title)
	if in.Access == "" {
		in.Access = "edits"
	}
	switch {
	case in.DeviceId == "":
		return "deviceId is required"
	case !validAgentKind(in.Agent):
		return "unknown agent"
	case in.Agent == "acp" && in.Command == "":
		return "command is required for a custom ACP agent"
	case strings.TrimSpace(in.Prompt) == "":
		return "prompt is required"
	case len(in.Prompt) > maxPromptBytes:
		return "prompt is too long"
	case !validAccess(in.Access):
		return "access must be ask, edits, auto or full"
	case len(in.Cwd) > maxProjectPath || strings.ContainsRune(in.Cwd, 0):
		return "cwd is invalid"
	}
	if in.Agent != "acp" {
		in.Command = ""
	}
	return ""
}

// titleFromPrompt uses the first ~60 characters of the first line.
func titleFromPrompt(prompt string) string {
	line := strings.TrimSpace(prompt)
	if i := strings.IndexByte(line, '\n'); i >= 0 {
		line = strings.TrimSpace(line[:i])
	}
	if utf8.RuneCountInString(line) <= 60 {
		return line
	}
	r := []rune(line)
	cut := strings.TrimSpace(string(r[:60]))
	if i := strings.LastIndexByte(cut, ' '); i > 30 {
		cut = cut[:i]
	}
	return cut + "…"
}

// createThread stores a new thread, records the prompt and starts delivery
// in the background.
func (s *Server) createThread(in threadInput) (*Thread, error) {
	now := time.Now().Unix()
	title := in.Title
	if title == "" {
		title = titleFromPrompt(in.Prompt)
	}
	t := &Thread{
		Id: randomToken()[:16], Title: title, DeviceId: in.DeviceId, Agent: in.Agent, Command: in.Command,
		Cwd: in.Cwd, Model: in.Model, Access: in.Access, Status: "starting",
		CreatedAt: now, UpdatedAt: now, LastReadAt: now, AutomationId: in.AutomationId,
	}
	if err := s.store.CreateThread(t); err != nil {
		return nil, err
	}
	s.threads.recordUser(t.Id, in.Prompt)
	s.threads.changed(t.Id, true)
	go s.threads.deliver(t.Id, in.Prompt)
	stored, err := s.store.ThreadById(t.Id)
	if err != nil || stored == nil {
		return t, err
	}
	return stored, nil
}

// --- HTTP ---

func (s *Server) handleListThreads(w http.ResponseWriter, r *http.Request) {
	threads, err := s.store.ListThreads()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, threads)
}

func (s *Server) handleCreateThread(w http.ResponseWriter, r *http.Request) {
	var in threadInput
	if err := readJSON(r, &in); err != nil {
		httpError(w, http.StatusBadRequest, "invalid thread")
		return
	}
	if msg := in.validate(); msg != "" {
		httpError(w, http.StatusBadRequest, msg)
		return
	}
	if !s.validateProjectDevice(w, in.DeviceId) {
		return
	}
	if s.registry.get(in.DeviceId) == nil {
		httpError(w, http.StatusServiceUnavailable, "device is offline")
		return
	}
	s.rememberPublicURL(r)
	t, err := s.createThread(in)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, t)
}

// threadFromPath loads the {id} thread or writes a 404.
func (s *Server) threadFromPath(w http.ResponseWriter, r *http.Request) *Thread {
	t, err := s.store.ThreadById(r.PathValue("id"))
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return nil
	}
	if t == nil {
		httpError(w, http.StatusNotFound, "thread not found")
		return nil
	}
	return t
}

func (s *Server) handleGetThread(w http.ResponseWriter, r *http.Request) {
	t := s.threadFromPath(w, r)
	if t == nil {
		return
	}
	messages, err := s.store.ThreadMessages(t.Id)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, map[string]any{"thread": t, "messages": messages})
}

func (s *Server) handlePatchThread(w http.ResponseWriter, r *http.Request) {
	t := s.threadFromPath(w, r)
	if t == nil {
		return
	}
	var p threadPatch
	if err := readJSON(r, &p); err != nil {
		httpError(w, http.StatusBadRequest, "invalid patch")
		return
	}
	if p.Title != nil {
		title := strings.TrimSpace(*p.Title)
		if title == "" || len(title) > 200 {
			httpError(w, http.StatusBadRequest, "title must be 1-200 characters")
			return
		}
		p.Title = &title
	}
	if p.Access != nil && !validAccess(*p.Access) {
		httpError(w, http.StatusBadRequest, "access must be ask, edits, auto or full")
		return
	}
	if p.Model != nil {
		model := strings.TrimSpace(*p.Model)
		p.Model = &model
	}
	if err := s.store.PatchThread(t.Id, p); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Access and model are command-line/session settings: apply them by
	// restarting (and resuming) the agent before the next prompt.
	if (p.Access != nil && *p.Access != t.Access) || (p.Model != nil && *p.Model != t.Model) {
		s.threads.runtime(t.Id).restart.Store(true)
	}
	updated, err := s.store.ThreadById(t.Id)
	if err != nil || updated == nil {
		httpError(w, http.StatusInternalServerError, "thread vanished")
		return
	}
	s.threads.push(t.Id, map[string]any{"type": "thread", "thread": updated})
	s.threads.changed(t.Id, true)
	writeJSON(w, updated)
}

func (s *Server) handleDeleteThread(w http.ResponseWriter, r *http.Request) {
	t := s.threadFromPath(w, r)
	if t == nil {
		return
	}
	if c := s.registry.get(t.DeviceId); c != nil {
		ctx, cancel := contextWithTimeout(10 * time.Second)
		c.requestInto(ctx, protocol.TypeThreadStop, protocol.ThreadRef{ThreadId: t.Id}, nil)
		if t.Terminal != "" {
			c.requestInto(ctx, protocol.TypeSessionKill, protocol.SessionKill{Name: t.Terminal}, nil)
			s.events.publish(event{Type: "sessions.changed", DeviceId: c.deviceId})
		}
		cancel()
	}
	if err := s.store.DeleteThread(t.Id); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.threads.forget(t.Id)
	s.events.publish(event{Type: "threads.changed", ThreadId: t.Id})
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) handleThreadPrompt(w http.ResponseWriter, r *http.Request) {
	t := s.threadFromPath(w, r)
	if t == nil {
		return
	}
	var req struct {
		Text string `json:"text"`
	}
	if err := readJSON(r, &req); err != nil || strings.TrimSpace(req.Text) == "" {
		httpError(w, http.StatusBadRequest, "text is required")
		return
	}
	if len(req.Text) > maxPromptBytes {
		httpError(w, http.StatusBadRequest, "prompt is too long")
		return
	}
	if s.registry.get(t.DeviceId) == nil {
		httpError(w, http.StatusServiceUnavailable, "device is offline")
		return
	}
	s.rememberPublicURL(r)
	s.threads.recordUser(t.Id, req.Text)
	go s.threads.deliver(t.Id, req.Text)
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) handleThreadCancel(w http.ResponseWriter, r *http.Request) {
	t := s.threadFromPath(w, r)
	if t == nil {
		return
	}
	c := s.registry.get(t.DeviceId)
	if c == nil {
		httpError(w, http.StatusServiceUnavailable, "device is offline")
		return
	}
	ctx, cancel := deviceCtx()
	defer cancel()
	err := c.requestInto(ctx, protocol.TypeThreadCancel, protocol.ThreadRef{ThreadId: t.Id}, nil)
	if err != nil && !strings.Contains(err.Error(), errNotRunning) {
		httpError(w, http.StatusBadGateway, err.Error())
		return
	}
	if err != nil {
		// Nothing is running, so there's nothing to wait for.
		s.threads.setStatus(t.Id, "idle", "")
	}
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) handleThreadApproval(w http.ResponseWriter, r *http.Request) {
	t := s.threadFromPath(w, r)
	if t == nil {
		return
	}
	var req struct {
		ApprovalId string `json:"approvalId"`
		OptionId   string `json:"optionId"`
	}
	if err := readJSON(r, &req); err != nil || req.ApprovalId == "" || req.OptionId == "" {
		httpError(w, http.StatusBadRequest, "approvalId and optionId are required")
		return
	}
	c := s.registry.get(t.DeviceId)
	if c == nil {
		httpError(w, http.StatusServiceUnavailable, "device is offline")
		return
	}
	ctx, cancel := deviceCtx()
	defer cancel()
	err := c.requestInto(ctx, protocol.TypeThreadApproval,
		protocol.ThreadApproval{ThreadId: t.Id, ApprovalId: req.ApprovalId, OptionId: req.OptionId}, nil)
	if err != nil {
		httpError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) handleAgentKinds(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, agentKinds)
}

func (s *Server) handleDeviceAgents(w http.ResponseWriter, r *http.Request) {
	c := s.deviceConn(w, r)
	if c == nil {
		return
	}
	ctx, cancel := contextWithTimeout(20 * time.Second)
	defer cancel()
	var res protocol.AgentsDetectResult
	if err := c.requestInto(ctx, protocol.TypeAgentsDetect, struct{}{}, &res); err != nil {
		httpError(w, http.StatusBadGateway, err.Error())
		return
	}
	if res.Agents == nil {
		res.Agents = []protocol.AgentInfo{}
	}
	writeJSON(w, res.Agents)
}

// handleThreadWS streams one thread: a snapshot, then every changed message
// and thread record.
func (s *Server) handleThreadWS(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	t, err := s.store.ThreadById(id)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if t == nil {
		httpError(w, http.StatusNotFound, "thread not found")
		return
	}
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer ws.Close()

	// Subscribe before reading the snapshot so nothing falls in between;
	// duplicates are harmless because messages are full folded records.
	sub := s.threads.subscribe(id)
	defer s.threads.unsubscribe(id, sub)
	if t, err = s.store.ThreadById(id); err != nil || t == nil {
		return
	}
	messages, err := s.store.ThreadMessages(id)
	if err != nil {
		return
	}
	write := func(msgType int, b []byte) error {
		ws.SetWriteDeadline(time.Now().Add(15 * time.Second))
		return ws.WriteMessage(msgType, b)
	}
	snap, _ := json.Marshal(map[string]any{"type": "snapshot", "thread": t, "messages": messages})
	if err := write(websocket.TextMessage, snap); err != nil {
		return
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			if _, _, err := ws.ReadMessage(); err != nil {
				return
			}
		}
	}()
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case b := <-sub.ch:
			if err := write(websocket.TextMessage, b); err != nil {
				return
			}
		case <-sub.kick:
			return
		case <-ticker.C:
			if err := write(websocket.PingMessage, nil); err != nil {
				return
			}
		case <-done:
			return
		}
	}
}

// resetInterruptedThreads runs at startup: anything mid-turn when the hub
// went down is shown as stopped and resumes on the next prompt.
func (s *Server) resetInterruptedThreads() {
	if err := s.store.ResetInterruptedThreads(); err != nil {
		log.Printf("threads: %v", err)
	}
}
