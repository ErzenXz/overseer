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
	}
}

// codexPolicy maps the contract's access level to approvalPolicy + sandbox.
func codexPolicy(access string) (string, string) {
	switch access {
	case "ask":
		return "on-request", "read-only"
	case "full":
		return "never", "danger-full-access"
	}
	return "on-request", "workspace-write"
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

	approval, sandbox := codexPolicy(c.cfg.Access)
	params := map[string]any{"cwd": c.cfg.Cwd, "approvalPolicy": approval, "sandbox": sandbox}
	if c.cfg.Model != "" {
		params["model"] = c.cfg.Model
	}
	var res json.RawMessage
	if c.cfg.ResumeId != "" {
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
	c.cmu.Unlock()
	c.mu.Lock()
	c.resume = id
	c.mu.Unlock()
	c.started.Store(true)
	return id, nil
}

func (c *codexAdapter) prompt(text string) error {
	c.beginTurn()
	c.cmu.Lock()
	threadId := c.threadId
	c.planId = ""
	c.cmu.Unlock()
	ctx, cancel := context.WithTimeout(c.ctx, 30*time.Second)
	defer cancel()
	var res json.RawMessage
	err := c.rpc.call(ctx, "turn/start", map[string]any{
		"threadId": threadId,
		"input":    []map[string]string{{"type": "text", "text": text}},
	}, &res)
	if err != nil {
		return err
	}
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
	switch method {
	case "turn/started":
		if id := jStr(jObj(p, "turn"), "id"); id != "" {
			c.cmu.Lock()
			c.turnId = id
			c.cmu.Unlock()
		}
	case "item/started":
		c.onItem(jObj(p, "item"), false)
	case "item/completed":
		c.onItem(jObj(p, "item"), true)
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
			usage := c.usage
			c.cmu.Unlock()
			c.sink.state(protocol.ThreadState{Usage: &usage})
		}
	case "turn/completed":
		turn := jObj(p, "turn")
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

func (c *codexAdapter) onItem(item jsonObj, done bool) {
	id := jStr(item, "id")
	if id == "" {
		return
	}
	msgId := c.itemId(id)
	status := codexItemStatus(item, done)
	switch jStr(item, "type") {
	case "agentMessage":
		if done {
			if text := jStr(item, "text"); text != "" {
				c.emit(protocol.ThreadEvent{Id: msgId, Role: "assistant", Text: text})
			}
		}
	case "reasoning":
		if done {
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
		c.emit(protocol.ThreadEvent{Id: msgId, Role: "tool", Tool: tool})
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
		c.emit(protocol.ThreadEvent{Id: msgId, Role: "tool", Tool: tool})
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
		c.emit(protocol.ThreadEvent{Id: msgId, Role: "tool", Tool: tool})
	case "webSearch":
		c.emit(protocol.ThreadEvent{Id: msgId, Role: "tool", Tool: &protocol.ThreadTool{
			Name: "websearch", Title: "Search the web", Status: status, Input: jStr(item, "query"),
		}})
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
	if c.cfg.Access == "full" {
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

// requestPermissions answers a request for extra sandbox permissions
// (filesystem roots, network). Granting echoes the requested profile back;
// declining grants nothing.
func (c *codexAdapter) requestPermissions(id json.RawMessage, p jsonObj) {
	requested := jObj(p, "permissions")
	grant := func(scope string) {
		c.rpc.respond(id, map[string]any{"permissions": requested, "scope": scope})
	}
	if c.cfg.Access == "full" {
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
