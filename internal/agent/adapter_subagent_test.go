package agent

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// toolEvents returns the tool events in order.
func toolEvents(s *recordingSink) []protocol.ThreadEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []protocol.ThreadEvent
	for _, ev := range s.events {
		if ev.Tool != nil {
			out = append(out, ev)
		}
	}
	return out
}

func claudeLines(t *testing.T, a *claudeAdapter, lines ...any) {
	t.Helper()
	for _, l := range lines {
		b, err := json.Marshal(l)
		if err != nil {
			t.Fatal(err)
		}
		a.onLine(b)
	}
}

func TestClaudeSubagentEvents(t *testing.T) {
	sink := newRecordingSink()
	a := newClaudeAdapter(protocol.ThreadStart{Agent: "claude"}, sink)
	claudeLines(t, a,
		// The parent starts an Explore subagent.
		map[string]any{"type": "assistant", "parent_tool_use_id": nil, "message": map[string]any{"id": "m1", "content": []any{
			map[string]any{"type": "tool_use", "id": "toolu_task", "name": "Task", "input": map[string]any{
				"subagent_type": "Explore", "description": "Find auth tests", "prompt": "Search the repo for auth tests.\nReport file paths.",
			}},
		}}},
		// The subagent's own tool call and its text (text is dropped).
		map[string]any{"type": "assistant", "parent_tool_use_id": "toolu_task", "message": map[string]any{"id": "s1", "content": []any{
			map[string]any{"type": "text", "text": "Let me look."},
			map[string]any{"type": "tool_use", "id": "toolu_grep", "name": "Grep", "input": map[string]any{"pattern": "TestLogin"}},
		}}},
		map[string]any{"type": "user", "parent_tool_use_id": "toolu_task", "message": map[string]any{"content": []any{
			map[string]any{"type": "tool_result", "tool_use_id": "toolu_grep", "content": "internal/auth/login_test.go:12"},
		}}},
		// Progress, then the Task result with its totals.
		map[string]any{"type": "system", "subtype": "task_progress", "tool_use_id": "toolu_task", "usage": map[string]any{"tool_uses": 3.0, "total_tokens": 4200.0, "duration_ms": 9000.0}},
		map[string]any{"type": "user", "parent_tool_use_id": nil, "message": map[string]any{"content": []any{
			map[string]any{"type": "tool_result", "tool_use_id": "toolu_task", "content": []any{map[string]any{"type": "text", "text": "Found 2 test files."}}},
		}}, "tool_use_result": map[string]any{"status": "completed", "totalToolUseCount": 4.0, "totalTokens": 5100.0, "totalDurationMs": 12000.0}},
	)
	evs := toolEvents(sink)
	if len(evs) != 5 {
		t.Fatalf("got %d tool events: %+v", len(evs), evs)
	}
	start := evs[0]
	if start.Tool.Name != "agent" || start.Tool.Status != "running" || start.ParentId != "" {
		t.Fatalf("spawn event: %+v %+v", start, start.Tool)
	}
	ag := start.Tool.Agent
	if ag == nil || ag.Type != "Explore" || ag.Task != "Find auth tests" || !strings.Contains(ag.Prompt, "Report file paths") {
		t.Fatalf("agent: %+v", ag)
	}
	step := evs[1]
	if step.ParentId != start.Id || step.Tool.Name != "grep" {
		t.Fatalf("nested step should point at the subagent row: %+v", step)
	}
	if evs[2].ParentId != "" || evs[2].Id != step.Id || evs[2].Tool.Status != "completed" {
		t.Fatalf("nested result: %+v", evs[2])
	}
	if p := evs[3].Tool.Agent; evs[3].Id != start.Id || p == nil || p.Tools != 3 || p.Tokens != 4200 {
		t.Fatalf("progress: %+v", evs[3])
	}
	end := evs[4]
	if end.Id != start.Id || end.Tool.Status != "completed" {
		t.Fatalf("end: %+v", end)
	}
	if r := end.Tool.Agent; r.Result != "Found 2 test files." || r.Tools != 4 || r.DurationMs != 12000 || r.Tokens != 5100 {
		t.Fatalf("result: %+v", r)
	}
	// The subagent's chatter never becomes a transcript message.
	for _, ev := range sink.events {
		if ev.Role == "assistant" || ev.Role == "thought" {
			t.Fatalf("subagent text leaked: %+v", ev)
		}
	}
}

