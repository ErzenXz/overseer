package agent

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// prepEnv is a fake home, a fake "GitHub" (a bare repo in a temp folder that
// https://github.com/ is rewritten to) and no gh, so nothing leaves the disk.
type prepEnv struct {
	t      *testing.T
	home   string
	origin string // bare repo acme/widgets
	seed   string // work tree used to push to origin
}

func newPrepEnv(t *testing.T) *prepEnv {
	t.Helper()
	tmp := canonPath(t.TempDir())
	e := &prepEnv{t: t, home: filepath.Join(tmp, "home"), origin: filepath.Join(tmp, "github", "acme", "widgets.git"), seed: filepath.Join(tmp, "seed")}
	os.MkdirAll(e.home, 0o755)
	cfg := filepath.Join(tmp, "gitconfig")
	os.WriteFile(cfg, []byte("[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n[url \""+filepath.Join(tmp, "github")+"/\"]\n\tinsteadOf = https://github.com/\n"), 0o644)
	t.Setenv("GIT_CONFIG_GLOBAL", cfg)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	t.Setenv("HOME", e.home)
	t.Setenv("USERPROFILE", e.home)
	oldGh := ghLookup
	ghLookup = func() string { return "" }
	t.Cleanup(func() { ghLookup = oldGh })

	os.MkdirAll(e.origin, 0o755)
	e.git(e.origin, "init", "--bare", "-q")
	os.MkdirAll(e.seed, 0o755)
	e.git(e.seed, "init", "-q")
	e.git(e.seed, "remote", "add", "origin", e.origin)
	e.commit("README.md", "hello\n", "first")
	e.git(e.seed, "branch", "feature/x")
	e.git(e.seed, "branch", "other")
	e.git(e.seed, "push", "-q", "origin", "main", "feature/x", "other")
	return e
}

func (e *prepEnv) git(dir string, args ...string) string {
	e.t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		e.t.Fatalf("git %v in %s: %v\n%s", args, dir, err, out)
	}
	return strings.TrimSpace(string(out))
}

// commit adds a commit to the seed's current branch.
func (e *prepEnv) commit(file, body, msg string) {
	e.t.Helper()
	os.WriteFile(filepath.Join(e.seed, file), []byte(body), 0o644)
	e.git(e.seed, "add", file)
	e.git(e.seed, "commit", "-q", "-m", msg)
}

// userClone makes the clone a person already has, at path.
func (e *prepEnv) userClone(path string) string {
	e.t.Helper()
	os.MkdirAll(filepath.Dir(path), 0o755)
	e.git(filepath.Dir(path), "clone", "-q", "https://github.com/acme/widgets", path)
	return path
}

func (e *prepEnv) prepare(branch string, mutate ...func(*protocol.GitPrepareRequest)) (protocol.GitPrepareResult, error) {
	req := protocol.GitPrepareRequest{Repo: "acme/widgets", Branch: branch}
	for _, m := range mutate {
		m(&req)
	}
	return prepareCheckout(context.Background(), req)
}

func (e *prepEnv) mustPrepare(branch string, mutate ...func(*protocol.GitPrepareRequest)) protocol.GitPrepareResult {
	e.t.Helper()
	res, err := e.prepare(branch, mutate...)
	if err != nil {
		e.t.Fatalf("prepare %s: %v", branch, err)
	}
	return res
}

func (e *prepEnv) branchOf(dir string) string {
	return e.git(dir, "rev-parse", "--abbrev-ref", "HEAD")
}

