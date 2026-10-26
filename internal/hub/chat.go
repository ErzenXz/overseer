package hub

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// Chat apps: answer agents from Telegram, Slack and Discord, and send events
// to a webhook. The hub dials out to every service (long polling, Socket
// Mode, the Discord gateway), so no public URL is needed.
//
// Flow: the thread code calls onMessage / onThread (two one-line hooks). The
// manager turns an approval or question into one chatPrompt per integration,
// sends it, and records the message reference. A button press or reply comes
// back through act(), which checks who pressed, claims the prompt exactly
// once, and answers through the same helpers the in-app buttons use.

const (
	chatTelegram = "telegram"
	chatSlack    = "slack"
	chatDiscord  = "discord"
	chatWebhook  = "webhook"
)

var chatKinds = []string{chatTelegram, chatSlack, chatDiscord, chatWebhook}

var chatKindNames = map[string]string{chatTelegram: "Telegram", chatSlack: "Slack", chatDiscord: "Discord", chatWebhook: "Webhook"}

// Events an integration can ask for.
const (
	evApproval = "approval"
	evQuestion = "question"
	evFinished = "finished"
	evFailed   = "failed"
	evTest     = "test"
)

var chatEventNames = []string{evApproval, evQuestion, evFinished, evFailed}

const (
	chatLinkTTL      = 10 * time.Minute
	chatLinkMaxFails = 10
	chatPromptKeep   = 14 * 24 * time.Hour
)

// chatConfig is one integration's saved settings. It holds secrets, so it is
// never serialised to the browser (chatAppView is).
type chatConfig struct {
	Enabled       bool     `json:"enabled"`
	BotToken      string   `json:"botToken,omitempty"`
	AppToken      string   `json:"appToken,omitempty"` // Slack app-level token (xapp-)
	Channel       string   `json:"channel,omitempty"`  // Telegram chat id, Slack / Discord channel id
	ChatTitle     string   `json:"chatTitle,omitempty"`
	BotName       string   `json:"botName,omitempty"`
	BotId         string   `json:"botId,omitempty"`
	WebhookURL    string   `json:"webhookUrl,omitempty"`
	WebhookSecret string   `json:"webhookSecret,omitempty"`
	AllowedUsers  []string `json:"allowedUsers,omitempty"`
	Events        []string `json:"events,omitempty"`
	Machines      []string `json:"machines,omitempty"` // device ids; empty = every machine
	HideAlways    bool     `json:"hideAlways,omitempty"`
	LinkCode      string   `json:"linkCode,omitempty"`
	LinkExpires   int64    `json:"linkExpires,omitempty"`
	LinkFails     int      `json:"linkFails,omitempty"`
}

// ready: enough settings to connect at all.
func (c chatConfig) ready(kind string) bool {
	switch kind {
	case chatTelegram:
		return c.BotToken != ""
	case chatSlack:
		return c.BotToken != "" && c.AppToken != "" && c.Channel != ""
	case chatDiscord:
		return c.BotToken != "" && c.Channel != ""
	case chatWebhook:
		return c.WebhookURL != ""
	}
	return false
}

// deliverable: ready, and (Telegram) linked to a chat.
func (c chatConfig) deliverable(kind string) bool {
	if !c.Enabled || !c.ready(kind) {
		return false
	}
	return kind != chatTelegram || c.Channel != ""
}

func (c chatConfig) wants(event string) bool { return slices.Contains(c.Events, event) }

func (c chatConfig) machineOK(deviceId string) bool {
	return len(c.Machines) == 0 || slices.Contains(c.Machines, deviceId)
}

// allows says whether this user may answer. Nobody is allowed until a user
// has been recorded.
func (c chatConfig) allows(userId string) bool {
	return userId != "" && slices.Contains(c.AllowedUsers, userId)
}

func (c chatConfig) codeMatches(code string) bool {
	if c.LinkCode == "" || time.Now().Unix() > c.LinkExpires || c.LinkFails >= chatLinkMaxFails {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(strings.ToLower(strings.TrimSpace(code))), []byte(c.LinkCode)) == 1
}

