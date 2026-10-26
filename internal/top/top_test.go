package top

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ErzenXz/overseer/internal/fleet"
	"github.com/ErzenXz/overseer/internal/protocol"
)

var fixedNow = time.Date(2026, 10, 26, 14, 30, 0, 0, time.Local)

func ms(ago time.Duration) int64 { return fixedNow.Add(-ago).UnixMilli() }

func tool(name, title, input, status string) *protocol.ThreadTool {
	return &protocol.ThreadTool{Name: name, Title: title, Input: input, Status: status}
}

func approvalMsgs() []fleet.ThreadMessage {
	return []fleet.ThreadMessage{
		{Id: "u1", Role: "user", Text: "fix the flaky test", At: ms(10 * time.Minute)},
		{Id: "t1", Role: "tool", Tool: tool("read", "Read auth_test.go", "/src/auth_test.go", "completed"), At: ms(9 * time.Minute)},
		{Id: "a1", Role: "approval", At: ms(4*time.Minute + 12*time.Second), Approval: &protocol.ThreadApprovalRequest{
			Id: "ap1", Title: "Run: go test ./...", Detail: "go test ./... -count=1 -race",
			Options: []protocol.ApprovalOption{
				{Id: "o1", Label: "Allow once", Kind: "allow_once"},
				{Id: "o2", Label: "Always allow", Kind: "allow_always"},
				{Id: "o3", Label: "Reject", Kind: "reject_once"},
			}}},
	}
}

func fixture() Snapshot {
	mk := func(id, title, status, agent, model, dev, cwd string, upd time.Duration, msgs []fleet.ThreadMessage) Row {
		t := fleet.Thread{Id: id, Title: title, Status: status, Agent: agent, Model: model, DeviceId: dev, DeviceName: strings.ToUpper(dev[:1]) + dev[1:],
			Cwd: cwd, CreatedAt: ms(time.Hour), UpdatedAt: ms(upd), Access: "ask"}
		r := Row{Thread: t, Kind: kindOf(status), Msgs: msgs}
		if msgs != nil {
			r.Act = deriveActivity(t, msgs)
		}
		return r
	}
	rows := []Row{
		mk("d1", "Add dark mode to settings", "idle", "claude", "claude-sonnet-5", "macbook", "/Users/e/Projects/web", 3*time.Minute, []fleet.ThreadMessage{
			{Role: "user", Text: "dark mode", At: ms(20 * time.Minute)},
			{Role: "assistant", Text: "Done. Dark mode is added.\nSee settings.", At: ms(4 * time.Minute)},
		}),
		mk("w1", "Refactor the billing module", "working", "codex", "gpt-5", "studio", "/home/e/code/billing", 5*time.Second, []fleet.ThreadMessage{
			{Role: "user", Text: "refactor", At: ms(7 * time.Minute)},
			{Role: "tool", Tool: tool("edit", "Edit invoice.go", "/home/e/code/billing/invoice.go", "running"), At: ms(2 * time.Second)},
		}),
		mk("p1", "Fix flaky auth test", "waiting", "claude", "claude-opus-5", "macbook", "/Users/e/Projects/LiveAgent", 4*time.Minute, approvalMsgs()),
		mk("f1", "Migrate the database", "error", "claude", "", "studio", "/home/e/code/db", 30*time.Minute, nil),
		mk("w2", "Write release notes", "working", "claude", "claude-haiku-5", "macbook", "/Users/e/Projects/LiveAgent", 1*time.Second, []fleet.ThreadMessage{
			{Role: "user", Text: "notes", At: ms(90 * time.Second)},
			{Role: "tool", Tool: tool("bash", "", "bash -lc 'cd /x && go test ./internal/... -count=1'", "running"), At: ms(time.Second)},
		}),
	}
	rows[3].Thread.Error = "agent crashed: exit 1"
	rows[3].Act.Step = "agent crashed: exit 1"
	rows[0].Branch = "feat/dark"
	rows[2].Branch = "main"
	sortRows(rows)
	cpu := func(c float64, used, total uint64) *protocol.Stats {
		return &protocol.Stats{CPUPercent: c, MemUsed: used, MemTotal: total}
	}
	return Snapshot{
		At: fixedNow, HubURL: "https://hub.example.com", Hub: "hub.example.com", Version: "0.9.0", Loaded: true,
		Rows: rows,
		Machines: []Machine{
			{Device: fleet.Device{Id: "macbook", Name: "Macbook", Online: true, Stats: cpu(34, 61, 100)}, Working: 1, Waiting: 1, Total: 3},
			{Device: fleet.Device{Id: "studio", Name: "Studio", Online: true, Stats: cpu(88, 40, 100)}, Working: 1, Total: 2},
			{Device: fleet.Device{Id: "nas", Name: "Nas", Online: false, LastSeen: fixedNow.Add(-3 * time.Hour).Unix()}},
		},
	}
}

