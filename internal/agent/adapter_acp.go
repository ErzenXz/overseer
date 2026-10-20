package agent

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// acpAdapter drives any agent speaking the Agent Client Protocol (JSON-RPC
// 2.0 over stdio): gemini, opencode, goose, copilot, cursor-agent, or a
// custom command line.
type acpAdapter struct {
	adapterBase
	bin        string
	candidates [][]string

	ctx       context.Context // ends on stop; bounds prompts and permission waits
	cancelCtx context.CancelFunc

	proc      *agentProcess
	rpc       *rpcConn
	sessionId string
	loading   atomic.Bool // replaying history during session/load: ignore updates

	infoMu sync.Mutex
	info   acpSessionInfo // modes, models and config options from session/new|load

	prompts chan promptInput

	metaMu   sync.Mutex
	images   bool // promptCapabilities.image
	commands []protocol.AgentCommand
	usage    protocol.Usage

	planMu sync.Mutex
	planId string
}

const maxFsReadBytes = 10 * 1024 * 1024

func newACPAdapter(cfg protocol.ThreadStart, sink threadSink, bin string, candidates [][]string) *acpAdapter {
	ctx, cancel := context.WithCancel(context.Background())
	return &acpAdapter{
		adapterBase: newAdapterBase(cfg, sink),
		bin:         bin,
		candidates:  candidates,
		ctx:         ctx,
		cancelCtx:   cancel,
		prompts:     make(chan promptInput, 16),
	}
}

func (a *acpAdapter) start(ctx context.Context) (string, error) {
	path, err := lookAgentBinary(a.bin)
	if err != nil {
		return "", err
	}
	var lastErr error
	for _, args := range a.candidates {
		if lastErr = a.spawn(ctx, path, args); lastErr == nil {
			a.started.Store(true)
			go a.turnLoop()
			return a.sessionId, nil
		}
		if a.proc != nil {
			a.proc.kill()
		}
		if ctx.Err() != nil {
			break
		}
	}
	return "", lastErr
}

