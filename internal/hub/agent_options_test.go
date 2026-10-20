package hub

import (
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// An existing database from before the agent-options columns must gain them
// on open, keep its rows, and round-trip the new fields.
func TestThreadOptionColumnsMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.db")
	old, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = old.Exec(`CREATE TABLE threads (
		id TEXT PRIMARY KEY, title TEXT NOT NULL, device_id TEXT NOT NULL, agent TEXT NOT NULL,
		command TEXT NOT NULL DEFAULT '', cwd TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '',
		access TEXT NOT NULL DEFAULT 'edits', status TEXT NOT NULL DEFAULT 'starting', error TEXT NOT NULL DEFAULT '',
		created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_read_at INTEGER NOT NULL DEFAULT 0,
		terminal TEXT NOT NULL DEFAULT '', pr TEXT NOT NULL DEFAULT '', usage TEXT NOT NULL DEFAULT '',
		automation_id TEXT NOT NULL DEFAULT '', resume_id TEXT NOT NULL DEFAULT '');
		INSERT INTO threads (id, title, device_id, agent, created_at, updated_at) VALUES ('old', 'Old', 'd', 'claude', 1, 1);`)
	if err != nil {
		t.Fatal(err)
	}
	old.Close()

	for round := 0; round < 2; round++ { // reopening must be a no-op
		s, err := OpenStore(path)
		if err != nil {
			t.Fatalf("open %d: %v", round, err)
		}
		th, err := s.ThreadById("old")
		if err != nil || th == nil || th.Title != "Old" || th.Effort != "" || th.Fast || th.Mode != "" ||
			th.Pinned || th.Archived || th.Folder != "" || th.ParentId != "" || th.ForkPending || th.Meta.Capabilities != nil {
			t.Fatalf("migrated row = %+v, %v", th, err)
		}
		s.Close()
	}

	s, _ := OpenStore(path)
	defer s.Close()
	if err := s.CreateThread(&Thread{Id: "new", Title: "N", DeviceId: "d", Agent: "codex", Access: "ask",
		Effort: "high", Fast: true, Mode: "read-only", Status: "idle", CreatedAt: 2, UpdatedAt: 2}); err != nil {
		t.Fatal(err)
	}
	th, _ := s.ThreadById("new")
	if th.Effort != "high" || !th.Fast || th.Mode != "read-only" {
		t.Errorf("round trip = %+v", th)
	}
	effort, fast, mode := "low", false, "auto"
	if err := s.PatchThread("new", threadPatch{Effort: &effort, Fast: &fast, Mode: &mode}); err != nil {
		t.Fatal(err)
	}
	th, _ = s.ThreadById("new")
	if th.Effort != "low" || th.Fast || th.Mode != "auto" {
		t.Errorf("after patch = %+v", th)
	}
}

func TestAgentOptionsEndpoint(t *testing.T) {
	t.Setenv(fakeACPEnv, "1")
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	srv, base := startHub(t)
	token, _ := srv.store.CreateApiToken("options-test")
	api := apiClient{t: t, base: base, token: token}

	// A known but offline device answers with the builtin table.
	offline, _, err := srv.store.CreateDevice("offline", "offline.local", "linux", "amd64", false)
	if err != nil {
		t.Fatal(err)
	}
	var o protocol.AgentOptions
	api.do("GET", "/api/devices/"+offline+"/agents/claude/options", nil, &o)
	if o.Source != "builtin" || o.Agent != "claude" || len(o.Modes) != 5 || o.Fast == nil {
		t.Errorf("offline options = %+v", o)
	}
	if code := api.do("GET", "/api/devices/nope/agents/claude/options", nil, nil); code != http.StatusNotFound {
		t.Errorf("unknown device = %d", code)
	}
	if code := api.do("GET", "/api/devices/"+offline+"/agents/bogus/options", nil, nil); code != http.StatusNotFound {
		t.Errorf("unknown agent = %d", code)
	}

	// An online device runs discovery (the fake ACP agent has no modes, so
	// the single default mode comes back) and the result is cached.
	deviceId := connectAgent(t, srv, base)
	path := "/api/devices/" + deviceId + "/agents/acp/options?command=" + url.QueryEscape(fmt.Sprintf("%q", exe))
	api.do("GET", path, nil, &o)
	if o.Source != "discovered" || o.Agent != "acp" || o.DefaultMode != "default" || o.Models == nil || o.Efforts == nil {
		t.Errorf("discovered options = %+v", o)
	}
	if _, ok := srv.agentOpts.get(agentOptionsKey(deviceId, "acp", fmt.Sprintf("%q", exe))); !ok {
		t.Error("result not cached")
	}
	api.do("GET", path+"&refresh=1", nil, &o)
	if o.Source != "discovered" {
		t.Errorf("refreshed options = %+v", o)
	}

	// A thread created with a mode derives its access from the mode's kind.
	var th Thread
	in := threadInput{DeviceId: offline, Agent: "claude", Prompt: "x", Mode: "plan", Effort: "high", Fast: true}
	if msg := in.validate(srv.agents); msg != "" {
		t.Fatal(msg)
	}
	created, err := srv.createThread(in)
	if err != nil {
		t.Fatal(err)
	}
	if created.Access != "ask" || created.Mode != "plan" || created.Effort != "high" || !created.Fast {
		t.Errorf("created = %+v", created)
	}
	api.do("PATCH", "/api/threads/"+created.Id, map[string]any{"mode": "bypassPermissions"}, &th)
	if th.Access != "full" || th.Mode != "bypassPermissions" {
		t.Errorf("patched = %+v", th)
	}
	th = Thread{}
	api.do("PATCH", "/api/threads/"+created.Id, map[string]any{"mode": "", "access": "edits"}, &th)
	if th.Access != "edits" || th.Mode != "" {
		t.Errorf("cleared mode = %+v", th)
	}
	if code := api.do("PATCH", "/api/threads/"+created.Id, map[string]any{"effort": "--evil"}, nil); code != http.StatusBadRequest {
		t.Errorf("bad effort = %d", code)
	}
}