func newModel(w, h int) *Model {
	m := NewModel(w, h, false)
	m.Now = fixedNow
	m.SetSnapshot(fixture())
	return m
}

func plainLines(m *Model) []string {
	var out []string
	for _, l := range m.Lines() {
		out = append(out, l.Plain())
	}
	return out
}

func TestRenderSizes(t *testing.T) {
	for _, sz := range [][2]int{{80, 24}, {160, 40}, {60, 12}, {120, 30}} {
		m := newModel(sz[0], sz[1])
		lines := plainLines(m)
		if len(lines) != sz[1] {
			t.Fatalf("%dx%d: got %d lines", sz[0], sz[1], len(lines))
		}
		for i, l := range lines {
			if w := strWidth(l); w > sz[0] {
				t.Errorf("%dx%d line %d is %d cells wide: %q", sz[0], sz[1], i, w, l)
			}
		}
		out := m.View()
		if strings.Contains(out, "\x1b[38;5") || strings.Contains(out, "\x1b[48;5") {
			t.Errorf("%dx%d: colour codes with Color=false", sz[0], sz[1])
		}
	}
}

func TestRender80x24Content(t *testing.T) {
	m := newModel(80, 24)
	text := strings.Join(plainLines(m), "\n")
	for _, want := range []string{
		"Overseer top", "hub.example.com", "1 waiting", "2 working", "1 done today", "1 failed",
		"Macbook", "cpu", "mem", "Nas", "offline",
		"Fix flaky auth", "approval", "Run: go test ./...",
		"Editing invoice.go", "Running go test",
		"↑↓ move", "q quit",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("missing %q in:\n%s", want, text)
		}
	}
	// waiting first, then working, then the rest
	idx := func(s string) int { return strings.Index(text, s) }
	if !(idx("Fix flaky auth") < idx("Refactor the") && idx("Refactor the") < idx("Add dark mode")) {
		t.Errorf("wrong row order:\n%s", text)
	}
	if t.Failed() {
		t.Log("\n" + text)
	}
}

func TestRenderWideShowsFolderAndBranch(t *testing.T) {
	text := strings.Join(plainLines(newModel(160, 40)), "\n")
	for _, want := range []string{"FOLDER", "Projects/LiveAgent ⎇ main", "web ⎇ feat/dark", "claude sonnet-5", "Done. Dark mode is added."} {
		if !strings.Contains(text, want) {
			t.Errorf("missing %q in:\n%s", want, text)
		}
	}
	narrow := strings.Join(plainLines(newModel(80, 24)), "\n")
	if strings.Contains(narrow, "FOLDER") {
		t.Errorf("80 columns should drop the folder column")
	}
}

func TestSelectedRowHighlight(t *testing.T) {
	m := NewModel(80, 24, true)
	m.Now = fixedNow
	m.SetSnapshot(fixture())
	if !strings.Contains(m.View(), "\x1b[48;5;238") {
		t.Error("selected row has no background in colour mode")
	}
	m.Color = false
	if !strings.Contains(m.View(), "\x1b[7m") {
		t.Error("selected row should use reverse video without colour")
	}
}

func TestEscapeInjectionIsNeutralised(t *testing.T) {
	s := fixture()
	s.Rows[0].Thread.Title = "evil\x1b]0;pwned\x07 title\x1b[2J"
	s.Rows[0].Act.Step = "step\x1b[31m red"
	m := NewModel(100, 24, false)
	m.Now = fixedNow
	m.SetSnapshot(s)
	out := m.View()
	if strings.Contains(out, "pwned\x07") || strings.Contains(out, "\x1b]") || strings.Contains(out, "\x1b[2J") || strings.Contains(out, "\x1b[31m") {
		t.Errorf("escape sequences from hub data reached the terminal: %q", out)
	}
}

func TestTruncateAndWidth(t *testing.T) {
	cases := []struct {
		in   string
		w    int
		want string
	}{
		{"hello", 10, "hello"}, {"hello world", 6, "hello…"}, {"abc", 1, "…"}, {"abc", 0, ""},
		{"日本語です", 6, "日本…"}, {"héllo", 5, "héllo"},
	}
	for _, c := range cases {
		if got := truncate(c.in, c.w); got != c.want {
			t.Errorf("truncate(%q,%d)=%q want %q", c.in, c.w, got, c.want)
		}
		if strWidth(truncate(c.in, c.w)) > c.w {
			t.Errorf("truncate(%q,%d) too wide", c.in, c.w)
		}
	}
	if got := truncateMiddle("/very/long/path/to/project", 12); strWidth(got) != 12 || !strings.Contains(got, "…") {
		t.Errorf("truncateMiddle = %q", got)
	}
	if got := oneLine("a\n\tb \x1b[0m  c"); got != "a b [0m c" {
		t.Errorf("oneLine = %q", got)
	}
}

