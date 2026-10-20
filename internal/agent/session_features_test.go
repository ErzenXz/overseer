package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

func TestClaudeForkArgs(t *testing.T) {
	join := func(cfg protocol.ThreadStart) string { return strings.Join(claudeArgs(cfg, threadSettings{}), " ") }
	if got := join(protocol.ThreadStart{ResumeId: "s1", Fork: true}); !strings.Contains(got, "--resume s1 --fork-session") {
		t.Errorf("whole-session fork: %q", got)
	}
	if got := join(protocol.ThreadStart{ResumeId: "s1", Fork: true, ForkAt: "u-1"}); strings.Contains(got, "--resume") {
		t.Errorf("a cut fork can't resume (fresh session + transcript): %q", got)
	}
	if got := join(protocol.ThreadStart{ResumeId: "s1"}); !strings.Contains(got, "--resume s1") || strings.Contains(got, "fork") {
		t.Errorf("plain resume: %q", got)
	}
}

func TestPromptContentWithImages(t *testing.T) {
	p := promptInput{Text: "look", Images: []promptImage{{Path: "/x/a.png", Mime: "image/png", Data: []byte("PNG")}}}
	c := claudeUserContent(p)
	if len(c) != 2 || c[0]["type"] != "image" || c[1]["text"] != "look" {
		t.Fatalf("claude content = %+v", c)
	}
	if src := c[0]["source"].(map[string]any); src["media_type"] != "image/png" || src["data"] != "UE5H" {
		t.Errorf("claude image source = %+v", src)
	}
	in := codexInput(p)
	if len(in) != 2 || in[1]["type"] != "localImage" || in[1]["path"] != "/x/a.png" {
		t.Errorf("codex input = %+v", in)
	}
	blocks := acpPromptBlocks(p)
	if len(blocks) != 2 || blocks[0]["mimeType"] != "image/png" || blocks[0]["data"] != "UE5H" {
		t.Errorf("acp blocks = %+v", blocks)
	}
}

func TestLoadPromptImages(t *testing.T) {
	cwd := t.TempDir()
	os.MkdirAll(filepath.Join(cwd, ".overseer", "uploads"), 0o755)
	os.WriteFile(filepath.Join(cwd, ".overseer", "uploads", "shot.png"), []byte("png"), 0o644)
	os.WriteFile(filepath.Join(cwd, "notes.txt"), []byte("x"), 0o644)
	imgs, err := loadPromptImages(cwd, []string{".overseer/uploads/shot.png"})
	if err != nil || len(imgs) != 1 || imgs[0].Mime != "image/png" || string(imgs[0].Data) != "png" || !filepath.IsAbs(imgs[0].Path) {
		t.Fatalf("load = %+v, %v", imgs, err)
	}
	if _, err := loadPromptImages(cwd, []string{"notes.txt"}); err == nil {
		t.Error("non-image file accepted")
	}
	if _, err := loadPromptImages(cwd, []string{"missing.png"}); err == nil {
		t.Error("missing file accepted")
	}
	home, _ := os.UserHomeDir()
	if !strings.HasPrefix(cwd, home) {
		if _, err := loadPromptImages(cwd, []string{"/etc/hosts.png"}); err == nil {
			t.Error("path outside cwd and home accepted")
		}
	}
}

func TestClaudeAskUserQuestionMapping(t *testing.T) {
	var input jsonObj
	json.Unmarshal([]byte(`{"questions": [
		{"question": "Which database?", "header": "DB", "multiSelect": false,
		 "options": [{"label": "Postgres", "description": "relational"}, {"label": "SQLite", "description": "file"}]},
		{"question": "Which extras?", "header": "Extras", "multiSelect": true, "options": [{"label": "Auth"}, {"label": "Billing"}]}
	]}`), &input)
	qs := claudeQuestions("q", input)
	if len(qs) != 2 || qs[0].Text != "Which database?" || qs[0].Multiple || !qs[1].Multiple || !qs[0].AllowText {
		t.Fatalf("questions = %+v", qs)
	}
	if qs[0].Options[0].Id != "Postgres" || qs[0].Options[0].Description != "relational" {
		t.Errorf("options = %+v", qs[0].Options)
	}
	out := claudeAnswerInput(input, qs, [][]string{{"SQLite"}, {"Auth", "Billing"}})
	answers := out["answers"].(map[string]string)
	if answers["Which database?"] != "SQLite" || answers["Which extras?"] != "Auth, Billing" || out["questions"] == nil {
		t.Errorf("updatedInput = %+v", out)
	}
}

func TestCodexRequestUserInputMapping(t *testing.T) {
	var p jsonObj
	json.Unmarshal([]byte(`{"threadId": "t", "turnId": "u", "itemId": "i", "isBlocking": true, "questions": [
		{"id": "env", "header": "Environment", "question": "Deploy where?", "options": [{"label": "staging", "description": "safe"}, {"label": "prod", "description": "careful"}]},
		{"id": "why", "header": "Reason", "question": "Why?", "options": null, "isOther": false}
	]}`), &p)
	qs, ids := codexQuestions("q", p)
	if len(qs) != 2 || ids[0] != "env" || ids[1] != "why" || qs[0].AllowText || !qs[1].AllowText || len(qs[0].Options) != 2 {
		t.Fatalf("questions = %+v ids = %v", qs, ids)
	}
}

