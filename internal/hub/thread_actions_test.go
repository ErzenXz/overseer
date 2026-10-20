package hub

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"testing"

	"github.com/ErzenXz/overseer/internal/protocol"
)

func TestForkCutAndUndoTranscript(t *testing.T) {
	msgs := []ThreadMessage{
		{Id: "u1", Seq: 1, Role: "user", Text: "first"},
		{Id: "a1", Seq: 2, Role: "assistant", Text: "one", Turn: "u1"},
		{Id: "t1", Seq: 3, Role: "tool", Turn: "u1", Tool: &protocol.ThreadTool{Title: "Run tests", Input: "go test"}},
		{Id: "u2", Seq: 4, Role: "user", Text: "second"},
		{Id: "a2", Seq: 5, Role: "assistant", Text: "two", Turn: "u2"},
		{Id: "u3", Seq: 6, Role: "user", Text: "queued", Queued: true},
		{Id: "u4", Seq: 7, Role: "user", Text: "third"},
		{Id: "a4", Seq: 8, Role: "assistant", Text: "three", Turn: "u4"},
	}
	ids := func(ms []ThreadMessage) string {
		var out []string
		for _, m := range ms {
			out = append(out, m.Id)
		}
		return strings.Join(out, ",")
	}
	kept, cut, dropped, ok := forkCut(msgs, "")
	if !ok || ids(kept) != "u1,a1,t1,u2,a2,u4,a4" || cut != "u4" || dropped != 0 {
		t.Errorf("whole fork: %s cut=%s dropped=%d", ids(kept), cut, dropped)
	}
	// Forking at a tool call keeps its whole turn; later turns are dropped
	// (the queued prompt is not a turn).
	kept, cut, dropped, ok = forkCut(msgs, "t1")
	if !ok || ids(kept) != "u1,a1,t1" || cut != "u1" || dropped != 2 {
		t.Errorf("fork at t1: %s cut=%s dropped=%d", ids(kept), cut, dropped)
	}
	kept, cut, dropped, _ = forkCut(msgs, "u2")
	if ids(kept) != "u1,a1,t1,u2,a2" || cut != "u2" || dropped != 1 {
		t.Errorf("fork at u2: %s cut=%s dropped=%d", ids(kept), cut, dropped)
	}
	if _, _, _, ok := forkCut(msgs, "nope"); ok {
		t.Error("unknown message should fail")
	}
	if got := strings.Join(lastTurnIds(msgs), ","); got != "u4,a4" {
		t.Errorf("last turn = %s", got)
	}
	tr := forkTranscript(msgs[:5])
	for _, want := range []string{"User: first", "Assistant: one", "Tool: Run tests (go test)", "User: second", "---"} {
		if !strings.Contains(tr, want) {
			t.Errorf("transcript missing %q:\n%s", want, tr)
		}
	}
	if forkTranscript(nil) != "" {
		t.Error("empty transcript should be empty")
	}
}

func TestSessionOrganisationColumns(t *testing.T) {
	s := testStore(t)
	th := &Thread{Id: "o1", Title: "x", DeviceId: "d", Agent: "codex", Access: "edits", Status: "idle", CreatedAt: 1, UpdatedAt: 5, LastReadAt: 5, ParentId: "p"}
	if err := s.CreateThread(th); err != nil {
		t.Fatal(err)
	}
	yes, folder, unread := true, "Work", false
	if err := s.PatchThread("o1", threadPatch{Pinned: &yes, Archived: &yes, Folder: &folder, Read: &unread}); err != nil {
		t.Fatal(err)
	}
	got, _ := s.ThreadById("o1")
	if !got.Pinned || !got.Archived || got.Folder != "Work" || got.ParentId != "p" || got.LastReadAt != 0 {
		t.Errorf("patched = %+v", got)
	}
	caps := protocol.ThreadCapabilities{Fork: true, Undo: true}
	s.MergeThreadMeta("o1", &caps, []protocol.AgentCommand{{Name: "review"}})
	s.MergeThreadMeta("o1", nil, nil) // keeps what is there
	got, _ = s.ThreadById("o1")
	if got.Meta.Capabilities == nil || !got.Meta.Capabilities.Undo || len(got.Meta.Commands) != 1 {
		t.Errorf("meta = %+v", got.Meta)
	}
	s.SetThreadUsage("o1", protocol.Usage{InputTokens: 1, ContextTokens: 900, ContextWindow: 1000})
	got, _ = s.ThreadById("o1")
	if got.Usage.ContextTokens != 900 || got.Usage.ContextWindow != 1000 {
		t.Errorf("usage = %+v", got.Usage)
	}
}