func TestWrap(t *testing.T) {
	got := wrap("the quick brown fox jumps over the lazy dog\n\nnext para averyveryverylongwordthatdoesnotfit", 12)
	for _, l := range got {
		if strWidth(l) > 12 {
			t.Errorf("line too long: %q", l)
		}
	}
	if got[0] != "the quick" {
		t.Errorf("wrap[0] = %q", got[0])
	}
}

func TestFormatDuration(t *testing.T) {
	cases := map[int64]string{0: "0s", 45_000: "45s", 125_000: "2m05s", 725_000: "12m", 3_900_000: "1h05m", 90_000_000: "1d1h", -5: "0s"}
	for in, want := range cases {
		if got := formatDuration(in); got != want {
			t.Errorf("formatDuration(%d)=%q want %q", in, got, want)
		}
	}
}

func TestDescribeTool(t *testing.T) {
	cases := []struct {
		tool *protocol.ThreadTool
		want string
	}{
		{tool("read", "Read /a/b/auth.go", "/a/b/auth.go", "completed"), "Read auth.go"},
		{tool("read", "", "/a/b/auth.go", "running"), "Reading auth.go"},
		{tool("edit", "", "", "running"), "Editing files"},
		{tool("bash", "", "bash -lc 'cd /repo && rg -n foo src'", "completed"), "Searched for foo"},
		{tool("bash", "", "cat /etc/hosts", "completed"), "Read hosts"},
		{tool("bash", "", "go build ./... && go test", "completed"), "Ran go build ./... && go test"},
		{tool("grep", "Searched for TODO", "", "completed"), "Searched for TODO"},
		{tool("webfetch", "", "https://example.com/", "completed"), "Fetched example.com"},
		{tool("mcp", "github.create_issue", "", "running"), "Using github.create_issue"},
		{tool("weird", "Doing a thing", "", "running"), "Doing a thing"},
		{&protocol.ThreadTool{Name: "edit", Status: "completed", Files: []protocol.ThreadToolFile{{Path: "/a/x.go"}, {Path: "/a/y.go"}}}, "Edited 2 files"},
	}
	for _, c := range cases {
		if got := stepLine(fleet.ThreadMessage{Role: "tool", Tool: c.tool}); got != c.want {
			t.Errorf("stepLine(%s %q) = %q want %q", c.tool.Name, c.tool.Input, got, c.want)
		}
	}
}

func TestDeriveActivity(t *testing.T) {
	th := fleet.Thread{Id: "x", Status: "waiting", CreatedAt: 1}
	a := deriveActivity(th, approvalMsgs())
	if a.Pending == nil || a.Pending.Approval == nil || a.Pending.Approval.Id != "ap1" {
		t.Fatalf("pending approval not found: %+v", a)
	}
	if a.Step != "Run: go test ./..." || a.TurnStart != ms(10*time.Minute) {
		t.Errorf("activity = %+v", a)
	}
	// A resolved approval is not pending.
	msgs := approvalMsgs()
	msgs[2].Approval.Resolved = "o1"
	if a := deriveActivity(th, msgs); a.Pending != nil {
		t.Errorf("resolved approval still pending")
	}
	// Working: thinking, replying, no transcript.
	w := fleet.Thread{Status: "working"}
	if got := deriveActivity(w, []fleet.ThreadMessage{{Role: "user"}, {Role: "thought"}}).Step; got != "Thinking…" {
		t.Errorf("step = %q", got)
	}
	if got := deriveActivity(w, nil).Step; got != "Starting…" {
		t.Errorf("step = %q", got)
	}
	// Question.
	q := []fleet.ThreadMessage{{Role: "question", Question: &protocol.ThreadQuestion{Id: "q", Text: "Which db?"}}}
	if a := deriveActivity(th, q); a.Pending == nil || a.Pending.Question == nil || a.Step != "Which db?" {
		t.Errorf("question = %+v", a)
	}
}

func TestSortRowsStable(t *testing.T) {
	s := fixture()
	var order []string
	for _, r := range s.Rows {
		order = append(order, r.Thread.Id)
	}
	want := []string{"p1", "w1", "w2", "d1", "f1"} // waiting; working oldest turn first; rest newest first
	if strings.Join(order, ",") != strings.Join(want, ",") {
		t.Errorf("order = %v want %v", order, want)
	}
}

func TestFilter(t *testing.T) {
	m := newModel(100, 24)
	m.Filter = "macbook claude"
	for _, r := range m.Rows() {
		if r.Thread.DeviceName != "Macbook" {
			t.Errorf("row %s leaked through filter", r.Thread.Title)
		}
	}
	if n := len(m.Rows()); n != 3 {
		t.Errorf("filtered rows = %d", n)
	}
	m.Filter = "zzz"
	if text := strings.Join(plainLines(m), "\n"); !strings.Contains(text, "No sessions match") {
		t.Errorf("empty filter message missing:\n%s", text)
	}
}

func keyRune(r rune) Key { return Key{Kind: KeyRune, R: r} }