func TestClaudeBackgroundSubagentStaysRunning(t *testing.T) {
	sink := newRecordingSink()
	a := newClaudeAdapter(protocol.ThreadStart{Agent: "claude"}, sink)
	claudeLines(t, a,
		map[string]any{"type": "assistant", "message": map[string]any{"id": "m1", "content": []any{
			map[string]any{"type": "tool_use", "id": "toolu_bg", "name": "Agent", "input": map[string]any{"subagent_type": "general-purpose", "description": "Audit deps", "prompt": "x", "run_in_background": true}},
		}}},
		map[string]any{"type": "user", "message": map[string]any{"content": []any{
			map[string]any{"type": "tool_result", "tool_use_id": "toolu_bg", "content": "Async agent launched"},
		}}, "tool_use_result": map[string]any{"isAsync": true, "status": "async_launched"}},
	)
	evs := toolEvents(sink)
	if len(evs) != 2 || evs[1].Tool.Status != "" {
		t.Fatalf("a launch receipt must not finish the run: %+v", evs)
	}
	claudeLines(t, a, map[string]any{"type": "system", "subtype": "task_notification", "tool_use_id": "toolu_bg", "status": "failed", "summary": "Network down", "usage": map[string]any{"duration_ms": 5000.0}})
	evs = toolEvents(sink)
	last := evs[len(evs)-1]
	if last.Tool.Status != "error" || last.Tool.Agent.Result != "Network down" {
		t.Fatalf("notification: %+v %+v", last, last.Tool.Agent)
	}
}

func TestClaudeSubagentTodoWriteStaysOutOfPlan(t *testing.T) {
	sink := newRecordingSink()
	a := newClaudeAdapter(protocol.ThreadStart{Agent: "claude"}, sink)
	claudeLines(t, a, map[string]any{"type": "assistant", "parent_tool_use_id": "toolu_task", "message": map[string]any{"id": "s1", "content": []any{
		map[string]any{"type": "tool_use", "id": "toolu_todo", "name": "TodoWrite", "input": map[string]any{"todos": []any{}}},
	}}})
	for _, ev := range sink.events {
		if ev.Role == "plan" {
			t.Fatalf("a subagent's todo list replaced the plan: %+v", ev)
		}
	}
}

func codexNotify(a *codexAdapter, method string, params any) {
	b, _ := json.Marshal(params)
	a.onNotify(method, b)
}

func TestCodexSubagentEvents(t *testing.T) {
	sink := newRecordingSink()
	a := newCodexAdapter(protocol.ThreadStart{Agent: "codex"}, sink)
	a.threadId = "thr_parent"

	// The parent spawns an agent: the call itself has no receiver yet, then
	// completes naming the child thread.
	codexNotify(a, "item/started", map[string]any{"threadId": "thr_parent", "item": map[string]any{
		"id": "call1", "type": "collabAgentToolCall", "tool": "spawnAgent", "status": "inProgress",
		"senderThreadId": "thr_parent", "receiverThreadIds": []string{}, "agentsStates": map[string]any{},
		"prompt": "Review the migration for races.\nBe brief.",
	}})
	if n := len(toolEvents(sink)); n != 0 {
		t.Fatalf("a spawn with no receiver should stay silent, got %d events", n)
	}
	codexNotify(a, "item/completed", map[string]any{"threadId": "thr_parent", "item": map[string]any{
		"id": "call1", "type": "collabAgentToolCall", "tool": "spawnAgent", "status": "completed",
		"senderThreadId": "thr_parent", "receiverThreadIds": []string{"thr_child"}, "agentsStates": map[string]any{"thr_child": map[string]any{"status": "running"}},
		"prompt": "Review the migration for races.\nBe brief.", "model": "gpt-5-codex",
	}})
	codexNotify(a, "thread/started", map[string]any{"thread": map[string]any{"id": "thr_child", "agentNickname": "Hume", "agentRole": "explorer"}})

	evs := toolEvents(sink)
	row := evs[0]
	if row.Tool.Name != "agent" || row.Tool.Status != "running" || row.Tool.Agent.Task != "Review the migration for races." || row.Tool.Agent.Model != "gpt-5-codex" {
		t.Fatalf("spawn row: %+v %+v", row.Tool, row.Tool.Agent)
	}
	named := evs[len(evs)-1]
	if named.Id != row.Id || named.Tool.Agent.Name != "Hume" || named.Tool.Agent.Type != "explorer" {
		t.Fatalf("nickname: %+v", named)
	}

	// The child's own items nest under the row and its turn must not end the
	// parent's.
	codexNotify(a, "item/started", map[string]any{"threadId": "thr_child", "item": map[string]any{"id": "c1", "type": "commandExecution", "command": "rg race", "status": "inProgress"}})
	codexNotify(a, "item/completed", map[string]any{"threadId": "thr_child", "item": map[string]any{"id": "c1", "type": "commandExecution", "command": "rg race", "status": "completed", "exitCode": 0, "aggregatedOutput": "db.go:4"}})
	codexNotify(a, "item/completed", map[string]any{"threadId": "thr_child", "item": map[string]any{"id": "m1", "type": "agentMessage", "text": "No races found."}})
	codexNotify(a, "turn/completed", map[string]any{"threadId": "thr_child", "turn": map[string]any{"status": "completed"}})

	var nested, parentDone int
	var result string
	var lastStatus string
	for _, ev := range toolEvents(sink) {
		if ev.ParentId == row.Id {
			nested++
		}
		if ev.Id == row.Id && ev.Tool.Agent != nil && ev.Tool.Agent.Result != "" {
			result = ev.Tool.Agent.Result
		}
		if ev.Id == row.Id && ev.Tool.Status != "" {
			lastStatus = ev.Tool.Status
		}
	}
	if nested != 2 || result != "No races found." || lastStatus != "completed" {
		t.Fatalf("nested=%d result=%q status=%q", nested, result, lastStatus)
	}
	sink.mu.Lock()
	for _, ev := range sink.events {
		if ev.Role == "status" {
			parentDone++
		}
	}
	idle := 0
	for _, st := range sink.states {
		if st.Status == "idle" {
			idle++
		}
	}
	sink.mu.Unlock()
	if parentDone != 0 || idle != 0 {
		t.Fatalf("a child's turn ended the parent turn (%d status events, %d idle)", parentDone, idle)
	}
}

