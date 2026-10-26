package agent

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// stubGh installs a fake `gh` that records what it was asked and answers like
// GitHub would. Nothing here reaches the network.
type stubGh struct {
	dir string // holds log.txt (one line per call), body.txt, created
}

func newStubGh(t *testing.T) *stubGh {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("the stub gh is a shell script")
	}
	dir := t.TempDir()
	script := `#!/bin/sh
printf '%s\n' "$*" >> "` + dir + `/log.txt"
case "$1 $2" in
"pr list")
	if [ -f "` + dir + `/created" ]; then echo '[{"number":42,"url":"https://github.com/acme/widgets/pull/42"}]'; else echo '[]'; fi ;;
"pr create")
	cat > "` + dir + `/body.txt"
	touch "` + dir + `/created"
	echo "https://github.com/acme/widgets/pull/42" ;;
*) echo "unexpected: $*" >&2; exit 1 ;;
esac
`
	path := filepath.Join(dir, "gh")
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	old := ghLookup
	ghLookup = func() string { return path }
	t.Cleanup(func() { ghLookup = old })
	return &stubGh{dir: dir}
}

func (g *stubGh) log() string {
	b, _ := os.ReadFile(filepath.Join(g.dir, "log.txt"))
	return string(b)
}

func (g *stubGh) body() string {
	b, _ := os.ReadFile(filepath.Join(g.dir, "body.txt"))
	return string(b)
}

func TestPrepareNewBranchFromBase(t *testing.T) {
	e := newPrepEnv(t)
	clone := e.userClone(filepath.Join(e.home, "code", "widgets"))
	planned := e.mustPrepare("overseer/issue-7-fix", func(r *protocol.GitPrepareRequest) { r.CreateFrom = "main"; r.Plan = true })
	if planned.Action != protocol.PrepareWorktree {
		t.Fatalf("plan = %+v", planned)
	}

	res := e.mustPrepare("overseer/issue-7-fix", func(r *protocol.GitPrepareRequest) { r.CreateFrom = "main" })
	if res.Action != protocol.PrepareWorktree || res.Source != clone {
		t.Fatalf("result = %+v", res)
	}
	if want := filepath.Join(e.home, ".overseer", "worktrees", "acme-widgets", "overseer-issue-7-fix"); res.Path != want {
		t.Errorf("worktree at %s, want %s", res.Path, want)
	}
	if got := e.branchOf(res.Path); got != "overseer/issue-7-fix" {
		t.Errorf("worktree is on %q", got)
	}
	if got := e.branchOf(clone); got != "main" {
		t.Errorf("the user's clone moved to %q", got)
	}
	// The new branch starts exactly where main is.
	if e.git(res.Path, "rev-parse", "HEAD") != e.git(clone, "rev-parse", "origin/main") {
		t.Error("the branch does not start at origin/main")
	}

	// Asking again (a hub restart) finds the same worktree.
	again := e.mustPrepare("overseer/issue-7-fix", func(r *protocol.GitPrepareRequest) { r.CreateFrom = "main" })
	if again.Action != protocol.PrepareReuse || again.Path != res.Path {
		t.Errorf("second prepare = %+v", again)
	}

	// Without CreateFrom a branch GitHub does not have is still an error.
	if _, err := e.prepare("overseer/issue-8-nope"); err == nil || !strings.Contains(err.Error(), "not found") {
		t.Errorf("missing branch error = %v", err)
	}
	// A base that does not exist is reported, and nothing is left behind.
	if _, err := e.prepare("overseer/issue-9-x", func(r *protocol.GitPrepareRequest) { r.CreateFrom = "nope" }); err == nil {
		t.Error("a missing base was accepted")
	}
}

func TestPrepareNewBranchClonesWhenNoClone(t *testing.T) {
	e := newPrepEnv(t)
	res := e.mustPrepare("overseer/issue-3-a", func(r *protocol.GitPrepareRequest) { r.CreateFrom = "main" })
	if res.Action != protocol.PrepareClone {
		t.Fatalf("result = %+v", res)
	}
	if got := e.branchOf(res.Path); got != "overseer/issue-3-a" {
		t.Errorf("clone is on %q", got)
	}
}