// End to end over the fake ACP agent (no steering, no native fork): a
// prompt sent mid-turn is queued and sent after the turn; a fork carries
// the transcript in its first prompt; unsupported actions are 409s.
func TestQueueForkAndCapabilities(t *testing.T) {
	t.Setenv(fakeACPEnv, "1")
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	srv, base := startHub(t)
	deviceId := connectAgent(t, srv, base)
	token, _ := srv.store.CreateApiToken("actions-test")
	api := apiClient{t: t, base: base, token: token}

	var created Thread
	api.do("POST", "/api/threads", map[string]any{
		"deviceId": deviceId, "agent": "acp", "command": fmt.Sprintf("%q", exe), "cwd": t.TempDir(), "prompt": "ping",
	}, &created)
	t.Cleanup(func() { exec.Command("tmux", "kill-session", "-t", "thread-"+created.Id[:8]).Run() })
	w := &threadWatcher{t: t, ws: api.dial("/api/ws/threads/" + created.Id), messages: map[string]ThreadMessage{}}
	w.until("approval", func() bool { return w.find("approval", nil) != nil && w.thread.Status == "waiting" })

	// Mid-turn prompt: ACP can't steer, so it waits in the queue.
	api.do("POST", "/api/threads/"+created.Id+"/prompt", map[string]string{"text": "later"}, &map[string]bool{})
	w.until("queued prompt", func() bool {
		return w.find("user", func(m ThreadMessage) bool { return m.Text == "later" && m.Queued }) != nil
	})
	var caps protocol.ThreadCapabilities
	api.do("GET", "/api/threads/"+created.Id+"/capabilities", nil, &caps)
	if caps.Steer || caps.Undo || !caps.Fork {
		t.Errorf("capabilities = %+v", caps)
	}
	var cmds []protocol.AgentCommand
	api.do("GET", "/api/threads/"+created.Id+"/commands", nil, &cmds)
	if cmds == nil || len(cmds) != 0 {
		t.Errorf("commands = %+v", cmds)
	}

	first := w.find("approval", nil)
	api.do("POST", "/api/threads/"+created.Id+"/approval", map[string]string{"approvalId": first.Approval.Id, "optionId": "ok"}, &map[string]bool{})
	w.until("queued prompt sent", func() bool {
		return w.find("user", func(m ThreadMessage) bool { return m.Text == "later" && !m.Queued }) != nil &&
			w.find("approval", func(m ThreadMessage) bool { return m.Approval.Resolved == "" }) != nil
	})
	second := w.find("approval", func(m ThreadMessage) bool { return m.Approval.Resolved == "" })
	api.do("POST", "/api/threads/"+created.Id+"/approval", map[string]string{"approvalId": second.Approval.Id, "optionId": "ok"}, &map[string]bool{})
	w.until("second reply", func() bool {
		return w.thread.Status == "idle" && w.find("assistant", func(m ThreadMessage) bool { return m.Text == "pong: later" }) != nil
	})
	reply := w.find("assistant", func(m ThreadMessage) bool { return m.Text == "pong: later" })
	later := w.find("user", func(m ThreadMessage) bool { return m.Text == "later" })
	if reply.Turn != later.Id {
		t.Errorf("reply turn = %q, want the dequeued prompt %q", reply.Turn, later.Id)
	}

	// Unsupported features say so.
	for _, action := range []string{"undo", "compact"} {
		if code := api.do("POST", "/api/threads/"+created.Id+"/"+action, nil, nil); code != http.StatusConflict {
			t.Errorf("%s = %d, want 409", action, code)
		}
	}
	if code := api.do("POST", "/api/threads/"+created.Id+"/answer", map[string]any{"questionId": "nope", "answers": []string{"x"}}, nil); code != http.StatusConflict {
		t.Errorf("unknown question = %d, want 409", code)
	}

	// Fork after the first turn: the copy keeps that turn only.
	var detail struct {
		Messages []ThreadMessage `json:"messages"`
	}
	api.do("GET", "/api/threads/"+created.Id, nil, &detail)
	var firstReply string
	for _, m := range detail.Messages {
		if m.Role == "assistant" && m.Text == "pong: ping" {
			firstReply = m.Id
		}
	}
	var fork Thread
	api.do("POST", "/api/threads/"+created.Id+"/fork", map[string]string{"messageId": firstReply}, &fork)
	if fork.ParentId != created.Id || fork.Title != "Fork of ping" || fork.Status != "idle" {
		t.Errorf("fork = %+v", fork)
	}
	var forkDetail struct {
		Messages []ThreadMessage `json:"messages"`
	}
	api.do("GET", "/api/threads/"+fork.Id, nil, &forkDetail)
	for _, m := range forkDetail.Messages {
		if m.Text == "later" || m.Text == "pong: later" {
			t.Errorf("fork kept a later turn: %+v", m)
		}
	}
	if len(forkDetail.Messages) == 0 || forkDetail.Messages[0].Text != "ping" {
		t.Fatalf("fork messages = %+v", forkDetail.Messages)
	}
	t.Cleanup(func() { exec.Command("tmux", "kill-session", "-t", "thread-"+fork.Id[:8]).Run() })

	// The fake agent can't fork, so the first prompt carries the transcript.
	fw := &threadWatcher{t: t, ws: api.dial("/api/ws/threads/" + fork.Id), messages: map[string]ThreadMessage{}}
	api.do("POST", "/api/threads/"+fork.Id+"/prompt", map[string]string{"text": "branch"}, &map[string]bool{})
	fw.until("fork approval", func() bool {
		return fw.find("approval", func(m ThreadMessage) bool { return m.Approval.Resolved == "" }) != nil
	})
	fa := fw.find("approval", func(m ThreadMessage) bool { return m.Approval.Resolved == "" })
	api.do("POST", "/api/threads/"+fork.Id+"/approval", map[string]string{"approvalId": fa.Approval.Id, "optionId": "ok"}, &map[string]bool{})
	fw.until("fork reply", func() bool {
		return fw.find("assistant", func(m ThreadMessage) bool {
			return strings.HasSuffix(m.Text, "branch") && strings.Contains(m.Text, "User: ping")
		}) != nil
	})
	stored, _ := srv.store.ThreadById(fork.Id)
	if stored.ForkPending || stored.ForkContext != "" {
		t.Errorf("fork bookkeeping not cleared: pending=%v context=%q", stored.ForkPending, stored.ForkContext)
	}

	// Organisation fields.
	var patched Thread
	api.do("PATCH", "/api/threads/"+fork.Id, map[string]any{"pinned": true, "folder": " Experiments ", "read": false}, &patched)
	if !patched.Pinned || patched.Folder != "Experiments" || patched.LastReadAt != 0 {
		t.Errorf("patched = %+v", patched)
	}
	if code := api.do("PATCH", "/api/threads/"+fork.Id, map[string]any{"folder": strings.Repeat("x", 201)}, nil); code != http.StatusBadRequest {
		t.Errorf("long folder = %d", code)
	}
}