// spawn starts one candidate command line and completes the ACP handshake.
func (a *acpAdapter) spawn(ctx context.Context, path string, args []string) error {
	proc, err := startAgentProcess(path, args, a.cfg.Cwd, agentEnv())
	if err != nil {
		return err
	}
	rpc := newRPCConn(true)
	rpc.proc = proc
	rpc.onNotify = a.onNotify
	rpc.onRequest = a.onRequest
	a.proc, a.rpc = proc, rpc
	proc.readLines(rpc.handleLine)
	a.watchExit(proc, rpc.shutdown)

	fail := func(err error) error {
		if !proc.alive() {
			return fmt.Errorf("%s: %s", err, proc.exitError())
		}
		return err
	}

	var init struct {
		AgentCapabilities struct {
			LoadSession     bool `json:"loadSession"`
			McpCapabilities struct {
				Http bool `json:"http"`
			} `json:"mcpCapabilities"`
			PromptCapabilities struct {
				Image bool `json:"image"`
			} `json:"promptCapabilities"`
			SessionCapabilities map[string]any `json:"sessionCapabilities"`
		} `json:"agentCapabilities"`
	}
	ictx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	err = rpc.call(ictx, "initialize", map[string]any{
		"protocolVersion": 1,
		"clientCapabilities": map[string]any{
			"fs":          map[string]bool{"readTextFile": true, "writeTextFile": true},
			"terminal":    false,
			"elicitation": map[string]any{"form": map[string]any{}},
		},
		"clientInfo": map[string]string{"name": "overseer", "title": "Overseer", "version": "1"},
	}, &init)
	if err != nil {
		return fail(err)
	}
	a.metaMu.Lock()
	a.images = init.AgentCapabilities.PromptCapabilities.Image
	a.metaMu.Unlock()
	_, canFork := init.AgentCapabilities.SessionCapabilities["fork"]

	servers := acpMcpServers(a.cfg.McpServers, init.AgentCapabilities.McpCapabilities.Http)
	var sess json.RawMessage
	resumed := false
	if a.cfg.Fork {
		// Native fork of the whole session where advertised; a cut at an
		// earlier turn (or no fork support) starts fresh.
		a.forkFallback = true
		if a.cfg.ResumeId != "" && a.cfg.ForkAt == "" && canFork {
			if err := rpc.call(ctx, "session/fork", map[string]any{
				"sessionId": a.cfg.ResumeId, "cwd": a.cfg.Cwd, "mcpServers": servers,
			}, &sess); err == nil && parseACPSession(sess).SessionId != "" {
				a.sessionId, resumed = parseACPSession(sess).SessionId, true
				a.forkFallback = false
			}
		}
	} else if a.cfg.ResumeId != "" && init.AgentCapabilities.LoadSession {
		a.loading.Store(true)
		err := rpc.call(ctx, "session/load", map[string]any{
			"sessionId": a.cfg.ResumeId, "cwd": a.cfg.Cwd, "mcpServers": servers,
		}, &sess)
		a.loading.Store(false)
		if err == nil {
			a.sessionId, resumed = a.cfg.ResumeId, true
		}
	}
	if !resumed {
		sess = nil
		if err := rpc.call(ctx, "session/new", map[string]any{"cwd": a.cfg.Cwd, "mcpServers": servers}, &sess); err != nil {
			return fail(err)
		}
		info := parseACPSession(sess)
		if info.SessionId == "" {
			return fmt.Errorf("agent returned no session id")
		}
		a.sessionId = info.SessionId
	}
	a.mu.Lock()
	a.resume = a.sessionId
	a.mu.Unlock()
	a.infoMu.Lock()
	a.info = parseACPSession(sess)
	a.infoMu.Unlock()

	// Best effort: a setting the agent rejects leaves its default in place.
	a.apply(ctx, a.settings(), threadSettings{}, true)
	a.publishACPMeta()
	return nil
}

func (a *acpAdapter) hasCommand(name string) bool {
	a.metaMu.Lock()
	defer a.metaMu.Unlock()
	for _, c := range a.commands {
		if c.Name == name {
			return true
		}
	}
	return false
}

func (a *acpAdapter) publishACPMeta() {
	a.metaMu.Lock()
	caps := protocol.ThreadCapabilities{Fork: true, Images: a.images, Commands: len(a.commands) > 0}
	cmds := a.commands
	a.metaMu.Unlock()
	caps.Compact = a.hasCommand("compact")
	caps.Review = a.hasCommand("review")
	a.publishMeta(caps, cmds)
}

func (a *acpAdapter) compact() error {
	if !a.hasCommand("compact") {
		return notSupported("compact", a.cfg.Agent)
	}
	return a.prompt(promptInput{Text: "/compact"})
}

func (a *acpAdapter) undo() error { return notSupported("undo", a.cfg.Agent) }

// acpPromptBlocks builds the session/prompt content.
func acpPromptBlocks(p promptInput) []map[string]any {
	blocks := []map[string]any{}
	for _, img := range p.Images {
		blocks = append(blocks, map[string]any{"type": "image", "mimeType": img.Mime, "data": base64.StdEncoding.EncodeToString(img.Data)})
	}
	if p.Text != "" || len(blocks) == 0 {
		blocks = append(blocks, map[string]any{"type": "text", "text": p.Text})
	}
	return blocks
}

// acpModeTarget is the mode to select for settings: the explicit mode, or a
// "plan" mode for the legacy read-only access level when one is offered.
func (a *acpAdapter) acpModeTarget(set threadSettings) string {
	if set.Mode != "" {
		return set.Mode
	}
	if set.Access == "ask" {
		a.infoMu.Lock()
		defer a.infoMu.Unlock()
		for _, m := range a.info.modeChoices() {
			if m.Id == "plan" {
				return m.Id
			}
		}
	}
	return ""
}

