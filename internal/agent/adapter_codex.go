package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// codexAdapter drives `codex app-server` (JSON-RPC over stdio without the
// "jsonrpc" field). The app-server protocol is still evolving, so payloads
// are decoded loosely and a couple of field spellings are probed.
type codexAdapter struct {
	adapterBase

	ctx       context.Context
	cancelCtx context.CancelFunc
	proc      *agentProcess
	rpc       *rpcConn

	cmu        sync.Mutex
	threadId   string
	turnId     string
	reasoning  map[string]bool   // items that streamed a summary (skip raw deltas)
	cmdOutput  map[string]string // streamed command output per item
	cmdEmitted map[string]time.Time
	planId     string
	usage      protocol.Usage
	turnActive bool                    // a turn is running (prompts steer it)
	skills     map[string]bool         // skill names, for "/skill" -> "$skill"
	commands   []protocol.AgentCommand // built-ins + skills
	model      string                  // model the thread runs (from thread/start), for collaborationMode
	tier       string                  // service tier id used for fast mode
	planTurn   bool                    // the last turn ran in the plan collaboration mode

	// Subagents: Codex runs them as child threads on the same app-server.
	agents map[string]*codexSub // child thread id -> its row in the parent transcript
}

// codexSub tracks one spawned subagent while its parent turn runs.
type codexSub struct {
	msgId string
	tools int
	done  bool
	start time.Time
	name  string // nickname
	role  string
}

func newCodexAdapter(cfg protocol.ThreadStart, sink threadSink) *codexAdapter {
	ctx, cancel := context.WithCancel(context.Background())
	return &codexAdapter{
		adapterBase: newAdapterBase(cfg, sink),
		ctx:         ctx,
		cancelCtx:   cancel,
		reasoning:   map[string]bool{},
		cmdOutput:   map[string]string{},
		cmdEmitted:  map[string]time.Time{},
		agents:      map[string]*codexSub{},
	}
}

// codexMode is the effective Codex mode id: the explicit mode, else the
// legacy access level mapped onto the same presets.
func codexMode(set threadSettings) string {
	if set.Mode != "" {
		return set.Mode
	}
	switch set.Access {
	case "ask":
		return "read-only"
	case "full":
		return "full-access"
	}
	return "on-request"
}

// codexModePolicy maps a mode id onto approvalPolicy + sandbox mode.
func codexModePolicy(mode string) (approval, sandbox string) {
	switch mode {
	case "read-only", "plan":
		return "on-request", "read-only"
	case "full-access":
		return "never", "danger-full-access"
	}
	return "on-request", "workspace-write"
}

// codexSandboxPolicy is the turn/start form of a sandbox mode.
func codexSandboxPolicy(sandbox string) map[string]any {
	switch sandbox {
	case "read-only":
		return map[string]any{"type": "readOnly"}
	case "danger-full-access":
		return map[string]any{"type": "dangerFullAccess"}
	}
	return map[string]any{"type": "workspaceWrite"}
}

const codexDefaultTier = "priority"

// codexTurnOverrides are the per-turn settings sent with turn/start (they
// also stick for later turns): model, effort, fast tier, approval policy,
// sandbox, approvals reviewer and the plan collaboration mode. model is the
// thread's model when none is set (collaborationMode requires one); wasPlan
// says whether the previous turn was in plan mode, so leaving it is explicit.
func codexTurnOverrides(set threadSettings, model, tier string, wasPlan bool) map[string]any {
	p := map[string]any{}
	if set.Model != "" {
		p["model"] = set.Model
		model = set.Model
	}
	if set.Effort != "" {
		p["effort"] = set.Effort
	}
	if set.Fast {
		if tier == "" {
			tier = codexDefaultTier
		}
		p["serviceTierForTurn"] = tier
	}
	mode := codexMode(set)
	approval, sandbox := codexModePolicy(mode)
	p["approvalPolicy"] = approval
	p["sandboxPolicy"] = codexSandboxPolicy(sandbox)
	if set.Mode != "" {
		if mode == "auto" {
			p["approvalsReviewer"] = "auto_review"
		} else {
			p["approvalsReviewer"] = "user"
		}
	}
	if (mode == "plan" || wasPlan) && model != "" {
		kind := "default"
		if mode == "plan" {
			kind = "plan"
		}
		settings := map[string]any{"model": model, "developer_instructions": nil}
		if set.Effort != "" {
			settings["reasoning_effort"] = set.Effort
		} else {
			settings["reasoning_effort"] = nil
		}
		p["collaborationMode"] = map[string]any{"mode": kind, "settings": settings}
	}
	return p
}

// tomlString quotes s as a TOML basic string (JSON escapes are valid TOML).
func tomlString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func tomlInlineTable(m map[string]string) string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, tomlString(k)+" = "+tomlString(m[k]))
	}
	return "{" + strings.Join(parts, ", ") + "}"
}

// codexMcpArgs renders registry servers as `-c mcp_servers.<name>.*` overrides.
func codexMcpArgs(servers []protocol.McpServer) []string {
	var args []string
	taken := map[string]any{}
	for _, s := range servers {
		key := mcpServerKey(s.Name, taken)
		taken[key] = true
		prefix := "mcp_servers." + key + "."
		switch s.Transport {
		case "stdio":
			argv := s.Args
			if argv == nil {
				argv = []string{}
			}
			b, _ := json.Marshal(argv)
			args = append(args, "-c", prefix+"command="+tomlString(s.Command), "-c", prefix+"args="+string(b))
			if len(s.Env) > 0 {
				args = append(args, "-c", prefix+"env="+tomlInlineTable(s.Env))
			}
		case "http":
			args = append(args, "-c", prefix+"url="+tomlString(s.Url))
			if len(s.Headers) > 0 {
				args = append(args, "-c", prefix+"http_headers="+tomlInlineTable(s.Headers))
			}
		}
	}
	return args
}

