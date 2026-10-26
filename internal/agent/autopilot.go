package agent

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// Machine side of the issue autopilot: run the GitHub CLI for the hub (with
// arguments, never a shell line) and turn the work in a worktree into a pull
// request. The hub decides what to do and when; this file only does it
// safely:
//
//   - it pushes only the branch the worktree is on, never forced, and only in
//     a repo whose origin is the repo it was asked about;
//   - it never stages files that look like secrets (.env, keys, .npmrc …);
//   - a pull request that is already open for the branch is reused, so running
//     the same finish twice never opens two.

const (
	ghDefaultTimeout   = 60 * time.Second
	ghMaxTimeout       = 5 * time.Minute
	ghOutputCap        = 4 * 1024 * 1024
	finishPushTimeout  = 3 * time.Minute
	finishLocalTimeout = 2 * time.Minute
	maxGhArgs          = 40
	maxGhArg           = 64 * 1024
	maxPRBody          = 60 * 1024
)

// findGh locates the GitHub CLI: PATH first, then the places installers put
// it, because a service often runs with a short PATH.
func findGh() string {
	if p := ghLookup(); p != "" {
		return p
	}
	home, _ := os.UserHomeDir()
	candidates := []string{"/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh", "/snap/bin/gh"}
	if home != "" {
		candidates = append(candidates, filepath.Join(home, ".local", "bin", "gh"))
	}
	if runtime.GOOS == "windows" {
		candidates = []string{`C:\Program Files\GitHub CLI\gh.exe`, `C:\Program Files (x86)\GitHub CLI\gh.exe`}
		if local := os.Getenv("LOCALAPPDATA"); local != "" {
			candidates = append(candidates, filepath.Join(local, "Programs", "GitHub CLI", "gh.exe"))
		}
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	return ""
}

// ghEnv keeps gh from ever waiting for a person.
func ghEnv() []string {
	return append(os.Environ(), "GH_PROMPT_DISABLED=1", "GH_NO_UPDATE_NOTIFIER=1", "GH_SPINNER_DISABLED=1", "NO_COLOR=1", "GIT_TERMINAL_PROMPT=0", "GCM_INTERACTIVE=never", "LC_ALL=C")
}

// runGh runs gh with args and stdin and returns what it printed.
func runGh(ctx context.Context, cwd, stdin string, args ...string) protocol.GhRunResult {
	bin := findGh()
	if bin == "" {
		return protocol.GhRunResult{ExitCode: 127, Missing: true, Stderr: "gh: command not found"}
	}
	cmd := exec.CommandContext(ctx, bin, args...)
	if cwd != "" && dirExists(cwd) {
		cmd.Dir = cwd
	}
	cmd.Env = ghEnv()
	cmd.WaitDelay = 3 * time.Second
	if stdin != "" {
		cmd.Stdin = strings.NewReader(stdin)
	}
	stdout := &cappedBuf{limit: ghOutputCap}
	stderr := &cappedBuf{limit: 64 * 1024}
	cmd.Stdout, cmd.Stderr = stdout, stderr
	err := cmd.Run()
	res := protocol.GhRunResult{Stdout: stdout.buf.String(), Stderr: stderr.buf.String()}
	var exitErr *exec.ExitError
	switch {
	case ctx.Err() != nil:
		res.ExitCode = -1
		res.Stderr += "\ngh timed out"
	case errors.As(err, &exitErr):
		res.ExitCode = exitErr.ExitCode()
	case err != nil:
		res.ExitCode = -1
		res.Stderr += "\n" + err.Error()
	}
	return res
}

// ghCommand is the autopilot.gh request.
func (a *Agent) ghCommand(req protocol.GhRun) (protocol.GhRunResult, error) {
	if len(req.Args) == 0 || len(req.Args) > maxGhArgs {
		return protocol.GhRunResult{}, errors.New("gh needs between 1 and 40 arguments")
	}
	for _, arg := range req.Args {
		if len(arg) > maxGhArg || strings.ContainsRune(arg, 0) {
			return protocol.GhRunResult{}, errors.New("a gh argument is invalid")
		}
	}
	if len(req.Stdin) > maxPRBody*2 || len(req.Cwd) > 4096 || strings.ContainsRune(req.Cwd, 0) {
		return protocol.GhRunResult{}, errors.New("gh input is too large")
	}
	timeout := ghDefaultTimeout
	if req.TimeoutSec > 0 {
		timeout = min(time.Duration(req.TimeoutSec)*time.Second, ghMaxTimeout)
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	return runGh(ctx, req.Cwd, req.Stdin, req.Args...), nil
}

// ---- finishing: commit, push, pull request ----

var (
	sensitiveNameRe = regexp.MustCompile(`(?i)(^|/)(\.env(\.[^/]*)?|[^/]*\.pem|[^/]*\.p12|[^/]*\.pfx|[^/]*\.key|id_rsa|id_dsa|id_ecdsa|id_ed25519|\.npmrc|\.netrc|\.pypirc|credentials\.json|service-account[^/]*\.json)$`)
	safeEnvNameRe   = regexp.MustCompile(`(?i)\.(example|sample|template|dist|defaults?)$`)
	prURLRe         = regexp.MustCompile(`https://[^\s]+/pull/(\d+)`)
)

// sensitivePath reports whether a file looks like it holds secrets and must
// not be committed by a robot.
func sensitivePath(p string) bool {
	p = filepath.ToSlash(p)
	return sensitiveNameRe.MatchString(p) && !safeEnvNameRe.MatchString(p)
}

func (a *Agent) autopilotFinish(req protocol.AutopilotFinish) protocol.AutopilotFinishResult {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()
	return finishWork(ctx, req)
}

func finishWork(ctx context.Context, req protocol.AutopilotFinish) (res protocol.AutopilotFinishResult) {
	fail := func(msg string) protocol.AutopilotFinishResult { res.Error = msg; return res }
	title := strings.TrimSpace(strings.NewReplacer("\r", " ", "\n", " ").Replace(req.Title))
	switch {
	case !repoNameRe.MatchString(req.Repo) || strings.HasPrefix(req.Repo, "-") || strings.Contains(req.Repo, ".."):
		return fail("The repo name is invalid.")
	case !validBranch(req.Branch) || !validBranch(req.Base):
		return fail("The branch name is invalid.")
	case title == "" || len(title) > 256:
		return fail("The pull request needs a title of up to 256 characters.")
	case len(req.Body) > maxPRBody:
		return fail("The pull request description is too long.")
	case !filepath.IsAbs(req.Cwd) || !dirExists(req.Cwd):
		return fail("The checkout folder is gone: " + req.Cwd)
	}
	if _, err := exec.LookPath("git"); err != nil {
		return fail("Git is not installed on this machine.")
	}
	dir := req.Cwd

	cur, err := gitText(ctx, prepareQuickTimeout, dir, "rev-parse", "--abbrev-ref", "HEAD")
	if err != nil {
		return fail("That folder is not a git checkout.")
	}
	if cur != req.Branch {
		return fail("The checkout is on " + cur + ", not " + req.Branch + ", so nothing was pushed.")
	}
	common, err := gitText(ctx, prepareQuickTimeout, dir, "rev-parse", "--git-common-dir")
	if err == nil && !filepath.IsAbs(common) {
		common = filepath.Join(dir, common)
	}
	if err != nil || originKey(canonPath(common)) != "github.com/"+strings.ToLower(req.Repo) {
		return fail("That checkout is not a clone of " + req.Repo + ".")
	}

	// Commit whatever the agent left uncommitted (minus anything secret-like).
	if status, _ := gitText(ctx, prepareQuickTimeout, dir, "status", "--porcelain"); status != "" {
		if _, err := gitText(ctx, finishLocalTimeout, dir, "add", "-A"); err != nil {
			return fail("Could not stage the changes: " + err.Error())
		}
		if names, err := gitText(ctx, prepareQuickTimeout, dir, "diff", "--cached", "--name-only", "-z"); err == nil {
			for _, name := range strings.Split(names, "\x00") {
				if name = strings.TrimSpace(name); name != "" && sensitivePath(name) {
					gitText(ctx, prepareQuickTimeout, dir, "reset", "-q", "--", name)
				}
			}
		}
		if staged, _ := gitText(ctx, prepareQuickTimeout, dir, "diff", "--cached", "--name-only"); staged != "" {
			msg := strings.TrimSpace(req.CommitMessage)
			if msg == "" {
				msg = title
			}
			args := []string{}
			if email, _ := gitText(ctx, prepareQuickTimeout, dir, "config", "user.email"); email == "" {
				args = append(args, "-c", "user.name=Overseer", "-c", "user.email=overseer@users.noreply.github.com")
			}
			args = append(args, "commit", "-q", "-m", msg)
			if out, err := gitText(ctx, finishLocalTimeout, dir, args...); err != nil {
				return fail("Could not commit: " + lastLine(out))
			}
			res.Committed = true
		}
	}

	// Anything to propose? Compare with the base as GitHub has it.
	baseRef := "refs/remotes/origin/" + req.Base
	gitText(ctx, prepareFetchTimeout, dir, "fetch", "-q", "origin", "+refs/heads/"+req.Base+":"+baseRef)
	if !refExists(ctx, dir, baseRef) {
		return fail("Branch " + req.Base + " was not found on GitHub.")
	}
	ahead, err := gitText(ctx, prepareQuickTimeout, dir, "rev-list", "--count", "origin/"+req.Base+"..HEAD")
	if err != nil {
		return fail("Could not compare with " + req.Base + ".")
	}
	if n, _ := strconv.Atoi(ahead); n == 0 {
		res.NoChanges = true
		return res
	}

	// Push the branch (never forced).
	if err := gitRun(ctx, finishPushTimeout, dir, req.Branch, "push", "-q", "-u", "origin", req.Branch); err != nil {
		return fail("Could not push " + req.Branch + ": " + err.Error())
	}
	res.Pushed = true

	// A pull request for this branch may already be open (a retry, or a
	// restart between pushing and recording it).
	list := runGh(ctx, dir, "", "pr", "list", "-R", req.Repo, "--head", req.Branch, "--state", "open", "--limit", "5", "--json", "number,url")
	if list.Missing {
		return fail("The branch " + req.Branch + " was pushed, but the GitHub CLI is not installed on this machine, so no pull request was opened.")
	}
	if list.ExitCode == 0 {
		var open []struct {
			Number int    `json:"number"`
			Url    string `json:"url"`
		}
		if json.Unmarshal([]byte(list.Stdout), &open) == nil && len(open) > 0 {
			res.PRUrl, res.PRNumber, res.Existing = open[0].Url, open[0].Number, true
			return res
		}
	}
	created := runGh(ctx, dir, req.Body, "pr", "create", "-R", req.Repo, "--base", req.Base, "--head", req.Branch, "--title", title, "--body-file", "-")
	if created.ExitCode != 0 {
		text := strings.TrimSpace(created.Stderr + "\n" + created.Stdout)
		if m := prURLRe.FindStringSubmatch(text); m != nil && strings.Contains(strings.ToLower(text), "already exists") {
			res.PRUrl, res.Existing = m[0], true
			res.PRNumber, _ = strconv.Atoi(m[1])
			return res
		}
		return fail("The branch " + req.Branch + " was pushed, but opening the pull request failed: " + lastLine(text))
	}
	m := prURLRe.FindStringSubmatch(created.Stdout)
	if m == nil {
		return fail("The branch " + req.Branch + " was pushed, but GitHub did not say where the pull request is.")
	}
	res.PRUrl = m[0]
	res.PRNumber, _ = strconv.Atoi(m[1])
	return res
}

// dispatchAutopilot answers the issue-autopilot and screenshot requests. Each
// runs in its own goroutine: a clone, push or browser can take a while.
func (a *Agent) dispatchAutopilot(m protocol.Msg) {
	switch m.Type {
	case protocol.TypeAutopilotGh:
		var req protocol.GhRun
		if err := json.Unmarshal(m.Data, &req); err != nil {
			a.reply(m.Id, nil, err)
			return
		}
		go func() {
			res, err := a.ghCommand(req)
			a.reply(m.Id, res, err)
		}()
	case protocol.TypeAutopilotFinish:
		var req protocol.AutopilotFinish
		if err := json.Unmarshal(m.Data, &req); err != nil {
			a.reply(m.Id, nil, err)
			return
		}
		// Committing, pushing and opening a PR can take minutes; never hold the
		// connection's read loop for that.
		go func() {
			res := a.autopilotFinish(req)
			a.reply(m.Id, res, nil)
		}()
	case protocol.TypeScreenshot:
		var req protocol.ScreenshotRequest
		if err := json.Unmarshal(m.Data, &req); err != nil {
			a.reply(m.Id, nil, err)
			return
		}
		go func() {
			res := a.screenshot(req)
			a.reply(m.Id, res, nil)
		}()
	}
}