// apply selects mode, model and effort. On the initial call every set value
// is applied; afterwards only what changed since prev. It reports whether
// everything was applied.
func (a *acpAdapter) apply(ctx context.Context, set, prev threadSettings, initial bool) bool {
	ok := true
	a.infoMu.Lock()
	info := a.info
	a.infoMu.Unlock()

	target, prevTarget := a.acpModeTarget(set), a.acpModeTarget(prev)
	if !initial && target == "" && prevTarget != "" {
		target = info.initialMode() // back to the agent's default
	}
	if target != "" && (initial || target != prevTarget) {
		ok = a.setMode(ctx, info, target) == nil && ok
	}
	if set.Model != "" && (initial || set.Model != prev.Model) {
		if a.cfg.Agent == "gemini" {
			ok = initial && ok // gemini takes the model as a flag: restart to change it
		} else if err := a.setModel(ctx, info, set.Model); err != nil {
			ok = false
		}
	} else if !initial && set.Model != prev.Model {
		ok = false // back to the default model: start over
	}
	if set.Effort != "" && (initial || set.Effort != prev.Effort) {
		if opt := info.option("thought_level"); opt != nil {
			ok = a.setConfig(ctx, opt.Id, set.Effort) == nil && ok
		}
	}
	return ok
}

func (a *acpAdapter) setMode(ctx context.Context, info acpSessionInfo, mode string) error {
	if !info.HasModes {
		if opt := info.option("mode"); opt != nil {
			return a.setConfig(ctx, opt.Id, mode)
		}
	}
	return a.rpc.call(ctx, "session/set_mode", map[string]any{"sessionId": a.sessionId, "modeId": mode}, nil)
}

func (a *acpAdapter) setModel(ctx context.Context, info acpSessionInfo, model string) error {
	if !info.HasModels {
		if opt := info.option("model"); opt != nil {
			return a.setConfig(ctx, opt.Id, model)
		}
	}
	return a.rpc.call(ctx, "session/set_model", map[string]any{"sessionId": a.sessionId, "modelId": model}, nil)
}

// setConfig sets one session config option and keeps the refreshed option
// list the agent returns.
func (a *acpAdapter) setConfig(ctx context.Context, configId, value string) error {
	var res json.RawMessage
	err := a.rpc.call(ctx, "session/set_config_option", map[string]any{
		"sessionId": a.sessionId, "configId": configId, "value": value,
	}, &res)
	if err != nil {
		return err
	}
	if opts := parseACPConfigOptions(jArr(decodeObj(res), "configOptions")); len(opts) > 0 {
		a.infoMu.Lock()
		a.info.Config = opts
		a.infoMu.Unlock()
	}
	return nil
}

// update applies mode, model and effort live; anything the agent rejects
// asks for a restart.
func (a *acpAdapter) update(next threadSettings) bool {
	cur := a.settings()
	ctx, cancel := context.WithTimeout(a.ctx, 15*time.Second)
	defer cancel()
	ok := a.apply(ctx, next, cur, false)
	a.setSettings(next)
	return !ok
}

// acpMcpServers converts registry entries to ACP's McpServer shape.
func acpMcpServers(servers []protocol.McpServer, http bool) []map[string]any {
	out := []map[string]any{}
	for _, s := range servers {
		switch s.Transport {
		case "stdio":
			env := []map[string]string{}
			for k, v := range s.Env {
				env = append(env, map[string]string{"name": k, "value": v})
			}
			args := s.Args
			if args == nil {
				args = []string{}
			}
			out = append(out, map[string]any{"name": s.Name, "command": s.Command, "args": args, "env": env})
		case "http":
			if !http {
				continue // agent did not advertise HTTP MCP support
			}
			headers := []map[string]string{}
			for k, v := range s.Headers {
				headers = append(headers, map[string]string{"name": k, "value": v})
			}
			out = append(out, map[string]any{"type": "http", "name": s.Name, "url": s.Url, "headers": headers})
		}
	}
	return out
}

