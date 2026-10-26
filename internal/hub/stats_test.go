package hub

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// statsFixture seeds a week of activity on two machines. now is Wednesday
// 21 Oct 2026, noon UTC.
func statsFixture(t *testing.T) (*Store, time.Time) {
	t.Helper()
	s := testStore(t)
	now := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	m1, _, err := s.CreateDevice("MacBook", "mb", "darwin", "arm64", false)
	if err != nil {
		t.Fatal(err)
	}
	m2, _, err := s.CreateDevice("Studio", "st", "linux", "amd64", false)
	if err != nil {
		t.Fatal(err)
	}
	mon := time.Date(2026, 10, 19, 10, 0, 0, 0, time.UTC)
	tue := mon.Add(24 * time.Hour)

	mk := func(id, title, device, agent string, created, updated time.Time, status string) {
		if err := s.CreateThread(&Thread{Id: id, Title: title, DeviceId: device, Agent: agent, Cwd: "/x", Access: "auto",
			Status: status, CreatedAt: created.Unix(), UpdatedAt: updated.Unix()}); err != nil {
			t.Fatal(err)
		}
	}
	mk("a", "Ship the retry client", m1, "claude", mon, tue.Add(time.Hour), "idle")
	mk("b", "Fix the flaky tests", m2, "codex", tue, tue.Add(2*time.Hour), "working")
	mk("old", "Ancient history", m1, "claude", now.AddDate(0, 0, -20), now.AddDate(0, 0, -20), "idle")
	if err := s.SetThreadUsage("a", protocol.Usage{InputTokens: 1000, OutputTokens: 200, CostUsd: 1.5}); err != nil {
		t.Fatal(err)
	}

	ev := func(thread string, e protocol.ThreadEvent, at time.Time) {
		if _, err := s.ApplyThreadEvent(thread, e, "", at); err != nil {
			t.Fatal(err)
		}
	}
	edit := func(id string, add, del int, path, status string) protocol.ThreadEvent {
		return protocol.ThreadEvent{Id: id, Role: "tool", Tool: &protocol.ThreadTool{Name: "edit", Status: status,
			Files: []protocol.ThreadToolFile{{Path: path, Additions: add, Deletions: del, Diff: "@@ big diff @@"}}}}
	}
	ev("a", protocol.ThreadEvent{Id: "u1", Role: "user", Text: "go"}, mon)
	ev("a", edit("e1", 10, 2, "a.go", "completed"), mon.Add(time.Minute))
	ev("a", edit("e2", 5, 0, "a.go", "completed"), mon.Add(2*time.Minute))
	ev("a", edit("e3", 7, 7, "b.go", "completed"), mon.Add(3*time.Minute))
	ev("a", edit("e4", 100, 100, "c.go", "error"), mon.Add(4*time.Minute)) // failed edits don't count
	ev("a", protocol.ThreadEvent{Id: "ap", Role: "approval", Approval: &protocol.ThreadApprovalRequest{Id: "ap", Title: "run?", Resolved: "allow"}}, mon.Add(5*time.Minute))
	ev("a", protocol.ThreadEvent{Id: "ap2", Role: "approval", Approval: &protocol.ThreadApprovalRequest{Id: "ap2", Title: "again?"}}, mon.Add(6*time.Minute)) // still pending
	ev("a", protocol.ThreadEvent{Id: "pr", Role: "tool", Tool: &protocol.ThreadTool{Name: "bash", Status: "completed",
		Input: "gh pr create --fill", Output: "https://github.com/acme/app/pull/12\n"}}, mon.Add(7*time.Minute))
	ev("a", protocol.ThreadEvent{Id: "as1", Role: "assistant", Text: "done", DurationMs: 600_000}, mon.Add(8*time.Minute))
	ev("a", protocol.ThreadEvent{Id: "u2", Role: "user", Text: "now merge"}, tue)
	ev("a", protocol.ThreadEvent{Id: "mg", Role: "tool", Tool: &protocol.ThreadTool{Name: "bash", Status: "completed",
		Input: "gh pr merge 12 --squash", Output: "Merged"}}, tue.Add(time.Minute))
	ev("a", protocol.ThreadEvent{Id: "st1", Role: "status", Text: "Done", DurationMs: 1_200_000}, tue.Add(2*time.Minute))

	ev("b", protocol.ThreadEvent{Id: "u1", Role: "user", Text: "fix"}, tue)
	ev("b", protocol.ThreadEvent{Id: "as1", Role: "assistant", Text: "ok", DurationMs: 3_600_000}, tue.Add(time.Hour))
	ev("b", protocol.ThreadEvent{Id: "u2", Role: "user", Text: "later"}, tue.Add(90*time.Minute))

	ev("old", protocol.ThreadEvent{Id: "u1", Role: "user", Text: "ancient"}, now.AddDate(0, 0, -20))
	ev("old", protocol.ThreadEvent{Id: "as1", Role: "assistant", Text: "ok", DurationMs: 9_000_000}, now.AddDate(0, 0, -20))
	return s, now
}

