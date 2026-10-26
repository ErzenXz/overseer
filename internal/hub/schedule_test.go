package hub

import (
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// fakeHost is a schedHost with a settable clock-independent state.
type fakeHost struct {
	online  bool
	name    string
	limits  protocol.PlanLimits
	hasData bool
	guard   guardCfg
	asked   int
}

func (f *fakeHost) Online(string) bool       { return f.online }
func (f *fakeHost) DeviceName(string) string { return f.name }
func (f *fakeHost) Limits(_, _ string, refresh bool) (protocol.PlanLimits, bool) {
	if refresh {
		f.asked++
	}
	return f.limits, f.hasData
}
func (f *fakeHost) Guard(string) guardCfg { return f.guard }

var schedT0 = time.Date(2026, 10, 26, 12, 0, 0, 0, time.UTC)

func claudeLimits(five, week float64, fiveReset, weekReset time.Time) protocol.PlanLimits {
	return protocol.PlanLimits{Agent: "claude", Windows: []protocol.LimitWindow{
		{Id: "five_hour", Label: "5-hour", UsedPercent: five, ResetsAt: fiveReset.Unix(), WindowMinutes: 300},
		{Id: "seven_day", Label: "Weekly", UsedPercent: week, ResetsAt: weekReset.Unix(), WindowMinutes: 10080},
		{Id: "seven_day_opus", Label: "Weekly (Opus)", UsedPercent: 99, ResetsAt: weekReset.Unix(), WindowMinutes: 10080},
	}}
}

func TestDecideTime(t *testing.T) {
	host := &fakeHost{online: true, name: "Studio"}
	j := &ScheduledSession{Trigger: schedTrigger{Kind: trigTime, At: schedT0.Add(time.Hour).Unix()}, schedPayload: schedPayload{DeviceId: "d", Agent: "claude"}}

	d := decide(j, schedT0, host)
	if d.Start || d.FireAt != j.Trigger.At || d.Note != "" {
		t.Fatalf("before the time: %+v", d)
	}
	d = decide(j, schedT0.Add(time.Hour), host)
	if !d.Start {
		t.Fatalf("at the time it should start: %+v", d)
	}
	host.online = false
	d = decide(j, schedT0.Add(2*time.Hour), host)
	if d.Start || !strings.Contains(d.Note, "Studio") || !strings.Contains(d.Note, "online") {
		t.Fatalf("offline machine should wait and say so: %+v", d)
	}
	host.online = true
	if d = decide(j, schedT0.Add(2*time.Hour), host); !d.Start {
		t.Fatalf("back online it should start: %+v", d)
	}
}

func TestDecideLimitReset(t *testing.T) {
	reset := schedT0.Add(72 * time.Minute)
	host := &fakeHost{online: true, name: "Studio", hasData: true, limits: claudeLimits(100, 40, reset, schedT0.Add(100*time.Hour))}
	j := &ScheduledSession{
		Trigger:      schedTrigger{Kind: trigLimit, Window: "five_hour", Threshold: 90, ResetsAt: reset.Unix()},
		StartsAt:     reset.Unix() + 30,
		schedPayload: schedPayload{DeviceId: "d", Agent: "claude"},
	}
	// Waiting: nothing is asked of the machine before the reset.
	d := decide(j, schedT0, host)
	if d.Start || d.FireAt != j.StartsAt || host.asked != 0 {
		t.Fatalf("before reset: %+v asked=%d", d, host.asked)
	}
	// After the reset time the window is read again; it has reset, so start.
	host.limits = claudeLimits(3, 40, schedT0.Add(6*time.Hour), schedT0.Add(100*time.Hour))
	now := time.Unix(j.StartsAt+1, 0)
	d = decide(j, now, host)
	if !d.Start || host.asked != 1 {
		t.Fatalf("after reset: %+v asked=%d", d, host.asked)
	}
	// Still limited with a new reset time: wait for that one and keep waiting.
	next := now.Add(40 * time.Minute)
	host.limits = claudeLimits(100, 40, next, schedT0.Add(100*time.Hour))
	d = decide(j, now, host)
	if d.Start || d.FireAt != next.Unix()+30 || d.Trigger.ResetsAt != next.Unix() || d.Note == "" {
		t.Fatalf("still limited: %+v", d)
	}
	// Offline at the trigger time: wait for the machine, say so, ask nothing.
	host.online, host.asked = false, 0
	d = decide(j, now, host)
	if d.Start || !strings.Contains(d.Note, "Studio") || host.asked != 0 {
		t.Fatalf("offline: %+v", d)
	}
	// No reading to check against: the time has passed, so start.
	host.online, host.hasData = true, false
	if d = decide(j, now, host); !d.Start {
		t.Fatalf("no data: %+v", d)
	}
}

func TestDecideGuardrailHeldUsesHoldThreshold(t *testing.T) {
	reset := schedT0.Add(2 * time.Hour)
	host := &fakeHost{online: true, hasData: true, guard: guardCfg{HoldEnabled: true, HoldPercent: 90, PausePercent: 98}}
	j := &ScheduledSession{
		Reason:       reasonGuardrail,
		Trigger:      schedTrigger{Kind: trigLimit, Window: "seven_day", Threshold: 90, ResetsAt: reset.Unix()},
		StartsAt:     reset.Unix() + 30,
		schedPayload: schedPayload{DeviceId: "d", Agent: "claude"},
	}
	now := time.Unix(j.StartsAt+1, 0)
	// Weekly still at 92 % with a reset in the future: the guardrail still holds.
	host.limits = claudeLimits(1, 92, now.Add(time.Hour), now.Add(3*time.Hour))
	if d := decide(j, now, host); d.Start {
		t.Fatalf("should keep holding: %+v", d)
	}
	// The user raised the hold level to 95: 92 % is fine now.
	host.guard.HoldPercent = 95
	if d := decide(j, now, host); !d.Start {
		t.Fatalf("should start under the new level: %+v", d)
	}
}

func TestResolveLimitWindow(t *testing.T) {
	five, week := schedT0.Add(time.Hour), schedT0.Add(50*time.Hour)

	// The 5-hour window is used up: wait for it, not for the weekly one.
	w, ok := resolveLimitWindow(claudeLimits(100, 60, five, week), "sonnet", 90, schedT0)
	if !ok || w.Id != "five_hour" {
		t.Fatalf("exhausted 5-hour: %+v %v", w, ok)
	}
	// Both used up: the later reset is the one that matters.
	w, _ = resolveLimitWindow(claudeLimits(100, 100, five, week), "sonnet", 90, schedT0)
	if w.Id != "seven_day" {
		t.Fatalf("both exhausted: %+v", w)
	}
	// Only high, not exhausted.
	w, ok = resolveLimitWindow(claudeLimits(95, 10, five, week), "sonnet", 90, schedT0)
	if !ok || w.Id != "five_hour" {
		t.Fatalf("high 5-hour: %+v %v", w, ok)
	}
	// Opus's own weekly window (99 %) only counts for Opus.
	if w, _ = resolveLimitWindow(claudeLimits(10, 10, five, week), "sonnet", 90, schedT0); w.Id != "" {
		t.Fatalf("opus window leaked into a sonnet session: %+v", w)
	}
	if w, ok = resolveLimitWindow(claudeLimits(10, 10, five, week), "opus", 90, schedT0); !ok || w.Id != "seven_day_opus" {
		t.Fatalf("opus session: %+v %v", w, ok)
	}
	// Nothing is high.
	if _, ok = resolveLimitWindow(claudeLimits(10, 10, five, week), "sonnet", 90, schedT0); ok {
		t.Fatal("low limits should not resolve")
	}
	// A window that already reset is not waited on.
	if _, ok = resolveLimitWindow(claudeLimits(100, 10, schedT0.Add(-time.Minute), week), "sonnet", 90, schedT0); ok {
		t.Fatal("past reset should not resolve")
	}
}

func TestGuardThresholds(t *testing.T) {
	reset := schedT0.Add(time.Hour)
	cfg := guardCfg{HoldEnabled: true, HoldPercent: 90, PauseEnabled: true, PausePercent: 98}
	at := func(week float64) protocol.PlanLimits { return claudeLimits(100, week, reset, reset) }

	if _, held := guardHolds(cfg, at(89.9), "sonnet"); held {
		t.Error("89.9 % must not hold at 90")
	}
	if _, held := guardHolds(cfg, at(90), "sonnet"); !held {
		t.Error("90 % must hold at 90")
	}
	if _, p := guardPauses(cfg, at(97.9), "sonnet"); p {
		t.Error("97.9 % must not pause at 98")
	}
	if _, p := guardPauses(cfg, at(98), "sonnet"); !p {
		t.Error("98 % must pause at 98")
	}
	// The 5-hour window never triggers a weekly guardrail.
	if _, held := guardHolds(cfg, claudeLimits(100, 10, reset, reset), "sonnet"); held {
		t.Error("an exhausted 5-hour window is not the weekly limit")
	}
	// Off means off.
	if _, held := guardHolds(guardCfg{HoldPercent: 90, PausePercent: 98}, at(100), "sonnet"); held {
		t.Error("disabled hold must not hold")
	}
	if _, p := guardPauses(guardCfg{HoldPercent: 90, PausePercent: 98}, at(100), "sonnet"); p {
		t.Error("disabled pause must not pause")
	}
	// Codex's secondary window is its weekly one.
	codex := protocol.PlanLimits{Agent: "codex", Windows: []protocol.LimitWindow{
		{Id: "primary", Label: "5-hour", UsedPercent: 99, WindowMinutes: 300},
		{Id: "secondary", Label: "Weekly", UsedPercent: 91, WindowMinutes: 10080},
	}}
	if w, held := guardHolds(cfg, codex, ""); !held || w.Id != "secondary" {
		t.Errorf("codex weekly: %+v %v", w, held)
	}
	// Opus weekly matters only for Opus sessions.
	if _, held := guardHolds(cfg, claudeLimits(0, 10, reset, reset), "sonnet"); held {
		t.Error("opus weekly leaked into a sonnet session")
	}
	if _, held := guardHolds(cfg, claudeLimits(0, 10, reset, reset), "opus"); !held {
		t.Error("opus session should be held by the opus weekly window")
	}
}

func TestHumanIn(t *testing.T) {
	for secs, want := range map[int64]string{20: "under a minute", 45 * 60: "45m", 72 * 60: "1h 12m", 53 * 3600: "2d 5h"} {
		if got := humanIn(secs); got != want {
			t.Errorf("humanIn(%d) = %q, want %q", secs, got, want)
		}
	}
}

// --- through a real hub ---

func acpStart(deviceId, exe, cwd, key string) map[string]any {
	return map[string]any{"deviceId": deviceId, "agent": "acp", "command": strconvQuote(exe), "cwd": cwd, "prompt": "ping", "clientRequestId": key}
}

func strconvQuote(s string) string { return `"` + strings.ReplaceAll(s, `"`, `\"`) + `"` }

func killThreadShell(t *testing.T, id string) {
	t.Cleanup(func() { exec.Command("tmux", "kill-session", "-t", "thread-"+id[:8]).Run() })
}

func TestScheduledSessionLifecycle(t *testing.T) {
	t.Setenv(fakeACPEnv, "1")
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	srv, base := startHub(t)
	deviceId := connectAgent(t, srv, base)
	token, _ := srv.store.CreateApiToken("sched-test")
	api := apiClient{t: t, base: base, token: token}
	cwd := t.TempDir()

	body := acpStart(deviceId, exe, cwd, "sched-key-0001")
	body["trigger"] = map[string]any{"kind": "time", "at": time.Now().Add(2 * time.Hour).Unix()}
	var made ScheduledSession
	api.do("POST", "/api/scheduled", body, &made)
	if made.Status != "waiting" || made.Trigger.Kind != "time" || made.StartsAt == 0 || made.DeviceName == "" {
		t.Fatalf("created: %+v", made)
	}
	// A retried create (same key) returns the same row.
	var again ScheduledSession
	api.do("POST", "/api/scheduled", body, &again)
	if again.Id != made.Id {
		t.Fatalf("retry made a second row: %s vs %s", again.Id, made.Id)
	}
	var list []ScheduledSession
	api.do("GET", "/api/scheduled", nil, &list)
	if len(list) != 1 {
		t.Fatalf("list: %+v", list)
	}

	// Not due yet: the scheduler leaves it alone.
	srv.runDueScheduled(time.Now())
	if cur, _ := srv.store.ScheduledById(made.Id); cur.Status != "waiting" {
		t.Fatalf("started early: %+v", cur)
	}

	// Edit, then bad input is refused.
	var edited ScheduledSession
	api.do("PATCH", "/api/scheduled/"+made.Id, map[string]any{"prompt": "ping again", "trigger": map[string]any{"kind": "time", "at": time.Now().Add(3 * time.Hour).Unix()}}, &edited)
	if edited.Prompt != "ping again" || edited.Title != "ping again" {
		t.Fatalf("edit: %+v", edited)
	}
	for _, at := range []int64{1, time.Now().Add(-time.Hour).Unix(), time.Now().Add(400 * 24 * time.Hour).Unix()} {
		bad := acpStart(deviceId, exe, cwd, "sched-key-bad1")
		bad["trigger"] = map[string]any{"kind": "time", "at": at}
		if code := api.do("POST", "/api/scheduled", bad, nil); code != 400 {
			t.Fatalf("time %d should be refused, got %d", at, code)
		}
	}
	if list, _ := srv.store.ListScheduled(); len(list) != 1 {
		t.Fatalf("a refused schedule left a row behind: %+v", list)
	}
	if code := api.do("PATCH", "/api/scheduled/"+made.Id, map[string]any{"agent": "nope"}, nil); code != 400 {
		t.Fatalf("unknown agent: %d", code)
	}
	if code := api.do("POST", "/api/scheduled", map[string]any{"deviceId": deviceId, "agent": "claude", "prompt": "x", "cwd": cwd, "trigger": map[string]any{"kind": "limit_reset"}}, nil); code != 400 {
		t.Fatalf("a limit trigger with no known limit should be refused: %d", code)
	}

	// Start now: one session, created under the schedule's request key.
	var started ScheduledSession
	api.do("POST", "/api/scheduled/"+made.Id+"/start", nil, &started)
	if started.Status != "started" || started.ThreadId == "" {
		t.Fatalf("start now: %+v", started)
	}
	killThreadShell(t, started.ThreadId)
	th, _ := srv.store.ThreadByRequestId(made.ClientRequestId)
	if th == nil || th.Id != started.ThreadId {
		t.Fatalf("the schedule's request id points at %+v, not the started session %s", th, started.ThreadId)
	}
	if code := api.do("POST", "/api/scheduled/"+made.Id+"/start", nil, nil); code != 409 {
		t.Fatalf("second start: %d", code)
	}
	// Running the scheduler again never starts it twice.
	srv.runDueScheduled(time.Now().Add(24 * time.Hour))
	if all, _ := srv.store.ListThreads(); len(all) != 1 {
		t.Fatalf("%d sessions for one schedule", len(all))
	}

	// Cancelling removes the row.
	body2 := acpStart(deviceId, exe, cwd, "sched-key-0002")
	body2["trigger"] = map[string]any{"kind": "time", "at": time.Now().Add(time.Hour).Unix()}
	var second ScheduledSession
	api.do("POST", "/api/scheduled", body2, &second)
	if code := api.do("DELETE", "/api/scheduled/"+second.Id, nil, nil); code != 200 {
		t.Fatalf("cancel: %d", code)
	}
	if cur, _ := srv.store.ScheduledById(second.Id); cur != nil {
		t.Fatal("cancelled row is still there")
	}
}

func TestGuardrailHoldsNewSessions(t *testing.T) {
	srv, base := startHub(t)
	deviceId := connectAgent(t, srv, base)
	token, _ := srv.store.CreateApiToken("guard-test")
	api := apiClient{t: t, base: base, token: token}

	var cfgs map[string]guardCfg
	api.do("GET", "/api/guardrails", nil, &cfgs)
	if c := cfgs["claude"]; c.HoldEnabled || c.PauseEnabled || c.HoldPercent != 90 || c.PausePercent != 98 {
		t.Fatalf("defaults must be off at 90/98: %+v", c)
	}
	if code := api.do("PUT", "/api/guardrails", map[string]any{"claude": map[string]any{"holdEnabled": true, "holdPercent": 140, "pausePercent": 98}}, nil); code != 400 {
		t.Fatalf("out of range percent: %d", code)
	}
	if code := api.do("PUT", "/api/guardrails", map[string]any{"gemini": map[string]any{"holdPercent": 90, "pausePercent": 98}}, nil); code != 400 {
		t.Fatalf("agent without plan limits: %d", code)
	}
	api.do("PUT", "/api/guardrails", map[string]any{"claude": map[string]any{"holdEnabled": true, "holdPercent": 90, "pauseEnabled": true, "pausePercent": 98}}, &cfgs)
	if !cfgs["claude"].HoldEnabled || !cfgs["claude"].PauseEnabled {
		t.Fatalf("saved: %+v", cfgs)
	}

	reset := time.Now().Add(50 * time.Hour)
	srv.usageLimits.update(deviceId, claudeLimits(10, 93, time.Now().Add(time.Hour), reset))

	start := map[string]any{"deviceId": deviceId, "agent": "claude", "cwd": t.TempDir(), "prompt": "refactor billing", "clientRequestId": "hold-key-0001"}
	var held struct {
		Held      bool             `json:"held"`
		Scheduled ScheduledSession `json:"scheduled"`
	}
	if code := api.do("POST", "/api/threads", start, &held); code != 202 || !held.Held {
		t.Fatalf("expected a held start (202), got %d %+v", code, held)
	}
	if held.Scheduled.Reason != "guardrail" || held.Scheduled.Trigger.Kind != "limit_reset" || held.Scheduled.Trigger.Window != "seven_day" {
		t.Fatalf("held row: %+v", held.Scheduled)
	}
	if want := reset.Unix() + 30; held.Scheduled.StartsAt != want {
		t.Fatalf("starts at %d, want %d", held.Scheduled.StartsAt, want)
	}
	// The retry finds the same row; no session was created.
	var held2 struct {
		Scheduled ScheduledSession `json:"scheduled"`
	}
	api.do("POST", "/api/threads", start, &held2)
	if held2.Scheduled.Id != held.Scheduled.Id {
		t.Fatalf("retry made another row: %s vs %s", held2.Scheduled.Id, held.Scheduled.Id)
	}
	if threads, _ := srv.store.ListThreads(); len(threads) != 0 {
		t.Fatalf("a held session must not start: %+v", threads)
	}
	var notices []guardNotice
	api.do("GET", "/api/guardrails/notices", nil, &notices)
	if len(notices) != 1 || notices[0].Kind != "hold" || notices[0].RefId != held.Scheduled.Id || notices[0].Threshold != 90 {
		t.Fatalf("notices: %+v", notices)
	}
	api.do("DELETE", "/api/guardrails/notices/"+notices[0].Id, nil, nil)
	api.do("GET", "/api/guardrails/notices", nil, &notices)
	if len(notices) != 0 {
		t.Fatalf("dismissed notice is back: %+v", notices)
	}

	// Below the level, a start goes through (here it fails fast: no such folder
	// is needed, the point is that it was not held).
	srv.usageLimits.update(deviceId, claudeLimits(10, 60, time.Now().Add(time.Hour), reset))
	start["clientRequestId"] = "hold-key-0002"
	var out map[string]any
	code := api.do("POST", "/api/threads", start, nil)
	_ = out
	if code == 202 {
		t.Fatal("below the hold level the start must not be held")
	}
	if ths, _ := srv.store.ListThreads(); len(ths) > 0 {
		killThreadShell(t, ths[0].Id)
	}
}

func TestContinueEndToEnd(t *testing.T) {
	t.Setenv(fakeACPEnv, "1")
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	srv, base := startHub(t)
	deviceId := connectAgent(t, srv, base)
	token, _ := srv.store.CreateApiToken("handoff-test")
	api := apiClient{t: t, base: base, token: token}
	cwd := t.TempDir()

	var first Thread
	api.do("POST", "/api/threads", acpStart(deviceId, exe, cwd, "hand-key-0001"), &first)
	killThreadShell(t, first.Id)

	var prev struct {
		Prompt string    `json:"prompt"`
		Title  string    `json:"title"`
		Stats  contStats `json:"stats"`
	}
	api.do("POST", "/api/threads/"+first.Id+"/continue/preview", map[string]any{"agent": "acp", "note": "use tabs"}, &prev)
	for _, want := range []string{"## Original goal", "ping", "## What is left", "use tabs", "git status"} {
		if !strings.Contains(prev.Prompt, want) {
			t.Errorf("preview is missing %q:\n%s", want, prev.Prompt)
		}
	}
	if !strings.HasPrefix(prev.Title, "Continue: ") || prev.Stats.Turns != 1 {
		t.Errorf("preview: %+v", prev)
	}

	req := map[string]any{"prompt": prev.Prompt + "\nEdited.", "agent": "acp", "clientRequestId": "hand-key-0002"}
	// The generic acp agent needs its command.
	if code := api.do("POST", "/api/threads/"+first.Id+"/continue", req, nil); code != 400 {
		t.Fatalf("acp without a command: %d", code)
	}
	req["command"] = strconvQuote(exe)
	var second Thread
	api.do("POST", "/api/threads/"+first.Id+"/continue", req, &second)
	killThreadShell(t, second.Id)
	if second.Id == "" || second.Id == first.Id || second.Cwd != first.Cwd || second.DeviceId != deviceId || second.Title != prev.Title {
		t.Fatalf("continued session: %+v (title %q)", second, prev.Title)
	}
	// The same key never starts a second one.
	var again Thread
	api.do("POST", "/api/threads/"+first.Id+"/continue", req, &again)
	if again.Id != second.Id {
		t.Fatalf("retry started %s, want %s", again.Id, second.Id)
	}

	var links struct {
		From *contLink  `json:"from"`
		To   []contLink `json:"to"`
	}
	api.do("GET", "/api/threads/"+second.Id+"/continue", nil, &links)
	if links.From == nil || links.From.Id != first.Id || len(links.To) != 0 {
		t.Fatalf("second links: %+v", links)
	}
	api.do("GET", "/api/threads/"+first.Id+"/continue", nil, &links)
	if links.From != nil || len(links.To) != 1 || links.To[0].Id != second.Id {
		t.Fatalf("first links: %+v", links)
	}
	msgs, _ := srv.store.ThreadMessages(first.Id)
	found := false
	for _, m := range msgs {
		if m.Role == "status" && strings.HasPrefix(m.Text, "Continued in") {
			found = true
		}
	}
	if !found {
		t.Fatal("the source transcript does not say it was continued")
	}
}

// --- the handoff prompt ---

func hmsg(id, role, text string) ThreadMessage { return ThreadMessage{Id: id, Role: role, Text: text} }

func TestBuildContinuePrompt(t *testing.T) {
	thread := &Thread{Title: "Fix the flaky auth tests", Cwd: "/work/api", Agent: "claude", Status: "idle"}
	edit := ThreadMessage{Id: "t1", Role: "tool", Tool: &protocol.ThreadTool{Name: "edit", Title: "Edit a.go", Status: "completed",
		Files: []protocol.ThreadToolFile{{Path: "a.go", Additions: 10, Deletions: 2}, {Path: "b.go", Additions: 1}}}}
	edit2 := ThreadMessage{Id: "t2", Role: "tool", Tool: &protocol.ThreadTool{Name: "edit", Title: "Edit a.go", Status: "completed",
		Files: []protocol.ThreadToolFile{{Path: "a.go", Additions: 5, Deletions: 1}}}}
	failed := ThreadMessage{Id: "t3", Role: "tool", Tool: &protocol.ThreadTool{Name: "bash", Title: "Run tests", Status: "error", Output: "FAIL TestSession 0.3s"}}
	plan := ThreadMessage{Id: "p1", Role: "plan", Plan: []protocol.PlanEntry{
		{Content: "Add a fake clock", Status: "completed"}, {Content: "Rewrite the expiry test", Status: "in_progress"}, {Content: "Run with -race", Status: "pending"}}}
	msgs := []ThreadMessage{
		hmsg("u1", "user", "The auth tests fail 1 in 5 runs. Find out why and fix it."),
		hmsg("a1", "assistant", "They race the expiry ticker, so I will inject a fake clock."),
		edit, plan,
		{Id: "u2", Role: "user", Text: "queued, not sent yet", Queued: true},
		hmsg("u3", "user", "Also cover the refresh path."),
		edit2, failed,
		hmsg("e1", "error", "rate limit reached"),
	}
	prompt, stats := buildContinuePrompt(contInput{Thread: thread, Messages: msgs, FromName: "Claude Code", ToName: "Codex",
		DiffStat: " a.go | 15 ++++-\n 1 file changed", Note: "Keep the public API."})

	for _, want := range []string{
		"taking over a coding task from Claude Code (you are Codex)",
		"/work/api",
		"The auth tests fail 1 in 5 runs",
		"They race the expiry ticker",
		"- a.go (+15 −3)", "- b.go (+1 −0)",
		"1 file changed",
		"[x] Add a fake clock", "[~] Rewrite the expiry test", "[ ] Run with -race",
		"## Last error", "rate limit reached",
		"- Rewrite the expiry test", "- Run with -race",
		"Result: no final answer", // the second turn never finished
		"Keep the public API.",
	} {
		if !strings.Contains(prompt, want) {
			t.Errorf("handoff is missing %q:\n%s", want, prompt)
		}
	}
	if strings.Contains(prompt, "queued, not sent yet") {
		t.Error("a queued, unsent prompt is not part of the history")
	}
	if stats.Turns != 2 || stats.Files != 2 || stats.PlanDone != 1 || stats.PlanTotal != 3 || !stats.LastError || !stats.DiffStat {
		t.Errorf("stats: %+v", stats)
	}
}

func TestBuildContinueCondensesLongThreads(t *testing.T) {
	var msgs []ThreadMessage
	for i := 0; i < 12; i++ {
		msgs = append(msgs,
			hmsg("u"+string(rune('a'+i)), "user", "Step "+string(rune('A'+i))+" "+strings.Repeat("ask ", 100)),
			hmsg("r"+string(rune('a'+i)), "assistant", "Answer "+string(rune('A'+i))+" "+strings.Repeat("detail ", 200)))
	}
	prompt, stats := buildContinuePrompt(contInput{Thread: &Thread{Cwd: "/x"}, Messages: msgs, FromName: "Claude Code"})
	if stats.Turns != 12 {
		t.Fatalf("turns: %d", stats.Turns)
	}
	if len(prompt) > contCap {
		t.Errorf("prompt is %d bytes, cap %d", len(prompt), contCap)
	}
	if !strings.Contains(prompt, "12. Asked: Step L") || !strings.Contains(prompt, "1. Asked: Step A") {
		t.Error("every turn should appear at least as one line")
	}
	// The older turns are condensed harder than the recent ones.
	if strings.Count(prompt, "detail") > 4*(900/7+1)+8*(240/7+1)+10 {
		t.Errorf("older turns were not condensed (%d bytes)", len(prompt))
	}
	if strings.Contains(prompt, "## Files changed") || strings.Contains(prompt, "## Last error") {
		t.Error("empty sections should be left out")
	}
	if !strings.Contains(prompt, "Check the work against the original goal") {
		t.Error("with no plan and a finished last turn, say what to do next")
	}
}

func TestContinueLastErrorFallsBackToFailedTool(t *testing.T) {
	msgs := []ThreadMessage{
		hmsg("u1", "user", "do it"),
		{Id: "t", Role: "tool", Tool: &protocol.ThreadTool{Title: "Run build", Status: "error", Output: "exit status 2"}},
	}
	if got := contLastError(&Thread{}, msgs); !strings.Contains(got, "Run build") || !strings.Contains(got, "exit status 2") {
		t.Errorf("got %q", got)
	}
	// An error from an earlier turn is not "the last error".
	msgs = append(msgs, hmsg("u2", "user", "try again"), hmsg("a2", "assistant", "done"))
	if got := contLastError(&Thread{}, msgs); got != "" {
		t.Errorf("stale error shown: %q", got)
	}
	if got := contLastError(&Thread{Status: "error", Error: "agent crashed"}, msgs); got != "agent crashed" {
		t.Errorf("thread error: %q", got)
	}
}

// The scheduler tick starts a due session through the normal path, and starts
// it exactly once however often it runs.
func TestSchedulerTickStartsDueSession(t *testing.T) {
	t.Setenv(fakeACPEnv, "1")
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	srv, base := startHub(t)
	deviceId := connectAgent(t, srv, base)
	token, _ := srv.store.CreateApiToken("tick-test")
	api := apiClient{t: t, base: base, token: token}

	body := acpStart(deviceId, exe, t.TempDir(), "tick-key-0001")
	body["trigger"] = map[string]any{"kind": "time", "at": time.Now().Add(time.Hour).Unix()}
	var made ScheduledSession
	api.do("POST", "/api/scheduled", body, &made)

	// An hour from now it is due.
	later := time.Now().Add(61 * time.Minute)
	srv.runDueScheduled(later)
	srv.runDueScheduled(later)
	var got *ScheduledSession
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); time.Sleep(50 * time.Millisecond) {
		if got, _ = srv.store.ScheduledById(made.Id); got != nil && got.Status == "started" {
			break
		}
	}
	if got == nil || got.Status != "started" || got.ThreadId == "" {
		t.Fatalf("after the tick: %+v", got)
	}
	killThreadShell(t, got.ThreadId)
	srv.runDueScheduled(later.Add(time.Minute))
	if all, _ := srv.store.ListThreads(); len(all) != 1 {
		t.Fatalf("%d sessions for one schedule", len(all))
	}
	// A start that is retried with the same key finds the session.
	th, replayed, err := srv.startThreadOnce(made.schedPayload.threadInput())
	if err != nil || !replayed || th.Id != got.ThreadId {
		t.Fatalf("replay: %v %v %+v", replayed, err, th)
	}
}