func TestPrepareClonesWhenMissing(t *testing.T) {
	e := newPrepEnv(t)
	planned := e.mustPrepare("feature/x", func(r *protocol.GitPrepareRequest) { r.Plan = true })
	want := filepath.Join(e.home, "code", "widgets")
	if planned.Action != protocol.PrepareClone || planned.Path != want {
		t.Fatalf("plan = %+v, want clone at %s", planned, want)
	}
	if pathExists(want) {
		t.Fatal("plan created the folder")
	}

	res := e.mustPrepare("feature/x")
	if res.Action != protocol.PrepareClone || res.Path != want || res.Branch != "feature/x" {
		t.Fatalf("result = %+v", res)
	}
	if got := e.branchOf(want); got != "feature/x" {
		t.Errorf("clone is on %q", got)
	}
	if got := e.git(want, "rev-parse", "--abbrev-ref", "feature/x@{upstream}"); got != "origin/feature/x" {
		t.Errorf("upstream = %q", got)
	}

	// Asking again finds the clone it made and uses it.
	again := e.mustPrepare("feature/x")
	if again.Action != protocol.PrepareReuse || again.Path != want {
		t.Errorf("second prepare = %+v", again)
	}
}

func TestPrepareClonesIntoTheUsersCodeFolder(t *testing.T) {
	e := newPrepEnv(t)
	// ~/Projects already holds repos; ~/code does not exist.
	for _, name := range []string{"a", "b"} {
		os.MkdirAll(filepath.Join(e.home, "Projects", name, ".git"), 0o755)
	}
	res := e.mustPrepare("main")
	if want := filepath.Join(e.home, "Projects", "widgets"); res.Path != want {
		t.Errorf("cloned to %s, want %s", res.Path, want)
	}
}

func TestPrepareCloneNameTaken(t *testing.T) {
	e := newPrepEnv(t)
	os.MkdirAll(filepath.Join(e.home, "code", "widgets"), 0o755)
	os.WriteFile(filepath.Join(e.home, "code", "widgets", "mine.txt"), []byte("x"), 0o644)
	res := e.mustPrepare("main")
	if want := filepath.Join(e.home, "code", "acme-widgets"); res.Path != want {
		t.Errorf("cloned to %s, want %s", res.Path, want)
	}
	if _, err := os.Stat(filepath.Join(e.home, "code", "widgets", "mine.txt")); err != nil {
		t.Error("the other folder was touched")
	}
}

func TestPrepareExplicitCloneDir(t *testing.T) {
	e := newPrepEnv(t)
	dir := filepath.Join(canonPath(t.TempDir()), "here")
	res := e.mustPrepare("other", func(r *protocol.GitPrepareRequest) { r.Dir = dir })
	if res.Path != dir || e.branchOf(dir) != "other" {
		t.Errorf("result = %+v", res)
	}
	if pathExists(filepath.Join(e.home, "code")) {
		t.Error("used the default folder")
	}
}

func TestPrepareReusesCloneAlreadyOnTheBranch(t *testing.T) {
	e := newPrepEnv(t)
	clone := e.userClone(filepath.Join(e.home, "code", "widgets"))
	// Uncommitted work is fine when nothing has to move.
	os.WriteFile(filepath.Join(clone, "wip.txt"), []byte("wip"), 0o644)
	res := e.mustPrepare("main")
	if res.Action != protocol.PrepareReuse || res.Path != clone {
		t.Fatalf("result = %+v, want reuse of %s", res, clone)
	}
}

func TestPrepareUsesWorktreeForDirtyClone(t *testing.T) {
	e := newPrepEnv(t)
	clone := e.userClone(filepath.Join(e.home, "code", "widgets"))
	os.WriteFile(filepath.Join(clone, "README.md"), []byte("changed by hand\n"), 0o644)
	os.WriteFile(filepath.Join(clone, "wip.txt"), []byte("untracked\n"), 0o644)

	res := e.mustPrepare("feature/x")
	want := filepath.Join(e.home, ".overseer", "worktrees", "acme-widgets", "feature-x")
	if res.Action != protocol.PrepareWorktree || res.Path != want || res.Source != clone {
		t.Fatalf("result = %+v, want worktree at %s", res, want)
	}
	if got := e.branchOf(want); got != "feature/x" {
		t.Errorf("worktree is on %q", got)
	}
	// The user's checkout is exactly as it was.
	if got := e.branchOf(clone); got != "main" {
		t.Errorf("clone moved to %q", got)
	}
	if b, _ := os.ReadFile(filepath.Join(clone, "README.md")); string(b) != "changed by hand\n" {
		t.Errorf("README changed: %q", b)
	}
	if _, err := os.Stat(filepath.Join(clone, "wip.txt")); err != nil {
		t.Error("untracked file is gone")
	}

	again := e.mustPrepare("feature/x")
	if again.Action != protocol.PrepareReuse || again.Path != want {
		t.Errorf("second prepare = %+v", again)
	}
}