func TestComputeStatsWeek(t *testing.T) {
	s, now := statsFixture(t)
	end := time.Date(2026, 10, 22, 0, 0, 0, 0, time.UTC)
	res, err := s.computeStats(end.AddDate(0, 0, -7), end, time.UTC, now)
	if err != nil {
		t.Fatal(err)
	}
	if res.Sessions.Started != 2 || res.Sessions.Finished != 1 {
		t.Errorf("sessions = %+v", res.Sessions)
	}
	if res.Turns != 4 {
		t.Errorf("turns = %d, want 4", res.Turns)
	}
	if res.AgentMs != 600_000+1_200_000+3_600_000 || res.AgentHours != 1.5 {
		t.Errorf("agent time = %d ms, %v h", res.AgentMs, res.AgentHours)
	}
	if res.Lines.Added != 22 || res.Lines.Removed != 9 || res.Files != 2 {
		t.Errorf("lines = %+v, files = %d", res.Lines, res.Files)
	}
	if res.Approvals != 1 {
		t.Errorf("approvals = %d, want 1", res.Approvals)
	}
	if res.PRs.Opened != 1 || res.PRs.Merged != 1 {
		t.Errorf("prs = %+v", res.PRs)
	}
	if res.Tokens.Input != 1000 || res.CostUsd != 1.5 {
		t.Errorf("tokens = %+v cost = %v", res.Tokens, res.CostUsd)
	}
	if len(res.Days) != 7 || res.Days[0].Date != "2026-10-15" || res.Days[6].Date != "2026-10-21" {
		t.Fatalf("days = %+v", res.Days)
	}
	if d := res.Days[4]; d.Date != "2026-10-19" || d.Sessions != 1 || d.Turns != 1 || d.Lines != 31 {
		t.Errorf("monday = %+v", d)
	}
	if res.BusiestDay == nil || res.BusiestDay.Date != "2026-10-20" {
		t.Errorf("busiest = %+v", res.BusiestDay)
	}
	if len(res.Agents) != 2 || res.Agents[0].Id != "codex" || res.Agents[0].AgentMs != 3_600_000 {
		t.Errorf("agents = %+v", res.Agents)
	}
	if len(res.Machines) != 2 || res.Machines[0].Name != "Studio" || res.Machines[1].PRs != 1 {
		t.Errorf("machines = %+v", res.Machines)
	}
	if res.TopSession == nil || res.TopSession.Id != "a" || res.TopSession.Added != 22 {
		t.Errorf("top = %+v", res.TopSession)
	}
	if res.LongestSession == nil || res.LongestSession.Id != "b" {
		t.Errorf("longest = %+v", res.LongestSession)
	}
	// Prompts on Mon and Tue, and again 20 days ago: today (Wed) is empty but
	// the run through Tuesday is still alive.
	if res.Streak.Current != 2 || res.Streak.Longest != 2 {
		t.Errorf("streak = %+v", res.Streak)
	}
}

