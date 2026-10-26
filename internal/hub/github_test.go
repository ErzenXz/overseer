package hub

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// A stand-in for the GitHub CLI that answers the calls the hub makes with
// canned JSON, plus a fake "GitHub" (a bare repo that https://github.com/ is
// rewritten to), so the whole path runs without a network.
const ghStub = `#!/bin/sh
if [ "$GH_STUB_MODE" = "noauth" ]; then
  echo "To get started with GitHub CLI, please run:  gh auth login" >&2
  exit 4
fi
case "$*" in
  "repo list --limit 100"*)
    echo '[{"nameWithOwner":"me/api","description":"My API","updatedAt":"2026-10-01T00:00:00Z","pushedAt":"2026-10-01T00:00:00Z","isPrivate":true,"isFork":false,"defaultBranchRef":{"name":"main"}}]';;
  "api user --jq"*) echo me;;
  "api user/orgs"*) echo acme;;
  "repo list acme"*)
    echo '[{"nameWithOwner":"acme/widgets","description":"","updatedAt":"2026-10-20T00:00:00Z","pushedAt":"2026-10-20T00:00:00Z","isPrivate":false,"isFork":false,"defaultBranchRef":{"name":"main"}},{"nameWithOwner":"me/api","description":"dup","pushedAt":"2026-10-01T00:00:00Z","defaultBranchRef":{"name":"main"}}]';;
  "repo view acme/widgets --json defaultBranchRef") echo '{"defaultBranchRef":{"name":"main"}}';;
  "repo view acme/widgets --json nameWithOwner"*)
    echo '{"nameWithOwner":"acme/widgets","description":"Widgets","updatedAt":"2026-10-20T00:00:00Z","isPrivate":false,"isFork":false,"defaultBranchRef":{"name":"main"}}';;
  "search repos"*)
    echo '[{"fullName":"other/widgets-ui","description":"UI","updatedAt":"2026-09-01T00:00:00Z","isPrivate":false,"isFork":false,"defaultBranch":"trunk"}]';;
  "api repos/acme/widgets/branches"*) echo '[{"name":"feature/x"},{"name":"main"},{"name":"other"}]';;
  "pr list -R acme/widgets"*)
    echo '[{"headRefName":"other","number":7,"title":"Other work","isDraft":false,"isCrossRepository":false},{"headRefName":"forked","number":8,"title":"From a fork","isDraft":false,"isCrossRepository":true}]';;
  "repo clone"*) echo "gh: could not start" >&2; exit 1;; # falls back to plain git
  *) echo "gh: HTTP 404: Not Found" >&2; exit 1;;
esac
`

type ghEnv struct {
	api  apiClient
	dev  string
	home string
}

func newGHEnv(t *testing.T) ghEnv {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("the gh stub is a shell script")
	}
	tmp := t.TempDir()
	if r, err := filepath.EvalSymlinks(tmp); err == nil {
		tmp = r
	}
	bin := filepath.Join(tmp, "bin")
	os.MkdirAll(bin, 0o755)
	os.WriteFile(filepath.Join(bin, "gh"), []byte(ghStub), 0o755)
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	home := filepath.Join(tmp, "home")
	os.MkdirAll(home, 0o755)
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("SHELL", "/bin/sh")

	// "GitHub": acme/widgets with a main and a feature/x branch.
	gh := filepath.Join(tmp, "github")
	cfg := filepath.Join(tmp, "gitconfig")
	os.WriteFile(cfg, []byte("[user]\n\tname = T\n\temail = t@example.com\n[init]\n\tdefaultBranch = main\n[url \""+gh+"/\"]\n\tinsteadOf = https://github.com/\n"), 0o644)
	t.Setenv("GIT_CONFIG_GLOBAL", cfg)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	run := func(dir string, args ...string) {
		t.Helper()
		if out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	bare, seed := filepath.Join(gh, "acme", "widgets.git"), filepath.Join(tmp, "seed")
	os.MkdirAll(bare, 0o755)
	os.MkdirAll(seed, 0o755)
	run(bare, "init", "--bare", "-q")
	run(seed, "init", "-q")
	run(seed, "remote", "add", "origin", bare)
	os.WriteFile(filepath.Join(seed, "a.txt"), []byte("a"), 0o644)
	run(seed, "add", ".")
	run(seed, "commit", "-q", "-m", "one")
	run(seed, "branch", "feature/x")
	run(seed, "push", "-q", "origin", "main", "feature/x")

	srv, base := startHub(t)
	dev := connectAgent(t, srv, base)
	// The agent puts Homebrew's folders first on PATH when it starts; the
	// stub must still win over a real gh.
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	token, _ := srv.store.CreateApiToken("github-test")
	return ghEnv{api: apiClient{t: t, base: base, token: token}, dev: dev, home: home}
}