func TestKeyNavigation(t *testing.T) {
	m := newModel(100, 24)
	if m.SelID != "p1" {
		t.Fatalf("first selection = %q", m.SelID)
	}
	m.HandleKey(Key{Kind: KeyDown})
	m.HandleKey(keyRune('j'))
	if m.SelID != "w2" {
		t.Errorf("after j,down = %q", m.SelID)
	}
	m.HandleKey(keyRune('k'))
	if m.SelID != "w1" {
		t.Errorf("after k = %q", m.SelID)
	}
	m.HandleKey(keyRune('G'))
	if m.SelID != "f1" {
		t.Errorf("G = %q", m.SelID)
	}
	m.HandleKey(Key{Kind: KeyDown})
	if m.SelID != "f1" {
		t.Errorf("down at the end moved to %q", m.SelID)
	}
	m.HandleKey(keyRune('g'))
	if m.SelID != "p1" {
		t.Errorf("g = %q", m.SelID)
	}
	if a := m.HandleKey(keyRune('q')); a.Kind != ActQuit {
		t.Errorf("q = %+v", a)
	}
	if a := m.HandleKey(Key{Kind: KeyCtrlC}); a.Kind != ActQuit {
		t.Errorf("ctrl-c = %+v", a)
	}
}

func TestSelectionFollowsSessionWhenOrderChanges(t *testing.T) {
	m := newModel(100, 24)
	m.HandleKey(keyRune('G')) // f1
	s := fixture()
	s.Rows[0], s.Rows[len(s.Rows)-1] = s.Rows[len(s.Rows)-1], s.Rows[0]
	m.SetSnapshot(s)
	if r, _ := m.Selected(); r.Thread.Id != "f1" {
		t.Errorf("selection jumped to %s", r.Thread.Id)
	}
	// A vanished session leaves a valid selection.
	s.Rows = s.Rows[:1]
	m.SetSnapshot(s)
	if _, ok := m.Selected(); !ok {
		t.Error("no selection after the list shrank")
	}
}

func TestDetailPane(t *testing.T) {
	m := newModel(80, 24)
	if a := m.HandleKey(Key{Kind: KeyEnter}); a.Kind != ActRefresh || m.Mode != ModeDetail {
		t.Fatalf("enter: %+v mode %d", a, m.Mode)
	}
	text := strings.Join(plainLines(m), "\n")
	for _, want := range []string{"Fix flaky auth test", "Waiting for your approval", "Recent steps", "Read auth_test.go", "fix the flaky test", "Last message", "⏎/esc back"} {
		if !strings.Contains(text, want) {
			t.Errorf("detail missing %q:\n%s", want, text)
		}
	}
	m.HandleKey(Key{Kind: KeyDown})
	m.HandleKey(keyRune('k'))
	m.HandleKey(keyRune('k'))
	if m.Scroll != 0 {
		t.Errorf("scroll underflow: %d", m.Scroll)
	}
	m.HandleKey(Key{Kind: KeyEsc})
	if m.Mode != ModeList {
		t.Error("esc should leave detail")
	}
	// detail scrolls on a tiny terminal
	m = newModel(60, 12)
	m.HandleKey(Key{Kind: KeyEnter})
	m.HandleKey(keyRune('G'))
	if m.Scroll == 0 {
		t.Error("G should scroll to the end on a small screen")
	}
	for _, l := range plainLines(m) {
		if strWidth(l) > 60 {
			t.Errorf("detail line too wide: %q", l)
		}
	}
}

func TestApproveFlow(t *testing.T) {
	m := newModel(100, 24)
	m.HandleKey(keyRune('a'))
	if m.Overlay != OverlayApprove || m.Choice != 0 {
		t.Fatalf("overlay=%d choice=%d", m.Overlay, m.Choice)
	}
	text := strings.Join(plainLines(m), "\n")
	for _, want := range []string{"Approve?", "1 Allow once", "2 Always allow", "3 Reject", "confirm"} {
		if !strings.Contains(text, want) {
			t.Errorf("chooser missing %q:\n%s", want, text)
		}
	}
	m.HandleKey(Key{Kind: KeyRight})
	m.HandleKey(Key{Kind: KeyRight})
	m.HandleKey(Key{Kind: KeyRight}) // wraps to 0
	if m.Choice != 0 {
		t.Errorf("choice = %d", m.Choice)
	}
	m.HandleKey(keyRune('3'))
	a := m.HandleKey(Key{Kind: KeyEnter})
	if a.Kind != ActApprove || a.ThreadID != "p1" || a.ApprovalID != "ap1" || a.OptionID != "o3" || m.Overlay != OverlayNone {
		t.Errorf("approve action = %+v overlay=%d", a, m.Overlay)
	}
	// Esc cancels.
	m.HandleKey(keyRune('a'))
	if a := m.HandleKey(Key{Kind: KeyEsc}); a.Kind != ActNone || m.Overlay != OverlayNone {
		t.Errorf("esc: %+v", a)
	}
	// Not waiting: refused with a message.
	m.HandleKey(Key{Kind: KeyDown})
	m.HandleKey(keyRune('a'))
	if m.Overlay != OverlayNone {
		t.Error("approve opened on a working session")
	}
	if msg, isErr := m.Flashed(); !isErr || !strings.Contains(msg, "nothing is waiting") {
		t.Errorf("flash = %q %v", msg, isErr)
	}
}