func (a *acpAdapter) prompt(p promptInput) error {
	a.metaMu.Lock()
	images := a.images
	a.metaMu.Unlock()
	if len(p.Images) > 0 && !images {
		return notSupported("images", a.cfg.Agent)
	}
	select {
	case a.prompts <- p:
		return nil
	default:
		return fmt.Errorf("too many queued prompts")
	}
}

// turnLoop runs queued prompts one at a time (ACP allows one turn per session).
func (a *acpAdapter) turnLoop() {
	for {
		select {
		case <-a.ctx.Done():
			return
		case p := <-a.prompts:
			a.runTurn(p)
		}
	}
}

func (a *acpAdapter) runTurn(p promptInput) {
	a.beginTurn()
	a.planMu.Lock()
	a.planId = ""
	a.planMu.Unlock()
	a.setStatus("working", "")
	var res struct {
		StopReason string `json:"stopReason"`
	}
	err := a.rpc.call(a.ctx, "session/prompt", map[string]any{
		"sessionId": a.sessionId,
		"prompt":    acpPromptBlocks(p),
	}, &res)
	if a.stopping.Load() {
		return
	}
	if err != nil {
		if !a.proc.alive() {
			return // watchExit reports it
		}
		a.emitError(err.Error())
	} else if res.StopReason != "" && res.StopReason != "end_turn" && res.StopReason != "cancelled" {
		a.emit(protocol.ThreadEvent{Id: a.newId("stop"), Role: "status", Text: "Stopped: " + strings.ReplaceAll(res.StopReason, "_", " ")})
	}
	a.finishTurn(0)
}

func (a *acpAdapter) cancel() error {
	// Drop queued prompts; the user asked to stop.
	for {
		select {
		case <-a.prompts:
			continue
		default:
		}
		break
	}
	a.cancelApprovals()
	return a.rpc.notify("session/cancel", map[string]string{"sessionId": a.sessionId})
}

func (a *acpAdapter) stop() {
	a.stopping.Store(true)
	a.cancelCtx()
	a.cancelApprovals()
	if a.proc != nil {
		a.proc.kill()
	}
}

func (a *acpAdapter) alive() bool {
	return a.proc != nil && a.proc.alive() && !a.stopping.Load()
}

// --- agent -> client notifications ---

func (a *acpAdapter) onNotify(method string, params json.RawMessage) {
	if method != "session/update" || a.loading.Load() {
		return
	}
	u := jObj(decodeObj(params), "update")
	switch jStr(u, "sessionUpdate") {
	case "agent_message_chunk":
		a.chunk("assistant", jStr(jObj(u, "content"), "text"))
	case "agent_thought_chunk":
		a.chunk("thought", jStr(jObj(u, "content"), "text"))
	case "available_commands_update":
		var cmds []protocol.AgentCommand
		for _, x := range jArr(u, "availableCommands") {
			if m, ok := x.(map[string]any); ok && jStr(m, "name") != "" {
				cmds = append(cmds, protocol.AgentCommand{Name: jStr(m, "name"), Description: jStr(m, "description"), Hint: jStr(jObj(m, "input"), "hint")})
			}
		}
		a.metaMu.Lock()
		a.commands = cmds
		a.metaMu.Unlock()
		go a.publishACPMeta()
	case "usage_update":
		used, ok1 := jNum(u, "used")
		size, ok2 := jNum(u, "size")
		if ok1 || ok2 {
			a.metaMu.Lock()
			a.usage.ContextTokens, a.usage.ContextWindow = int64(used), int64(size)
			if cost, ok := jNum(jObj(u, "cost"), "amount"); ok {
				a.usage.CostUsd = cost
			}
			usage := a.usage
			a.metaMu.Unlock()
			a.sink.state(protocol.ThreadState{Usage: &usage})
		}
	case "tool_call":
		a.onToolCall(u, true)
	case "tool_call_update":
		a.onToolCall(u, false)
	case "plan":
		var plan []protocol.PlanEntry
		for _, e := range jArr(u, "entries") {
			if m, ok := e.(map[string]any); ok {
				plan = append(plan, protocol.PlanEntry{Content: jStr(m, "content"), Status: planStatus(jStr(m, "status"))})
			}
		}
		if plan == nil {
			plan = []protocol.PlanEntry{}
		}
		a.planMu.Lock()
		if a.planId == "" {
			a.planId = a.newId("plan")
		}
		id := a.planId
		a.planMu.Unlock()
		a.emit(protocol.ThreadEvent{Id: id, Role: "plan", Plan: plan})
	}
}