func (c *codexAdapter) start(ctx context.Context) (string, error) {
	path, err := lookAgentBinary("codex")
	if err != nil {
		return "", err
	}
	args := append([]string{"app-server"}, codexMcpArgs(c.cfg.McpServers)...)
	proc, err := startAgentProcess(path, args, c.cfg.Cwd, agentEnv())
	if err != nil {
		return "", err
	}
	rpc := newRPCConn(false)
	rpc.proc = proc
	rpc.onNotify = c.onNotify
	rpc.onRequest = c.onRequest
	c.proc, c.rpc = proc, rpc
	proc.readLines(rpc.handleLine)
	c.watchExit(proc, rpc.shutdown)

	fail := func(err error) (string, error) {
		proc.kill()
		if tail := proc.stderr.String(); tail != "" {
			return "", fmt.Errorf("%v\n%s", err, tail)
		}
		return "", err
	}
	ictx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	err = rpc.call(ictx, "initialize", map[string]any{
		"clientInfo":   map[string]string{"name": "overseer", "title": "Overseer", "version": "1"},
		"capabilities": map[string]any{"experimentalApi": true},
	}, nil)
	if err != nil {
		return fail(err)
	}
	if err := rpc.notify("initialized", nil); err != nil {
		return fail(err)
	}

	set := c.settings()
	approval, sandbox := codexModePolicy(codexMode(set))
	params := map[string]any{"cwd": c.cfg.Cwd, "approvalPolicy": approval, "sandbox": sandbox}
	if set.Model != "" {
		params["model"] = set.Model
	}
	if set.Mode == "auto" {
		params["approvalsReviewer"] = "auto_review"
	}
	var res json.RawMessage
	switch {
	case c.cfg.Fork && c.cfg.ResumeId != "":
		res = c.fork(ctx, params)
		if res == nil {
			c.forkFallback = true
		}
	case c.cfg.Fork:
		c.forkFallback = true
	case c.cfg.ResumeId != "":
		resume := map[string]any{"threadId": c.cfg.ResumeId}
		for k, v := range params {
			resume[k] = v
		}
		if err := rpc.call(ctx, "thread/resume", resume, &res); err != nil {
			res = nil
		}
	}
	if res == nil {
		if err := rpc.call(ctx, "thread/start", params, &res); err != nil {
			return fail(err)
		}
	}
	r := decodeObj(res)
	id := jStr(jObj(r, "thread"), "id")
	if id == "" {
		id = jStr(r, "threadId", "id")
	}
	if id == "" {
		return fail(fmt.Errorf("codex returned no thread id"))
	}
	c.cmu.Lock()
	c.threadId = id
	c.model = jStr(r, "model")
	c.cmu.Unlock()
	c.mu.Lock()
	c.resume = id
	c.mu.Unlock()
	if set.Fast {
		c.lookupTier(ctx, set.Model)
	}
	c.started.Store(true)
	c.loadCommands(ctx)
	return id, nil
}

// fork copies the stored thread (thread/fork) and, with ForkAt, cuts it
// after the turn whose user message carries that client id
// (thread/revert). It returns nil when that isn't possible.
func (c *codexAdapter) fork(ctx context.Context, params map[string]any) json.RawMessage {
	fp := map[string]any{"threadId": c.cfg.ResumeId}
	for k, v := range params {
		fp[k] = v
	}
	var res json.RawMessage
	if err := c.rpc.call(ctx, "thread/fork", fp, &res); err != nil {
		return nil
	}
	if c.cfg.ForkAt == "" {
		return res
	}
	newId := jStr(jObj(decodeObj(res), "thread"), "id")
	turns := codexTurnIds(ctx, c.rpc, newId)
	cut := -1
	for i, t := range turns {
		if t.clientId == c.cfg.ForkAt {
			cut = i
		}
	}
	switch {
	case cut < 0:
		c.rpc.call(ctx, "thread/delete", map[string]string{"threadId": newId}, nil)
		return nil
	case cut+1 < len(turns):
		var rev json.RawMessage
		if err := c.rpc.call(ctx, "thread/revert", map[string]any{"threadId": newId, "beforeTurnId": turns[cut+1].id}, &rev); err != nil {
			c.rpc.call(ctx, "thread/delete", map[string]string{"threadId": newId}, nil)
			return nil
		}
	}
	return res
}

type codexTurnRef struct{ id, clientId string }

// codexTurnIds lists a thread's turns oldest first, with the client id of
// each turn's user message.
func codexTurnIds(ctx context.Context, rpc *rpcConn, threadId string) []codexTurnRef {
	var out []codexTurnRef
	cursor := ""
	for page := 0; page < 50; page++ {
		params := map[string]any{"threadId": threadId, "sortDirection": "asc", "itemsView": "summary", "limit": 100}
		if cursor != "" {
			params["cursor"] = cursor
		}
		var res json.RawMessage
		if rpc.call(ctx, "thread/turns/list", params, &res) != nil {
			return out
		}
		r := decodeObj(res)
		for _, x := range jArr(r, "data") {
			t, ok := x.(map[string]any)
			if !ok {
				continue
			}
			ref := codexTurnRef{id: jStr(t, "id")}
			for _, it := range jArr(t, "items") {
				if im, ok := it.(map[string]any); ok && jStr(im, "type") == "userMessage" && ref.clientId == "" {
					ref.clientId = jStr(im, "clientId")
				}
			}
			out = append(out, ref)
		}
		next, _ := r["nextCursor"].(string)
		if next == "" || next == cursor {
			break
		}
		cursor = next
	}
	return out
}