func TestCodexWaitCarriesResultAndTurnEndClosesRows(t *testing.T) {
	sink := newRecordingSink()
	a := newCodexAdapter(protocol.ThreadStart{Agent: "codex"}, sink)
	a.threadId = "thr_parent"
	for _, tid := range []string{"thr_a", "thr_b"} {
		codexNotify(a, "item/completed", map[string]any{"threadId": "thr_parent", "item": map[string]any{
			"id": "spawn-" + tid, "type": "collabAgentToolCall", "tool": "spawnAgent", "status": "completed",
			"receiverThreadIds": []string{tid}, "agentsStates": map[string]any{}, "prompt": "job " + tid,
		}})
	}
	codexNotify(a, "item/completed", map[string]any{"threadId": "thr_parent", "item": map[string]any{
		"id": "wait1", "type": "collabAgentToolCall", "tool": "wait", "status": "completed",
		"receiverThreadIds": []string{"thr_a"}, "agentsStates": map[string]any{"thr_a": map[string]any{"status": "errored", "message": "boom"}},
	}})
	rows := map[string]protocol.ThreadEvent{}
	for _, ev := range toolEvents(sink) {
		if ev.Tool.Name == "agent" || ev.Tool.Agent != nil {
			rows[ev.Id] = ev
		}
	}
	if len(rows) != 2 {
		t.Fatalf("want 2 rows, got %d", len(rows))
	}
	var sawA bool
	for _, ev := range toolEvents(sink) {
		if ev.Tool.Status == "error" && ev.Tool.Agent != nil && ev.Tool.Agent.Result == "boom" {
			sawA = true
		}
	}
	if !sawA {
		t.Fatalf("wait should fail agent a with its message: %+v", toolEvents(sink))
	}
	// b never reported; the parent turn ending completes it.
	codexNotify(a, "turn/completed", map[string]any{"threadId": "thr_parent", "turn": map[string]any{"status": "completed"}})
	var closed bool
	for _, ev := range toolEvents(sink) {
		if ev.Id == a.itemId("agent-thr_b") && ev.Tool.Status == "completed" {
			closed = true
		}
	}
	if !closed {
		t.Fatalf("turn end should complete the unfinished subagent")
	}
}

// The child's thread/started can arrive before the spawn call completes; the
// row opens then and the spawn call fills in the task.
func TestCodexSubagentThreadStartedFirst(t *testing.T) {
	sink := newRecordingSink()
	a := newCodexAdapter(protocol.ThreadStart{Agent: "codex"}, sink)
	a.threadId = "thr_parent"
	codexNotify(a, "thread/started", map[string]any{"thread": map[string]any{"id": "thr_parent"}})
	codexNotify(a, "thread/started", map[string]any{"thread": map[string]any{"id": "thr_kid", "parentThreadId": "thr_parent", "agentNickname": "Ada"}})
	evs := toolEvents(sink)
	if len(evs) != 1 || evs[0].Tool.Name != "agent" || evs[0].Tool.Status != "running" || evs[0].Tool.Agent.Name != "Ada" {
		t.Fatalf("thread/started should open the row once: %+v", evs)
	}
	codexNotify(a, "item/completed", map[string]any{"threadId": "thr_parent", "item": map[string]any{
		"id": "c1", "type": "collabAgentToolCall", "tool": "spawnAgent", "status": "completed",
		"receiverThreadIds": []string{"thr_kid"}, "agentsStates": map[string]any{}, "prompt": "Check the schema",
	}})
	evs = toolEvents(sink)
	last := evs[len(evs)-1]
	if last.Id != evs[0].Id || last.Tool.Title != "Check the schema" || last.Tool.Agent.Name != "Ada" {
		t.Fatalf("spawn call should fill the same row: %+v %+v", last, last.Tool.Agent)
	}
}
