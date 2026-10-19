package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// claudeAdapter drives Claude Code in headless stream-json mode, answering
// its permission prompts over the stdio control protocol.
type claudeAdapter struct {
	adapterBase

	ctx       context.Context
	cancelCtx context.CancelFunc
	proc      *agentProcess
	ctlSeq    atomic.Int64
	// interrupted suppresses the error result Claude reports for a turn the
	// user cancelled.
	interrupted atomic.Bool

	smu         sync.Mutex
	ctlWait     map[string]chan struct{}
	curMsg      string              // API message id being streamed
	blockIds    map[int]string      // stream block index -> message id
	streamed    map[string][]string // "<msg>/text" | "<msg>/thinking" -> streamed ids in order
	finalCount  map[string]int      // same keys: blocks already seen in final messages
	toolNames   map[string]string   // tool_use id -> tool name
	alwaysAllow map[string]bool     // tools the user allowed for this process
	planId      string
	usage       protocol.Usage
}

func newClaudeAdapter(cfg protocol.ThreadStart, sink threadSink) *claudeAdapter {
	ctx, cancel := context.WithCancel(context.Background())
	return &claudeAdapter{
		adapterBase: newAdapterBase(cfg, sink),
		ctx:         ctx,
		cancelCtx:   cancel,
		ctlWait:     map[string]chan struct{}{},
		blockIds:    map[int]string{},
		streamed:    map[string][]string{},
		finalCount:  map[string]int{},
		toolNames:   map[string]string{},
		alwaysAllow: map[string]bool{},
	}
}

func claudePermissionMode(access string) string {
	switch access {
	case "ask":
		return "plan"
	case "auto":
		return "auto"
	case "full":
		return "bypassPermissions"
	}
	return "acceptEdits"
}

// claudeMcpConfig renders registry servers as a --mcp-config JSON document.
func claudeMcpConfig(servers []protocol.McpServer) string {
	cfg := map[string]any{}
	for _, s := range servers {
		name := mcpServerKey(s.Name, cfg)
		switch s.Transport {
		case "stdio":
			args := s.Args
			if args == nil {
				args = []string{}
			}
			entry := map[string]any{"command": s.Command, "args": args}
			if len(s.Env) > 0 {
				entry["env"] = s.Env
			}
			cfg[name] = entry
		case "http":
			entry := map[string]any{"type": "http", "url": s.Url}
			if len(s.Headers) > 0 {
				entry["headers"] = s.Headers
			}
			cfg[name] = entry
		}
	}
	if len(cfg) == 0 {
		return ""
	}
	b, _ := json.Marshal(map[string]any{"mcpServers": cfg})
	return string(b)
}

var mcpKeyRe = regexp.MustCompile(`[^A-Za-z0-9_-]+`)

// mcpServerKey makes a config-safe, unique key for a server name.
func mcpServerKey(name string, taken map[string]any) string {
	key := strings.Trim(mcpKeyRe.ReplaceAllString(name, "_"), "_")
	if key == "" {
		key = "server"
	}
	base := key
	for i := 2; ; i++ {
		if _, dup := taken[key]; !dup {
			return key
		}
		key = base + "_" + strconv.Itoa(i)
	}
}