func TestApproveQuestionIsRedirected(t *testing.T) {
	s := fixture()
	s.Rows[0].Act.Pending = &Pending{Question: &protocol.ThreadQuestion{Id: "q", Text: "Which?"}}
	m := NewModel(100, 24, false)
	m.Now = fixedNow
	m.SetSnapshot(s)
	m.HandleKey(keyRune('a'))
	if m.Overlay != OverlayNone {
		t.Error("chooser opened for a question")
	}
	if msg, _ := m.Flashed(); !strings.Contains(msg, "question") {
		t.Errorf("flash = %q", msg)
	}
	if got := s.Rows[0].StateText(); got != "question" {
		t.Errorf("state = %q", got)
	}
}

func TestSteerFlow(t *testing.T) {
	m := newModel(100, 24)
	m.HandleKey(keyRune('s'))
	if m.Overlay != OverlaySteer {
		t.Fatal("steer overlay not opened")
	}
	for _, r := range "use the v2 api" {
		m.HandleKey(keyRune(r))
	}
	m.HandleKey(Key{Kind: KeyBackspace})
	m.HandleKey(Key{Kind: KeyPaste, Text: "i\nsecond line"})
	if got := string(m.Input); got != "use the v2 api second line" {
		t.Errorf("input = %q", got)
	}
	if text := strings.Join(plainLines(m), "\n"); !strings.Contains(text, "steer Fix flaky auth test › use the v2 api second line") {
		t.Errorf("input line missing:\n%s", text)
	}
	m.HandleKey(Key{Kind: KeyCtrlW})
	if got := string(m.Input); got != "use the v2 api second " {
		t.Errorf("after ^W = %q", got)
	}
	m.HandleKey(Key{Kind: KeyCtrlU})
	if len(m.Input) != 0 {
		t.Errorf("after ^U = %q", string(m.Input))
	}
	var a Action
	m = newModel(100, 24)
	m.HandleKey(keyRune('s'))
	for _, r := range "hello" {
		m.HandleKey(keyRune(r))
	}
	a = m.HandleKey(Key{Kind: KeyEnter})
	if a.Kind != ActSteer || a.Text != "hello" || a.ThreadID != "p1" || m.Overlay != OverlayNone {
		t.Errorf("steer = %+v", a)
	}
	// Empty and cancelled sends do nothing.
	m.HandleKey(keyRune('s'))
	if a := m.HandleKey(Key{Kind: KeyEnter}); a.Kind != ActNone {
		t.Errorf("empty steer sent: %+v", a)
	}
	m.HandleKey(keyRune('s'))
	m.HandleKey(keyRune('x'))
	if a := m.HandleKey(Key{Kind: KeyEsc}); a.Kind != ActNone || m.Overlay != OverlayNone {
		t.Errorf("esc: %+v", a)
	}
	// Typing q or / inside the prompt must not quit or filter.
	m.HandleKey(keyRune('s'))
	if a := m.HandleKey(keyRune('q')); a.Kind != ActNone {
		t.Error("q quit while typing")
	}
}

func TestStopFlow(t *testing.T) {
	m := newModel(100, 24)
	m.HandleKey(keyRune('x'))
	if m.Overlay != OverlayStop {
		t.Fatal("stop confirm not shown")
	}
	if text := strings.Join(plainLines(m), "\n"); !strings.Contains(text, "Stop the current turn of “Fix flaky auth test”") {
		t.Errorf("confirm text missing:\n%s", text)
	}
	if a := m.HandleKey(keyRune('y')); a.Kind != ActStop || a.ThreadID != "p1" {
		t.Errorf("y = %+v", a)
	}
	m.HandleKey(keyRune('x'))
	if a := m.HandleKey(Key{Kind: KeyEnter}); a.Kind != ActNone || m.Overlay != OverlayNone {
		t.Errorf("enter must cancel: %+v", a)
	}
	// Done sessions cannot be stopped.
	m.HandleKey(keyRune('G'))
	m.HandleKey(keyRune('x'))
	if m.Overlay != OverlayNone {
		t.Error("stop offered for a finished session")
	}
}