// chatOption is one button.
type chatOption struct {
	Id    string `json:"id"` // the agent's option id
	Label string `json:"label"`
	Kind  string `json:"kind,omitempty"` // approvals: allow_once | allow_always | reject_once | reject_always
	Desc  string `json:"desc,omitempty"`
}

// chatContent is what a message says, independent of the service.
type chatContent struct {
	Event     string       `json:"event"`
	ThreadId  string       `json:"threadId"`
	Session   string       `json:"session"`
	DeviceId  string       `json:"deviceId"`
	Machine   string       `json:"machine"`
	AgentId   string       `json:"agentId"`
	Agent     string       `json:"agent"`
	Title     string       `json:"title"`  // approval: what it wants to do; question: the question
	Detail    string       `json:"detail"` // approval: the command; finished: summary; failed: error
	Options   []chatOption `json:"options,omitempty"`
	Multiple  bool         `json:"multiple,omitempty"`
	AllowText bool         `json:"allowText,omitempty"`
	Picked    []int        `json:"picked,omitempty"`
	Link      string       `json:"link,omitempty"`
}

// chatPrompt is one approval or question as shown in one integration.
type chatPrompt struct {
	Id        string
	Kind      string
	ThreadId  string
	PromptId  string // the agent's approval / question id
	Type      string // approval | question
	Ref       string // the service's message reference
	State     string
	Outcome   string // final line once done
	CreatedAt int64
	Content   chatContent
}

// chatNote is a message with nothing to answer (finished, failed, test).
type chatNote struct{ Content chatContent }

type chatTransport interface {
	// run connects and receives until ctx ends, reconnecting with backoff.
	run(ctx context.Context)
	sendPrompt(ctx context.Context, p *chatPrompt) (ref string, err error)
	editPrompt(ctx context.Context, p *chatPrompt) error
	sendNote(ctx context.Context, n chatNote) error
}

type chatStatus struct {
	State  string `json:"state"` // off | connecting | connected | error
	Detail string `json:"detail,omitempty"`
	At     int64  `json:"at,omitempty"`
}

// chatEndpoints are the service base URLs (replaced in tests).
type chatEndpoints struct {
	telegram, slack, discord, discordGateway string
}

type chatRunner struct {
	t      chatTransport
	cancel context.CancelFunc
	done   chan struct{}
}

type chatManager struct {
	s   *Server
	api chatEndpoints

	// approve / answer deliver an answer to the device: the same helpers the
	// in-app endpoints use. Tests replace them.
	approve func(t *Thread, approvalId, optionId string) (int, error)
	answer  func(t *Thread, questionId string, answers []string, text string) (int, error)
	// newTransport builds the client for one integration. Tests replace it.
	newTransport func(kind string) chatTransport

	mu      sync.Mutex
	ctx     context.Context
	cfgs    map[string]*chatConfig
	runners map[string]*chatRunner
	status  map[string]chatStatus
	last    map[string]string // thread id -> last status seen

	actMu sync.Mutex // serialises claims and pick toggles

	q          chan func()
	running    atomic.Bool
	active     atomic.Bool // some integration is switched on
	wantStatus atomic.Bool // some integration wants finished / failed
	wg         sync.WaitGroup
}

func newChatManager(s *Server) *chatManager {
	m := &chatManager{
		s: s,
		api: chatEndpoints{
			telegram:       "https://api.telegram.org",
			slack:          "https://slack.com/api",
			discord:        "https://discord.com/api/v10",
			discordGateway: "wss://gateway.discord.gg/?v=10&encoding=json",
		},
		cfgs:    map[string]*chatConfig{},
		runners: map[string]*chatRunner{},
		status:  map[string]chatStatus{},
		last:    map[string]string{},
		q:       make(chan func(), 256),
	}
	m.approve = s.sendApproval
	m.answer = s.sendAnswer
	m.newTransport = m.buildTransport
	return m
}

func (m *chatManager) buildTransport(kind string) chatTransport {
	switch kind {
	case chatTelegram:
		return newTelegram(m)
	case chatSlack:
		return newSlack(m)
	case chatDiscord:
		return newDiscord(m)
	case chatWebhook:
		return newWebhook(m)
	}
	return nil
}

