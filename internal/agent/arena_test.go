package agent

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// arenaFixture is a user's clone with a base commit and an arena id.
type arenaFixture struct {
	*prepEnv
	a     *Agent
	clone string
	head  string
	id    string
}

func newArenaFixture(t *testing.T) *arenaFixture {
	e := newPrepEnv(t)
	f := &arenaFixture{prepEnv: e, a: &Agent{}, id: "arena-test-1"}
	f.clone = e.userClone(filepath.Join(e.home, "code", "widgets"))
	res, err := f.a.arenaOp(protocol.ArenaRequest{Action: protocol.ArenaInspect, Repo: f.clone})
	if err != nil {
		t.Fatalf("inspect: %v", err)
	}
	f.head = res.Head
	return f
}

func (f *arenaFixture) create(name, agent string) protocol.ArenaResult {
	f.t.Helper()
	res, err := f.a.arenaOp(protocol.ArenaRequest{
		Action: protocol.ArenaCreate, ArenaId: f.id, Repo: f.clone, Commit: f.head, Name: name,
		Branch: "arena/" + f.id + "/" + agent, RemoteKey: "github.com/acme/widgets",
	})
	if err != nil {
		f.t.Fatalf("create %s: %v", name, err)
	}
	return res
}

func (f *arenaFixture) req(action, worktree string) protocol.ArenaRequest {
	return protocol.ArenaRequest{Action: action, ArenaId: f.id, Worktree: worktree, Base: f.head, Repo: f.clone}
}

func TestArenaInspect(t *testing.T) {
	f := newArenaFixture(t)
	res, err := f.a.arenaOp(protocol.ArenaRequest{Action: protocol.ArenaInspect, Repo: f.clone})
	if err != nil || len(res.Head) != 40 || res.Branch != "main" || res.Dirty != 0 || res.RemoteKey != "github.com/acme/widgets" {
		t.Fatalf("inspect = %+v, %v", res, err)
	}
	os.WriteFile(filepath.Join(f.clone, "scratch.txt"), []byte("x"), 0o644)
	res, _ = f.a.arenaOp(protocol.ArenaRequest{Action: protocol.ArenaInspect, Repo: f.clone})
	if res.Dirty != 1 {
		t.Errorf("dirty = %d, want 1", res.Dirty)
	}
	if _, err := f.a.arenaOp(protocol.ArenaRequest{Action: protocol.ArenaInspect, Repo: f.home}); err == nil {
		t.Error("a folder that is not a repo was accepted")
	}
}

func TestArenaCreateIsolatedWorktrees(t *testing.T) {
	f := newArenaFixture(t)
	// Uncommitted work in the user's folder is not in the contestants' copies.
	os.WriteFile(filepath.Join(f.clone, "README.md"), []byte("changed by the user\n"), 0o644)

	one := f.create("1-claude", "claude")
	two := f.create("2-codex", "codex")
	wantDir := filepath.Join(f.home, ".overseer", "worktrees", "arena", f.id)
	if filepath.Dir(one.Path) != canonPath(wantDir) || filepath.Base(two.Path) != "2-codex" {
		t.Fatalf("paths: %q %q (want under %q)", one.Path, two.Path, wantDir)
	}
	body, _ := os.ReadFile(filepath.Join(one.Path, "README.md"))
	if string(body) != "hello\n" {
		t.Errorf("worktree has the user's uncommitted edit: %q", body)
	}
	if got := f.git(one.Path, "rev-parse", "HEAD"); got != f.head {
		t.Errorf("worktree head %s, want %s", got, f.head)
	}
	if got := f.branchOf(two.Path); got != "arena/"+f.id+"/codex" {
		t.Errorf("branch = %s", got)
	}
	// The user's folder: same branch, same commit, edit untouched.
	if got := f.branchOf(f.clone); got != "main" {
		t.Errorf("user's folder moved to %s", got)
	}
	body, _ = os.ReadFile(filepath.Join(f.clone, "README.md"))
	if string(body) != "changed by the user\n" {
		t.Errorf("user's file was touched: %q", body)
	}

	// Refusals: wrong repo, bad names, a branch outside the arena, a taken folder.
	bad := []protocol.ArenaRequest{
		{Action: protocol.ArenaCreate, ArenaId: f.id, Repo: f.clone, Commit: f.head, Name: "3-x", Branch: "arena/" + f.id + "/x", RemoteKey: "github.com/other/repo"},
		{Action: protocol.ArenaCreate, ArenaId: f.id, Repo: f.clone, Commit: f.head, Name: "../escape", Branch: "arena/" + f.id + "/x"},
		{Action: protocol.ArenaCreate, ArenaId: f.id, Repo: f.clone, Commit: f.head, Name: "3-x", Branch: "main"},
		{Action: protocol.ArenaCreate, ArenaId: f.id, Repo: f.clone, Commit: "--output=/tmp/x", Name: "3-x", Branch: "arena/" + f.id + "/x"},
		{Action: protocol.ArenaCreate, ArenaId: f.id, Repo: f.clone, Commit: f.head, Name: "1-claude", Branch: "arena/" + f.id + "/again"},
		{Action: protocol.ArenaCreate, ArenaId: f.id, Repo: f.clone, Commit: strings.Repeat("a", 40), Name: "3-x", Branch: "arena/" + f.id + "/x"},
	}
	for i, req := range bad {
		if _, err := f.a.arenaOp(req); err == nil {
			t.Errorf("bad request %d was accepted", i)
		}
	}
}