func TestFilterFlow(t *testing.T) {
	m := newModel(100, 24)
	m.HandleKey(keyRune('/'))
	for _, r := range "billing" {
		m.HandleKey(keyRune(r))
	}
	if n := len(m.Rows()); n != 1 || m.SelID != "w1" {
		t.Errorf("live filter: %d rows, sel %q", n, m.SelID)
	}
	m.HandleKey(Key{Kind: KeyEnter})
	if m.Overlay != OverlayNone || m.Filter != "billing" {
		t.Errorf("enter: overlay %d filter %q", m.Overlay, m.Filter)
	}
	if text := strings.Join(plainLines(m), "\n"); !strings.Contains(text, "filter: billing  (1 of 5, esc clears)") {
		t.Errorf("filter status missing:\n%s", text)
	}
	m.HandleKey(Key{Kind: KeyEsc})
	if m.Filter != "" || len(m.Rows()) != 5 {
		t.Errorf("esc did not clear the filter")
	}
	// Esc while typing clears too.
	m.HandleKey(keyRune('/'))
	m.HandleKey(keyRune('z'))
	m.HandleKey(Key{Kind: KeyEsc})
	if m.Filter != "" || m.Overlay != OverlayNone {
		t.Error("esc while typing should clear")
	}
}

func TestHelpAndOpen(t *testing.T) {
	m := newModel(80, 24)
	m.HandleKey(keyRune('?'))
	if text := strings.Join(plainLines(m), "\n"); !strings.Contains(text, "Keys") || !strings.Contains(text, "answer a waiting approval") {
		t.Errorf("help missing:\n%s", text)
	}
	m.HandleKey(keyRune('x')) // any key closes
	if m.Overlay != OverlayNone {
		t.Error("help not closed")
	}
	if a := m.HandleKey(keyRune('o')); a.Kind != ActOpen || a.ThreadID != "p1" {
		t.Errorf("open = %+v", a)
	}
}

func TestOpenURL(t *testing.T) {
	cases := []struct{ hub, id, want string }{
		{"https://hub.example.com", "abc", "https://hub.example.com/sessions/abc"},
		{"http://localhost:4318/", "a b", "http://localhost:4318/sessions/a%20b"},
		{"https://u:p@hub.example.com/base", "x", "https://hub.example.com/base/sessions/x"},
	}
	for _, c := range cases {
		if got, ok := OpenURL(c.hub, c.id); !ok || got != c.want {
			t.Errorf("OpenURL(%q) = %q %v want %q", c.hub, got, ok, c.want)
		}
	}
	for _, bad := range []string{"", "file:///etc/passwd", "javascript:alert(1)", "hub.example.com"} {
		if got, ok := OpenURL(bad, "x"); ok {
			t.Errorf("OpenURL(%q) accepted: %q", bad, got)
		}
	}
}

func TestParseKeys(t *testing.T) {
	kinds := func(b string) []KeyKind {
		ks, rest := ParseKeys([]byte(b))
		if len(rest) != 0 {
			t.Errorf("%q left %q", b, rest)
		}
		var out []KeyKind
		for _, k := range ks {
			out = append(out, k.Kind)
		}
		return out
	}
	eq := func(got []KeyKind, want ...KeyKind) bool {
		if len(got) != len(want) {
			return false
		}
		for i := range got {
			if got[i] != want[i] {
				return false
			}
		}
		return true
	}
	checks := []struct {
		in   string
		want []KeyKind
	}{
		{"\x1b[A\x1b[B\x1b[C\x1b[D", []KeyKind{KeyUp, KeyDown, KeyRight, KeyLeft}},
		{"\x1bOA\x1bOB", []KeyKind{KeyUp, KeyDown}},
		{"\r", []KeyKind{KeyEnter}}, {"\r\n", []KeyKind{KeyEnter}}, {"\x1b", []KeyKind{KeyEsc}},
		{"\x7f\x03", []KeyKind{KeyBackspace, KeyCtrlC}},
		{"\x1b[5~\x1b[6~\x1b[H\x1b[F\x1b[3~", []KeyKind{KeyPgUp, KeyPgDn, KeyHome, KeyEnd, KeyDelete}},
		{"\x1b[1;5A", []KeyKind{KeyUp}},
		{"\x1b[200~line1\nline2\x1b[201~", []KeyKind{KeyPaste}},
		{"ab", []KeyKind{KeyRune, KeyRune}},
		{"\x1b[<0;10;5M", nil}, // mouse reports are ignored
	}
	for _, c := range checks {
		if got := kinds(c.in); !eq(got, c.want...) {
			t.Errorf("ParseKeys(%q) = %v want %v", c.in, got, c.want)
		}
	}
	ks, _ := ParseKeys([]byte("é日"))
	if len(ks) != 2 || ks[0].R != 'é' || ks[1].R != '日' {
		t.Errorf("utf8 = %+v", ks)
	}
	// Split sequences are carried over.
	ks, rest := ParseKeys([]byte("a\x1b["))
	if len(ks) != 1 || string(rest) != "\x1b[" {
		t.Errorf("split: %+v %q", ks, rest)
	}
	ks, rest = ParseKeys(append(rest, 'A'))
	if len(ks) != 1 || ks[0].Kind != KeyUp || len(rest) != 0 {
		t.Errorf("joined: %+v %q", ks, rest)
	}
	ks, rest = ParseKeys([]byte("\xe6\x97"))
	if len(ks) != 0 || len(rest) != 2 {
		t.Errorf("split rune: %+v %q", ks, rest)
	}
	ks, _ = ParseKeys([]byte("\x1b[200~a\nb\x1b[201~"))
	if ks[0].Text != "a\nb" {
		t.Errorf("paste text = %q", ks[0].Text)
	}
}

