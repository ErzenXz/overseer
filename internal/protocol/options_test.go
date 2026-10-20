package protocol

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestBuiltinAgentOptionsShape(t *testing.T) {
	for _, agent := range []string{"claude", "codex", "gemini", "acp"} {
		o := BuiltinAgentOptions(agent)
		b, _ := json.Marshal(o)
		var m map[string]any
		json.Unmarshal(b, &m)
		for _, key := range []string{"agent", "source", "models", "efforts", "modes", "defaultMode"} {
			if _, ok := m[key]; !ok || m[key] == nil {
				t.Errorf("%s: %s missing or null in %s", agent, key, b)
			}
		}
		if o.Source != OptionsBuiltin || o.Agent != agent {
			t.Errorf("%s: source/agent = %q/%q", agent, o.Source, o.Agent)
		}
		found := false
		for _, mode := range o.Modes {
			found = found || mode.Id == o.DefaultMode
			if mode.Kind == "" || mode.Label == "" {
				t.Errorf("%s: incomplete mode %+v", agent, mode)
			}
		}
		if !found {
			t.Errorf("%s: default mode %q not among modes", agent, o.DefaultMode)
		}
	}
	claude := BuiltinAgentOptions("claude")
	var ids []string
	for _, e := range claude.Efforts {
		ids = append(ids, e.Id)
	}
	if strings.Join(ids, ",") != "low,medium,high,max" || claude.Fast == nil || len(claude.Modes) != 5 {
		t.Errorf("claude builtin = %+v", claude)
	}
	codex := BuiltinAgentOptions("codex")
	if len(codex.Efforts) != 4 || codex.Efforts[0].Id != "minimal" || codex.Fast == nil || codex.DefaultMode != "on-request" {
		t.Errorf("codex builtin = %+v", codex)
	}
	if acp := BuiltinAgentOptions("opencode"); acp.Fast != nil || len(acp.Efforts) != 0 || acp.Modes[0].Id != "default" {
		t.Errorf("acp builtin = %+v", acp)
	}
	// Builtins are copies: callers may modify them.
	claude.Modes[0].Id = "changed"
	if BuiltinAgentOptions("claude").Modes[0].Id != "default" {
		t.Error("builtin table was mutated through a returned value")
	}
}

func TestModeKindAndAccess(t *testing.T) {
	cases := []struct{ agent, mode, kind, access string }{
		{"claude", "plan", KindPlan, "ask"},
		{"claude", "default", KindAsk, "edits"},
		{"claude", "acceptEdits", KindEdits, "edits"},
		{"claude", "bypassPermissions", KindFull, "full"},
		{"codex", "read-only", KindReadonly, "ask"},
		{"codex", "auto", KindAuto, "auto"},
		{"codex", "full-access", KindFull, "full"},
		{"opencode", "build", KindEdits, "edits"},
		{"gemini", "yolo", KindFull, "full"},
		{"gemini", "whatever", KindAsk, "edits"},
	}
	for _, c := range cases {
		kind := ModeKind(c.agent, c.mode, nil)
		if kind != c.kind || AccessForKind(kind) != c.access {
			t.Errorf("%s/%s = %s/%s, want %s/%s", c.agent, c.mode, kind, AccessForKind(kind), c.kind, c.access)
		}
	}
	if ModeKind("opencode", "build", []AgentMode{{Id: "build", Kind: KindFull}}) != KindFull {
		t.Error("discovered modes should win over guessing")
	}
}
