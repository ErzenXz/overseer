package hub

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func arenaGitCmd(t *testing.T, dir string, args ...string) string {
	t.Helper()
	out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

// An arena end to end on one machine: worktrees, sessions, the check command,
// the scoreboard numbers, applying the winner, and cleaning up. The agents are
// the fake ACP agent, so nothing leaves the machine.
func TestArenaEndToEnd(t *testing.T) {
	t.Setenv(fakeACPEnv, "1")
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	tmp, _ := filepath.EvalSymlinks(t.TempDir())
	home := filepath.Join(tmp, "home")
	os.MkdirAll(home, 0o755)
	cfg := filepath.Join(tmp, "gitconfig")
	os.WriteFile(cfg, []byte("[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n"), 0o644)
	t.Setenv("GIT_CONFIG_GLOBAL", cfg)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)

	repo := filepath.Join(home, "code", "widgets")
	os.MkdirAll(repo, 0o755)
	arenaGitCmd(t, repo, "init", "-q")
	os.WriteFile(filepath.Join(repo, "README.md"), []byte("hello\n"), 0o644)
	arenaGitCmd(t, repo, "add", ".")
	arenaGitCmd(t, repo, "commit", "-q", "-m", "first")
	head := arenaGitCmd(t, repo, "rev-parse", "HEAD")
	// Uncommitted work that must not reach the contestants.
	os.WriteFile(filepath.Join(repo, "README.md"), []byte("hello, edited\n"), 0o644)

	srv, base := startHub(t)
	deviceId := connectAgent(t, srv, base)
	token, _ := srv.store.CreateApiToken("arena-test")
	api := apiClient{t: t, base: base, token: token}

	var custom CatalogAgent
	api.do("POST", "/api/agents/custom", map[string]string{"name": "Fake", "command": fmt.Sprintf("%q", exe)}, &custom)

	// Bad requests.
	good := map[string]any{
		"prompt": "add a feature", "deviceId": deviceId, "cwd": repo, "check": "test -f feature.txt",
		"contestants": []map[string]any{{"agent": custom.Id}, {"agent": custom.Id}},
	}
	with := func(k string, v any) map[string]any {
		m := map[string]any{}
		for kk, vv := range good {
			m[kk] = vv
		}
		m[k] = v
		return m
	}
	for name, body := range map[string]map[string]any{
		"one contestant": with("contestants", []map[string]any{{"agent": custom.Id}}),
		"five":           with("contestants", []map[string]any{{"agent": custom.Id}, {"agent": custom.Id}, {"agent": custom.Id}, {"agent": custom.Id}, {"agent": custom.Id}}),
		"unknown agent":  with("contestants", []map[string]any{{"agent": custom.Id}, {"agent": "nope"}}),
		"no prompt":      with("prompt", " "),
		"not a repo":     with("cwd", home),
		"bad access":     with("access", "root"),
		"acp":            with("contestants", []map[string]any{{"agent": custom.Id}, {"agent": "acp"}}),
	} {
		if code := api.do("POST", "/api/arenas", body, nil); code != http.StatusBadRequest {
			t.Errorf("%s: %d, want 400", name, code)
		}
	}

	var arena Arena
	api.do("POST", "/api/arenas", good, &arena)
	if arena.BaseCommit != head || len(arena.Contestants) != 2 || arena.DirtyAtStart != 1 || arena.Title != "add a feature" {
		t.Fatalf("created = %+v", arena)
	}
	wait := func(what string, ok func(*Arena) bool) *Arena {
		t.Helper()
		deadline := time.Now().Add(60 * time.Second)
		var a Arena
		for time.Now().Before(deadline) {
			a = Arena{}
			api.do("GET", "/api/arenas/"+arena.Id, nil, &a)
			// The fake agent asks before it "edits": allow it.
			for _, c := range a.Contestants {
				if c.ThreadId == "" || c.State != arenaRunning {
					continue
				}
				var detail struct {
					Messages []ThreadMessage `json:"messages"`
				}
				api.do("GET", "/api/threads/"+c.ThreadId, nil, &detail)
				for _, m := range detail.Messages {
					if m.Role == "approval" && m.Approval != nil && m.Approval.Resolved == "" {
						api.do("POST", "/api/threads/"+c.ThreadId+"/approval", map[string]string{"approvalId": m.Approval.Id, "optionId": "ok"}, nil)
					}
				}
			}
			if ok(&a) {
				return &a
			}
			time.Sleep(150 * time.Millisecond)
		}
		t.Fatalf("timed out waiting for %s: %+v", what, a)
		return nil
	}

	started := wait("both running", func(a *Arena) bool {
		for _, c := range a.Contestants {
			if c.Worktree == "" {
				return false
			}
		}
		return true
	})
	wantBase := filepath.Join(home, ".overseer", "worktrees", "arena", arena.Id)
	for i, c := range started.Contestants {
		if filepath.Dir(c.Worktree) != wantBase || !strings.HasPrefix(c.Branch, "arena/"+arena.Id+"/") {
			t.Errorf("contestant %d: %q %q", i, c.Worktree, c.Branch)
		}
		body, _ := os.ReadFile(filepath.Join(c.Worktree, "README.md"))
		if string(body) != "hello\n" {
			t.Errorf("contestant %d sees the user's uncommitted edit: %q", i, body)
		}
		if c.Thread == nil || c.Thread.Cwd != c.Worktree || c.Thread.Folder != arenaFolder {
			t.Errorf("contestant %d thread = %+v", i, c.Thread)
		}
	}
	if started.Contestants[0].Branch == started.Contestants[1].Branch {
		t.Error("two contestants share a branch")
	}
	// Contestant 1 "does the work"; contestant 2 does not.
	one, two := started.Contestants[0], started.Contestants[1]
	os.WriteFile(filepath.Join(one.Worktree, "feature.txt"), []byte("a\nb\nc\n"), 0o644)

	done := wait("finished", func(a *Arena) bool { return a.Status == "finished" })
	c1, c2 := done.Contestants[0], done.Contestants[1]
	if c1.State != arenaDone || c2.State != arenaDone {
		t.Fatalf("states = %s %s (%s %s)", c1.State, c2.State, c1.Error, c2.Error)
	}
	if c1.Stats == nil || c1.Stats.Files != 1 || c1.Stats.Additions != 3 || c2.Stats == nil || c2.Stats.Files != 0 {
		t.Errorf("stats = %+v / %+v", c1.Stats, c2.Stats)
	}
	if c1.Check == nil || c1.Check.ExitCode != 0 || c2.Check == nil || c2.Check.ExitCode == 0 {
		t.Errorf("checks = %+v / %+v", c1.Check, c2.Check)
	}
	if c1.FinishedAt < c1.StartedAt || done.FinishedAt == 0 {
		t.Errorf("times: %d..%d, arena %d", c1.StartedAt, c1.FinishedAt, done.FinishedAt)
	}

	// Cleanup needs a winner and a confirmation; a failing contestant cannot win.
	if code := api.do("POST", "/api/arenas/"+arena.Id+"/cleanup", map[string]any{"confirm": true}, nil); code != http.StatusConflict {
		t.Errorf("cleanup before a winner: %d", code)
	}
	if code := api.do("POST", "/api/arenas/"+arena.Id+"/winner", map[string]any{"contestant": 9, "action": "keep"}, nil); code != http.StatusBadRequest {
		t.Errorf("unknown winner: %d", code)
	}

	// The folder has uncommitted changes: apply is refused and nothing moves.
	if code := api.do("POST", "/api/arenas/"+arena.Id+"/winner", map[string]any{"contestant": 1, "action": "apply"}, nil); code != http.StatusConflict {
		t.Errorf("dirty apply: %d, want 409", code)
	}
	if _, err := os.Stat(filepath.Join(repo, "feature.txt")); err == nil {
		t.Error("a refused apply wrote a file")
	}

	// Patch download.
	resp, err := httpGetAuth(base+fmt.Sprintf("/api/arenas/%s/patch?contestant=1", arena.Id), token)
	if err != nil || !strings.Contains(resp, "feature.txt") || !strings.Contains(resp, "+a") {
		t.Errorf("patch = %q, %v", resp, err)
	}

	// Put the folder back to clean, then apply.
	arenaGitCmd(t, repo, "checkout", "-q", "--", "README.md")
	var won Arena
	api.do("POST", "/api/arenas/"+arena.Id+"/winner", map[string]any{"contestant": 1, "action": "apply"}, &won)
	if won.Winner != 1 || won.Outcome != "applied" {
		t.Errorf("won = %+v", won)
	}
	if body, _ := os.ReadFile(filepath.Join(repo, "feature.txt")); string(body) != "a\nb\nc\n" {
		t.Errorf("applied file = %q", body)
	}
	if arenaGitCmd(t, repo, "rev-parse", "HEAD") != head {
		t.Error("apply moved HEAD")
	}

	// Clean up: confirmation required; the winner's copy stays.
	if code := api.do("POST", "/api/arenas/"+arena.Id+"/cleanup", map[string]any{}, nil); code != http.StatusBadRequest {
		t.Errorf("cleanup without confirm: %d", code)
	}
	var cleaned Arena
	api.do("POST", "/api/arenas/"+arena.Id+"/cleanup", map[string]any{"confirm": true}, &cleaned)
	if !cleaned.Contestants[1].Removed || cleaned.Contestants[0].Removed || !cleaned.Cleaned {
		t.Errorf("cleanup = %+v", cleaned.Contestants)
	}
	if _, err := os.Stat(two.Worktree); err == nil {
		t.Error("the loser's worktree is still there")
	}
	if _, err := os.Stat(one.Worktree); err != nil {
		t.Error("the winner's worktree was removed")
	}
	if got := arenaGitCmd(t, repo, "branch", "--list", two.Branch); got != "" {
		t.Errorf("the loser's branch is still there: %q", got)
	}
	// Now that it is applied, the winner's copy can go too.
	api.do("POST", "/api/arenas/"+arena.Id+"/cleanup", map[string]any{"confirm": true, "includeWinner": true}, &cleaned)
	if _, err := os.Stat(one.Worktree); err == nil {
		t.Error("the winner's worktree is still there after includeWinner")
	}
	if body, _ := os.ReadFile(filepath.Join(repo, "feature.txt")); string(body) != "a\nb\nc\n" {
		t.Error("cleanup touched the user's folder")
	}

	var list []Arena
	api.do("GET", "/api/arenas", nil, &list)
	if len(list) != 1 || list[0].Id != arena.Id {
		t.Errorf("list = %+v", list)
	}
	api.do("DELETE", "/api/arenas/"+arena.Id, nil, &map[string]bool{})
	if code := api.do("GET", "/api/arenas/"+arena.Id, nil, nil); code != http.StatusNotFound {
		t.Errorf("deleted arena GET = %d", code)
	}
}

func httpGetAuth(url, token string) (string, error) {
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var sb strings.Builder
	buf := make([]byte, 4096)
	for {
		n, err := resp.Body.Read(buf)
		sb.Write(buf[:n])
		if err != nil {
			break
		}
	}
	if resp.StatusCode != 200 {
		return sb.String(), fmt.Errorf("status %d", resp.StatusCode)
	}
	return sb.String(), nil
}
