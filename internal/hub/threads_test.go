package hub

import (
	"strings"
	"testing"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

func TestThreadEventFolding(t *testing.T) {
	s := testStore(t)
	now := time.UnixMilli(1_700_000_000_000)
	th := &Thread{Id: "t1", Title: "x", DeviceId: "d", Agent: "claude", Access: "edits", Status: "idle", CreatedAt: 1, UpdatedAt: 1}
	if err := s.CreateThread(th); err != nil {
		t.Fatal(err)
	}
	apply := func(ev protocol.ThreadEvent, turn string, at time.Time) *ThreadMessage {
		t.Helper()
		m, err := s.ApplyThreadEvent("t1", ev, turn, at)
		if err != nil {
			t.Fatal(err)
		}
		return m
	}

	u := apply(protocol.ThreadEvent{Id: "u1", Role: "user", Text: "hi"}, "u0", now)
	if u.Seq != 1 || u.Turn != "" {
		t.Errorf("user message seq=%d turn=%q, want 1 and no turn", u.Seq, u.Turn)
	}

	// Appends concatenate and keep seq/at from the first event.
	apply(protocol.ThreadEvent{Id: "a1", Role: "assistant", Text: "Hel", Append: true}, "u1", now)
	m := apply(protocol.ThreadEvent{Id: "a1", Text: "lo", Append: true}, "u2", now.Add(time.Second))
	if m.Text != "Hello" || m.Seq != 2 || m.Role != "assistant" {
		t.Errorf("after append: %+v", m)
	}
	if m.At != now.UnixMilli() || m.UpdatedAt != now.Add(time.Second).UnixMilli() {
		t.Errorf("at/updatedAt = %d/%d", m.At, m.UpdatedAt)
	}
	if m.Turn != "u1" {
		t.Errorf("turn = %q, want the default from first insert (u1)", m.Turn)
	}

	// A non-append event replaces text and merges other fields.
	m = apply(protocol.ThreadEvent{Id: "a1", Text: "Hello, world", DurationMs: 1500}, "", now)
	if m.Text != "Hello, world" || m.DurationMs != 1500 {
		t.Errorf("after replace: %+v", m)
	}
	m = apply(protocol.ThreadEvent{Id: "a1"}, "", now) // empty fields leave everything alone
	if m.Text != "Hello, world" || m.DurationMs != 1500 {
		t.Errorf("empty event changed message: %+v", m)
	}

	// Tool fields merge individually.
	apply(protocol.ThreadEvent{Id: "tool1", Role: "tool", Tool: &protocol.ThreadTool{Name: "bash", Title: "Run", Status: "running", Input: "ls"}}, "u1", now)
	big := strings.Repeat("x", toolOutputCap+100)
	m = apply(protocol.ThreadEvent{Id: "tool1", Tool: &protocol.ThreadTool{Status: "completed", Output: big}}, "", now)
	if m.Seq != 3 || m.Tool.Name != "bash" || m.Tool.Input != "ls" || m.Tool.Status != "completed" {
		t.Errorf("tool merge: seq=%d %+v", m.Seq, m.Tool)
	}
	if len(m.Tool.Output) > toolOutputCap+64 {
		t.Errorf("tool output not capped: %d bytes", len(m.Tool.Output))
	}

	// Approval resolution only touches resolved.
	apply(protocol.ThreadEvent{Id: "p1", Role: "approval", Approval: &protocol.ThreadApprovalRequest{
		Id: "p1", Title: "Allow?", Options: []protocol.ApprovalOption{{Id: "y", Label: "Yes", Kind: "allow_once"}},
	}}, "u1", now)
	m = apply(protocol.ThreadEvent{Id: "p1", Approval: &protocol.ThreadApprovalRequest{Id: "p1", Resolved: "y"}}, "", now)
	if m.Approval.Title != "Allow?" || len(m.Approval.Options) != 1 || m.Approval.Resolved != "y" {
		t.Errorf("approval merge: %+v", m.Approval)
	}

	// A first event without a role gets one inferred.
	m = apply(protocol.ThreadEvent{Id: "plan1", Plan: []protocol.PlanEntry{{Content: "a", Status: "pending"}}}, "u1", now)
	if m.Role != "plan" || m.Seq != 5 {
		t.Errorf("inferred role/seq = %q/%d", m.Role, m.Seq)
	}

	msgs, err := s.ThreadMessages("t1")
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, m := range msgs {
		ids = append(ids, m.Id)
	}
	if got := strings.Join(ids, ","); got != "u1,a1,tool1,p1,plan1" {
		t.Errorf("order = %s", got)
	}
	if last, _ := s.LastUserMessageId("t1"); last != "u1" {
		t.Errorf("last user message = %q", last)
	}

	if err := s.DeleteThread("t1"); err != nil {
		t.Fatal(err)
	}
	if msgs, _ := s.ThreadMessages("t1"); len(msgs) != 0 {
		t.Errorf("messages survived delete: %d", len(msgs))
	}
}

func TestTitleFromPrompt(t *testing.T) {
	if got := titleFromPrompt("  Fix the login bug\nwith details  "); got != "Fix the login bug" {
		t.Errorf("got %q", got)
	}
	long := strings.Repeat("word ", 30)
	got := titleFromPrompt(long)
	if !strings.HasSuffix(got, "…") || len([]rune(got)) > 61 {
		t.Errorf("long title = %q", got)
	}
}

func TestCronParse(t *testing.T) {
	bad := []string{"", "* * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "*/0 * * * *", "5-1 * * * *", "a * * * *", "1,,2 * * * *"}
	for _, spec := range bad {
		if _, err := parseCron(spec); err == nil {
			t.Errorf("%q should fail", spec)
		}
	}
	c, err := parseCron("*/15 9-17 * * mon-fri")
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range []int{0, 15, 30, 45} {
		if c.minute&(1<<uint(m)) == 0 {
			t.Errorf("minute %d missing", m)
		}
	}
	if c.minute&(1<<1) != 0 || c.hour&(1<<8) != 0 || c.hour&(1<<17) == 0 {
		t.Error("wrong minute/hour bits")
	}
	if c.dow != 0b0111110 {
		t.Errorf("dow bits = %b", c.dow)
	}
	if c7, _ := parseCron("0 0 * * 7"); c7.dow&1 == 0 {
		t.Error("7 should mean Sunday")
	}
}

func TestCronNext(t *testing.T) {
	loc := time.UTC
	at := func(s string) time.Time {
		t.Helper()
		v, err := time.ParseInLocation("2006-01-02 15:04", s, loc)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	cases := []struct{ spec, after, want string }{
		{"*/15 * * * *", "2026-03-10 10:07", "2026-03-10 10:15"},
		{"*/15 * * * *", "2026-03-10 10:15", "2026-03-10 10:30"}, // strictly after
		{"0 9 * * *", "2026-03-10 09:00", "2026-03-11 09:00"},
		{"30 2 1 * *", "2026-12-15 00:00", "2027-01-01 02:30"},
		{"0 9 * * 1-5", "2026-03-13 10:00", "2026-03-16 09:00"},  // Fri -> Mon
		{"0 0 13 * 5", "2026-03-01 00:00", "2026-03-06 00:00"},   // dom OR dow: first Friday
		{"0 0 29 2 *", "2026-03-01 00:00", "2028-02-29 00:00"},   // leap day
		{"5,10 1 * * *", "2026-03-10 01:07", "2026-03-10 01:10"}, // lists
		{"@hourly", "2026-03-10 10:59", "2026-03-10 11:00"},
	}
	for _, tc := range cases {
		c, err := parseCron(tc.spec)
		if err != nil {
			t.Fatalf("%s: %v", tc.spec, err)
		}
		got := c.next(at(tc.after))
		if !got.Equal(at(tc.want)) {
			t.Errorf("%s after %s = %s, want %s", tc.spec, tc.after, got.Format("2006-01-02 15:04"), tc.want)
		}
	}
	if c, _ := parseCron("0 0 31 2 *"); !c.next(at("2026-01-01 00:00")).IsZero() {
		t.Error("impossible schedule should yield zero time")
	}

	// Across a DST change the result must still move forward and match.
	ny, err := time.LoadLocation("America/New_York")
	if err == nil {
		c, _ := parseCron("30 2 * * *")
		start := time.Date(2026, 3, 7, 12, 0, 0, 0, ny)
		n1 := c.next(start)
		n2 := c.next(n1)
		if !n1.After(start) || !n2.After(n1) || n2.Minute() != 30 {
			t.Errorf("DST: %s then %s", n1, n2)
		}
	}
}