func (c *claudeAdapter) start(ctx context.Context) (string, error) {
	path, err := lookAgentBinary("claude")
	if err != nil {
		return "", err
	}
	args := []string{
		"--print", "--input-format", "stream-json", "--output-format", "stream-json",
		"--verbose", "--include-partial-messages", "--permission-prompt-tool", "stdio",
		"--permission-mode", claudePermissionMode(c.cfg.Access),
	}
	if c.cfg.Model != "" {
		args = append(args, "--model", c.cfg.Model)
	}
	if c.cfg.ResumeId != "" {
		args = append(args, "--resume", c.cfg.ResumeId)
	}
	if mcp := claudeMcpConfig(c.cfg.McpServers); mcp != "" {
		args = append(args, "--mcp-config", mcp)
	}
	proc, err := startAgentProcess(path, args, c.cfg.Cwd, agentEnv())
	if err != nil {
		return "", err
	}
	c.proc = proc
	proc.readLines(c.onLine)
	c.watchExit(proc, nil)

	// Initialize the control protocol. Older CLIs may not answer; carry on
	// after a grace period as long as the process is still up.
	waiter := c.sendControl(map[string]any{"subtype": "initialize"})
	select {
	case <-waiter:
	case <-proc.done:
		return "", fmt.Errorf("claude exited during startup: %s", proc.exitError())
	case <-time.After(20 * time.Second):
	case <-ctx.Done():
		return "", ctx.Err()
	}
	if !proc.alive() {
		return "", fmt.Errorf("claude exited during startup: %s", proc.exitError())
	}
	c.started.Store(true)
	return c.cfg.ResumeId, nil
}

// sendControl writes a control_request and returns a channel closed when the
// matching control_response arrives.
func (c *claudeAdapter) sendControl(request map[string]any) <-chan struct{} {
	id := fmt.Sprintf("ovs-%d", c.ctlSeq.Add(1))
	ch := make(chan struct{})
	c.smu.Lock()
	c.ctlWait[id] = ch
	c.smu.Unlock()
	c.proc.writeJSON(map[string]any{"type": "control_request", "request_id": id, "request": request})
	return ch
}

func (c *claudeAdapter) prompt(text string) error {
	c.beginTurn()
	c.smu.Lock()
	c.planId = ""
	c.smu.Unlock()
	session := c.resumeId()
	if session == "" {
		session = "default"
	}
	return c.proc.writeJSON(map[string]any{
		"type": "user",
		"message": map[string]any{
			"role":    "user",
			"content": []map[string]string{{"type": "text", "text": text}},
		},
		"parent_tool_use_id": nil,
		"session_id":         session,
	})
}

func (c *claudeAdapter) cancel() error {
	c.interrupted.Store(true)
	c.cancelApprovals()
	c.sendControl(map[string]any{"subtype": "interrupt"})
	return nil
}

func (c *claudeAdapter) stop() {
	c.stopping.Store(true)
	c.cancelCtx()
	c.cancelApprovals()
	if c.proc != nil {
		c.proc.kill()
	}
}

func (c *claudeAdapter) alive() bool {
	return c.proc != nil && c.proc.alive() && !c.stopping.Load()
}

// --- stdout ---

func (c *claudeAdapter) onLine(line []byte) {
	m := decodeObj(line)
	switch jStr(m, "type") {
	case "system":
		if jStr(m, "subtype") == "init" {
			c.setResumeId(jStr(m, "session_id"))
		}
	case "stream_event":
		if m["parent_tool_use_id"] != nil {
			return // sub-agent chatter; its tool calls still show up below
		}
		c.onStreamEvent(jObj(m, "event"))
	case "assistant":
		c.onAssistant(jObj(m, "message"), m["parent_tool_use_id"] != nil)
	case "user":
		msg := jObj(m, "message")
		for _, b := range jArr(msg, "content") {
			if block, ok := b.(map[string]any); ok && jStr(block, "type") == "tool_result" {
				c.onToolResult(block)
			}
		}
	case "result":
		c.onResult(m)
	case "control_request":
		go c.onControlRequest(line)
	case "control_response":
		id := jStr(jObj(m, "response"), "request_id")
		c.smu.Lock()
		ch := c.ctlWait[id]
		delete(c.ctlWait, id)
		c.smu.Unlock()
		if ch != nil {
			close(ch)
		}
	}
}