// finishEnv is a worktree on a new branch with a stub gh.
func newFinishEnv(t *testing.T) (*prepEnv, *stubGh, string) {
	t.Helper()
	e := newPrepEnv(t)
	gh := newStubGh(t)
	e.userClone(filepath.Join(e.home, "code", "widgets"))
	res := e.mustPrepare("overseer/issue-7-fix", func(r *protocol.GitPrepareRequest) { r.CreateFrom = "main" })
	return e, gh, res.Path
}

func finishReq(dir string) protocol.AutopilotFinish {
	return protocol.AutopilotFinish{
		Cwd: dir, Repo: "acme/widgets", Branch: "overseer/issue-7-fix", Base: "main",
		Title: "Fix the thing (#7)", Body: "Fixes #7\n\nSummary here", CommitMessage: "Fix #7",
	}
}

func TestFinishCommitsPushesAndOpensOnePR(t *testing.T) {
	e, gh, dir := newFinishEnv(t)
	os.WriteFile(filepath.Join(dir, "fix.txt"), []byte("fixed\n"), 0o644)
	os.WriteFile(filepath.Join(dir, ".env"), []byte("SECRET=1\n"), 0o644)
	os.WriteFile(filepath.Join(dir, ".env.example"), []byte("SECRET=\n"), 0o644)
	os.WriteFile(filepath.Join(dir, "deploy.pem"), []byte("key\n"), 0o644)

	req := finishReq(dir)
	req.Title = `Fix "x" $(touch ` + filepath.Join(gh.dir, "pwned") + `) ; echo`
	res := finishWork(context.Background(), req)
	if res.Error != "" || !res.Committed || !res.Pushed || res.PRNumber != 42 || res.PRUrl != "https://github.com/acme/widgets/pull/42" || res.Existing {
		t.Fatalf("result = %+v", res)
	}
	// Secrets stayed out of the commit; the example file went in.
	files := e.git(dir, "show", "--name-only", "--format=", "HEAD")
	if !strings.Contains(files, "fix.txt") || !strings.Contains(files, ".env.example") || strings.Contains(files, "deploy.pem") || strings.Contains(files, "\n.env\n") || files == ".env" {
		t.Errorf("committed files:\n%s", files)
	}
	for _, line := range strings.Split(files, "\n") {
		if line == ".env" {
			t.Errorf(".env was committed")
		}
	}
	// The branch is on "GitHub".
	if got := e.git(e.origin, "rev-parse", "overseer/issue-7-fix"); got != e.git(dir, "rev-parse", "HEAD") {
		t.Errorf("origin has %s", got)
	}
	// The body went through stdin, the title as one argument, and the shell
	// never saw it.
	if gh.body() != req.Body {
		t.Errorf("body = %q", gh.body())
	}
	if !strings.Contains(gh.log(), "--title "+req.Title+" --body-file -") {
		t.Errorf("gh was called with:\n%s", gh.log())
	}
	if _, err := os.Stat(filepath.Join(gh.dir, "pwned")); err == nil {
		t.Fatal("the title was run as a command")
	}

	// Finishing again reuses the open pull request.
	again := finishWork(context.Background(), req)
	if again.Error != "" || !again.Existing || again.PRNumber != 42 || again.Committed {
		t.Errorf("second finish = %+v", again)
	}
	if strings.Count(gh.log(), "pr create") != 1 {
		t.Errorf("a second pull request was opened:\n%s", gh.log())
	}
}

func TestFinishUsesWhatTheAgentCommitted(t *testing.T) {
	e, _, dir := newFinishEnv(t)
	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("a\n"), 0o644)
	e.git(dir, "add", "a.txt")
	e.git(dir, "commit", "-q", "-m", "agent commit")
	res := finishWork(context.Background(), finishReq(dir))
	if res.Error != "" || res.Committed || !res.Pushed || res.PRNumber != 42 {
		t.Fatalf("result = %+v", res)
	}
}