var codexBuiltinCommands = []protocol.AgentCommand{
	{Name: "review", Description: "Review the uncommitted changes (or follow the given instructions)", Hint: "instructions"},
	{Name: "compact", Description: "Summarise the conversation to free up context"},
}

// loadCommands publishes Codex's built-in commands plus its skills.
func (c *codexAdapter) loadCommands(ctx context.Context) {
	cmds := append([]protocol.AgentCommand{}, codexBuiltinCommands...)
	skills := map[string]bool{}
	sctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var res json.RawMessage
	if c.rpc.call(sctx, "skills/list", map[string]any{"cwds": []string{c.cfg.Cwd}}, &res) == nil {
		for _, e := range jArr(decodeObj(res), "data") {
			em, _ := e.(map[string]any)
			for _, sk := range jArr(em, "skills") {
				m, ok := sk.(map[string]any)
				if !ok || jStr(m, "name") == "" || (m["enabled"] != nil && !jBool(m, "enabled")) || skills[jStr(m, "name")] {
					continue
				}
				skills[jStr(m, "name")] = true
				cmds = append(cmds, protocol.AgentCommand{Name: jStr(m, "name"), Description: jStr(m, "description", "shortDescription"), Hint: "skill"})
			}
		}
	}
	c.cmu.Lock()
	c.skills, c.commands = skills, cmds
	c.cmu.Unlock()
	c.publishMeta(protocol.ThreadCapabilities{Fork: true, Compact: true, Undo: true, Steer: true, Images: true, Commands: true, Review: true}, cmds)
}

// codexInput builds turn input items: text plus local images.
func codexInput(p promptInput) []map[string]any {
	in := []map[string]any{}
	if p.Text != "" || len(p.Images) == 0 {
		in = append(in, map[string]any{"type": "text", "text": p.Text})
	}
	for _, img := range p.Images {
		in = append(in, map[string]any{"type": "localImage", "path": img.Path})
	}
	return in
}

func (c *codexAdapter) compact() error {
	c.cmu.Lock()
	threadId, busy := c.threadId, c.turnActive
	c.cmu.Unlock()
	if busy {
		return fmt.Errorf("the agent is working; compact after the turn ends")
	}
	c.beginTurn()
	c.setStatus("working", "")
	ctx, cancel := context.WithTimeout(c.ctx, 30*time.Second)
	defer cancel()
	return c.rpc.call(ctx, "thread/compact/start", map[string]string{"threadId": threadId}, nil)
}

// undo reverts the thread to before its latest turn.
func (c *codexAdapter) undo() error {
	c.cmu.Lock()
	threadId, busy := c.threadId, c.turnActive
	c.cmu.Unlock()
	if busy {
		return fmt.Errorf("the agent is working; undo after the turn ends")
	}
	ctx, cancel := context.WithTimeout(c.ctx, 30*time.Second)
	defer cancel()
	var res json.RawMessage
	if err := c.rpc.call(ctx, "thread/turns/list", map[string]any{"threadId": threadId, "sortDirection": "desc", "limit": 1, "itemsView": "notLoaded"}, &res); err != nil {
		return err
	}
	data := jArr(decodeObj(res), "data")
	if len(data) == 0 {
		return fmt.Errorf("nothing to undo")
	}
	last, _ := data[0].(map[string]any)
	return c.rpc.call(ctx, "thread/revert", map[string]any{"threadId": threadId, "beforeTurnId": jStr(last, "id")}, nil)
}

// startReview runs review/start inline on the thread.
func (c *codexAdapter) startReview(threadId, instructions string) error {
	target := map[string]any{"type": "uncommittedChanges"}
	if instructions != "" {
		target = map[string]any{"type": "custom", "instructions": instructions}
	}
	ctx, cancel := context.WithTimeout(c.ctx, 30*time.Second)
	defer cancel()
	var res json.RawMessage
	if err := c.rpc.call(ctx, "review/start", map[string]any{"threadId": threadId, "target": target}, &res); err != nil {
		return err
	}
	if id := jStr(jObj(decodeObj(res), "turn"), "id"); id != "" {
		c.cmu.Lock()
		c.turnId, c.turnActive = id, true
		c.cmu.Unlock()
	}
	return nil
}

// lookupTier finds the fast service tier id for model in the catalog
// (falls back to "priority").
func (c *codexAdapter) lookupTier(ctx context.Context, model string) {
	tctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	models, err := codexListModels(tctx, c.rpc)
	if err != nil {
		return
	}
	c.cmu.Lock()
	defer c.cmu.Unlock()
	if model == "" {
		model = c.model
	}
	for _, m := range models {
		if (m.model == model || m.id == model) && m.tier != "" {
			c.tier = m.tier
			return
		}
	}
}

// update stores new settings; Codex takes all of them per turn.
func (c *codexAdapter) update(next threadSettings) bool {
	cur := c.settings()
	c.setSettings(next)
	if next.Fast && !cur.Fast {
		c.cmu.Lock()
		known := c.tier != ""
		c.cmu.Unlock()
		if !known {
			c.lookupTier(c.ctx, next.Model)
		}
	}
	return false
}