func TestPlainText(t *testing.T) {
	out := PlainText(fixture(), 100, fixedNow)
	if strings.Contains(out, "\x1b") {
		t.Error("plain output has escapes")
	}
	for _, want := range []string{"Overseer top", "Fix flaky auth", "SESSION", "Editing invoice.go"} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q:\n%s", want, out)
		}
	}
	for _, l := range strings.Split(out, "\n") {
		if strWidth(l) > 100 {
			t.Errorf("too wide: %q", l)
		}
	}
	empty := PlainText(Snapshot{Loaded: true}, 80, fixedNow)
	if !strings.Contains(empty, "no agent sessions") {
		t.Errorf("empty:\n%s", empty)
	}
}

func TestStatus(t *testing.T) {
	rep := BuildStatus(fixture(), fixedNow)
	if rep.Counts.Waiting != 1 || rep.Counts.Working != 2 || rep.Counts.Failed != 1 || rep.Counts.DoneToday != 1 || rep.Counts.Total != 5 {
		t.Errorf("counts = %+v", rep.Counts)
	}
	if len(rep.NeedsYou) != 1 || rep.NeedsYou[0] != "p1" {
		t.Errorf("needsYou = %v", rep.NeedsYou)
	}
	first := rep.Sessions[0]
	if first.State != "approval" || first.Approval == nil || first.Approval.Title != "Run: go test ./..." || first.ElapsedSeconds != 252 {
		t.Errorf("first = %+v", first)
	}
	if len(rep.Machines) != 3 || rep.Machines[2].Online || rep.Machines[0].CPUPercent == nil || *rep.Machines[0].MemPercent != 61 {
		t.Errorf("machines = %+v", rep.Machines)
	}
	text := StatusText(fixture(), fixedNow, 80, false)
	for _, want := range []string{"Machines", "Needs you (1)", "Fix flaky auth test", "approval 4m12s", "Run: go test", "Working (2)", "Recent (2)", "1 waiting", "2 working"} {
		if !strings.Contains(text, want) {
			t.Errorf("status text missing %q:\n%s", want, text)
		}
	}
	for _, l := range strings.Split(text, "\n") {
		if strWidth(l) > 80 {
			t.Errorf("status line too wide: %q", l)
		}
	}
	if strings.Contains(text, "\x1b") {
		t.Error("escapes without colour")
	}
	if !strings.Contains(StatusText(fixture(), fixedNow, 80, true), "\x1b[") {
		t.Error("no colour requested colour")
	}
	if got := StatusShort(fixture(), fixedNow, false); got != "●1 ◐2 ✗1" {
		t.Errorf("short = %q", got)
	}
	if got := StatusShort(Snapshot{}, fixedNow, false); got != "✓" {
		t.Errorf("short idle = %q", got)
	}
	idle := StatusText(Snapshot{Hub: "h"}, fixedNow, 80, false)
	if !strings.Contains(idle, "nothing is waiting for you") {
		t.Errorf("idle:\n%s", idle)
	}
}

// --- fetcher ---

type fakeSrc struct {
	devices  []fleet.Device
	threads  []fleet.Thread
	msgs     map[string][]fleet.ThreadMessage
	getCalls map[string]int
	gitCalls int
	derr     error
	mu       sync.Mutex
}

func (f *fakeSrc) DevicesContext(context.Context) ([]fleet.Device, error) { return f.devices, f.derr }
func (f *fakeSrc) Threads(context.Context) ([]fleet.Thread, error)        { return f.threads, nil }
func (f *fakeSrc) Thread(_ context.Context, id string) (*fleet.Thread, []fleet.ThreadMessage, error) {
	f.mu.Lock()
	f.getCalls[id]++
	f.mu.Unlock()
	return nil, f.msgs[id], nil
}
func (f *fakeSrc) GitBranches(_ context.Context, dev string, paths []string) (map[string]string, error) {
	f.mu.Lock()
	f.gitCalls++
	f.mu.Unlock()
	out := map[string]string{}
	for _, p := range paths {
		out[p] = "main"
	}
	return out, nil
}