// run starts the integrations and processes hub events until ctx ends.
func (m *chatManager) run(ctx context.Context) {
	m.mu.Lock()
	m.ctx = ctx
	m.mu.Unlock()
	m.running.Store(true)
	defer m.running.Store(false)
	m.s.store.pruneChatPrompts(time.Now().Add(-chatPromptKeep).Unix())
	for _, kind := range chatKinds {
		m.reload(kind)
	}
	tick := time.NewTicker(6 * time.Hour)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			m.mu.Lock()
			for kind, r := range m.runners {
				r.cancel()
				delete(m.runners, kind)
			}
			m.mu.Unlock()
			return
		case fn := <-m.q:
			fn()
		case <-tick.C:
			m.s.store.pruneChatPrompts(time.Now().Add(-chatPromptKeep).Unix())
		}
	}
}

// enqueue runs fn on the manager's goroutine, in order, without ever
// blocking the thread code that calls the hooks.
func (m *chatManager) enqueue(fn func()) {
	if m == nil || !m.running.Load() {
		return
	}
	select {
	case m.q <- fn:
	default:
		log.Printf("chat: event queue full, dropped an event")
	}
}

// --- config ---

func (m *chatManager) config(kind string) chatConfig {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.configLocked(kind)
}

func (m *chatManager) configLocked(kind string) chatConfig {
	if c := m.cfgs[kind]; c != nil {
		return *c
	}
	c, err := m.s.store.chatConfig(kind)
	if err != nil {
		log.Printf("chat: reading %s settings: %v", kind, err)
	}
	m.cfgs[kind] = &c
	return c
}

// updateConfig changes one integration's settings and saves them. It does
// not restart the connection (see reload).
func (m *chatManager) updateConfig(kind string, fn func(c *chatConfig)) (chatConfig, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c := m.configLocked(kind)
	fn(&c)
	if err := m.s.store.saveChatConfig(kind, c); err != nil {
		return c, err
	}
	m.cfgs[kind] = &c
	m.recomputeLocked()
	return c, nil
}

func (m *chatManager) dropConfig(kind string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.s.store.deleteChatConfig(kind); err != nil {
		return err
	}
	delete(m.cfgs, kind)
	m.recomputeLocked()
	return nil
}

func (m *chatManager) recomputeLocked() {
	active, status := false, false
	for _, kind := range chatKinds {
		c := m.configLocked(kind)
		if c.Enabled && c.ready(kind) {
			active = true
			if c.wants(evFinished) || c.wants(evFailed) {
				status = true
			}
		}
	}
	m.active.Store(active)
	m.wantStatus.Store(status)
}

// reload (re)starts one integration after its settings changed.
func (m *chatManager) reload(kind string) {
	m.mu.Lock()
	m.recomputeLocked()
	old := m.runners[kind]
	delete(m.runners, kind)
	cfg := m.configLocked(kind)
	ctx := m.ctx
	m.mu.Unlock()
	if old != nil {
		old.cancel()
		select {
		case <-old.done:
		case <-time.After(3 * time.Second):
		}
	}
	if ctx == nil || ctx.Err() != nil {
		return
	}
	if !cfg.Enabled || !cfg.ready(kind) {
		m.setStatus(kind, "off", "")
		return
	}
	t := m.newTransport(kind)
	if t == nil {
		return
	}
	rctx, cancel := context.WithCancel(ctx)
	r := &chatRunner{t: t, cancel: cancel, done: make(chan struct{})}
	m.mu.Lock()
	m.runners[kind] = r
	m.mu.Unlock()
	m.setStatus(kind, "connecting", "")
	go func() {
		defer close(r.done)
		t.run(rctx)
	}()
}

func (m *chatManager) transport(kind string) chatTransport {
	m.mu.Lock()
	defer m.mu.Unlock()
	if r := m.runners[kind]; r != nil {
		return r.t
	}
	return nil
}

func (m *chatManager) setStatus(kind, state, detail string) {
	m.mu.Lock()
	m.status[kind] = chatStatus{State: state, Detail: detail, At: time.Now().Unix()}
	m.mu.Unlock()
}

