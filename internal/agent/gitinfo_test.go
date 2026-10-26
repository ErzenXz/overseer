package agent

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/ErzenXz/overseer/internal/protocol"
)

func gitIn(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL=/dev/null", "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func TestGitInfo(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)

	repo := filepath.Join(home, "code", "api")
	if err := os.MkdirAll(filepath.Join(repo, "pkg"), 0o755); err != nil {
		t.Fatal(err)
	}
	gitIn(t, repo, "init", "-q", "-b", "feature-x")
	gitIn(t, repo, "remote", "add", "origin", "https://user:secret@github.com/acme/api.git")
	os.WriteFile(filepath.Join(repo, "a.txt"), []byte("a"), 0o644)
	gitIn(t, repo, "add", ".")
	gitIn(t, repo, "commit", "-q", "-m", "init")
	os.WriteFile(filepath.Join(repo, "a.txt"), []byte("changed"), 0o644) // modified
	os.WriteFile(filepath.Join(repo, "new.txt"), []byte("n"), 0o644)     // untracked

	plain := filepath.Join(home, "notes")
	os.MkdirAll(plain, 0o755)
	file := filepath.Join(home, "file.txt")
	os.WriteFile(file, []byte("x"), 0o644)

	a := &Agent{}
	res := a.gitInfo(protocol.GitInfoRequest{Paths: []string{
		"~/code/api", repo + "/pkg", "~/notes", "~/missing", file, "",
	}})
	if res.Home != home {
		t.Errorf("home = %q, want %q", res.Home, home)
	}
	if len(res.Paths) != 6 {
		t.Fatalf("got %d results, want 6", len(res.Paths))
	}

	r := res.Paths[0]
	if !r.Exists || !r.IsRepo || r.Branch != "feature-x" || r.Detached {
		t.Errorf("repo: %+v", r)
	}
	if r.Path != "~/code/api" || r.Resolved != repo {
		t.Errorf("repo paths: %q -> %q", r.Path, r.Resolved)
	}
	if r.Dirty == nil || *r.Dirty != 2 {
		t.Errorf("dirty = %v, want 2", r.Dirty)
	}
	if r.RemoteKey != "github.com/acme/api" || r.Remote != "https://github.com/acme/api.git" {
		t.Errorf("remote = %q key %q (credentials must be dropped)", r.Remote, r.RemoteKey)
	}
	if resolved, _ := filepath.EvalSymlinks(repo); r.Root != repo && r.Root != resolved {
		t.Errorf("root = %q, want %q", r.Root, repo)
	}

	// A sub-folder resolves to the same repo.
	if sub := res.Paths[1]; !sub.IsRepo || sub.Branch != "feature-x" || sub.RemoteKey != r.RemoteKey {
		t.Errorf("subfolder: %+v", sub)
	}
	if p := res.Paths[2]; !p.Exists || p.IsRepo || p.Branch != "" {
		t.Errorf("plain folder: %+v", p)
	}
	if m := res.Paths[3]; m.Exists || m.IsRepo {
		t.Errorf("missing folder: %+v", m)
	}
	if f := res.Paths[4]; f.Exists || f.IsRepo {
		t.Errorf("a file is not a folder: %+v", f)
	}
	if h := res.Paths[5]; !h.Exists || h.Resolved != home {
		t.Errorf("empty path means home: %+v", h)
	}

	// Detached HEAD reports a short commit.
	gitIn(t, repo, "checkout", "-q", "--detach")
	d := a.gitInfo(protocol.GitInfoRequest{Paths: []string{repo}}).Paths[0]
	if !d.Detached || len(d.Branch) != 7 {
		t.Errorf("detached: %+v", d)
	}

	// A repo with no remote has no key.
	bare := filepath.Join(home, "local")
	os.MkdirAll(bare, 0o755)
	gitIn(t, bare, "init", "-q")
	if l := a.gitInfo(protocol.GitInfoRequest{Paths: []string{bare}}).Paths[0]; !l.IsRepo || l.RemoteKey != "" || l.Remote != "" {
		t.Errorf("no remote: %+v", l)
	}
}

func TestGitInfoCapsPaths(t *testing.T) {
	paths := make([]string, protocol.MaxGitInfoPaths+10)
	for i := range paths {
		paths[i] = "/nonexistent"
	}
	if got := len((&Agent{}).gitInfo(protocol.GitInfoRequest{Paths: paths}).Paths); got != protocol.MaxGitInfoPaths {
		t.Errorf("got %d results, want %d", got, protocol.MaxGitInfoPaths)
	}
}