func (c *claudeAdapter) onStreamEvent(ev jsonObj) {
	idx := -1
	if f, ok := jNum(ev, "index"); ok {
		idx = int(f)
	}
	switch jStr(ev, "type") {
	case "message_start":
		c.smu.Lock()
		c.curMsg = jStr(jObj(ev, "message"), "id")
		c.blockIds = map[int]string{}
		c.smu.Unlock()
	case "content_block_start":
		kind := jStr(jObj(ev, "content_block"), "type")
		if kind != "text" && kind != "thinking" {
			return
		}
		c.smu.Lock()
		id := c.scopedId("m", fmt.Sprintf("%s-%d", c.curMsg, idx))
		c.blockIds[idx] = id
		key := c.curMsg + "/" + kind
		c.streamed[key] = append(c.streamed[key], id)
		c.smu.Unlock()
	case "content_block_delta":
		delta := jObj(ev, "delta")
		c.smu.Lock()
		id := c.blockIds[idx]
		c.smu.Unlock()
		if id == "" {
			return
		}
		switch jStr(delta, "type") {
		case "text_delta":
			c.appendText(id, "assistant", jStr(delta, "text"))
		case "thinking_delta":
			c.appendText(id, "thought", jStr(delta, "thinking"))
		}
	}
}

// appendText streams into an explicit message id.
func (c *claudeAdapter) appendText(id, role, text string) {
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

// finalBlockId maps the k-th text/thinking block of a final assistant message
// onto the id it was streamed under (Claude Code may split one API message
// across several assistant lines).
func (c *claudeAdapter) finalBlockId(msgId, kind string) string {
	c.smu.Lock()
	defer c.smu.Unlock()
	key := msgId + "/" + kind
	k := c.finalCount[key]
	c.finalCount[key] = k + 1
	if ids := c.streamed[key]; k < len(ids) {
		return ids[k]
	}
	return c.scopedId("m", fmt.Sprintf("%s-%s%d", msgId, kind, k))
}

func (c *claudeAdapter) onAssistant(msg jsonObj, sub bool) {
	msgId := jStr(msg, "id")
	if msgId == "" {
		msgId = c.newId("msg")
	}
	for _, b := range jArr(msg, "content") {
		block, ok := b.(map[string]any)
		if !ok {
			continue
		}
		switch jStr(block, "type") {
		case "text":
			if sub {
				continue
			}
			c.emit(protocol.ThreadEvent{Id: c.finalBlockId(msgId, "text"), Role: "assistant", Text: jStr(block, "text")})
		case "thinking":
			if sub {
				continue
			}
			if text := jStr(block, "thinking"); text != "" {
				c.emit(protocol.ThreadEvent{Id: c.finalBlockId(msgId, "thinking"), Role: "thought", Text: text})
			}
		case "tool_use":
			c.onToolUse(block)
		}
	}
}

var claudeToolNames = map[string]string{
	"Bash": "bash", "BashOutput": "bash", "KillShell": "bash", "Read": "read", "NotebookRead": "read",
	"Edit": "edit", "MultiEdit": "edit", "NotebookEdit": "edit", "Write": "write",
	"Grep": "grep", "Glob": "glob", "LS": "glob", "WebFetch": "webfetch", "WebSearch": "websearch",
	"TodoWrite": "todo",
}

func claudeToolName(name string) string {
	if strings.HasPrefix(name, "mcp__") {
		return "mcp"
	}
	if n := claudeToolNames[name]; n != "" {
		return n
	}
	return "other"
}

func claudeToolTitle(name string, input jsonObj) string {
	base := func(k string) string { return filepath.Base(jStr(input, k)) }
	switch name {
	case "Bash":
		if d := jStr(input, "description"); d != "" {
			return d
		}
		return "Run command"
	case "Read":
		return "Read " + base("file_path")
	case "Edit", "MultiEdit":
		return "Edit " + base("file_path")
	case "Write":
		return "Write " + base("file_path")
	case "Grep":
		return "Search for " + clip(jStr(input, "pattern"), 60)
	case "Glob":
		return "Find " + clip(jStr(input, "pattern"), 60)
	case "WebFetch":
		return "Fetch " + clip(jStr(input, "url"), 80)
	case "WebSearch":
		return "Search the web"
	case "Task":
		return "Agent: " + clip(jStr(input, "description"), 60)
	}
	if strings.HasPrefix(name, "mcp__") {
		parts := strings.SplitN(strings.TrimPrefix(name, "mcp__"), "__", 2)
		if len(parts) == 2 {
			return parts[0] + " · " + parts[1]
		}
	}
	return name
}

func claudeToolInput(name string, input jsonObj) string {
	switch name {
	case "Bash":
		return jStr(input, "command")
	case "WebSearch":
		return jStr(input, "query")
	case "Task":
		return clip(jStr(input, "prompt"), 500)
	}
	return toolInputDisplay(input)
}

func claudeToolFiles(name string, input jsonObj) []protocol.ThreadToolFile {
	path := jStr(input, "file_path")
	switch name {
	case "Edit":
		old, _ := input["old_string"].(string)
		repl, _ := input["new_string"].(string)
		return []protocol.ThreadToolFile{fileDiff(path, old, repl)}
	case "MultiEdit":
		var oldParts, newParts []string
		for _, e := range jArr(input, "edits") {
			if m, ok := e.(map[string]any); ok {
				o, _ := m["old_string"].(string)
				n, _ := m["new_string"].(string)
				oldParts, newParts = append(oldParts, o), append(newParts, n)
			}
		}
		return []protocol.ThreadToolFile{fileDiff(path, strings.Join(oldParts, "\n"), strings.Join(newParts, "\n"))}
	case "Write":
		content, _ := input["content"].(string)
		return []protocol.ThreadToolFile{fileDiff(path, "", content)}
	}
	return nil
}

func (c *claudeAdapter) onToolUse(block jsonObj) {
	id := jStr(block, "id")
	name := jStr(block, "name")
	input := jObj(block, "input")
	c.smu.Lock()
	c.toolNames[id] = name
	c.smu.Unlock()
	if name == "TodoWrite" {
		var plan []protocol.PlanEntry
		for _, t := range jArr(input, "todos") {
			if m, ok := t.(map[string]any); ok {
				plan = append(plan, protocol.PlanEntry{Content: jStr(m, "content"), Status: planStatus(jStr(m, "status"))})
			}
		}
		if plan == nil {
			plan = []protocol.PlanEntry{}
		}
		c.smu.Lock()
		if c.planId == "" {
			c.planId = c.newId("plan")
		}
		planId := c.planId
		c.smu.Unlock()
		c.emit(protocol.ThreadEvent{Id: planId, Role: "plan", Plan: plan})
		return
	}
	c.emit(protocol.ThreadEvent{Id: c.scopedId("tool", id), Role: "tool", Tool: &protocol.ThreadTool{
		Name:   claudeToolName(name),
		Title:  claudeToolTitle(name, input),
		Status: "running",
		Input:  claudeToolInput(name, input),
		Files:  claudeToolFiles(name, input),
	}})
}

// toolResultText flattens a tool_result's content (string or blocks).
func toolResultText(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case []any:
		var parts []string
		for _, b := range t {
			if m, ok := b.(map[string]any); ok && jStr(m, "type") == "text" {
				parts = append(parts, jStr(m, "text"))
			}
		}
		return strings.Join(parts, "\n")
	}
	return ""
}