func (m *chatManager) statusOf(kind string) chatStatus {
	m.mu.Lock()
	defer m.mu.Unlock()
	if st, ok := m.status[kind]; ok {
		return st
	}
	return chatStatus{State: "off"}
}

// invalidate closes every open prompt of an integration (its token or
// channel changed, so the old messages can no longer be answered).
func (m *chatManager) invalidate(kind, why string) {
	rows, _ := m.s.store.pendingChatPromptsOf(kind)
	for _, p := range rows {
		m.s.store.finishChatPrompt(p.Id, why, promptPending, promptAnswering)
	}
}

// --- hooks from the thread code ---

// onMessage is called with every folded message. Cheap unless it is an
// approval or a question.
func (m *chatManager) onMessage(threadId string, msg *ThreadMessage) {
	if m == nil || msg == nil || !m.active.Load() || (msg.Role != "approval" && msg.Role != "question") {
		return
	}
	cp := *msg
	m.enqueue(func() { m.handleMessage(threadId, &cp) })
}

// onThread is called whenever a thread's record changed.
func (m *chatManager) onThread(id string) {
	if m == nil || !m.wantStatus.Load() {
		return
	}
	// Read the status now: by the time the queue runs, a quick second change
	// would hide the first.
	t, err := m.s.store.ThreadById(id)
	if err != nil || t == nil {
		return
	}
	m.enqueue(func() { m.handleThread(t) })
}

func (m *chatManager) handleMessage(threadId string, msg *ThreadMessage) {
	switch {
	case msg.Role == "approval" && msg.Approval != nil && msg.Approval.Id != "":
		a := msg.Approval
		if a.Resolved != "" {
			m.resolved(threadId, a.Id, approvalElsewhere(a))
			return
		}
		if len(a.Options) == 0 {
			return
		}
		opts := make([]chatOption, 0, len(a.Options))
		for _, o := range a.Options {
			opts = append(opts, chatOption{Id: o.Id, Label: o.Label, Kind: o.Kind})
		}
		m.newPrompt(threadId, "approval", a.Id, evApproval, func(c *chatContent) {
			c.Title, c.Detail, c.Options = a.Title, a.Detail, opts
		})
	case msg.Role == "question" && msg.Question != nil && msg.Question.Id != "":
		q := msg.Question
		if q.Answered != nil {
			outcome := "Answered in Overseer · " + clock()
			if len(q.Answered) == 1 && q.Answered[0] == "(cancelled)" {
				outcome = noLongerWaiting
			}
			m.resolved(threadId, q.Id, outcome)
			return
		}
		opts := make([]chatOption, 0, len(q.Options))
		for _, o := range q.Options {
			opts = append(opts, chatOption{Id: o.Id, Label: o.Label, Desc: o.Description})
		}
		m.newPrompt(threadId, "question", q.Id, evQuestion, func(c *chatContent) {
			c.Title, c.Options, c.Multiple, c.AllowText = q.Text, opts, q.Multiple, q.AllowText
		})
	}
}

const noLongerWaiting = "⏹ No longer waiting"

func approvalElsewhere(a *protocol.ThreadApprovalRequest) string {
	for _, o := range a.Options {
		if o.Id == a.Resolved {
			if strings.HasPrefix(o.Kind, "reject") {
				return "🚫 Rejected in Overseer · " + clock()
			}
			return "✅ Allowed in Overseer · " + clock()
		}
	}
	return noLongerWaiting
}

func clock() string { return time.Now().Format("15:04") }

// contentFor fills the parts every message shares.
func (m *chatManager) contentFor(t *Thread, event string) chatContent {
	agent := t.Agent
	for _, a := range m.s.agents.list() {
		if a.Id == t.Agent {
			agent = a.Name
			break
		}
	}
	title := strings.TrimSpace(t.Title)
	if title == "" {
		title = "Untitled session"
	}
	return chatContent{
		Event: event, ThreadId: t.Id, Session: title, DeviceId: t.DeviceId, Machine: t.DeviceName,
		AgentId: t.Agent, Agent: agent, Link: m.link(t.Id),
	}
}