// acpToolKinds maps ACP ToolKind to the contract's tool names.
var acpToolKinds = map[string]string{
	"execute": "bash", "read": "read", "edit": "edit", "delete": "edit", "move": "edit",
	"search": "grep", "fetch": "webfetch", "think": "other", "other": "other",
}

func acpToolStatus(s string) string {
	switch s {
	case "completed":
		return "completed"
	case "failed":
		return "error"
	case "pending", "in_progress":
		return "running"
	}
	return ""
}

func planStatus(s string) string {
	switch s {
	case "in_progress", "inProgress", "in-progress":
		return "in_progress"
	case "completed", "done":
		return "completed"
	}
	return "pending"
}

// toolInputDisplay picks a human-readable input string from a raw input object.
func toolInputDisplay(raw any) string {
	m, ok := raw.(map[string]any)
	if !ok {
		return clip(compactJSON(raw), 500)
	}
	if cmd, ok := m["command"]; ok {
		if arr, ok := cmd.([]any); ok {
			parts := make([]string, 0, len(arr))
			for _, p := range arr {
				parts = append(parts, fmt.Sprint(p))
			}
			return strings.Join(parts, " ")
		}
		if s, ok := cmd.(string); ok {
			return s
		}
	}
	if s := jStr(m, "file_path", "path", "abs_path", "filePath", "url", "query", "pattern"); s != "" {
		return s
	}
	if len(m) == 0 {
		return ""
	}
	return clip(compactJSON(m), 500)
}

func (a *acpAdapter) onToolCall(u jsonObj, isNew bool) {
	callId := jStr(u, "toolCallId")
	if callId == "" {
		return
	}
	tool := &protocol.ThreadTool{Title: jStr(u, "title"), Status: acpToolStatus(jStr(u, "status"))}
	if kind := jStr(u, "kind"); kind != "" {
		tool.Name = acpToolKinds[kind]
		if tool.Name == "" {
			tool.Name = "other"
		}
	}
	if isNew {
		if tool.Name == "" {
			tool.Name = "other"
		}
		if tool.Status == "" {
			tool.Status = "running"
		}
		if tool.Title == "" {
			tool.Title = tool.Name
		}
	}
	if raw, ok := u["rawInput"]; ok {
		tool.Input = toolInputDisplay(raw)
	}
	if locs := jArr(u, "locations"); tool.Input == "" && len(locs) > 0 {
		if l, ok := locs[0].(map[string]any); ok {
			tool.Input = jStr(l, "path")
		}
	}
	var out strings.Builder
	for _, c := range jArr(u, "content") {
		item, ok := c.(map[string]any)
		if !ok {
			continue
		}
		switch jStr(item, "type") {
		case "content":
			if text := jStr(jObj(item, "content"), "text"); text != "" {
				if out.Len() > 0 {
					out.WriteString("\n")
				}
				out.WriteString(text)
			}
		case "diff":
			oldText, _ := item["oldText"].(string)
			newText, _ := item["newText"].(string)
			tool.Files = append(tool.Files, fileDiff(jStr(item, "path"), oldText, newText))
		}
	}
	tool.Output = out.String()
	if raw, ok := u["rawOutput"]; ok && tool.Output == "" && raw != nil {
		tool.Output = compactJSON(raw)
	}
	a.emit(protocol.ThreadEvent{Id: a.scopedId("tool", callId), Role: "tool", Tool: tool})
}