func (c *codexAdapter) prompt(p promptInput) error {
	c.cmu.Lock()
	threadId, turnId, busy := c.threadId, c.turnId, c.turnActive
	skills := c.skills
	c.cmu.Unlock()

	// Built-in slash commands map onto app-server methods; "/skill" becomes
	// the "$skill" mention Codex understands.
	if !busy && len(p.Images) == 0 && strings.HasPrefix(p.Text, "/") {
		name, rest, _ := strings.Cut(strings.TrimPrefix(p.Text, "/"), " ")
		switch {
		case name == "compact":
			return c.compact()
		case name == "review":
			c.beginTurn()
			return c.startReview(threadId, strings.TrimSpace(rest))
		case skills[name]:
			p.Text = "$" + strings.TrimPrefix(p.Text, "/")
		}
	}

	ctx, cancel := context.WithTimeout(c.ctx, 30*time.Second)
	defer cancel()
	if busy && turnId != "" {
		params := map[string]any{"threadId": threadId, "expectedTurnId": turnId, "input": codexInput(p)}
		if p.MessageId != "" {
			params["clientUserMessageId"] = p.MessageId
		}
		if err := c.rpc.call(ctx, "turn/steer", params, nil); err == nil {
			return nil
		}
		// The turn ended in between: start a new one.
	}

	c.beginTurn()
	set := c.settings()
	c.cmu.Lock()
	c.planId = ""
	params := codexTurnOverrides(set, c.model, c.tier, c.planTurn)
	c.cmu.Unlock()
	params["threadId"] = threadId
	params["input"] = codexInput(p)
	if p.MessageId != "" {
		params["clientUserMessageId"] = p.MessageId
	}
	var res json.RawMessage
	err := c.rpc.call(ctx, "turn/start", params, &res)
	if err != nil {
		return err
	}
	c.cmu.Lock()
	c.turnActive = true
	c.planTurn = codexMode(set) == "plan"
	if set.Model != "" {
		c.model = set.Model
	}
	c.cmu.Unlock()
	if id := jStr(jObj(decodeObj(res), "turn"), "id"); id != "" {
		c.cmu.Lock()
		c.turnId = id
		c.cmu.Unlock()
	}
	return nil
}

func (c *codexAdapter) cancel() error {
	c.cancelApprovals()
	c.cmu.Lock()
	params := map[string]string{"threadId": c.threadId, "turnId": c.turnId}
	c.cmu.Unlock()
	ctx, cancel := context.WithTimeout(c.ctx, 10*time.Second)
	defer cancel()
	return c.rpc.call(ctx, "turn/interrupt", params, nil)
}

func (c *codexAdapter) stop() {
	c.stopping.Store(true)
	c.cancelCtx()
	c.cancelApprovals()
	if c.proc != nil {
		c.proc.kill()
	}
}

func (c *codexAdapter) alive() bool {
	return c.proc != nil && c.proc.alive() && !c.stopping.Load()
}

// --- notifications ---

func (c *codexAdapter) itemId(id string) string { return c.scopedId("i", id) }

func (c *codexAdapter) onNotify(method string, params json.RawMessage) {
	p := decodeObj(params)
	if method == "thread/started" {
		c.onThreadStarted(jObj(p, "thread"))
		return
	}
	// Events of a spawned subagent's own thread arrive on the same stream.
	c.cmu.Lock()
	own := c.threadId
	c.cmu.Unlock()
	if tid := jStr(p, "threadId"); tid != "" && own != "" && tid != own {
		c.onChildNotify(method, p, tid)
		return
	}
	switch method {
	case "turn/started":
		if id := jStr(jObj(p, "turn"), "id"); id != "" {
			c.cmu.Lock()
			c.turnId, c.turnActive = id, true
			c.cmu.Unlock()
		}
	case "thread/compacted":
		c.emit(protocol.ThreadEvent{Id: c.newId("compact"), Role: "status", Text: "Conversation compacted"})
	case "item/started":
		c.onItem(jObj(p, "item"), false, "")
	case "item/completed":
		c.onItem(jObj(p, "item"), true, "")
	case "item/agentMessage/delta":
		c.appendTo(c.itemId(jStr(p, "itemId")), "assistant", jStr(p, "delta"))
	case "item/reasoning/summaryTextDelta":
		itemId := jStr(p, "itemId")
		c.cmu.Lock()
		c.reasoning[itemId] = true
		c.cmu.Unlock()
		c.appendTo(c.itemId(itemId), "thought", jStr(p, "delta"))
	case "item/reasoning/textDelta":
		itemId := jStr(p, "itemId")
		c.cmu.Lock()
		summarised := c.reasoning[itemId]
		c.cmu.Unlock()
		if !summarised {
			c.appendTo(c.itemId(itemId), "thought", jStr(p, "delta"))
		}
	case "item/commandExecution/outputDelta":
		c.onCommandOutput(jStr(p, "itemId"), jStr(p, "delta", "chunk"))
	case "turn/plan/updated":
		var plan []protocol.PlanEntry
		for _, e := range jArr(p, "plan") {
			if m, ok := e.(map[string]any); ok {
				plan = append(plan, protocol.PlanEntry{Content: jStr(m, "step", "content"), Status: planStatus(jStr(m, "status"))})
			}
		}
		if plan == nil {
			plan = []protocol.PlanEntry{}
		}
		c.cmu.Lock()
		if c.planId == "" {
			c.planId = c.newId("plan")
		}
		id := c.planId
		c.cmu.Unlock()
		c.emit(protocol.ThreadEvent{Id: id, Role: "plan", Plan: plan})
	case "thread/tokenUsage/updated":
		tu := jObj(p, "tokenUsage")
		total := jObj(tu, "total")
		if len(total) == 0 {
			total = tu
		}
		in, ok1 := jNum(total, "inputTokens", "input_tokens")
		out, ok2 := jNum(total, "outputTokens", "output_tokens")
		if ok1 || ok2 {
			c.cmu.Lock()
			c.usage.InputTokens, c.usage.OutputTokens = int64(in), int64(out)
			if last, ok := jNum(jObj(tu, "last"), "totalTokens", "total_tokens"); ok {
				c.usage.ContextTokens = int64(last)
			}
			if w, ok := jNum(tu, "modelContextWindow", "model_context_window"); ok {
				c.usage.ContextWindow = int64(w)
			}
			usage := c.usage
			c.cmu.Unlock()
			c.sink.state(protocol.ThreadState{Usage: &usage})
		}
	case "account/rateLimits/updated":
		if l, ok := codexLimitsEvent(params); ok {
			reportLimits(c.sink, l)
		}
	case "turn/completed":
		c.cmu.Lock()
		c.turnActive = false
		c.cmu.Unlock()
		turn := jObj(p, "turn")
		c.finishAgents(jStr(turn, "status") == "completed")
		switch jStr(turn, "status") {
		case "failed":
			msg := jStr(jObj(turn, "error"), "message")
			if msg == "" {
				msg = "Codex turn failed"
			}
			c.emitError(msg)
		case "interrupted":
			c.emit(protocol.ThreadEvent{Id: c.newId("stop"), Role: "status", Text: "Cancelled"})
		}
		c.finishTurn(0)
	case "error":
		if !jBool(p, "willRetry") {
			msg := jStr(jObj(p, "error"), "message")
			if msg == "" {
				msg = jStr(p, "message")
			}
			if msg != "" {
				c.emitError(msg)
			}
		}
	}
}