// link is where "Open" goes. Empty when the hub only knows a loopback
// address, which a phone could not open (and Telegram rejects).
func (m *chatManager) link(threadId string) string {
	base := strings.TrimRight(m.s.hubPublicURL(), "/")
	u, err := url.Parse(base)
	if err != nil || u.Host == "" {
		return ""
	}
	host := u.Hostname()
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || host == "::1" || strings.HasPrefix(host, "127.") || host == "0.0.0.0" {
		return ""
	}
	return base + "/sessions/" + threadId
}

func (m *chatManager) newPrompt(threadId, typ, promptId, event string, fill func(c *chatContent)) {
	t, err := m.s.store.ThreadById(threadId)
	if err != nil || t == nil || t.Archived {
		return
	}
	existing, _ := m.s.store.chatPromptsFor(threadId, promptId)
	for _, kind := range chatKinds {
		cfg := m.config(kind)
		if !cfg.deliverable(kind) || !cfg.wants(event) || !cfg.machineOK(t.DeviceId) {
			continue
		}
		if slices.ContainsFunc(existing, func(p *chatPrompt) bool { return p.Kind == kind }) {
			continue // the agent repeated the request
		}
		content := m.contentFor(t, event)
		fill(&content)
		if cfg.HideAlways {
			content.Options = slices.DeleteFunc(content.Options, func(o chatOption) bool { return o.Kind == "allow_always" || o.Kind == "reject_always" })
			if len(content.Options) == 0 {
				continue
			}
		}
		p := &chatPrompt{Id: randomToken()[:10], Kind: kind, ThreadId: threadId, PromptId: promptId, Type: typ,
			State: promptPending, CreatedAt: time.Now().Unix(), Content: content}
		if kind != chatWebhook { // a webhook has nothing to answer with
			if err := m.s.store.insertChatPrompt(p); err != nil {
				log.Printf("chat: saving prompt: %v", err)
				continue
			}
		}
		m.wg.Add(1)
		go m.deliver(p)
	}
}

func (m *chatManager) deliver(p *chatPrompt) {
	defer m.wg.Done()
	tr := m.transport(p.Kind)
	if tr == nil {
		m.s.store.finishChatPrompt(p.Id, "", promptPending)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	ref, err := tr.sendPrompt(ctx, p)
	if err != nil {
		log.Printf("chat: sending to %s: %v", p.Kind, err)
		m.s.store.finishChatPrompt(p.Id, "", promptPending)
		return
	}
	if p.Kind == chatWebhook {
		return
	}
	m.s.store.setChatPromptRef(p.Id, ref)
	// It may have been answered while the send was in flight.
	if cur, _ := m.s.store.chatPromptById(p.Id); cur != nil && cur.State == promptDone && cur.Outcome != "" {
		m.edit(cur)
	}
}

// edit re-renders a message in its service.
func (m *chatManager) edit(p *chatPrompt) {
	if p == nil || p.Ref == "" || p.Kind == chatWebhook {
		return
	}
	tr := m.transport(p.Kind)
	if tr == nil {
		return
	}
	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		if err := tr.editPrompt(ctx, p); err != nil {
			log.Printf("chat: updating %s message: %v", p.Kind, err)
		}
	}()
}

// resolved closes the copies of a prompt that nobody answered through chat
// (it was answered in the app, or the agent gave up).
func (m *chatManager) resolved(threadId, promptId, outcome string) {
	rows, _ := m.s.store.chatPromptsFor(threadId, promptId)
	for _, p := range rows {
		ok, _ := m.s.store.finishChatPrompt(p.Id, outcome, promptPending)
		if !ok {
			continue // already done, or being answered right now
		}
		if cur, _ := m.s.store.chatPromptById(p.Id); cur != nil {
			m.edit(cur)
		}
	}
}

// --- finished / failed ---