func TestGitHubRepos(t *testing.T) {
	e := newGHEnv(t)
	var reply githubReply
	e.api.do("GET", "/api/devices/"+e.dev+"/github/repos", nil, &reply)
	if reply.Status != "ok" || reply.Login != "me" {
		t.Fatalf("reply = %+v", reply)
	}
	// Own repos and the organization's, without the repeat, newest push first.
	var names []string
	for _, r := range reply.Repos {
		names = append(names, r.NameWithOwner)
	}
	if strings.Join(names, ",") != "acme/widgets,me/api" {
		t.Errorf("repos = %v", names)
	}
	if !reply.Repos[1].IsPrivate || reply.Repos[1].DefaultBranch != "main" {
		t.Errorf("repo = %+v", reply.Repos[1])
	}
}

func TestGitHubNotSignedIn(t *testing.T) {
	t.Setenv("GH_STUB_MODE", "noauth")
	e := newGHEnv(t)
	var reply githubReply
	e.api.do("GET", "/api/devices/"+e.dev+"/github/repos", nil, &reply)
	if reply.Status != "no-auth" || reply.Message == "" || len(reply.Repos) != 0 {
		t.Errorf("reply = %+v", reply)
	}
}

func TestGitHubFind(t *testing.T) {
	e := newGHEnv(t)
	for _, q := range []string{"acme/widgets", "https://github.com/acme/widgets/tree/feature/x", "github.com/acme/widgets.git", "git@github.com:acme/widgets.git"} {
		var reply githubReply
		e.api.do("GET", "/api/devices/"+e.dev+"/github/find?q="+strings.ReplaceAll(q, "#", ""), nil, &reply)
		if reply.Status != "ok" || len(reply.Repos) != 1 || reply.Repos[0].NameWithOwner != "acme/widgets" {
			t.Errorf("find %q = %+v", q, reply)
		}
		if strings.Contains(q, "/tree/") && reply.Branch != "feature/x" {
			t.Errorf("find %q: branch = %q", q, reply.Branch)
		}
	}
	var search githubReply
	e.api.do("GET", "/api/devices/"+e.dev+"/github/find?q=widgets+ui", nil, &search)
	if len(search.Repos) != 1 || search.Repos[0].NameWithOwner != "other/widgets-ui" || search.Repos[0].DefaultBranch != "trunk" {
		t.Errorf("search = %+v", search)
	}
	// Something that could break out of a shell is not searched for at all.
	var odd githubReply
	e.api.do("GET", "/api/devices/"+e.dev+"/github/find?q=%3Btouch+pwned", nil, &odd)
	if len(odd.Repos) != 0 {
		t.Errorf("odd = %+v", odd)
	}
	if _, err := os.Stat(filepath.Join(e.home, "pwned")); err == nil {
		t.Error("shell injection")
	}
}

func TestGitHubBranches(t *testing.T) {
	e := newGHEnv(t)
	var reply githubReply
	e.api.do("GET", "/api/devices/"+e.dev+"/github/branches?repo=acme/widgets", nil, &reply)
	var names []string
	for _, b := range reply.Branches {
		names = append(names, b.Name)
	}
	// Default first, then the pull request branch (not the fork's), then the rest.
	if strings.Join(names, ",") != "main,other,feature/x" || reply.DefaultBranch != "main" {
		t.Fatalf("branches = %v, default %q", names, reply.DefaultBranch)
	}
	if !reply.Branches[0].IsDefault || reply.Branches[1].PR == nil || reply.Branches[1].PR.Number != 7 || reply.Branches[2].PR != nil {
		t.Errorf("branches = %+v", reply.Branches)
	}
	if code := e.api.do("GET", "/api/devices/"+e.dev+"/github/branches?repo=x;y", nil, nil); code != 400 {
		t.Errorf("bad repo: status %d", code)
	}
}