func TestPrepareUsesWorktreeForCleanCloneOnOtherBranch(t *testing.T) {
	e := newPrepEnv(t)
	clone := e.userClone(filepath.Join(e.home, "src", "widgets"))
	res := e.mustPrepare("other")
	if res.Action != protocol.PrepareWorktree {
		t.Fatalf("result = %+v", res)
	}
	if got := e.branchOf(clone); got != "main" {
		t.Errorf("a clean clone was still moved to %q", got)
	}
	if got := e.branchOf(res.Path); got != "other" {
		t.Errorf("worktree is on %q", got)
	}
}

func TestPrepareFindsCloneInKnownFolder(t *testing.T) {
	e := newPrepEnv(t)
	elsewhere := e.userClone(filepath.Join(canonPath(t.TempDir()), "odd", "place"))
	sub := filepath.Join(elsewhere, "sub")
	os.MkdirAll(sub, 0o755)
	// The caller knows a folder inside the clone; the clone is what counts.
	res := e.mustPrepare("main", func(r *protocol.GitPrepareRequest) { r.Known = []string{sub} })
	if res.Action != protocol.PrepareReuse || res.Path != elsewhere {
		t.Errorf("result = %+v, want reuse of %s", res, elsewhere)
	}
	if pathExists(filepath.Join(e.home, "code")) {
		t.Error("cloned again")
	}
}

func TestPrepareFastForwardsOldLocalBranch(t *testing.T) {
	e := newPrepEnv(t)
	clone := e.userClone(filepath.Join(e.home, "code", "widgets"))
	e.git(clone, "branch", "feature/x", "origin/feature/x") // local copy, soon behind
	e.git(e.seed, "checkout", "-q", "feature/x")
	e.commit("x.txt", "new\n", "on feature")
	e.git(e.seed, "push", "-q", "origin", "feature/x")

	res := e.mustPrepare("feature/x")
	if res.Action != protocol.PrepareWorktree || res.Note != "" {
		t.Fatalf("result = %+v", res)
	}
	if _, err := os.Stat(filepath.Join(res.Path, "x.txt")); err != nil {
		t.Error("worktree does not have the new commit")
	}
}

func TestPrepareLeavesDivergedLocalBranchAlone(t *testing.T) {
	e := newPrepEnv(t)
	clone := e.userClone(filepath.Join(e.home, "code", "widgets"))
	e.git(clone, "branch", "feature/x", "origin/feature/x")
	e.git(clone, "checkout", "-q", "feature/x")
	os.WriteFile(filepath.Join(clone, "mine.txt"), []byte("local\n"), 0o644)
	e.git(clone, "add", "mine.txt")
	e.git(clone, "commit", "-q", "-m", "local only")
	e.git(clone, "checkout", "-q", "main")
	e.git(e.seed, "checkout", "-q", "feature/x")
	e.commit("theirs.txt", "remote\n", "remote only")
	e.git(e.seed, "push", "-q", "origin", "feature/x")

	res := e.mustPrepare("feature/x")
	if res.Note == "" {
		t.Error("expected a note about the diverged branch")
	}
	if _, err := os.Stat(filepath.Join(res.Path, "mine.txt")); err != nil {
		t.Error("local commit lost")
	}
}

func TestPrepareMissingBranch(t *testing.T) {
	e := newPrepEnv(t)
	_, err := e.prepare("nope")
	if err == nil || !strings.Contains(err.Error(), "Branch nope was not found on GitHub") {
		t.Fatalf("clone: err = %v", err)
	}
	if pathExists(filepath.Join(e.home, "code", "widgets")) {
		t.Error("half-made clone left behind")
	}

	e.userClone(filepath.Join(e.home, "code", "widgets"))
	_, err = e.prepare("nope")
	if err == nil || !strings.Contains(err.Error(), "was not found on GitHub") {
		t.Fatalf("worktree: err = %v", err)
	}
}