func TestACPElicitationMapping(t *testing.T) {
	var p jsonObj
	json.Unmarshal([]byte(`{"message": "Configure", "requestedSchema": {"type": "object", "properties": {
		"count": {"type": "integer", "title": "How many?"}, "ok": {"type": "boolean", "title": "Proceed?"}}}}`), &p)
	qs, fields := acpElicitQuestions("q", p)
	if len(qs) != 2 || fields[0].name != "count" || !qs[0].AllowText || len(qs[1].Options) != 2 {
		t.Fatalf("questions = %+v fields = %+v", qs, fields)
	}
	if v := acpElicitValue(fields[0], nil, " 3 "); v != int64(3) {
		t.Errorf("integer = %#v", v)
	}
	if v := acpElicitValue(fields[1], []string{"true"}, ""); v != true {
		t.Errorf("boolean = %#v", v)
	}
}

// The fake ACP agent asks an elicitation question; it surfaces as a
// question message, parks the thread, and the answer goes back typed.
func TestACPQuestionRoundTrip(t *testing.T) {
	t.Setenv(fakeACPEnv, "1")
	logPath := filepath.Join(t.TempDir(), "calls.log")
	t.Setenv(fakeACPLogEnv, logPath)
	exe, _ := os.Executable()
	cwd := t.TempDir()
	os.WriteFile(filepath.Join(cwd, "pic.png"), []byte("png"), 0o644)
	sink := newRecordingSink()
	ad, err := newThreadAdapter(protocol.ThreadStart{ThreadId: "q1", Agent: "acp", Command: fmt.Sprintf("%q", exe), Cwd: cwd, Access: "edits"}, sink)
	if err != nil {
		t.Fatal(err)
	}
	defer ad.stop()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := ad.start(ctx); err != nil {
		t.Fatal(err)
	}
	if calls, _ := os.ReadFile(logPath); strings.Contains(string(calls), "missing-elicitation-capability") {
		t.Error("client did not advertise elicitation")
	}
	// Capabilities follow the agent: images from promptCapabilities,
	// compact/review from its command list.
	sink.waitFor(t, "capabilities", func() bool {
		for _, st := range sink.states {
			if st.Capabilities != nil && st.Capabilities.Compact && st.Capabilities.Review && st.Capabilities.Images && len(st.Commands) == 2 {
				return true
			}
		}
		return false
	})
	if err := ad.undo(); err == nil || !strings.Contains(err.Error(), protocol.ErrNotSupported) {
		t.Errorf("undo = %v, want not supported", err)
	}
	imgs, _ := loadPromptImages(cwd, []string{"pic.png"})
	if err := ad.prompt(promptInput{Text: "ask", Images: imgs}); err != nil {
		t.Fatal(err)
	}
	var questions []protocol.ThreadQuestion
	sink.waitFor(t, "questions", func() bool {
		questions = questions[:0]
		for _, ev := range sink.events {
			if ev.Role == "question" && ev.Question != nil {
				questions = append(questions, *ev.Question)
			}
		}
		return len(questions) == 1 && sink.states[len(sink.states)-1].Status == "waiting"
	})
	q := questions[0]
	if !strings.HasPrefix(q.Text, "Pick a colour") || len(q.Options) != 2 || q.Options[1].Label != "Blue" {
		t.Fatalf("first question = %+v", q)
	}
	if err := ad.answer(q.Id, []string{"green"}, ""); err == nil {
		t.Error("unknown option accepted")
	}
	if err := ad.answer(q.Id, []string{"blue"}, ""); err != nil {
		t.Fatal(err)
	}
	sink.waitFor(t, "second question", func() bool {
		n := 0
		for _, ev := range sink.events {
			if ev.Role == "question" {
				n++
				q = *ev.Question
			}
		}
		return n == 2
	})
	if !q.AllowText || len(q.Options) != 0 {
		t.Fatalf("second question = %+v", q)
	}
	if err := ad.answer(q.Id, nil, "be quick"); err != nil {
		t.Fatal(err)
	}
	sink.waitFor(t, "reply", func() bool {
		text := ""
		for _, ev := range sink.events {
			if ev.Role == "assistant" {
				text += ev.Text
			}
		}
		return text == "accept: blue / be quick (images 1)"
	})
	sink.mu.Lock()
	defer sink.mu.Unlock()
	answered := 0
	for _, ev := range sink.events {
		if ev.Question != nil && len(ev.Question.Answered) > 0 {
			answered++
		}
	}
	if answered != 2 {
		t.Errorf("answered events = %d, want 2", answered)
	}
}