func TestComputeStatsEmptyAndTimeZone(t *testing.T) {
	s := testStore(t)
	now := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	end := time.Date(2026, 10, 22, 0, 0, 0, 0, time.UTC)
	res, err := s.computeStats(end.AddDate(0, 0, -7), end, time.UTC, now)
	if err != nil {
		t.Fatal(err)
	}
	if res.Turns != 0 || res.AgentMs != 0 || res.BusiestDay != nil || res.TopSession != nil || res.Streak.Current != 0 {
		t.Errorf("empty = %+v", res)
	}
	b, _ := json.Marshal(res)
	var back map[string]any
	if err := json.Unmarshal(b, &back); err != nil || back["agents"] == nil || back["days"] == nil {
		t.Errorf("empty lists must serialise as []: %s", b)
	}

	// A late-evening prompt in UTC is already the next day in Tokyo.
	s, now = statsFixture(t)
	tokyo, _ := time.LoadLocation("Asia/Tokyo")
	tend := time.Date(2026, 10, 22, 0, 0, 0, 0, tokyo)
	res, err = s.computeStats(tend.AddDate(0, 0, -7), tend, tokyo, now)
	if err != nil {
		t.Fatal(err)
	}
	if res.Days[6].Date != "2026-10-21" || res.Days[0].Date != "2026-10-15" || res.Days[4].Turns != 1 {
		t.Errorf("tokyo days = %+v", res.Days)
	}
}

func TestStatsEndpoint(t *testing.T) {
	s, _ := statsFixture(t)
	srv := &Server{store: s}
	get := func(query string) (*httptest.ResponseRecorder, StatsResponse) {
		w := httptest.NewRecorder()
		srv.handleStats(w, httptest.NewRequest("GET", "/api/stats?"+query, nil))
		var out StatsResponse
		json.Unmarshal(w.Body.Bytes(), &out)
		return w, out
	}
	if w, _ := get("range=bogus"); w.Code != http.StatusBadRequest {
		t.Errorf("bogus range: %d", w.Code)
	}
	if w, _ := get("start=5&end=3"); w.Code != http.StatusBadRequest {
		t.Errorf("bad custom range: %d", w.Code)
	}
	w, all := get("range=all&tz=UTC")
	if w.Code != 200 || all.Range != "all" || all.Previous != nil || all.Sessions.Started != 3 {
		t.Errorf("all: %d %+v", w.Code, all.Sessions)
	}
	w, wk := get("range=week")
	if w.Code != 200 || wk.Range != "week" || wk.Previous == nil || len(wk.Days) != 7 {
		t.Errorf("week: %d prev=%v days=%d", w.Code, wk.Previous, len(wk.Days))
	}
	_, custom := get("start=1760000000&end=1760100000")
	if custom.Range != "custom" || custom.Start != 1760000000 {
		t.Errorf("custom: %+v", custom)
	}
}

func TestComputeStatsIsFastOnALargeStore(t *testing.T) {
	s := testStore(t)
	now := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	tx, err := s.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 200; i++ {
		id := "t" + time.Duration(i).String()
		at := now.Add(-time.Duration(i) * time.Hour)
		tx.Exec(`INSERT INTO threads (id, title, device_id, agent, created_at, updated_at) VALUES (?, 'x', 'd', 'claude', ?, ?)`, id, at.Unix(), at.Unix())
		for j := 0; j < 100; j++ {
			role, data := "tool", `{"tool":{"name":"edit","status":"completed","files":[{"path":"a.go","additions":3,"deletions":1,"diff":"@@ x @@"}]}}`
			if j%10 == 0 {
				role, data = "user", `{}`
			}
			tx.Exec(`INSERT INTO thread_messages (thread_id, id, seq, at, updated_at, role, text, data) VALUES (?, ?, ?, ?, ?, ?, '', ?)`,
				id, "m"+time.Duration(j).String(), j, at.UnixMilli()+int64(j), at.UnixMilli()+int64(j), role, data)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	end := time.Date(2026, 10, 22, 0, 0, 0, 0, time.UTC)
	began := time.Now()
	res, err := s.computeStats(end.AddDate(0, 0, -30), end, time.UTC, now)
	if err != nil {
		t.Fatal(err)
	}
	if took := time.Since(began); took > 2*time.Second {
		t.Errorf("20k messages took %v", took)
	}
	if res.Turns != 200*10 || res.Lines.Added != 200*90*3 {
		t.Errorf("turns = %d, added = %d", res.Turns, res.Lines.Added)
	}
}