func (c *codexAdapter) appendTo(id, role, text string) {
	if text == "" {
		return
	}
	c.mu.Lock()
	if role == "assistant" {
		c.lastAssistant = id
	}
	c.mu.Unlock()
	c.sink.event(protocol.ThreadEvent{Id: id, Role: role, Text: text, Append: true})
}

// onCommandOutput streams command output, throttled to a few updates a second.
func (c *codexAdapter) onCommandOutput(itemId, delta string) {
	if itemId == "" || delta == "" {
		return
	}
	c.cmu.Lock()
	out := c.cmdOutput[itemId] + delta
	if len(out) > toolOutputCap {
		out = out[len(out)-toolOutputCap:]
	}
	c.cmdOutput[itemId] = out
	due := time.Since(c.cmdEmitted[itemId]) > 300*time.Millisecond
	if due {
		c.cmdEmitted[itemId] = time.Now()
	}
	c.cmu.Unlock()
	if due {
		c.sink.event(protocol.ThreadEvent{Id: c.itemId(itemId), Tool: &protocol.ThreadTool{Output: out}})
	}
}

func codexItemStatus(item jsonObj, done bool) string {
	switch jStr(item, "status") {
	case "failed", "declined", "error":
		return "error"
	case "completed":
		return "completed"
	case "inProgress", "in_progress", "running":
		if !done {
			return "running"
		}
	}
	if done {
		return "completed"
	}
	return "running"
}

func joinStrings(v []any, sep string) string {
	parts := make([]string, 0, len(v))
	for _, x := range v {
		switch t := x.(type) {
		case string:
			parts = append(parts, t)
		case map[string]any:
			if s := jStr(t, "text"); s != "" {
				parts = append(parts, s)
			}
		}
	}
	return strings.Join(parts, sep)
}

func (c *codexAdapter) onItem(item jsonObj, done bool, parent string) {
	id := jStr(item, "id")
	if id == "" {
		return
	}
	msgId := c.itemId(id)
	status := codexItemStatus(item, done)
	switch jStr(item, "type") {
	case "agentMessage":
		if parent != "" {
			if text := jStr(item, "text"); done && text != "" {
				c.emit(protocol.ThreadEvent{Id: parent, Role: "tool", Tool: &protocol.ThreadTool{Agent: &protocol.ThreadAgent{Result: text}}})
			}
			return
		}
		if done {
			if text := jStr(item, "text"); text != "" {
				c.emit(protocol.ThreadEvent{Id: msgId, Role: "assistant", Text: text})
			}
		}
	case "reasoning":
		if done && parent == "" {
			text := joinStrings(jArr(item, "summary"), "\n\n")
			if text == "" {
				text = joinStrings(jArr(item, "content"), "\n\n")
			}
			if text != "" {
				c.emit(protocol.ThreadEvent{Id: msgId, Role: "thought", Text: text})
			}
		}
	case "commandExecution":
		command := toolInputDisplay(map[string]any{"command": item["command"]})
		tool := &protocol.ThreadTool{Name: "bash", Title: "Run command", Status: status, Input: command}
		if done {
			if exit, ok := jNum(item, "exitCode", "exit_code"); ok && exit != 0 {
				tool.Status = "error"
			}
			tool.Output = jStr(item, "aggregatedOutput", "aggregated_output", "output")
			if tool.Output == "" {
				c.cmu.Lock()
				tool.Output = c.cmdOutput[id]
				c.cmu.Unlock()
			}
			c.cmu.Lock()
			delete(c.cmdOutput, id)
			delete(c.cmdEmitted, id)
			c.cmu.Unlock()
		}
		c.emitTool(msgId, parent, tool, done)
	case "fileChange":
		tool := &protocol.ThreadTool{Name: "edit", Title: "Edit files", Status: status}
		for _, ch := range jArr(item, "changes") {
			m, ok := ch.(map[string]any)
			if !ok {
				continue
			}
			tool.Files = append(tool.Files, unifiedDiffFile(jStr(m, "path"), jStr(m, "diff", "unified_diff")))
		}
		if len(tool.Files) == 1 {
			tool.Title = "Edit " + filepath.Base(tool.Files[0].Path)
			tool.Input = tool.Files[0].Path
		}
		c.emitTool(msgId, parent, tool, done)
	case "mcpToolCall":
		server, name := jStr(item, "server"), jStr(item, "tool")
		tool := &protocol.ThreadTool{Name: "mcp", Title: server + " · " + name, Status: status, Input: clip(compactJSON(item["arguments"]), 500)}
		if errObj := jObj(item, "error"); len(errObj) > 0 {
			tool.Status = "error"
			tool.Output = jStr(errObj, "message")
		} else if res := jObj(item, "result"); len(res) > 0 {
			tool.Output = joinStrings(jArr(res, "content"), "\n")
			if tool.Output == "" {
				tool.Output = compactJSON(res)
			}
		}
		c.emitTool(msgId, parent, tool, done)
	case "webSearch":
		c.emitTool(msgId, parent, &protocol.ThreadTool{
			Name: "websearch", Title: "Search the web", Status: status, Input: jStr(item, "query"),
		}, done)
	case "collabAgentToolCall":
		c.onCollab(item, status, done)
	case "subAgentActivity":
		c.onSubAgentActivity(item)
	}
}

