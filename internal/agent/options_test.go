package agent

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/ErzenXz/overseer/internal/protocol"
)

func TestClaudeArgsMapping(t *testing.T) {
	cfg := protocol.ThreadStart{ResumeId: "sess"}
	args := claudeArgs(cfg, threadSettings{Model: "opus", Effort: "xhigh", Fast: true, Mode: "plan", Access: "full"})
	joined := strings.Join(args, " ")
	for _, want := range []string{"--permission-mode plan", "--model opus", "--effort xhigh", `--settings {"fastMode":true}`, "--resume sess"} {
		if !strings.Contains(joined, want) {
			t.Errorf("args %q missing %q", joined, want)
		}
	}
	// Legacy access maps as before; empty effort/fast add nothing; the
	// "default" model is the CLI's own default.
	joined = strings.Join(claudeArgs(protocol.ThreadStart{}, threadSettings{Model: "default", Access: "full"}), " ")
	if !strings.Contains(joined, "--permission-mode bypassPermissions") {
		t.Errorf("legacy access: %q", joined)
	}
	for _, unwanted := range []string{"--model", "--effort", "--settings"} {
		if strings.Contains(joined, unwanted) {
			t.Errorf("unexpected %s in %q", unwanted, joined)
		}
	}
}

func TestCodexTurnOverrides(t *testing.T) {
	cases := []struct {
		name    string
		set     threadSettings
		wasPlan bool
		want    map[string]any
	}{
		{"legacy edits", threadSettings{Access: "edits"}, false, map[string]any{
			"approvalPolicy": "on-request", "sandboxPolicy": map[string]any{"type": "workspaceWrite"},
		}},
		{"read-only", threadSettings{Mode: "read-only", Effort: "high"}, false, map[string]any{
			"effort": "high", "approvalPolicy": "on-request", "sandboxPolicy": map[string]any{"type": "readOnly"}, "approvalsReviewer": "user",
		}},
		{"auto + fast", threadSettings{Mode: "auto", Fast: true, Model: "gpt-x"}, false, map[string]any{
			"model": "gpt-x", "serviceTierForTurn": "priority", "approvalPolicy": "on-request",
			"sandboxPolicy": map[string]any{"type": "workspaceWrite"}, "approvalsReviewer": "auto_review",
		}},
		{"full", threadSettings{Mode: "full-access"}, false, map[string]any{
			"approvalPolicy": "never", "sandboxPolicy": map[string]any{"type": "dangerFullAccess"}, "approvalsReviewer": "user",
		}},
		{"plan", threadSettings{Mode: "plan", Effort: "low"}, false, map[string]any{
			"effort": "low", "approvalPolicy": "on-request", "sandboxPolicy": map[string]any{"type": "readOnly"}, "approvalsReviewer": "user",
			"collaborationMode": map[string]any{"mode": "plan", "settings": map[string]any{"model": "thread-model", "reasoning_effort": "low", "developer_instructions": nil}},
		}},
		{"leaving plan", threadSettings{Mode: "on-request"}, true, map[string]any{
			"approvalPolicy": "on-request", "sandboxPolicy": map[string]any{"type": "workspaceWrite"}, "approvalsReviewer": "user",
			"collaborationMode": map[string]any{"mode": "default", "settings": map[string]any{"model": "thread-model", "reasoning_effort": nil, "developer_instructions": nil}},
		}},
	}
	for _, c := range cases {
		got := codexTurnOverrides(c.set, "thread-model", "", c.wasPlan)
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s:\n got %#v\nwant %#v", c.name, got, c.want)
		}
	}
	approval, sandbox := codexModePolicy(codexMode(threadSettings{Access: "ask"}))
	if approval != "on-request" || sandbox != "read-only" {
		t.Errorf("legacy ask = %s/%s", approval, sandbox)
	}
}