func TestFinishWithNothingToPropose(t *testing.T) {
	_, gh, dir := newFinishEnv(t)
	res := finishWork(context.Background(), finishReq(dir))
	if res.Error != "" || !res.NoChanges || res.Pushed || res.PRUrl != "" {
		t.Fatalf("result = %+v", res)
	}
	if strings.Contains(gh.log(), "pr create") {
		t.Error("opened a pull request for nothing")
	}
}

func TestFinishRefusesTheWrongPlace(t *testing.T) {
	e, _, dir := newFinishEnv(t)
	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("a\n"), 0o644)

	req := finishReq(dir)
	req.Branch = "main" // not what the worktree has checked out
	if res := finishWork(context.Background(), req); !strings.Contains(res.Error, "not main") || res.Pushed {
		t.Errorf("wrong branch: %+v", res)
	}
	req = finishReq(dir)
	req.Repo = "someone/else"
	if res := finishWork(context.Background(), req); !strings.Contains(res.Error, "not a clone of someone/else") || res.Pushed {
		t.Errorf("wrong repo: %+v", res)
	}
	for _, bad := range []func(*protocol.AutopilotFinish){
		func(r *protocol.AutopilotFinish) { r.Repo = "-x/y" },
		func(r *protocol.AutopilotFinish) { r.Branch = "--force" },
		func(r *protocol.AutopilotFinish) { r.Base = "a..b" },
		func(r *protocol.AutopilotFinish) { r.Title = "  " },
		func(r *protocol.AutopilotFinish) { r.Cwd = "relative/path" },
	} {
		r := finishReq(dir)
		bad(&r)
		if res := finishWork(context.Background(), r); res.Error == "" || res.Pushed {
			t.Errorf("accepted %+v", r)
		}
	}
	// None of that committed or pushed anything.
	if out := e.git(e.origin, "branch", "--list", "overseer/*"); out != "" {
		t.Errorf("origin has branches: %s", out)
	}
}

func TestGhCommandRunsWithArgsAndStdin(t *testing.T) {
	gh := newStubGh(t)
	a := &Agent{}
	res, err := a.ghCommand(protocol.GhRun{Args: []string{"pr", "create", "--title", "a b; $(x) `y`"}, Stdin: "body"})
	if err != nil || res.ExitCode != 0 || !strings.Contains(res.Stdout, "/pull/42") {
		t.Fatalf("res = %+v err = %v", res, err)
	}
	if gh.body() != "body" || !strings.Contains(gh.log(), "--title a b; $(x) `y`") {
		t.Errorf("gh saw %q / %q", gh.log(), gh.body())
	}
	res, _ = a.ghCommand(protocol.GhRun{Args: []string{"nope"}})
	if res.ExitCode != 1 || !strings.Contains(res.Stderr, "unexpected") {
		t.Errorf("failure = %+v", res)
	}
	if _, err := a.ghCommand(protocol.GhRun{}); err == nil {
		t.Error("an empty command was accepted")
	}
	if _, err := a.ghCommand(protocol.GhRun{Args: []string{"x\x00y"}}); err == nil {
		t.Error("a NUL argument was accepted")
	}

	old := ghLookup
	ghLookup = func() string { return "" }
	defer func() { ghLookup = old }()
	t.Setenv("PATH", t.TempDir())
	if findGh() == "" {
		res, _ = a.ghCommand(protocol.GhRun{Args: []string{"version"}})
		if !res.Missing {
			t.Errorf("missing gh = %+v", res)
		}
	}
}

func TestSensitivePath(t *testing.T) {
	for p, want := range map[string]bool{
		".env": true, "app/.env": true, ".env.local": true, ".env.production": true, ".env.example": false,
		"server.pem": true, "a/b/id_rsa": true, "id_ed25519": true, ".npmrc": true, "credentials.json": true,
		"src/env.ts": false, "README.md": false, "docs/environment.md": false, "keys.go": false,
	} {
		if got := sensitivePath(p); got != want {
			t.Errorf("sensitivePath(%q) = %v, want %v", p, got, want)
		}
	}
}