// emitTool sends a tool message; a subagent's own step carries its parent
// row's id and counts toward that row's tool total once it completes.
func (c *codexAdapter) emitTool(msgId, parent string, tool *protocol.ThreadTool, done bool) {
	ev := protocol.ThreadEvent{Id: msgId, Role: "tool", Tool: tool}
	if parent != "" {
		ev.ParentId = parent
	}
	c.emit(ev)
	if parent == "" || !done {
		return
	}
	c.cmu.Lock()
	var count int
	for _, sub := range c.agents {
		if sub.msgId == parent {
			sub.tools++
			count = sub.tools
		}
	}
	c.cmu.Unlock()
	if count > 0 {
		c.emit(protocol.ThreadEvent{Id: parent, Role: "tool", Tool: &protocol.ThreadTool{Agent: &protocol.ThreadAgent{Tools: count}}})
	}
}

// --- subagents ---

// codexAgentStatus maps a CollabAgentStatus onto a tool status; "" keeps the
// row running.
func codexAgentStatus(state string) string {
	switch state {
	case "completed", "shutdown":
		return "completed"
	case "errored", "notFound", "interrupted":
		return "error"
	}
	return ""
}

// firstLine is the first non-empty line of s, clipped for a one-line title.
func firstLine(s string, n int) string {
	for _, line := range strings.Split(s, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			return clip(line, n)
		}
	}
	return ""
}

// subRow returns the transcript row for a subagent thread, creating its
// bookkeeping (and reporting whether it is new).
func (c *codexAdapter) subRow(threadId, msgId string) (*codexSub, bool) {
	c.cmu.Lock()
	defer c.cmu.Unlock()
	if sub := c.agents[threadId]; sub != nil {
		return sub, false
	}
	if msgId == "" {
		msgId = c.itemId("agent-" + threadId)
	}
	sub := &codexSub{msgId: msgId, start: time.Now()}
	c.agents[threadId] = sub
	return sub, true
}

// onCollab handles Codex's collab tool calls. spawnAgent opens a subagent row
// (its call status is only the spawn, so the row stays running until the
// agent's own state or turn says otherwise); the other calls update the rows
// of the agents they name, and wait carries their final messages.
func (c *codexAdapter) onCollab(item jsonObj, status string, done bool) {
	tool := jStr(item, "tool")
	var receivers []string
	for _, r := range jArr(item, "receiverThreadIds") {
		if id, ok := r.(string); ok && id != "" {
			receivers = append(receivers, id)
		}
	}
	states := jObj(item, "agentsStates")
	if tool == "spawnAgent" {
		prompt := jStr(item, "prompt")
		for _, tid := range receivers {
			sub, fresh := c.subRow(tid, "")
			agent := &protocol.ThreadAgent{Task: firstLine(prompt, 120), Prompt: clip(prompt, 2000), Model: jStr(item, "model")}
			c.cmu.Lock()
			agent.Name, agent.Type = sub.name, sub.role
			c.cmu.Unlock()
			t := &protocol.ThreadTool{Name: "agent", Title: agent.Task, Input: clip(prompt, 500), Status: "running", Agent: agent}
			if t.Title == "" {
				t.Title = "Subagent"
			}
			if st := codexAgentStatus(jStr(jObj(states, tid), "status")); st != "" {
				t.Status = st
			}
			if fresh || done {
				c.emit(protocol.ThreadEvent{Id: sub.msgId, Role: "tool", Tool: t})
			}
		}
		if len(receivers) == 0 && done && status == "error" {
			c.emit(protocol.ThreadEvent{Id: c.itemId(jStr(item, "id")), Role: "tool", Tool: &protocol.ThreadTool{
				Name: "agent", Title: firstLine(prompt, 120), Status: "error", Agent: &protocol.ThreadAgent{Task: firstLine(prompt, 120), Prompt: clip(prompt, 2000)},
			}})
		}
		return
	}
	// Other collab calls: surface the final message and status of each agent.
	for tid, raw := range states {
		state, _ := raw.(map[string]any)
		c.cmu.Lock()
		sub := c.agents[tid]
		c.cmu.Unlock()
		if sub == nil || sub.done {
			continue
		}
		t := &protocol.ThreadTool{Agent: &protocol.ThreadAgent{}}
		if st := codexAgentStatus(jStr(state, "status")); st != "" {
			t.Status = st
			t.Agent.Result = jStr(state, "message")
			t.Agent.DurationMs = time.Since(sub.start).Milliseconds()
			c.cmu.Lock()
			sub.done = true
			c.cmu.Unlock()
		}
		if t.Status != "" || t.Agent.Result != "" {
			c.emit(protocol.ThreadEvent{Id: sub.msgId, Role: "tool", Tool: t})
		}
	}
	if tool == "wait" || tool == "listAgents" || len(receivers) == 0 {
		return // bookkeeping calls are not steps of their own
	}
	verb := map[string]string{"sendInput": "Message", "sendMessage": "Message", "followupTask": "Follow up with", "resumeAgent": "Resume", "closeAgent": "Close", "interruptAgent": "Interrupt"}[tool]
	if verb == "" {
		return
	}
	c.cmu.Lock()
	label := "subagent"
	if sub := c.agents[receivers[0]]; sub != nil && sub.name != "" {
		label = sub.name
	}
	c.cmu.Unlock()
	c.emit(protocol.ThreadEvent{Id: c.itemId(jStr(item, "id")), Role: "tool", Tool: &protocol.ThreadTool{
		Name: "other", Title: verb + " " + label, Status: status, Input: clip(jStr(item, "prompt"), 300),
	}})
}