func (m *chatManager) handleThread(t *Thread) {
	id := t.Id
	m.mu.Lock()
	prev := m.last[id]
	m.last[id] = t.Status
	if len(m.last) > 4000 {
		for k := range m.last {
			if k != id {
				delete(m.last, k)
			}
		}
	}
	m.mu.Unlock()
	if prev == "" || prev == t.Status || t.Archived {
		return
	}
	var event string
	switch {
	case t.Status == "error":
		event = evFailed
	case t.Status == "idle" && (prev == "working" || prev == "waiting" || prev == "starting"):
		event = evFinished
	default:
		return
	}
	for _, kind := range chatKinds {
		cfg := m.config(kind)
		if !cfg.deliverable(kind) || !cfg.wants(event) || !cfg.machineOK(t.DeviceId) {
			continue
		}
		c := m.contentFor(t, event)
		if event == evFailed {
			c.Detail = clipRunes(strings.TrimSpace(t.Error), 300)
		} else {
			c.Detail = summarize(m.s.store.lastAssistantText(t.Id), 280)
		}
		m.sendNoteTo(kind, chatNote{Content: c})
	}
}

func (m *chatManager) sendNoteTo(kind string, n chatNote) {
	tr := m.transport(kind)
	if tr == nil {
		return
	}
	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		defer cancel()
		if err := tr.sendNote(ctx, n); err != nil {
			log.Printf("chat: sending to %s: %v", kind, err)
		}
	}()
}

// summarize makes a short one-paragraph preview of the agent's last reply.
func summarize(text string, n int) string {
	text = strings.TrimSpace(text)
	if i := strings.Index(text, "\n\n"); i > 0 {
		text = text[:i]
	}
	return clipRunes(strings.Join(strings.Fields(text), " "), n)
}

func clipRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return strings.TrimRight(string(r[:n-1]), " ") + "…"
}

// --- answers coming back ---

type chatActor struct {
	UserId string
	Name   string
}

type chatAction struct {
	PromptId string // a button press names the prompt
	Ref      string // a text reply names the message it replies to
	Op       string // pick | toggle | send | text
	Index    int
	Text     string
	Actor    chatActor
}

type chatReply struct {
	Toast  string      // short note for whoever pressed
	Alert  bool        // the toast is a refusal
	Prompt *chatPrompt // latest state, when the message should be redrawn
}