func TestFetcher(t *testing.T) {
	sec := fixedNow.Unix()
	src := &fakeSrc{
		devices: []fleet.Device{{Id: "m", Name: "Mac", Online: true}},
		threads: []fleet.Thread{
			{Id: "a", Title: "active", Status: "working", DeviceId: "m", DeviceName: "Mac", Cwd: "/x/proj", CreatedAt: sec - 100, UpdatedAt: sec - 1},
			{Id: "b", Title: "old done", Status: "idle", DeviceId: "m", DeviceName: "Mac", Cwd: "/x/proj", CreatedAt: sec - 90000, UpdatedAt: sec - 80000},
			{Id: "c", Title: "recent done", Status: "idle", DeviceId: "m", DeviceName: "Mac", Cwd: "/x/other", CreatedAt: sec - 900, UpdatedAt: sec - 600},
			{Id: "z", Title: "archived", Status: "idle", Archived: true, DeviceId: "m"},
		},
		msgs: map[string][]fleet.ThreadMessage{
			"a": {{Role: "user", At: ms(time.Minute)}, {Role: "tool", Tool: tool("read", "", "/x/proj/main.go", "running")}},
			"c": {{Role: "assistant", Text: "All done here."}},
		},
		getCalls: map[string]int{},
	}
	f := NewFetcher(src, "http://hub:4318")
	snap, err := f.Fetch(context.Background(), nil, fixedNow)
	if err != nil {
		t.Fatal(err)
	}
	if len(snap.Rows) != 3 || snap.Rows[0].Thread.Id != "a" {
		t.Fatalf("rows = %+v", snap.Rows)
	}
	if snap.Rows[0].Act.Step != "Reading main.go" || snap.Rows[0].Branch != "main" || snap.Hub != "hub:4318" {
		t.Errorf("active row = %+v hub %q", snap.Rows[0], snap.Hub)
	}
	if snap.Rows[0].Thread.UpdatedAt != (sec-1)*1000 {
		t.Errorf("times not converted to ms: %d", snap.Rows[0].Thread.UpdatedAt)
	}
	if snap.Rows[1].Act.Step != "All done here." {
		t.Errorf("recent done step = %q", snap.Rows[1].Act.Step)
	}
	if src.getCalls["b"] != 0 || src.getCalls["z"] != 0 {
		t.Errorf("fetched transcripts of old/archived sessions: %v", src.getCalls)
	}
	if snap.Machines[0].Working != 1 || snap.Machines[0].Total != 3 {
		t.Errorf("machine counts = %+v", snap.Machines[0])
	}
	// Second refresh: active session refetched, finished one cached, git cached.
	if _, err := f.Fetch(context.Background(), nil, fixedNow.Add(2*time.Second)); err != nil {
		t.Fatal(err)
	}
	if src.getCalls["a"] != 2 || src.getCalls["c"] != 1 || src.gitCalls != 1 {
		t.Errorf("calls = %v git=%d", src.getCalls, src.gitCalls)
	}
	// The detail pane forces a fresh transcript.
	f.Fetch(context.Background(), map[string]bool{"b": true}, fixedNow.Add(3*time.Second))
	if src.getCalls["b"] != 1 {
		t.Errorf("want forced: %v", src.getCalls)
	}
	src.derr = errors.New("boom")
	if _, err := f.Fetch(context.Background(), nil, fixedNow); err == nil {
		t.Error("device error not reported")
	}
}

func TestErrorShownKeepsRows(t *testing.T) {
	m := newModel(100, 24)
	m.Snap.Err = "connection refused"
	text := strings.Join(plainLines(m), "\n")
	if !strings.Contains(text, "hub unreachable") || !strings.Contains(text, "Fix flaky auth") {
		t.Errorf("error banner / stale rows missing:\n%s", text)
	}
}

func TestNotLoadedView(t *testing.T) {
	m := NewModel(80, 24, false)
	m.Now = fixedNow
	m.Snap = Snapshot{HubURL: "http://hub", Hub: "hub"}
	if text := strings.Join(plainLines(m), "\n"); !strings.Contains(text, "Connecting to http://hub") {
		t.Errorf("connecting message missing:\n%s", text)
	}
}

func TestScrollingLongList(t *testing.T) {
	s := fixture()
	for i := 0; i < 40; i++ {
		r := s.Rows[len(s.Rows)-1]
		r.Thread.Id = "extra" + string(rune('a'+i%26)) + string(rune('a'+i/26))
		r.Thread.Title = "ses " + r.Thread.Id
		r.Thread.UpdatedAt -= int64(i+1) * 1000
		s.Rows = append(s.Rows, r)
	}
	m := NewModel(80, 24, false)
	m.Now = fixedNow
	m.SetSnapshot(s)
	m.HandleKey(keyRune('G'))
	text := strings.Join(plainLines(m), "\n")
	last := s.Rows[len(s.Rows)-1].Thread.Title
	if !strings.Contains(text, last) {
		t.Errorf("selected last row not visible:\n%s", text)
	}
	if strings.Contains(text, "Fix flaky auth") {
		t.Errorf("viewport did not scroll")
	}
	m.HandleKey(keyRune('g'))
	if text := strings.Join(plainLines(m), "\n"); !strings.Contains(text, "Fix flaky auth") {
		t.Errorf("did not scroll back up")
	}
	if got := len(plainLines(m)); got != 24 {
		t.Errorf("lines = %d", got)
	}
}