// onSubAgentActivity handles the newer subAgentActivity items, which report a
// subagent starting, being messaged, interrupted or finishing.
func (c *codexAdapter) onSubAgentActivity(item jsonObj) {
	tid := jStr(item, "agentThreadId")
	if tid == "" {
		return
	}
	sub, fresh := c.subRow(tid, "")
	name := jStr(item, "agentPath")
	if i := strings.LastIndex(name, "/"); i >= 0 {
		name = name[i+1:]
	}
	tool := &protocol.ThreadTool{Name: "agent", Agent: &protocol.ThreadAgent{Name: name, Model: jStr(item, "model")}}
	switch jStr(item, "kind") {
	case "started":
		tool.Status = "running"
	case "completed":
		tool.Status = "completed"
	case "interrupted":
		tool.Status = "error"
	default:
		if !fresh {
			return
		}
		tool.Status = "running"
	}
	if fresh {
		tool.Title = "Subagent " + name
		tool.Agent.Task = ""
	}
	if tool.Status != "running" {
		c.cmu.Lock()
		sub.done = true
		c.cmu.Unlock()
	}
	c.emit(protocol.ThreadEvent{Id: sub.msgId, Role: "tool", Tool: tool})
}

// onThreadStarted records the nickname and role Codex gives a spawned
// subagent, and puts them on its row.
func (c *codexAdapter) onThreadStarted(thread jsonObj) {
	tid := jStr(thread, "id")
	nick, role := jStr(thread, "agentNickname"), jStr(thread, "agentRole")
	if tid == "" || (nick == "" && role == "" && jStr(thread, "parentThreadId") == "") {
		return
	}
	c.cmu.Lock()
	if tid == c.threadId {
		c.cmu.Unlock()
		return
	}
	known := c.agents[tid] != nil
	c.cmu.Unlock()
	sub, _ := c.subRow(tid, "")
	c.cmu.Lock()
	sub.name, sub.role = nick, role
	msgId := sub.msgId
	c.cmu.Unlock()
	tool := &protocol.ThreadTool{Agent: &protocol.ThreadAgent{Name: nick, Type: role}}
	if !known { // the spawn call hasn't been seen: open the row now
		tool.Name, tool.Title, tool.Status = "agent", "Subagent", "running"
	}
	c.emit(protocol.ThreadEvent{Id: msgId, Role: "tool", Tool: tool})
}

// onChildNotify routes the events of a subagent's own thread: its tool calls
// become nested steps of its row, its last message is its result, and its
// turn ending ends the row. Everything else (reasoning, usage) is dropped so
// it can't leak into the parent turn.
func (c *codexAdapter) onChildNotify(method string, p jsonObj, tid string) {
	c.cmu.Lock()
	sub := c.agents[tid]
	c.cmu.Unlock()
	if sub == nil {
		return // not a subagent we know; ignore stray threads
	}
	switch method {
	case "item/started":
		c.onItem(jObj(p, "item"), false, sub.msgId)
	case "item/completed":
		c.onItem(jObj(p, "item"), true, sub.msgId)
	case "item/commandExecution/outputDelta":
		c.onCommandOutput(jStr(p, "itemId"), jStr(p, "delta", "chunk"))
	case "turn/completed":
		status := "completed"
		if s := jStr(jObj(p, "turn"), "status"); s == "failed" || s == "interrupted" {
			status = "error"
		}
		c.cmu.Lock()
		already := sub.done
		sub.done = true
		c.cmu.Unlock()
		if !already {
			c.emit(protocol.ThreadEvent{Id: sub.msgId, Role: "tool", Tool: &protocol.ThreadTool{Status: status, Agent: &protocol.ThreadAgent{DurationMs: time.Since(sub.start).Milliseconds()}}})
		}
	}
}