func (c *claudeAdapter) onToolResult(block jsonObj) {
	id := jStr(block, "tool_use_id")
	c.smu.Lock()
	name, known := c.toolNames[id]
	c.smu.Unlock()
	if !known || name == "TodoWrite" {
		return
	}
	status := "completed"
	if jBool(block, "is_error") {
		status = "error"
	}
	c.emit(protocol.ThreadEvent{Id: c.scopedId("tool", id), Role: "tool", Tool: &protocol.ThreadTool{
		Status: status,
		Output: toolResultText(block["content"]),
	}})
}

func (c *claudeAdapter) onResult(m jsonObj) {
	interrupted := c.interrupted.Swap(false)
	if interrupted {
		c.emit(protocol.ThreadEvent{Id: c.newId("stop"), Role: "status", Text: "Cancelled"})
	} else if jBool(m, "is_error") || (jStr(m, "subtype") != "" && jStr(m, "subtype") != "success") {
		msg := jStr(m, "result")
		if msg == "" {
			var errs []string
			for _, e := range jArr(m, "errors") {
				errs = append(errs, fmt.Sprint(e))
			}
			msg = strings.Join(errs, "\n")
		}
		if msg == "" {
			msg = "Claude reported " + strings.ReplaceAll(jStr(m, "subtype"), "_", " ")
		}
		c.emitError(msg)
	}
	u := jObj(m, "usage")
	in, _ := jNum(u, "input_tokens")
	cacheW, _ := jNum(u, "cache_creation_input_tokens")
	cacheR, _ := jNum(u, "cache_read_input_tokens")
	out, _ := jNum(u, "output_tokens")
	cost, hasCost := jNum(m, "total_cost_usd")
	c.smu.Lock()
	c.usage.InputTokens += int64(in + cacheW + cacheR)
	c.usage.OutputTokens += int64(out)
	if hasCost {
		// total_cost_usd has been both per-turn and cumulative across CLI
		// versions; a value that never decreases is treated as cumulative.
		if cost >= c.usage.CostUsd {
			c.usage.CostUsd = cost
		} else {
			c.usage.CostUsd += cost
		}
	}
	usage := c.usage
	c.smu.Unlock()
	c.sink.state(protocol.ThreadState{Usage: &usage})

	var duration int64
	if d, ok := jNum(m, "duration_ms"); ok {
		duration = int64(d)
	}
	c.finishTurn(duration)
}