func TestPrepareMissingRepo(t *testing.T) {
	e := newPrepEnv(t)
	_, err := prepareCheckout(context.Background(), protocol.GitPrepareRequest{Repo: "acme/gone", Branch: "main"})
	if err == nil || !strings.Contains(err.Error(), "acme/gone was not found") {
		t.Fatalf("err = %v", err)
	}
	if pathExists(filepath.Join(e.home, "code", "gone")) {
		t.Error("half-made clone left behind")
	}
}

func TestPrepareCancelled(t *testing.T) {
	e := newPrepEnv(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := prepareCheckout(ctx, protocol.GitPrepareRequest{Repo: "acme/widgets", Branch: "main"}); err == nil {
		t.Fatal("expected an error")
	}
	if pathExists(filepath.Join(e.home, "code", "widgets")) {
		t.Error("cancelled clone left behind")
	}
}

func TestPrepareRejectsBadInput(t *testing.T) {
	newPrepEnv(t)
	for _, req := range []protocol.GitPrepareRequest{
		{Repo: "nope", Branch: "main"},
		{Repo: "-x/y", Branch: "main"},
		{Repo: "a/b c", Branch: "main"},
		{Repo: "a/b", Branch: "--upload-pack=evil"},
		{Repo: "a/b", Branch: "x y"},
		{Repo: "a/b", Branch: ""},
	} {
		if _, err := prepareCheckout(context.Background(), req); err == nil {
			t.Errorf("%+v was accepted", req)
		}
	}
}

func TestBranchSlug(t *testing.T) {
	for in, want := range map[string]string{
		"feature/x":              "feature-x",
		"fix/a/b":                "fix-a-b",
		"release-1.4":            "release-1.4",
		"weird:name?":            "weird-name",
		"/..":                    "branch",
		strings.Repeat("a", 100): strings.Repeat("a", 80),
	} {
		if got := branchSlug(in); got != want {
			t.Errorf("branchSlug(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestExplainWordsCommonFailures(t *testing.T) {
	for out, want := range map[string]string{
		"fatal: Remote branch zzz not found in upstream origin":                              "Branch x was not found on GitHub.",
		"error: No space left on device":                                                     "out of disk space",
		"To get started with GitHub CLI, please run:  gh auth login":                         "not signed in to GitHub",
		"fatal: could not read Username for 'https://github.com': terminal prompts disabled": "not signed in to GitHub",
		"remote: Repository not found.":                                                      "acme/widgets was not found, or this machine's GitHub account has no access",
		"fatal: unable to access 'https://github.com/': Could not resolve host":              "could not reach GitHub",
	} {
		if got := explain(out, "acme/widgets", "x", os.ErrInvalid).Error(); !strings.Contains(got, want) {
			t.Errorf("explain(%q) = %q, want it to contain %q", out, got, want)
		}
	}
}

// With gh signed in, "not found" from gh is the answer: plain git has no
// better credentials, so it is not tried and the message says so.
func TestPrepareGhNotFoundIsFinal(t *testing.T) {
	e := newPrepEnv(t)
	bin := t.TempDir()
	stub := filepath.Join(bin, "gh")
	os.WriteFile(stub, []byte("#!/bin/sh\necho 'GraphQL: Could not resolve to a Repository with the name x.' >&2\nexit 1\n"), 0o755)
	ghLookup = func() string { return stub }
	// acme/widgets exists for plain git, so a fallback would have succeeded.
	_, err := e.prepare("main")
	if err == nil || !strings.Contains(err.Error(), "acme/widgets was not found, or this machine's GitHub account has no access") {
		t.Fatalf("err = %v", err)
	}
	if pathExists(filepath.Join(e.home, "code", "widgets")) {
		t.Error("clone left behind")
	}
}