// --- agent -> client requests ---

func (a *acpAdapter) onRequest(id json.RawMessage, method string, params json.RawMessage) {
	switch method {
	case "session/request_permission":
		a.requestPermission(id, params)
	case "elicitation/create":
		a.elicit(id, params)
	case "fs/read_text_file":
		var req struct {
			Path  string `json:"path"`
			Line  int    `json:"line"`
			Limit int    `json:"limit"`
		}
		json.Unmarshal(params, &req)
		content, err := a.readTextFile(req.Path, req.Line, req.Limit)
		if err != nil {
			a.rpc.respondError(id, -32000, err.Error())
			return
		}
		a.rpc.respond(id, map[string]string{"content": content})
	case "fs/write_text_file":
		var req struct {
			Path    string `json:"path"`
			Content string `json:"content"`
		}
		json.Unmarshal(params, &req)
		if err := a.writeTextFile(req.Path, req.Content); err != nil {
			a.rpc.respondError(id, -32000, err.Error())
			return
		}
		a.rpc.respond(id, nil)
	default:
		a.rpc.respondError(id, -32601, "method not found: "+method)
	}
}

type acpField struct {
	name, kind string // kind: string | number | integer | boolean
}

// acpElicitQuestions maps an MCP-style form elicitation (message +
// requestedSchema) onto one question per field.
func acpElicitQuestions(idPrefix string, p jsonObj) ([]protocol.ThreadQuestion, []acpField) {
	schema := jObj(p, "requestedSchema")
	props := jObj(schema, "properties")
	names := make([]string, 0, len(props))
	for k := range props {
		names = append(names, k)
	}
	sort.Strings(names)
	message := jStr(p, "message")
	var qs []protocol.ThreadQuestion
	var fields []acpField
	for i, name := range names {
		prop, _ := props[name].(map[string]any)
		title := jStr(prop, "title", "description")
		if title == "" {
			title = name
		}
		text := title
		if message != "" && len(names) == 1 {
			text = message
		} else if message != "" && i == 0 {
			text = message + "\n\n" + title
		}
		q := protocol.ThreadQuestion{Id: fmt.Sprintf("%s-%d", idPrefix, i), Text: text, Options: []protocol.QuestionOption{}}
		kind := jStr(prop, "type")
		enum, _ := stringList(prop["enum"])
		labels, _ := stringList(prop["enumNames"])
		switch {
		case len(enum) > 0:
			for k, v := range enum {
				label := v
				if k < len(labels) {
					label = labels[k]
				}
				q.Options = append(q.Options, protocol.QuestionOption{Id: v, Label: label})
			}
		case kind == "boolean":
			q.Options = []protocol.QuestionOption{{Id: "true", Label: "Yes"}, {Id: "false", Label: "No"}}
		default:
			q.AllowText = true
		}
		qs = append(qs, q)
		fields = append(fields, acpField{name: name, kind: kind})
	}
	return qs, fields
}

// acpElicitValue converts an answer to the field's JSON type.
func acpElicitValue(f acpField, answers []string, text string) any {
	v := text
	if len(answers) > 0 {
		v = answers[0]
	}
	switch f.kind {
	case "boolean":
		return v == "true"
	case "number", "integer":
		if n, err := strconv.ParseFloat(strings.TrimSpace(v), 64); err == nil {
			if f.kind == "integer" {
				return int64(n)
			}
			return n
		}
	}
	return v
}