func TestArenaStatsCountsUntrackedAndLeavesIndexAlone(t *testing.T) {
	f := newArenaFixture(t)
	wt := f.create("1-claude", "claude").Path
	os.WriteFile(filepath.Join(wt, "README.md"), []byte("hello\nworld\nmore\n"), 0o644)    // +2
	os.WriteFile(filepath.Join(wt, "new.go"), []byte("package x\n\nfunc A() {}\n"), 0o644) // +3, untracked
	before := f.git(wt, "status", "--porcelain")

	res, err := f.a.arenaOp(f.req(protocol.ArenaStats, wt))
	if err != nil {
		t.Fatal(err)
	}
	if res.Files != 2 || res.Additions != 5 || res.Deletions != 0 || len(res.Changed) != 2 {
		t.Errorf("stats = %+v", res)
	}
	if after := f.git(wt, "status", "--porcelain"); after != before {
		t.Errorf("stats changed the worktree's index:\n%s\n--\n%s", before, after)
	}
	// A worktree path from somewhere else is refused.
	other := filepath.Join(f.home, "elsewhere")
	os.MkdirAll(other, 0o755)
	if _, err := f.a.arenaOp(f.req(protocol.ArenaStats, other)); err == nil {
		t.Error("stats ran outside the arena folder")
	}
}

func TestArenaCheckReportsExitCodeAndOutput(t *testing.T) {
	f := newArenaFixture(t)
	wt := f.create("1-claude", "claude").Path
	req := f.req(protocol.ArenaCheck, wt)
	req.Command = "cat README.md && echo ok"
	res, err := f.a.arenaOp(req)
	if err != nil || res.ExitCode != 0 || !strings.Contains(res.Output, "hello") || !strings.Contains(res.Output, "ok") {
		t.Fatalf("pass: %+v, %v", res, err)
	}
	req.Command = "echo boom >&2; exit 3"
	res, err = f.a.arenaOp(req)
	if err != nil || res.ExitCode != 3 || !strings.Contains(res.Output, "boom") {
		t.Fatalf("fail: %+v, %v", res, err)
	}
	// It runs in the worktree, not in the user's folder.
	req.Command = "pwd"
	res, _ = f.a.arenaOp(req)
	if !strings.Contains(res.Output, "1-claude") {
		t.Errorf("check ran in %q", res.Output)
	}
}

func TestArenaApplyNeedsACleanFolder(t *testing.T) {
	f := newArenaFixture(t)
	wt := f.create("1-claude", "claude").Path
	os.WriteFile(filepath.Join(wt, "README.md"), []byte("hello\nfrom the winner\n"), 0o644)
	os.WriteFile(filepath.Join(wt, "added.txt"), []byte("new file\n"), 0o644)

	// A dirty folder is refused and left exactly as it was.
	os.WriteFile(filepath.Join(f.clone, "mine.txt"), []byte("wip"), 0o644)
	if res, err := f.a.arenaOp(f.req(protocol.ArenaApply, wt)); err == nil || res.Dirty != 1 || !strings.Contains(err.Error(), "uncommitted") {
		t.Fatalf("dirty apply: %+v, %v", res, err)
	}
	body, _ := os.ReadFile(filepath.Join(f.clone, "README.md"))
	if string(body) != "hello\n" {
		t.Errorf("README changed in a refused apply: %q", body)
	}
	os.Remove(filepath.Join(f.clone, "mine.txt"))

	res, err := f.a.arenaOp(f.req(protocol.ArenaApply, wt))
	if err != nil {
		t.Fatal(err)
	}
	if res.Files != 1 && res.Files != 2 { // the new file is untracked, so only README shows in `git diff HEAD`
		t.Errorf("apply files = %d", res.Files)
	}
	body, _ = os.ReadFile(filepath.Join(f.clone, "README.md"))
	if string(body) != "hello\nfrom the winner\n" {
		t.Errorf("README = %q", body)
	}
	if body, _ := os.ReadFile(filepath.Join(f.clone, "added.txt")); string(body) != "new file\n" {
		t.Errorf("added.txt = %q", body)
	}
	// Applied as uncommitted work: same commit, same branch.
	if f.git(f.clone, "rev-parse", "HEAD") != f.head || f.branchOf(f.clone) != "main" {
		t.Error("apply moved the user's branch")
	}
}