// finishAgents ends subagent rows still running when the parent turn ends.
func (c *codexAdapter) finishAgents(ok bool) {
	status := "completed"
	if !ok {
		status = "error"
	}
	var open []*codexSub
	c.cmu.Lock()
	for _, sub := range c.agents {
		if !sub.done {
			sub.done = true
			open = append(open, sub)
		}
	}
	c.cmu.Unlock()
	for _, sub := range open {
		c.emit(protocol.ThreadEvent{Id: sub.msgId, Role: "tool", Tool: &protocol.ThreadTool{Status: status, Agent: &protocol.ThreadAgent{DurationMs: time.Since(sub.start).Milliseconds()}}})
	}
}

// --- server requests (approvals) ---

func (c *codexAdapter) onRequest(id json.RawMessage, method string, params json.RawMessage) {
	p := decodeObj(params)
	var title, detail string
	var options []protocol.ApprovalOption
	legacy := false
	switch method {
	case "item/commandExecution/requestApproval":
		title = "Run command?"
		detail = toolInputDisplay(map[string]any{"command": p["command"]})
		if detail == "" {
			detail = jStr(p, "reason")
		}
	case "item/fileChange/requestApproval":
		title, detail = "Apply file changes?", jStr(p, "reason")
	case "item/permissions/requestApproval":
		c.requestPermissions(id, p)
		return
	case "item/tool/requestUserInput":
		c.requestUserInput(id, p)
		return
	case "execCommandApproval":
		legacy = true
		title = "Run command?"
		detail = toolInputDisplay(map[string]any{"command": p["command"]})
	case "applyPatchApproval":
		legacy = true
		title, detail = "Apply file changes?", jStr(p, "reason")
	default:
		c.rpc.respondError(id, -32601, "method not found: "+method)
		return
	}
	if legacy {
		options = []protocol.ApprovalOption{
			{Id: "approved", Label: "Allow", Kind: "allow_once"},
			{Id: "approved_for_session", Label: "Allow for this session", Kind: "allow_always"},
			{Id: "denied", Label: "Decline", Kind: "reject_once"},
		}
	} else {
		options = []protocol.ApprovalOption{
			{Id: "accept", Label: "Allow", Kind: "allow_once"},
			{Id: "acceptForSession", Label: "Allow for this session", Kind: "allow_always"},
			{Id: "decline", Label: "Decline", Kind: "reject_once"},
		}
	}
	if c.fullAccess() {
		c.rpc.respond(id, map[string]string{"decision": options[0].Id})
		return
	}
	choice := c.askApproval(c.ctx, protocol.ThreadApprovalRequest{
		Id: c.newId("perm"), Title: title, Detail: detail, Options: options,
	})
	if choice == "" {
		choice = options[2].Id
	}
	c.rpc.respond(id, map[string]string{"decision": choice})
}

// codexQuestions maps requestUserInput questions onto question messages
// (option ids are the labels Codex expects back).
func codexQuestions(idPrefix string, p jsonObj) ([]protocol.ThreadQuestion, []string) {
	var qs []protocol.ThreadQuestion
	var ids []string
	for i, x := range jArr(p, "questions") {
		m, ok := x.(map[string]any)
		if !ok {
			continue
		}
		text := jStr(m, "question")
		if h := jStr(m, "header"); h != "" && text == "" {
			text = h
		}
		q := protocol.ThreadQuestion{Id: fmt.Sprintf("%s-%d", idPrefix, i), Text: text, Options: []protocol.QuestionOption{}}
		for _, o := range jArr(m, "options") {
			if om, ok := o.(map[string]any); ok && jStr(om, "label") != "" {
				q.Options = append(q.Options, protocol.QuestionOption{Id: jStr(om, "label"), Label: jStr(om, "label"), Description: jStr(om, "description")})
			}
		}
		q.AllowText = jBool(m, "isOther") || len(q.Options) == 0
		qs = append(qs, q)
		ids = append(ids, jStr(m, "id"))
	}
	return qs, ids
}

// requestUserInput asks the user the tool's questions, one message each.
func (c *codexAdapter) requestUserInput(id json.RawMessage, p jsonObj) {
	questions, ids := codexQuestions(c.newId("q"), p)
	answers := map[string]any{}
	for i, q := range questions {
		chosen, text, ok := c.askQuestion(c.ctx, q)
		if !ok {
			break
		}
		if text != "" {
			chosen = append(chosen, text)
		}
		answers[ids[i]] = map[string]any{"answers": chosen}
	}
	c.rpc.respond(id, map[string]any{"answers": answers})
}

// requestPermissions answers a request for extra sandbox permissions
// (filesystem roots, network). Granting echoes the requested profile back;
// declining grants nothing.
func (c *codexAdapter) requestPermissions(id json.RawMessage, p jsonObj) {
	requested := jObj(p, "permissions")
	grant := func(scope string) {
		c.rpc.respond(id, map[string]any{"permissions": requested, "scope": scope})
	}
	if c.fullAccess() {
		grant("session")
		return
	}
	detail := jStr(p, "reason")
	if detail == "" {
		detail = clip(compactJSON(requested), 500)
	}
	options := []protocol.ApprovalOption{
		{Id: "turn", Label: "Allow for this turn", Kind: "allow_once"},
		{Id: "session", Label: "Allow for this session", Kind: "allow_always"},
		{Id: "deny", Label: "Decline", Kind: "reject_once"},
	}
	choice := c.askApproval(c.ctx, protocol.ThreadApprovalRequest{
		Id: c.newId("perm"), Title: "Grant extra permissions?", Detail: detail, Options: options,
	})
	switch choice {
	case "turn", "session":
		grant(choice)
	default:
		c.rpc.respond(id, map[string]any{"permissions": map[string]any{}, "scope": "turn"})
	}
}
