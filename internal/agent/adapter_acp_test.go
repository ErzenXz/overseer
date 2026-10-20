package agent

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// The test binary doubles as a fake ACP agent when this variable is set, so
// the adapter can be exercised end to end over real stdio pipes.
const (
	fakeACPEnv    = "OVERSEER_FAKE_ACP_AGENT"
	fakeACPLogEnv = "OVERSEER_FAKE_ACP_LOG" // file the fake agent appends "method params" lines to
)

func TestMain(m *testing.M) {
	if os.Getenv(fakeACPEnv) == "1" {
		runFakeACPAgent()
		os.Exit(0)
	}
	if cli := os.Getenv(fakeLimitsEnv); cli != "" {
		runFakeLimitsCLI(cli)
		os.Exit(0)
	}
	if os.Getenv(fakeExtEnv) == "1" {
		os.Exit(runFakeExtCLI())
	}
	os.Exit(m.Run())
}

// runFakeACPAgent answers initialize / session/new / session/prompt. A prompt
// streams a thought, two message chunks, a tool call guarded by a permission
// request, reads the file named by the prompt text through the client, and
// publishes a plan.
func runFakeACPAgent() {
	in := bufio.NewScanner(os.Stdin)
	in.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	out := json.NewEncoder(os.Stdout)
	send := func(v map[string]any) {
		v["jsonrpc"] = "2.0"
		out.Encode(v)
	}
	update := func(u map[string]any) {
		send(map[string]any{"method": "session/update", "params": map[string]any{"sessionId": "sess-1", "update": u}})
	}
	logCall := func(method string, params json.RawMessage) {
		if path := os.Getenv(fakeACPLogEnv); path != "" {
			f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
			if err == nil {
				fmt.Fprintf(f, "%s %s\n", method, params)
				f.Close()
			}
		}
	}
	nextId := 100
	// request sends a client request and waits for its response, answering
	// nothing else in between (the fake agent is strictly sequential).
	request := func(method string, params any) map[string]any {
		nextId++
		id := nextId
		send(map[string]any{"id": id, "method": method, "params": params})
		for in.Scan() {
			var m map[string]any
			if json.Unmarshal(in.Bytes(), &m) != nil {
				continue
			}
			if f, ok := m["id"].(float64); ok && int(f) == id && m["method"] == nil {
				return m
			}
		}
		os.Exit(1)
		return nil
	}

	for in.Scan() {
		var m struct {
			Id     json.RawMessage `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		if json.Unmarshal(in.Bytes(), &m) != nil {
			continue
		}
		reply := func(result any) { send(map[string]any{"id": m.Id, "result": result}) }
		logCall(m.Method, m.Params)
		switch m.Method {
		case "initialize":
			var p struct {
				ClientCapabilities struct {
					Elicitation map[string]any `json:"elicitation"`
				} `json:"clientCapabilities"`
			}
			json.Unmarshal(m.Params, &p)
			if p.ClientCapabilities.Elicitation == nil && os.Getenv(fakeACPLogEnv) != "" {
				logCall("missing-elicitation-capability", nil)
			}
			reply(map[string]any{"protocolVersion": 1, "agentCapabilities": map[string]any{"loadSession": false,
				"promptCapabilities":  map[string]any{"image": true},
				"sessionCapabilities": map[string]any{"delete": map[string]any{}}}})
			update(map[string]any{"sessionUpdate": "available_commands_update", "availableCommands": []map[string]any{
				{"name": "compact", "description": "Compact"}, {"name": "review", "description": "Review", "input": map[string]any{"hint": "what"}}}})
		case "session/new":
			var p struct {
				McpServers []map[string]any `json:"mcpServers"`
			}
			json.Unmarshal(m.Params, &p)
			// Discovery probes pass no servers; the adapter test passes one.
			if len(p.McpServers) > 0 && (len(p.McpServers) != 1 || p.McpServers[0]["command"] != "mcp-fs") {
				send(map[string]any{"id": m.Id, "error": map[string]any{"code": -32602, "message": "bad mcpServers"}})
				continue
			}
			reply(map[string]any{
				"sessionId": "sess-1",
				"modes": map[string]any{"currentModeId": "code", "availableModes": []map[string]string{
					{"id": "ask", "name": "Ask", "description": "Asks first"},
					{"id": "code", "name": "Code", "description": "Writes code"},
					{"id": "plan", "name": "Plan"},
				}},
				"models": map[string]any{"currentModelId": "m1", "availableModels": []map[string]string{
					{"modelId": "m1", "name": "Model One"}, {"modelId": "m2", "name": "Model Two", "description": "Bigger"},
				}},
				"configOptions": []map[string]any{{
					"id": "effort", "name": "Thinking", "category": "thought_level", "type": "select", "currentValue": "low",
					"options": []map[string]any{{"group": "levels", "name": "Levels", "options": []map[string]string{
						{"value": "low", "name": "Low"}, {"value": "high", "name": "High", "description": "Thinks hard"},
					}}},
				}},
			})
		case "session/set_mode", "session/set_model", "session/set_config_option", "session/delete":
			reply(map[string]any{})
		case "session/prompt":
			var p struct {
				Prompt []struct {
					Type     string `json:"type"`
					Text     string `json:"text"`
					MimeType string `json:"mimeType"`
				} `json:"prompt"`
			}
			json.Unmarshal(m.Params, &p)
			if last := p.Prompt[len(p.Prompt)-1]; last.Text == "ask" {
				// A form elicitation: one enum field and one free-text field.
				res := request("elicitation/create", map[string]any{"sessionId": "sess-1", "mode": "form", "message": "Pick a colour",
					"requestedSchema": map[string]any{"type": "object", "properties": map[string]any{
						"colour": map[string]any{"type": "string", "enum": []string{"red", "blue"}, "enumNames": []string{"Red", "Blue"}},
						"note":   map[string]any{"type": "string", "title": "Anything else?"},
					}}})
				r, _ := res["result"].(map[string]any)
				content, _ := r["content"].(map[string]any)
				update(map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]any{"type": "text",
					"text": fmt.Sprintf("%v: %v / %v (images %d)", r["action"], content["colour"], content["note"], len(p.Prompt)-1)}})
				reply(map[string]any{"stopReason": "end_turn"})
				continue
			}
			update(map[string]any{"sessionUpdate": "agent_thought_chunk", "content": map[string]any{"type": "text", "text": "Thinking"}})
			update(map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]any{"type": "text", "text": "Hello"}})
			update(map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]any{"type": "text", "text": " world"}})
			update(map[string]any{"sessionUpdate": "tool_call", "toolCallId": "t1", "title": "List files", "kind": "execute",
				"status": "pending", "rawInput": map[string]any{"command": "ls -la"}})
			perm := request("session/request_permission", map[string]any{
				"sessionId": "sess-1",
				"toolCall":  map[string]any{"toolCallId": "t1", "title": "List files"},
				"options": []map[string]string{
					{"optionId": "yes", "name": "Allow", "kind": "allow_once"},
					{"optionId": "no", "name": "Reject", "kind": "reject_once"},
				},
			})
			outcome, _ := perm["result"].(map[string]any)["outcome"].(map[string]any)
			chosen, _ := outcome["optionId"].(string)
			file := request("fs/read_text_file", map[string]any{"sessionId": "sess-1", "path": p.Prompt[0].Text})
			content, _ := file["result"].(map[string]any)["content"].(string)
			update(map[string]any{"sessionUpdate": "tool_call_update", "toolCallId": "t1", "status": "completed",
				"content": []any{
					map[string]any{"type": "content", "content": map[string]any{"type": "text", "text": "chose " + chosen + "; read " + content}},
					map[string]any{"type": "diff", "path": "/tmp/x.txt", "oldText": "a\nb\n", "newText": "a\nc\n"},
				}})
			update(map[string]any{"sessionUpdate": "plan", "entries": []map[string]string{
				{"content": "Step one", "status": "completed", "priority": "high"},
				{"content": "Step two", "status": "in_progress", "priority": "low"},
			}})
			update(map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]any{"type": "text", "text": "Done."}})
			reply(map[string]any{"stopReason": "end_turn"})
		default:
			if len(m.Id) > 0 {
				send(map[string]any{"id": m.Id, "error": map[string]any{"code": -32601, "message": "nope"}})
			}
		}
	}
}

type recordingSink struct {
	mu     sync.Mutex
	events []protocol.ThreadEvent
	states []protocol.ThreadState
	notify chan struct{}
}

func newRecordingSink() *recordingSink { return &recordingSink{notify: make(chan struct{}, 1024)} }

func (s *recordingSink) event(ev protocol.ThreadEvent) {
	s.mu.Lock()
	s.events = append(s.events, ev)
	s.mu.Unlock()
	s.notify <- struct{}{}
}

func (s *recordingSink) state(st protocol.ThreadState) {
	s.mu.Lock()
	s.states = append(s.states, st)
	s.mu.Unlock()
	s.notify <- struct{}{}
}

// waitFor blocks until cond (checked under the lock) holds.
func (s *recordingSink) waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.After(10 * time.Second)
	for {
		s.mu.Lock()
		ok := cond()
		s.mu.Unlock()
		if ok {
			return
		}
		select {
		case <-s.notify:
		case <-deadline:
			s.mu.Lock()
			defer s.mu.Unlock()
			t.Fatalf("timed out waiting for %s; events=%+v states=%+v", what, s.events, s.states)
		}
	}
}

func TestACPAdapterEndToEnd(t *testing.T) {
	t.Setenv(fakeACPEnv, "1")
	logPath := filepath.Join(t.TempDir(), "calls.log")
	t.Setenv(fakeACPLogEnv, logPath)
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cwd := t.TempDir()
	if resolved, err := filepath.EvalSymlinks(cwd); err == nil {
		cwd = resolved
	}
	notes := filepath.Join(cwd, "notes.txt")
	os.WriteFile(notes, []byte("secret notes"), 0o644)

	sink := newRecordingSink()
	cfg := protocol.ThreadStart{
		ThreadId: "th1", Agent: "acp", Command: fmt.Sprintf("%q", exe), Cwd: cwd, Access: "edits",
		Mode: "plan", Model: "m2", Effort: "high",
		McpServers: []protocol.McpServer{{Name: "fs", Transport: "stdio", Command: "mcp-fs", Enabled: true},
			{Name: "remote", Transport: "http", Url: "https://example.com/mcp", Enabled: true}},
	}
	ad, err := newThreadAdapter(cfg, sink)
	if err != nil {
		t.Fatal(err)
	}
	defer ad.stop()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	resume, err := ad.start(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if resume != "sess-1" {
		t.Fatalf("resumeId = %q, want sess-1", resume)
	}
	calls := func() string { b, _ := os.ReadFile(logPath); return string(b) }
	for _, want := range []string{
		`session/set_mode {"modeId":"plan","sessionId":"sess-1"}`,
		`session/set_model {"modelId":"m2","sessionId":"sess-1"}`,
		`session/set_config_option {"configId":"effort","sessionId":"sess-1","value":"high"}`,
	} {
		if !strings.Contains(calls(), want) {
			t.Errorf("missing call %s in:\n%s", want, calls())
		}
	}
	// A live mode change goes through session/set_mode, no restart needed.
	if restart := ad.update(threadSettings{Mode: "ask", Model: "m2", Effort: "high", Access: "edits"}); restart {
		t.Error("live mode change asked for a restart")
	}
	if !strings.Contains(calls(), `session/set_mode {"modeId":"ask","sessionId":"sess-1"}`) {
		t.Errorf("live set_mode missing:\n%s", calls())
	}
	if err := ad.prompt(promptInput{Text: notes}); err != nil {
		t.Fatal(err)
	}

	// The permission request surfaces as an approval and parks the thread.
	var approvalId string
	sink.waitFor(t, "approval", func() bool {
		for _, ev := range sink.events {
			if ev.Role == "approval" && ev.Approval != nil {
				approvalId = ev.Approval.Id
				return true
			}
		}
		return false
	})
	sink.waitFor(t, "waiting state", func() bool {
		return len(sink.states) > 0 && sink.states[len(sink.states)-1].Status == "waiting"
	})
	if err := ad.approve(approvalId, "bogus"); err == nil {
		t.Error("unknown option should be rejected")
	}
	if err := ad.approve(approvalId, "yes"); err != nil {
		t.Fatal(err)
	}
	sink.waitFor(t, "idle state", func() bool {
		return len(sink.states) > 0 && sink.states[len(sink.states)-1].Status == "idle"
	})

	sink.mu.Lock()
	defer sink.mu.Unlock()
	texts := map[string]string{}
	roles := map[string]string{}
	var order []string
	var tool *protocol.ThreadTool
	var plan []protocol.PlanEntry
	var resolved string
	var durationOn string
	for _, ev := range sink.events {
		if _, seen := roles[ev.Id]; !seen {
			order = append(order, ev.Id)
		}
		if ev.Role != "" {
			roles[ev.Id] = ev.Role
		}
		if ev.Append {
			texts[ev.Id] += ev.Text
		} else if ev.Text != "" {
			texts[ev.Id] = ev.Text
		}
		if ev.Tool != nil {
			if tool == nil {
				tool = &protocol.ThreadTool{}
			}
			if ev.Tool.Status != "" {
				tool.Status = ev.Tool.Status
			}
			if ev.Tool.Name != "" {
				tool.Name = ev.Tool.Name
			}
			if ev.Tool.Input != "" {
				tool.Input = ev.Tool.Input
			}
			if ev.Tool.Output != "" {
				tool.Output = ev.Tool.Output
			}
			if ev.Tool.Files != nil {
				tool.Files = ev.Tool.Files
			}
		}
		if ev.Plan != nil {
			plan = ev.Plan
		}
		if ev.Approval != nil && ev.Approval.Resolved != "" {
			resolved = ev.Approval.Resolved
		}
		if ev.DurationMs > 0 {
			durationOn = ev.Id
		}
	}

	var assistant []string
	for _, id := range order {
		if roles[id] == "assistant" {
			assistant = append(assistant, texts[id])
		}
	}
	if len(assistant) != 2 || assistant[0] != "Hello world" || assistant[1] != "Done." {
		t.Errorf("assistant messages = %q, want [Hello world, Done.]", assistant)
	}
	if roles[order[0]] != "thought" || texts[order[0]] != "Thinking" {
		t.Errorf("first message = %s %q, want thought", roles[order[0]], texts[order[0]])
	}
	if tool == nil || tool.Name != "bash" || tool.Status != "completed" || tool.Input != "ls -la" {
		t.Fatalf("tool = %+v", tool)
	}
	if tool.Output != "chose yes; read secret notes" {
		t.Errorf("tool output = %q", tool.Output)
	}
	if len(tool.Files) != 1 || tool.Files[0].Additions != 1 || tool.Files[0].Deletions != 1 || !strings.Contains(tool.Files[0].Diff, "+c") {
		t.Errorf("tool files = %+v", tool.Files)
	}
	if len(plan) != 2 || plan[1].Status != "in_progress" {
		t.Errorf("plan = %+v", plan)
	}
	if resolved != "yes" {
		t.Errorf("approval resolved = %q, want yes", resolved)
	}
	if durationOn == "" || texts[durationOn] != "Done." {
		t.Errorf("durationMs stamped on %q, want the final assistant message", durationOn)
	}
}

func TestACPFileAccessRestricted(t *testing.T) {
	cwd := t.TempDir()
	a := newACPAdapter(protocol.ThreadStart{Cwd: cwd}, newRecordingSink(), "x", nil)
	if _, err := a.allowedPath("relative/path"); err == nil {
		t.Error("relative paths must be rejected")
	}
	if _, err := a.allowedPath(filepath.Join(cwd, "a", "..", "b.txt")); err != nil {
		t.Errorf("path inside cwd rejected: %v", err)
	}
	home, _ := os.UserHomeDir()
	if !strings.HasPrefix(cwd, home) {
		if _, err := a.allowedPath(filepath.Join(cwd, "..", "..", "etc-outside")); err == nil {
			t.Error("path escaping cwd should be rejected")
		}
	}
}

func TestSplitCommandLine(t *testing.T) {
	got, err := splitCommandLine(`my-agent --flag "two words" 'single \ quoted' esc\ aped`)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"my-agent", "--flag", "two words", `single \ quoted`, "esc aped"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("got %q, want %q", got, want)
	}
	if _, err := splitCommandLine(`bad "quote`); err == nil {
		t.Error("unterminated quote should fail")
	}
}

func TestFileDiffCounts(t *testing.T) {
	f := fileDiff("x.go", "a\nb\nc\nd\n", "a\nB\nc\nd\ne\n")
	if f.Additions != 2 || f.Deletions != 1 {
		t.Errorf("additions/deletions = %d/%d, want 2/1\n%s", f.Additions, f.Deletions, f.Diff)
	}
	u := unifiedDiffFile("y", "--- a/y\n+++ b/y\n@@ -1 +1 @@\n-old\n+new\n+more\n")
	if u.Additions != 2 || u.Deletions != 1 {
		t.Errorf("unified counts = %d/%d", u.Additions, u.Deletions)
	}
}