func TestArenaPatchAndPRPush(t *testing.T) {
	f := newArenaFixture(t)
	wt := f.create("1-claude", "claude").Path
	branch := "arena/" + f.id + "/claude"
	os.WriteFile(filepath.Join(wt, "feature.txt"), []byte("done\n"), 0o644)

	// No gh in the fixture: the branch is pushed, and the error says so.
	req := f.req(protocol.ArenaPR, wt)
	req.Branch, req.Title = branch, "Add the feature"
	_, err := f.a.arenaOp(req)
	if err == nil || !strings.Contains(err.Error(), "pushed "+branch) {
		t.Fatalf("pr without gh: %v", err)
	}
	if got := f.git(f.origin, "log", "-1", "--format=%s", branch); got != "Add the feature" {
		t.Errorf("remote branch tip = %q", got)
	}

	req = f.req(protocol.ArenaPatch, wt)
	res, err := f.a.arenaOp(req)
	if err != nil || !strings.Contains(res.Patch, "feature.txt") || !strings.Contains(res.Patch, "+done") {
		t.Fatalf("patch: %q, %v", res.Patch, err)
	}

}

func TestArenaRemoveStaysInsideTheArena(t *testing.T) {
	f := newArenaFixture(t)
	one := f.create("1-claude", "claude").Path
	two := f.create("2-codex", "codex").Path
	keep := filepath.Join(f.home, "code", "precious")
	os.MkdirAll(keep, 0o755)
	os.WriteFile(filepath.Join(keep, "file"), []byte("x"), 0o644)

	// Folders outside the arena (or the user's own checkout) are refused.
	for _, bad := range []string{keep, f.clone, filepath.Join(filepath.Dir(one), "..", "1-claude"), filepath.Dir(one)} {
		req := f.req(protocol.ArenaRemove, bad)
		req.Branch = "arena/" + f.id + "/claude"
		if _, err := f.a.arenaOp(req); err == nil {
			t.Errorf("remove accepted %q", bad)
		}
	}
	// A branch outside the arena's namespace is refused.
	req := f.req(protocol.ArenaRemove, one)
	req.Branch = "main"
	if _, err := f.a.arenaOp(req); err == nil {
		t.Error("remove accepted branch main")
	}
	if !dirExists(one) || !dirExists(keep) || !dirExists(f.clone) {
		t.Fatal("a refused remove deleted something")
	}

	req = f.req(protocol.ArenaRemove, one)
	req.Branch = "arena/" + f.id + "/claude"
	if _, err := f.a.arenaOp(req); err != nil {
		t.Fatal(err)
	}
	if dirExists(one) || !dirExists(two) {
		t.Errorf("remove: one exists=%v two exists=%v", dirExists(one), dirExists(two))
	}
	if refExistsT(f, "refs/heads/arena/"+f.id+"/claude") {
		t.Error("branch survived")
	}
	if !refExistsT(f, "refs/heads/arena/"+f.id+"/codex") {
		t.Error("the other branch was removed")
	}
	// Removing again is not an error (cleanup can be retried).
	if _, err := f.a.arenaOp(req); err != nil {
		t.Errorf("second remove: %v", err)
	}
	req = f.req(protocol.ArenaRemove, two)
	req.Branch = "arena/" + f.id + "/codex"
	if _, err := f.a.arenaOp(req); err != nil {
		t.Fatal(err)
	}
	if pathExists(filepath.Join(f.home, ".overseer", "worktrees", "arena", f.id)) {
		t.Error("the empty arena folder was left behind")
	}
	if body, _ := os.ReadFile(filepath.Join(keep, "file")); string(body) != "x" {
		t.Error("a file outside the arena changed")
	}
	// The user's checkout is exactly as it was.
	if f.branchOf(f.clone) != "main" || f.git(f.clone, "status", "--porcelain") != "" {
		t.Error("the user's checkout changed")
	}
}

func refExistsT(f *arenaFixture, ref string) bool {
	return f.git(f.clone, "for-each-ref", ref) != ""
}