// --- control requests from the CLI (permission prompts) ---

func (c *claudeAdapter) onControlRequest(line []byte) {
	var req struct {
		RequestId string `json:"request_id"`
		Request   struct {
			Subtype   string          `json:"subtype"`
			ToolName  string          `json:"tool_name"`
			Input     json.RawMessage `json:"input"`
			ToolUseId string          `json:"tool_use_id"`
		} `json:"request"`
	}
	if json.Unmarshal(line, &req) != nil {
		return
	}
	reply := func(response map[string]any) {
		c.proc.writeJSON(map[string]any{"type": "control_response", "response": map[string]any{
			"subtype": "success", "request_id": req.RequestId, "response": response,
		}})
	}
	if req.Request.Subtype != "can_use_tool" {
		c.proc.writeJSON(map[string]any{"type": "control_response", "response": map[string]any{
			"subtype": "error", "request_id": req.RequestId, "error": "unsupported control request: " + req.Request.Subtype,
		}})
		return
	}
	input := req.Request.Input
	if len(input) == 0 {
		input = json.RawMessage("{}")
	}
	allow := func() { reply(map[string]any{"behavior": "allow", "updatedInput": input}) }

	c.smu.Lock()
	always := c.alwaysAllow[req.Request.ToolName]
	c.smu.Unlock()
	if always || c.cfg.Access == "full" {
		allow()
		return
	}
	var inputObj jsonObj
	json.Unmarshal(input, &inputObj)
	options := []protocol.ApprovalOption{
		{Id: "allow", Label: "Allow", Kind: "allow_once"},
		{Id: "always", Label: "Always allow " + req.Request.ToolName, Kind: "allow_always"},
		{Id: "deny", Label: "Deny", Kind: "reject_once"},
	}
	choice := c.askApproval(c.ctx, protocol.ThreadApprovalRequest{
		Id:      c.scopedId("perm", req.RequestId),
		Title:   claudeToolTitle(req.Request.ToolName, inputObj),
		Detail:  claudeToolInput(req.Request.ToolName, inputObj),
		Options: options,
	})
	switch optionKind(options, choice) {
	case "allow_always":
		c.smu.Lock()
		c.alwaysAllow[req.Request.ToolName] = true
		c.smu.Unlock()
		allow()
	case "allow_once":
		allow()
	default:
		msg := "The user denied this action."
		if choice == "" {
			msg = "The user cancelled this action."
		}
		reply(map[string]any{"behavior": "deny", "message": msg})
	}
}