// act handles one button press or text reply. The transport has already
// checked the channel; the user is checked here.
func (m *chatManager) act(kind string, a chatAction) chatReply {
	cfg := m.config(kind)
	if !cfg.allows(a.Actor.UserId) {
		return chatReply{Toast: "You are not allowed to answer from here.", Alert: true}
	}

	m.actMu.Lock()
	var p *chatPrompt
	var err error
	if a.PromptId != "" {
		p, err = m.s.store.chatPromptById(a.PromptId)
	} else {
		p, err = m.s.store.chatPromptByRef(kind, a.Ref)
	}
	if err != nil || p == nil || p.Kind != kind {
		m.actMu.Unlock()
		return chatReply{Toast: "This request is no longer available.", Alert: true}
	}
	switch p.State {
	case promptDone:
		m.actMu.Unlock()
		return chatReply{Toast: "Already answered.", Prompt: p}
	case promptAnswering:
		m.actMu.Unlock()
		return chatReply{Toast: "Already being answered."}
	}
	t, _ := m.s.store.ThreadById(p.ThreadId)
	if t == nil || !m.stillOpen(p) {
		m.actMu.Unlock()
		m.finishAll(p, noLongerWaiting, "")
		cur, _ := m.s.store.chatPromptById(p.Id)
		return chatReply{Toast: "The agent is no longer waiting for this.", Alert: true, Prompt: cur}
	}

	c := &p.Content
	switch a.Op {
	case "toggle":
		if !c.Multiple || a.Index < 0 || a.Index >= len(c.Options) {
			m.actMu.Unlock()
			return chatReply{Toast: "Unknown option.", Alert: true}
		}
		if i := slices.Index(c.Picked, a.Index); i >= 0 {
			c.Picked = slices.Delete(c.Picked, i, i+1)
		} else {
			c.Picked = append(c.Picked, a.Index)
			slices.Sort(c.Picked)
		}
		m.s.store.setChatPromptPicked(p.Id, *c)
		m.actMu.Unlock()
		return chatReply{Prompt: p}
	}

	// Work out the answer before claiming, so a bad press claims nothing.
	var optionId string
	var answers []string
	var text, verb string
	switch {
	case p.Type == "approval" && a.Op == "pick":
		if a.Index < 0 || a.Index >= len(c.Options) {
			m.actMu.Unlock()
			return chatReply{Toast: "Unknown option.", Alert: true}
		}
		o := c.Options[a.Index]
		optionId = o.Id
		switch o.Kind {
		case "allow_always":
			verb = "✅ Always allowed"
		case "reject_once", "reject_always":
			verb = "🚫 Rejected"
		default:
			verb = "✅ Allowed"
		}
	case p.Type == "question" && a.Op == "pick" && !c.Multiple:
		if a.Index < 0 || a.Index >= len(c.Options) {
			m.actMu.Unlock()
			return chatReply{Toast: "Unknown option.", Alert: true}
		}
		answers = []string{c.Options[a.Index].Id}
		verb = "💬 Answered “" + clipRunes(c.Options[a.Index].Label, 60) + "”"
	case p.Type == "question" && (a.Op == "send" || a.Op == "text"):
		if c.Multiple {
			for _, i := range c.Picked {
				if i >= 0 && i < len(c.Options) {
					answers = append(answers, c.Options[i].Id)
				}
			}
		}
		if a.Op == "text" {
			if !c.AllowText {
				m.actMu.Unlock()
				return chatReply{Toast: "This question takes the buttons only.", Alert: true}
			}
			text = strings.TrimSpace(a.Text)
			if utf8.RuneCountInString(text) > 4000 {
				m.actMu.Unlock()
				return chatReply{Toast: "That answer is too long.", Alert: true}
			}
		}
		if len(answers) == 0 && text == "" {
			m.actMu.Unlock()
			return chatReply{Toast: "Pick at least one option.", Alert: true}
		}
		verb = "💬 Answered"
		if text != "" {
			verb += ": " + clipRunes(text, 80)
		}
	default:
		m.actMu.Unlock()
		return chatReply{Toast: "That does not fit this request.", Alert: true}
	}

	// Another integration may have won already.
	rows, _ := m.s.store.chatPromptsFor(p.ThreadId, p.PromptId)
	for _, o := range rows {
		if o.Id != p.Id && (o.State == promptAnswering || o.State == promptDone) {
			m.actMu.Unlock()
			cur, _ := m.s.store.chatPromptById(p.Id)
			return chatReply{Toast: "Someone else just answered this.", Prompt: cur}
		}
	}
	won, err := m.s.store.claimChatPrompt(p.Id)
	m.actMu.Unlock()
	if err != nil || !won {
		return chatReply{Toast: "Already being answered."}
	}

	var status int
	if p.Type == "approval" {
		status, err = m.approve(t, p.PromptId, optionId)
	} else {
		status, err = m.answer(t, p.PromptId, answers, text)
	}
	if err != nil {
		if status == http.StatusServiceUnavailable || errors.Is(err, context.DeadlineExceeded) {
			m.s.store.releaseChatPrompt(p.Id)
			return chatReply{Toast: "Could not reach " + c.Machine + ". Try again in a moment.", Alert: true}
		}
		m.finishAll(p, noLongerWaiting, "")
		cur, _ := m.s.store.chatPromptById(p.Id)
		return chatReply{Toast: "The agent is no longer waiting for this.", Alert: true, Prompt: cur}
	}

	who := "you"
	if len(cfg.AllowedUsers) > 1 && a.Actor.Name != "" {
		who = a.Actor.Name
	}
	name := chatKindNames[kind]
	m.finishAll(p, verb+" by "+who+" · "+clock(), name)
	m.s.threads.appendEvent(t.Id, protocol.ThreadEvent{Id: "via-" + randomToken()[:12], Role: "status",
		Text: strings.TrimPrefix(strings.TrimPrefix(strings.TrimPrefix(verb, "✅ "), "🚫 "), "💬 ") + " via " + name})
	cur, _ := m.s.store.chatPromptById(p.Id)
	return chatReply{Toast: "Sent.", Prompt: cur}
}