func (a *acpAdapter) elicit(id json.RawMessage, params json.RawMessage) {
	questions, fields := acpElicitQuestions(a.newId("q"), decodeObj(params))
	if len(questions) == 0 {
		a.rpc.respond(id, map[string]any{"action": "decline"})
		return
	}
	content := map[string]any{}
	for i, q := range questions {
		answers, text, ok := a.askQuestion(a.ctx, q)
		if !ok {
			a.rpc.respond(id, map[string]any{"action": "cancel"})
			return
		}
		content[fields[i].name] = acpElicitValue(fields[i], answers, text)
	}
	a.rpc.respond(id, map[string]any{"action": "accept", "content": content})
}

func (a *acpAdapter) requestPermission(id json.RawMessage, params json.RawMessage) {
	p := decodeObj(params)
	call := jObj(p, "toolCall")
	if jStr(call, "toolCallId") != "" {
		a.onToolCall(call, false)
	}
	var options []protocol.ApprovalOption
	for _, o := range jArr(p, "options") {
		if m, ok := o.(map[string]any); ok {
			options = append(options, protocol.ApprovalOption{Id: jStr(m, "optionId"), Label: jStr(m, "name"), Kind: jStr(m, "kind")})
		}
	}
	selected := func(optionId string) {
		a.rpc.respond(id, map[string]any{"outcome": map[string]string{"outcome": "selected", "optionId": optionId}})
	}
	if a.fullAccess() {
		for _, kind := range []string{"allow_once", "allow_always"} {
			for _, o := range options {
				if o.Kind == kind {
					selected(o.Id)
					return
				}
			}
		}
	}
	if len(options) == 0 {
		a.rpc.respond(id, map[string]any{"outcome": map[string]string{"outcome": "cancelled"}})
		return
	}
	title := jStr(call, "title")
	if title == "" {
		title = "Allow this action?"
	}
	detail := ""
	if raw, ok := call["rawInput"]; ok {
		detail = toolInputDisplay(raw)
	}
	choice := a.askApproval(a.ctx, protocol.ThreadApprovalRequest{
		Id: a.newId("perm"), Title: title, Detail: detail, Options: options,
	})
	if choice == "" {
		a.rpc.respond(id, map[string]any{"outcome": map[string]string{"outcome": "cancelled"}})
		return
	}
	selected(choice)
}

// allowedPath restricts agent file access to the thread's cwd and the
// user's home directory.
func (a *acpAdapter) allowedPath(p string) (string, error) {
	if !filepath.IsAbs(p) {
		return "", fmt.Errorf("path must be absolute: %s", p)
	}
	p = filepath.Clean(p)
	home, _ := os.UserHomeDir()
	for _, base := range []string{a.cfg.Cwd, home} {
		if base == "" {
			continue
		}
		if rel, err := filepath.Rel(base, p); err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return p, nil
		}
	}
	return "", fmt.Errorf("access outside the working directory and home is not allowed: %s", p)
}

func (a *acpAdapter) readTextFile(path string, line, limit int) (string, error) {
	path, err := a.allowedPath(path)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("not a regular file: %s", path)
	}
	if info.Size() > maxFsReadBytes {
		return "", fmt.Errorf("file too large (%d bytes)", info.Size())
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	content := string(b)
	if line > 0 || limit > 0 {
		lines := strings.SplitAfter(content, "\n")
		start := max(line-1, 0)
		if start > len(lines) {
			start = len(lines)
		}
		end := len(lines)
		if limit > 0 && start+limit < end {
			end = start + limit
		}
		content = strings.Join(lines[start:end], "")
	}
	return content, nil
}

func (a *acpAdapter) writeTextFile(path, content string) error {
	path, err := a.allowedPath(path)
	if err != nil {
		return err
	}
	mode := os.FileMode(0o644)
	if info, err := os.Stat(path); err == nil {
		if !info.Mode().IsRegular() {
			return fmt.Errorf("not a regular file: %s", path)
		}
		mode = info.Mode().Perm()
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(content), mode)
}