func TestGitPrepareJob(t *testing.T) {
	e := newGHEnv(t)
	path := "/api/devices/" + e.dev + "/git-prepare"
	body := map[string]any{"repo": "acme/widgets", "branch": "feature/x"}

	var plan struct {
		Action, Path string
	}
	e.api.do("POST", path, map[string]any{"repo": "acme/widgets", "branch": "feature/x", "plan": true}, &plan)
	want := filepath.Join(e.home, "code", "widgets")
	if plan.Action != "clone" || plan.Path != want {
		t.Fatalf("plan = %+v", plan)
	}
	if _, err := os.Stat(want); err == nil {
		t.Fatal("plan cloned")
	}

	type job struct {
		Key, State, Error string
		Result            *struct{ Action, Path, Branch string }
	}
	body["key"] = "job-clone-0001"
	var started job
	e.api.do("POST", path, body, &started)
	var again job
	e.api.do("POST", path, body, &again) // same key: same job
	if again.Key != started.Key {
		t.Errorf("second POST made a new job: %+v", again)
	}
	var done job
	for deadline := time.Now().Add(30 * time.Second); time.Now().Before(deadline); time.Sleep(100 * time.Millisecond) {
		e.api.do("GET", "/api/git-prepare/job-clone-0001", nil, &done)
		if done.State != "running" {
			break
		}
	}
	if done.State != "done" || done.Result == nil || done.Result.Action != "clone" || done.Result.Path != want || done.Result.Branch != "feature/x" {
		t.Fatalf("job = %+v", done)
	}
	if out, _ := exec.Command("git", "-C", want, "rev-parse", "--abbrev-ref", "HEAD").Output(); strings.TrimSpace(string(out)) != "feature/x" {
		t.Errorf("clone is on %q", out)
	}

	// A branch that does not exist fails in plain words.
	body["key"], body["branch"] = "job-missing-01", "nope"
	e.api.do("POST", path, body, &started)
	for deadline := time.Now().Add(30 * time.Second); time.Now().Before(deadline); time.Sleep(100 * time.Millisecond) {
		e.api.do("GET", "/api/git-prepare/job-missing-01", nil, &done)
		if done.State != "running" {
			break
		}
	}
	if done.State != "failed" || !strings.Contains(done.Error, "Branch nope was not found on GitHub") {
		t.Errorf("job = %+v", done)
	}

	if code := e.api.do("POST", path, map[string]any{"repo": "acme/widgets;x", "branch": "main", "key": "job-bad-00001"}, nil); code != 400 {
		t.Errorf("bad repo: status %d", code)
	}
	if code := e.api.do("POST", path, map[string]any{"repo": "acme/widgets", "branch": "main"}, nil); code != 400 {
		t.Errorf("missing key: status %d", code)
	}
	if code := e.api.do("GET", "/api/git-prepare/never-made-01", nil, nil); code != 404 {
		t.Errorf("unknown job: status %d", code)
	}
}

func TestParseRepoRef(t *testing.T) {
	for in, want := range map[string]string{
		"acme/widgets":                                     "acme/widgets|",
		" https://github.com/acme/widgets/ ":               "acme/widgets|",
		"https://www.github.com/acme/widgets.git":          "acme/widgets|",
		"https://github.com/acme/widgets/tree/release/1.x": "acme/widgets|release/1.x",
		"git@github.com:acme/widgets.git":                  "acme/widgets|",
		"https://evil.com/github.com/acme/w":               "",
		"acme":                                             "",
		"acme/widgets;rm":                                  "",
		"-x/widgets":                                       "",
		"acme/..":                                          "",
	} {
		repo, branch, ok := parseRepoRef(in)
		got := ""
		if ok {
			got = repo + "|" + branch
		}
		if got != want {
			t.Errorf("parseRepoRef(%q) = %q, want %q", in, got, want)
		}
	}
}