// A prompt for a busy thread is queued unless the agent can steer, in
// which case it goes straight to the agent.
func TestQueueVersusSteer(t *testing.T) {
	t.Setenv(fakeACPEnv, "1")
	exe, _ := os.Executable()
	srv, base := startHub(t)
	deviceId := connectAgent(t, srv, base)
	token, _ := srv.store.CreateApiToken("steer-test")
	api := apiClient{t: t, base: base, token: token}

	for _, steer := range []bool{false, true} {
		th := &Thread{Id: fmt.Sprintf("busy-%v", steer), Title: "busy", DeviceId: deviceId, Agent: "acp",
			Command: fmt.Sprintf("%q", exe), Cwd: t.TempDir(), Access: "edits", Status: "working", CreatedAt: 1, UpdatedAt: 1}
		if err := srv.store.CreateThread(th); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { exec.Command("tmux", "kill-session", "-t", "thread-"+th.Id[:8]).Run() })
		caps := protocol.ThreadCapabilities{Fork: true, Steer: steer}
		srv.store.MergeThreadMeta(th.Id, &caps, nil)
		api.do("POST", "/api/threads/"+th.Id+"/prompt", map[string]string{"text": "more"}, &map[string]bool{})
		msgs, _ := srv.store.ThreadMessages(th.Id)
		if len(msgs) != 1 || msgs[0].Queued == steer {
			t.Errorf("steer=%v: messages = %+v", steer, msgs)
		}
	}
}