func TestClaudeOptionsFromInitialize(t *testing.T) {
	var resp jsonObj
	json.Unmarshal([]byte(`{
		"current_permission_mode": "default",
		"fast_mode_state": "off",
		"models": [
			{"value": "default", "displayName": "Default (recommended)", "description": "Opus", "supportsEffort": true,
			 "supportedEffortLevels": ["low", "medium", "high", "xhigh", "max"], "supportsFastMode": true, "supportsAutoMode": true},
			{"value": "sonnet", "displayName": "Sonnet", "supportedEffortLevels": ["low", "high"], "supportsAutoMode": true},
			{"value": "haiku", "displayName": "Haiku", "description": "Fast"}
		]}`), &resp)
	o, err := claudeOptionsFrom(resp)
	if err != nil {
		t.Fatal(err)
	}
	if len(o.Models) != 3 || !o.Models[0].Default || o.Models[0].Label != "Default (recommended)" {
		t.Fatalf("models = %+v", o.Models)
	}
	if strings.Join(o.Models[1].Efforts, ",") != "low,high" || o.Models[2].Efforts == nil || len(o.Models[2].Efforts) != 0 {
		t.Errorf("per-model efforts = %+v", o.Models)
	}
	var ids []string
	for _, e := range o.Efforts {
		ids = append(ids, e.Id)
	}
	if strings.Join(ids, ",") != "low,medium,high,xhigh,max" || o.Efforts[3].Label != "Extra high" {
		t.Errorf("efforts = %+v", o.Efforts)
	}
	if o.Fast == nil || len(o.Modes) != 5 || o.DefaultMode != "default" {
		t.Errorf("fast=%v modes=%d default=%q", o.Fast, len(o.Modes), o.DefaultMode)
	}
	b, _ := json.Marshal(o.Models[2])
	if !strings.Contains(string(b), `"efforts":[]`) {
		t.Errorf("model without efforts should marshal efforts: [], got %s", b)
	}
	b, _ = json.Marshal(protocol.AgentModel{Id: "x", Label: "x"})
	if strings.Contains(string(b), "efforts") {
		t.Errorf("unreported efforts should be omitted, got %s", b)
	}
	if _, err := claudeOptionsFrom(jsonObj{}); err == nil {
		t.Error("an empty catalog should fail discovery")
	}
}

func TestCodexOptionsFromModelList(t *testing.T) {
	models, next := parseCodexModels(json.RawMessage(`{"data": [
		{"id": "gpt-a", "model": "gpt-a", "displayName": "GPT A", "description": "a", "isDefault": true, "hidden": false,
		 "defaultReasoningEffort": "medium", "supportedReasoningEfforts": [
			{"reasoningEffort": "low", "description": "quick"}, {"reasoningEffort": "high", "description": "deep"}],
		 "serviceTiers": [{"id": "priority", "name": "Fast", "description": "2x speed"}]},
		{"id": "gpt-hidden", "model": "gpt-hidden", "displayName": "H", "description": "", "isDefault": false, "hidden": true,
		 "defaultReasoningEffort": "low", "supportedReasoningEfforts": []}
	], "nextCursor": "c2"}`))
	if next != "c2" || len(models) != 2 {
		t.Fatalf("parsed %d models, next %q", len(models), next)
	}
	o, err := codexOptionsFrom(models, []string{"default"})
	if err != nil {
		t.Fatal(err)
	}
	if len(o.Models) != 1 || o.Models[0].DefaultEffort != "medium" || !o.Models[0].Default || strings.Join(o.Models[0].Efforts, ",") != "low,high" {
		t.Errorf("models = %+v", o.Models)
	}
	if len(o.Efforts) != 2 || o.Efforts[1].Description != "deep" {
		t.Errorf("efforts = %+v", o.Efforts)
	}
	if o.Fast == nil || o.Fast.Label != "Fast" || o.Fast.Description != "2x speed" {
		t.Errorf("fast = %+v", o.Fast)
	}
	for _, m := range o.Modes {
		if m.Id == "plan" {
			t.Error("plan should be dropped when the server lists no plan collaboration mode")
		}
	}
}

func TestACPDiscovery(t *testing.T) {
	t.Setenv(fakeACPEnv, "1")
	logPath := filepath.Join(t.TempDir(), "calls.log")
	t.Setenv(fakeACPLogEnv, logPath)
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	o := discoverAgentOptions(protocol.AgentOptionsRequest{Agent: "acp", Command: fmt.Sprintf("%q", exe)})
	if o.Source != protocol.OptionsDiscovered || o.Agent != "acp" {
		t.Fatalf("options = %+v", o)
	}
	if len(o.Modes) != 3 || o.DefaultMode != "code" || o.Modes[2].Kind != protocol.KindPlan || o.Modes[1].Kind != protocol.KindEdits {
		t.Errorf("modes = %+v default %q", o.Modes, o.DefaultMode)
	}
	if len(o.Models) != 2 || !o.Models[0].Default || o.Models[1].Description != "Bigger" {
		t.Errorf("models = %+v", o.Models)
	}
	if len(o.Efforts) != 2 || o.Efforts[1].Id != "high" || o.Efforts[1].Description != "Thinks hard" {
		t.Errorf("efforts = %+v", o.Efforts)
	}
	if o.Fast != nil {
		t.Errorf("ACP has no fast option, got %+v", o.Fast)
	}
	calls, _ := os.ReadFile(logPath)
	if strings.Contains(string(calls), "session/prompt") || !strings.Contains(string(calls), "session/delete") {
		t.Errorf("probe calls:\n%s", calls)
	}

	// A missing CLI falls back to the builtin table.
	o = discoverAgentOptions(protocol.AgentOptionsRequest{Agent: "acp", Command: "/nonexistent/agent-cli"})
	if o.Source != protocol.OptionsBuiltin || len(o.Modes) != 1 || o.Models == nil || o.Efforts == nil {
		t.Errorf("fallback = %+v", o)
	}
}