// stillOpen checks the live message: has the agent already moved on?
func (m *chatManager) stillOpen(p *chatPrompt) bool {
	msg, err := m.s.store.threadMessageById(p.ThreadId, p.PromptId)
	if err != nil || msg == nil {
		return false
	}
	if p.Type == "approval" {
		return msg.Approval != nil && msg.Approval.Resolved == ""
	}
	return msg.Question != nil && msg.Question.Answered == nil
}

// finishAll closes this prompt (the caller redraws it) and every other
// integration's copy, which is edited to say where it was answered.
func (m *chatManager) finishAll(p *chatPrompt, outcome, via string) {
	m.s.store.finishChatPrompt(p.Id, outcome, promptPending, promptAnswering)
	rows, _ := m.s.store.chatPromptsFor(p.ThreadId, p.PromptId)
	for _, o := range rows {
		if o.Id == p.Id {
			continue
		}
		text := outcome
		if via != "" {
			text = "ℹ️ Answered via " + via + " · " + clock()
		}
		if ok, _ := m.s.store.finishChatPrompt(o.Id, text, promptPending); ok {
			if cur, _ := m.s.store.chatPromptById(o.Id); cur != nil {
				m.edit(cur)
			}
		}
	}
}

// --- sending an answer: shared with the in-app endpoints ---

// sendApproval delivers an approval choice to the thread's device. It
// returns the HTTP status to use when err is set.
func (s *Server) sendApproval(t *Thread, approvalId, optionId string) (int, error) {
	c := s.registry.get(t.DeviceId)
	if c == nil {
		return http.StatusServiceUnavailable, errors.New("device is offline")
	}
	ctx, cancel := deviceCtx()
	defer cancel()
	if err := c.requestInto(ctx, protocol.TypeThreadApproval,
		protocol.ThreadApproval{ThreadId: t.Id, ApprovalId: approvalId, OptionId: optionId}, nil); err != nil {
		return http.StatusConflict, err
	}
	return 0, nil
}

// sendAnswer delivers the answer to an agent's question.
func (s *Server) sendAnswer(t *Thread, questionId string, answers []string, text string) (int, error) {
	c := s.registry.get(t.DeviceId)
	if c == nil {
		return http.StatusServiceUnavailable, errors.New("device is offline")
	}
	ctx, cancel := deviceCtx()
	defer cancel()
	if err := c.requestInto(ctx, protocol.TypeThreadAnswer, protocol.ThreadAnswer{
		ThreadId: t.Id, QuestionId: questionId, Answers: answers, Text: strings.TrimSpace(text),
	}, nil); err != nil {
		return http.StatusConflict, err
	}
	return 0, nil
}

// --- shared rendering helpers ---

// buttonLabel is the text on an approval button.
func (o chatOption) buttonLabel() string {
	switch o.Kind {
	case "allow_once":
		return "Allow once"
	case "allow_always":
		return "Always allow"
	case "reject_once":
		return "Reject"
	case "reject_always":
		return "Always reject"
	}
	return o.Label
}

func lowerFirst(s string) string {
	if s == "" {
		return s
	}
	r, n := utf8.DecodeRuneInString(s)
	// Keep names like "Run" lower-cased but leave acronyms and paths alone.
	if r >= 'A' && r <= 'Z' && !(len(s) > n && s[n] >= 'A' && s[n] <= 'Z') {
		return strings.ToLower(string(r)) + s[n:]
	}
	return s
}

// chatHeadline is the first line of a message, without markup.
func chatHeadline(c chatContent) (emoji, who, what string) {
	who = c.Machine
	if who == "" {
		who = "A machine"
	}
	agent := c.Agent
	if agent == "" {
		agent = "an agent"
	}
	switch c.Event {
	case evApproval:
		return "🟠", who, agent + " wants to " + lowerFirst(c.Title)
	case evQuestion:
		return "❓", who, agent + " has a question"
	case evFinished:
		return "✅", who, agent + " finished"
	case evFailed:
		return "❌", who, agent + " failed"
	}
	return "🔔", "Overseer", "test message"
}

func sprintf(format string, a ...any) string { return fmt.Sprintf(format, a...) }