// The pause guardrail stops a running turn once, never ends the session, and
// says so in the transcript and in a notice.
func TestPauseGuardrail(t *testing.T) {
	srv, base := startHub(t)
	deviceId := connectAgent(t, srv, base)
	now := time.Now()
	srv.usageLimits.update(deviceId, claudeLimits(10, 99, now.Add(time.Hour), now.Add(48*time.Hour)))
	token, _ := srv.store.CreateApiToken("pause-test")
	api := apiClient{t: t, base: base, token: token}
	api.do("PUT", "/api/guardrails", map[string]any{"claude": map[string]any{"pauseEnabled": true, "pausePercent": 98, "holdPercent": 90}}, nil)

	mk := func(id, agent, status string) {
		th := &Thread{Id: id, Title: "Task " + id, DeviceId: deviceId, Agent: agent, Access: "edits", Status: status, CreatedAt: now.Unix(), UpdatedAt: now.Unix(), LastReadAt: now.Unix()}
		if err := srv.store.CreateThread(th); err != nil {
			t.Fatal(err)
		}
	}
	mk("run-claude-0001", "claude", "working")
	srv.threads.recordUser("run-claude-0001", "go", nil, false) // the turn that is running
	mk("idle-claude-002", "claude", "idle")
	mk("run-codex-00003", "codex", "working") // another agent: not paused

	srv.checkPauseGuardrails(now)
	if th, _ := srv.store.ThreadById("run-claude-0001"); th.Status == "working" {
		t.Fatalf("the running turn was not paused: %+v", th.Status)
	}
	if th, _ := srv.store.ThreadById("run-codex-00003"); th.Status != "working" {
		t.Fatal("a session of another agent was touched")
	}
	if th, _ := srv.store.ThreadById("idle-claude-002"); th == nil || th.Status != "idle" {
		t.Fatal("an idle session must be left alone")
	}
	if th, _ := srv.store.ThreadById("run-claude-0001"); th == nil {
		t.Fatal("pausing must never delete a session")
	}
	msgs, _ := srv.store.ThreadMessages("run-claude-0001")
	said := false
	for _, m := range msgs {
		said = said || (m.Role == "status" && strings.Contains(m.Text, "Paused by your guardrail"))
	}
	if !said {
		t.Fatal("the transcript does not say it was paused")
	}
	var notices []guardNotice
	api.do("GET", "/api/guardrails/notices", nil, &notices)
	if len(notices) != 1 || notices[0].Kind != "pause" || notices[0].Agent != "claude" || notices[0].Percent < 98 {
		t.Fatalf("notices: %+v", notices)
	}
	// The same turn is not paused again (and no second notice) on the next tick.
	srv.store.SetThreadStatus("run-claude-0001", "working", "")
	srv.checkPauseGuardrails(now.Add(15 * time.Second))
	api.do("GET", "/api/guardrails/notices", nil, &notices)
	if len(notices) != 1 {
		t.Fatalf("the same turn was paused twice: %+v", notices)
	}
	// Below the pause level nothing happens.
	srv.usageLimits.update(deviceId, claudeLimits(10, 97, now.Add(time.Hour), now.Add(48*time.Hour)))
	srv.store.SetThreadStatus("run-claude-0001", "working", "")
	srv.sched.mu.Lock()
	srv.sched.paused = nil
	srv.sched.mu.Unlock()
	srv.checkPauseGuardrails(now.Add(30 * time.Second))
	if th, _ := srv.store.ThreadById("run-claude-0001"); th.Status != "working" {
		t.Fatal("97% must not pause at 98%")
	}
}

func TestWindowModel(t *testing.T) {
	for _, c := range []struct {
		id, label, model string
		applies          bool
	}{
		{"seven_day", "Weekly", "sonnet", true},
		{"seven_day_opus", "Weekly (Opus)", "opus", true},
		{"seven_day_opus", "Weekly (Opus)", "sonnet", false},
		{"seven_day_fable", "", "", false},
		{"x", "Weekly (Sonnet)", "claude-sonnet-4", true},
		{"five_hour", "5-hour", "", true},
	} {
		if got := windowApplies(protocol.LimitWindow{Id: c.id, Label: c.label}, c.model); got != c.applies {
			t.Errorf("%s/%s for %q: %v, want %v", c.id, c.label, c.model, got, c.applies)
		}
	}
}
