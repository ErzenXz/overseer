package agent

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// git.prepare gets a GitHub repo and branch ready on this machine so a session
// can start there. The rules, in order:
//
//  1. A checkout of the repo already on that branch is used as is.
//  2. Another checkout of the repo (a clone the user already works in) is never
//     moved to the branch and never has its files touched: not when it has
//     uncommitted changes, and not when it is clean either, because someone may
//     have the folder open. The branch gets its own git worktree instead, under
//     ~/.overseer/worktrees/<owner>-<repo>/<branch>. Only remote-tracking refs
//     and the new worktree are written to the clone's .git.
//  3. With no clone on this machine, the repo is cloned (gh first, so private
//     repos use the user's sign-in; plain https as a fallback) straight onto
//     the branch, into the user's usual code folder.
//
// Nothing is ever deleted except a half-made clone this call created itself.

const (
	prepareTotalTimeout = 12 * time.Minute
	prepareCloneTimeout = 10 * time.Minute
	prepareFetchTimeout = 3 * time.Minute
	prepareLocalTimeout = 2 * time.Minute // worktree add checks files out
	prepareQuickTimeout = 10 * time.Second
	prepareScanLimit    = 400 // folders looked at when hunting for clones
)

var (
	// ghLookup finds the GitHub CLI; tests replace it so nothing touches the
	// network.
	ghLookup = func() string { p, _ := exec.LookPath("gh"); return p }
	// githubBase is where "owner/name" is cloned from without gh.
	githubBase = "https://github.com/"
	// codeRoots are the usual places people keep repos, in order of preference.
	codeRoots = []string{"code", "src", "Projects", "dev", "Developer", "repos", "github", "git", "work", "workspace"}

	repoNameRe = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)

	prepareRepoLocks sync.Map // lowercase "owner/name" -> *sync.Mutex
	prepareJobs      = struct {
		sync.Mutex
		cancels map[string]context.CancelFunc
	}{cancels: map[string]context.CancelFunc{}}
)

// prepareError is a failure already worded for the person using the UI.
type prepareError struct {
	msg  string
	kind int // what went wrong, for choosing between attempts (kind* below)
}

func (e *prepareError) Error() string { return e.msg }

func failf(format string, args ...any) error { return &prepareError{msg: fmt.Sprintf(format, args...)} }

func failKind(kind int, format string, args ...any) error {
	return &prepareError{msg: fmt.Sprintf(format, args...), kind: kind}
}

// Failure kinds, most telling first: a missing branch or full disk is true
// whichever way the clone was tried; "not found" from a signed-in gh is
// final; "not signed in" is only a guess from a failed plain git attempt.
const (
	kindBranch = iota + 1
	kindDisk
	kindNotFound
	kindAuth
	kindNet
	kindOther
)

// prepareGit is the agent entry point: it registers the job so it can be
// cancelled, then plans and (unless req.Plan) does the work.
func (a *Agent) prepareGit(req protocol.GitPrepareRequest) (protocol.GitPrepareResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), prepareTotalTimeout)
	defer cancel()
	if req.Key != "" {
		prepareJobs.Lock()
		prepareJobs.cancels[req.Key] = cancel
		prepareJobs.Unlock()
		defer func() {
			prepareJobs.Lock()
			delete(prepareJobs.cancels, req.Key)
			prepareJobs.Unlock()
		}()
	}
	res, err := prepareCheckout(ctx, req)
	if err != nil && ctx.Err() != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return res, failf("This took longer than %d minutes and was stopped.", int(prepareTotalTimeout.Minutes()))
		}
		return res, failf("Cancelled.")
	}
	return res, err
}

func cancelPrepare(key string) {
	prepareJobs.Lock()
	cancel := prepareJobs.cancels[key]
	prepareJobs.Unlock()
	if cancel != nil {
		cancel()
	}
}

// preparePlan is what prepareCheckout decided to do.
type preparePlan struct {
	action string
	path   string
	source string // top of the clone a worktree hangs off
	common string // that clone's git dir
}

func prepareCheckout(ctx context.Context, req protocol.GitPrepareRequest) (protocol.GitPrepareResult, error) {
	repo := strings.TrimSpace(req.Repo)
	branch := strings.TrimSpace(req.Branch)
	if !repoNameRe.MatchString(repo) || strings.HasPrefix(repo, "-") || strings.Contains(repo, "..") {
		return protocol.GitPrepareResult{}, failf("“%s” is not a GitHub repo. Use owner/name.", repo)
	}
	if !validBranch(branch) {
		return protocol.GitPrepareResult{}, failf("“%s” is not a valid branch name.", branch)
	}
	home, _ := os.UserHomeDir()
	if home == "" {
		return protocol.GitPrepareResult{}, failf("This machine has no home folder to put the code in.")
	}
	createFrom := strings.TrimSpace(req.CreateFrom)
	if createFrom != "" && !validBranch(createFrom) {
		return protocol.GitPrepareResult{}, failf("“%s” is not a valid branch name.", createFrom)
	}
	res := protocol.GitPrepareResult{Branch: branch, Home: home}
	if _, err := exec.LookPath("git"); err != nil {
		return res, failf("Git is not installed on this machine.")
	}

	if !req.Plan {
		// One prepare per repo at a time: two of them would race on .git locks.
		mu, _ := prepareRepoLocks.LoadOrStore(strings.ToLower(repo), &sync.Mutex{})
		mu.(*sync.Mutex).Lock()
		defer mu.(*sync.Mutex).Unlock()
	}

	plan, err := planPrepare(ctx, home, repo, branch, req)
	if err != nil {
		return res, err
	}
	res.Action, res.Path, res.Source = plan.action, plan.path, plan.source
	if req.Plan {
		return res, nil
	}
	switch plan.action {
	case protocol.PrepareReuse:
		return res, nil
	case protocol.PrepareWorktree:
		note, err := addWorktree(ctx, plan.source, branch, plan.path, createFrom)
		res.Note = note
		return res, err
	default:
		err := cloneRepo(ctx, repo, branch, plan.path)
		var pe *prepareError
		if errors.As(err, &pe) && pe.kind == kindBranch && createFrom != "" {
			err = cloneNewBranch(ctx, repo, createFrom, branch, plan.path)
		}
		return res, err
	}
}

// planPrepare looks at what is on disk and decides; it changes nothing.
func planPrepare(ctx context.Context, home, repo, branch string, req protocol.GitPrepareRequest) (preparePlan, error) {
	key := "github.com/" + strings.ToLower(repo)
	clones := findClones(ctx, home, key, req.Known)

	// 1. Somewhere already on the branch (the main folder or a worktree).
	for _, c := range clones {
		for _, wt := range listWorktrees(ctx, c.top) {
			if wt.branch == branch && dirExists(wt.path) {
				return preparePlan{action: protocol.PrepareReuse, path: wt.path, source: c.top, common: c.common}, nil
			}
		}
	}
	// 2. A clone on something else: a worktree beside it.
	if len(clones) > 0 {
		c := clones[0]
		owner, name, _ := strings.Cut(repo, "/")
		base := filepath.Join(home, ".overseer", "worktrees", owner+"-"+name)
		slug := branchSlug(branch)
		path := filepath.Join(base, slug)
		taken := map[string]bool{}
		for _, wt := range listWorktrees(ctx, c.top) {
			taken[filepath.Clean(wt.path)] = true
		}
		for i := 2; (pathExists(path) || taken[filepath.Clean(path)]) && i < 20; i++ {
			path = filepath.Join(base, fmt.Sprintf("%s-%d", slug, i))
		}
		if pathExists(path) {
			return preparePlan{}, failf("Could not find a free folder for this branch under %s.", base)
		}
		return preparePlan{action: protocol.PrepareWorktree, path: path, source: c.top, common: c.common}, nil
	}
	// 3. No clone: a new one.
	dir := strings.TrimSpace(req.Dir)
	if dir != "" {
		dir = expandHome(dir)
		if !filepath.IsAbs(dir) {
			return preparePlan{}, failf("The clone folder must be a full path.")
		}
	} else {
		var err error
		if dir, err = defaultCloneDir(home, repo); err != nil {
			return preparePlan{}, err
		}
	}
	if !emptyOrMissing(dir) {
		return preparePlan{}, failf("The folder %s already exists and is not empty.", dir)
	}
	return preparePlan{action: protocol.PrepareClone, path: dir}, nil
}

// ---- finding clones ----

type clone struct {
	top    string // main work tree (or the bare repo)
	common string // the repo's git dir
}

// findClones returns the distinct repos on this machine whose origin is key,
// the caller's known folders first, then the usual code folders.
func findClones(ctx context.Context, home, key string, known []string) []clone {
	var out []clone
	seen := map[string]bool{}
	add := func(common string) {
		common = canonPath(common)
		if common == "" || seen[common] {
			return
		}
		seen[common] = true
		if originKey(common) != key {
			return
		}
		top := common
		if filepath.Base(common) == ".git" {
			top = filepath.Dir(common)
		}
		out = append(out, clone{top: top, common: common})
	}
	for _, k := range known {
		dir := expandHome(strings.TrimSpace(k))
		if dir == "" || !dirExists(dir) {
			continue
		}
		if c, err := gitText(ctx, prepareQuickTimeout, dir, "rev-parse", "--git-common-dir"); err == nil && c != "" {
			if !filepath.IsAbs(c) {
				c = filepath.Join(dir, c)
			}
			add(c)
		}
	}
	budget := prepareScanLimit
	for _, root := range codeRoots {
		scanForClones(filepath.Join(home, root), 2, &budget, add)
	}
	return out
}

// scanForClones looks for repos (folders with a .git folder) up to depth
// levels under root, bounded by budget so it can never become a crawl.
func scanForClones(root string, depth int, budget *int, add func(string)) {
	if depth == 0 || *budget <= 0 {
		return
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return
	}
	for _, e := range entries {
		if *budget <= 0 {
			return
		}
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") || e.Name() == "node_modules" {
			continue
		}
		*budget--
		dir := filepath.Join(root, e.Name())
		if st, err := os.Stat(filepath.Join(dir, ".git")); err == nil && st.IsDir() {
			add(filepath.Join(dir, ".git"))
		} else if err != nil {
			scanForClones(dir, depth-1, budget, add)
		}
	}
}

// originKey reads remote.origin.url straight from the repo's config file (no
// process to start) and normalises it the way git.info does.
func originKey(common string) string {
	data, err := os.ReadFile(filepath.Join(common, "config"))
	if err != nil {
		return ""
	}
	inOrigin := false
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(line, "["):
			inOrigin = strings.EqualFold(strings.Join(strings.Fields(line), " "), `[remote "origin"]`)
		case inOrigin && strings.HasPrefix(line, "url"):
			if _, v, ok := strings.Cut(line, "="); ok {
				key, _ := protocol.NormalizeRemote(strings.TrimSpace(v))
				return strings.ToLower(key)
			}
		}
	}
	return ""
}

type worktree struct {
	path   string
	branch string // short name; empty when detached or bare
}

// listWorktrees reads `git worktree list`: the main folder and every linked
// worktree. Entries whose folder is gone are skipped.
func listWorktrees(ctx context.Context, top string) []worktree {
	out, err := gitText(ctx, prepareQuickTimeout, top, "worktree", "list", "--porcelain")
	if err != nil {
		return nil
	}
	var list []worktree
	var cur *worktree
	for _, line := range strings.Split(out, "\n") {
		switch {
		case strings.HasPrefix(line, "worktree "):
			list = append(list, worktree{path: filepath.FromSlash(strings.TrimPrefix(line, "worktree "))})
			cur = &list[len(list)-1]
		case cur != nil && strings.HasPrefix(line, "branch refs/heads/"):
			cur.branch = strings.TrimPrefix(line, "branch refs/heads/")
		}
	}
	return list
}

// defaultCloneDir picks <code folder>/<name>. The code folder is the one the
// user already keeps repos in (the usual names, whichever holds the most);
// ~/code when there is none yet.
func defaultCloneDir(home, repo string) (string, error) {
	owner, name, _ := strings.Cut(repo, "/")
	best, bestN := filepath.Join(home, "code"), 0
	for _, r := range codeRoots {
		root := filepath.Join(home, r)
		entries, err := os.ReadDir(root)
		if err != nil {
			continue
		}
		n := 0
		for i, e := range entries {
			if i >= 300 {
				break
			}
			if st, err := os.Stat(filepath.Join(root, e.Name(), ".git")); err == nil && st.IsDir() {
				n++
			}
		}
		if n > bestN {
			best, bestN = root, n
		}
	}
	for _, folder := range []string{name, owner + "-" + name} {
		if dir := filepath.Join(best, folder); !pathExists(dir) {
			return dir, nil
		}
	}
	return "", failf("Folders named %s and %s-%s already exist in %s.", name, owner, name, best)
}

// ---- doing the work ----

// addWorktree gives branch its own folder next to the clone at top. Fetching
// only moves the remote-tracking ref; an existing local branch is moved
// forward only when that is a fast-forward.
func addWorktree(ctx context.Context, top, branch, path, createFrom string) (string, error) {
	// Forget worktrees whose folder was deleted by hand: git would otherwise
	// still consider their branch checked out.
	gitText(ctx, prepareQuickTimeout, top, "worktree", "prune")

	remoteRef := "refs/remotes/origin/" + branch
	fetchErr := gitRun(ctx, prepareFetchTimeout, top, branch, "fetch", "origin", "+refs/heads/"+branch+":"+remoteRef)
	haveRemote := refExists(ctx, top, remoteRef)
	haveLocal := refExists(ctx, top, "refs/heads/"+branch)
	if !haveRemote && !haveLocal {
		if createFrom != "" {
			return addNewBranchWorktree(ctx, top, branch, createFrom, path)
		}
		if fetchErr != nil {
			return "", fetchErr
		}
		return "", failf("Branch %s was not found on GitHub.", branch)
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", diskError(err)
	}
	var args []string
	if haveLocal {
		args = []string{"worktree", "add", path, branch}
	} else {
		args = []string{"worktree", "add", "--track", "-b", branch, path, "origin/" + branch}
	}
	if err := gitRun(ctx, prepareLocalTimeout, top, branch, args...); err != nil {
		return "", err
	}
	if !haveLocal || !haveRemote {
		return noteIf(fetchErr != nil, "Could not reach GitHub, so this branch may be out of date."), nil
	}
	if _, err := gitText(ctx, prepareFetchTimeout, path, "merge", "--ff-only", "origin/"+branch); err != nil {
		return "The local branch has commits that are not on GitHub, so it was not updated.", nil
	}
	return noteIf(fetchErr != nil, "Could not reach GitHub, so this branch may be out of date."), nil
}

// addNewBranchWorktree gives a brand-new branch, cut from origin/base, its own
// folder next to the clone at top. Only remote-tracking refs and the new
// worktree are written to the clone's .git.
func addNewBranchWorktree(ctx context.Context, top, branch, base, path string) (string, error) {
	baseRef := "refs/remotes/origin/" + base
	fetchErr := gitRun(ctx, prepareFetchTimeout, top, base, "fetch", "origin", "+refs/heads/"+base+":"+baseRef)
	if !refExists(ctx, top, baseRef) {
		if fetchErr != nil {
			return "", fetchErr
		}
		return "", failf("Branch %s was not found on GitHub.", base)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", diskError(err)
	}
	if err := gitRun(ctx, prepareLocalTimeout, top, branch, "worktree", "add", "--no-track", "-b", branch, path, "origin/"+base); err != nil {
		return "", err
	}
	return noteIf(fetchErr != nil, "Could not reach GitHub, so "+base+" may be out of date."), nil
}

// cloneNewBranch clones repo on base and starts a new branch from it.
func cloneNewBranch(ctx context.Context, repo, base, branch, dir string) error {
	if err := cloneRepo(ctx, repo, base, dir); err != nil {
		return err
	}
	if err := gitRun(ctx, prepareLocalTimeout, dir, branch, "checkout", "-b", branch); err != nil {
		os.RemoveAll(dir)
		return err
	}
	return nil
}

func noteIf(cond bool, note string) string {
	if cond {
		return note
	}
	return ""
}

// cloneRepo clones repo straight onto branch at dir. dir is empty or missing
// before, so removing it after a failed attempt loses nothing.
func cloneRepo(ctx context.Context, repo, branch, dir string) error {
	if err := os.MkdirAll(filepath.Dir(dir), 0o755); err != nil {
		return diskError(err)
	}
	type attempt struct {
		name string
		cmd  []string
	}
	var attempts []attempt
	if gh := ghLookup(); gh != "" {
		attempts = append(attempts, attempt{"gh", []string{gh, "repo", "clone", repo, dir, "--", "--branch", branch}})
	}
	attempts = append(attempts, attempt{"git", []string{"git", "clone", "--branch", branch, githubBase + repo, dir}})

	var errs []error
	for _, a := range attempts {
		cctx, cancel := context.WithTimeout(ctx, prepareCloneTimeout)
		out, err := runCmd(cctx, "", a.cmd[0], a.cmd[1:]...)
		cancel()
		if err == nil {
			return nil
		}
		if ctx.Err() != nil {
			os.RemoveAll(dir)
			return ctx.Err()
		}
		os.RemoveAll(dir)
		e := explain(out, repo, branch, err)
		// gh is signed in as the user: if it cannot see the repo, plain git
		// without credentials cannot either, so there is nothing to fall back to.
		if pe, ok := e.(*prepareError); ok && a.name == "gh" && pe.kind == kindNotFound {
			return e
		}
		errs = append(errs, e)
	}
	return pickError(errs)
}

// pickError chooses the most useful of several failed attempts.
func pickError(errs []error) error {
	rank := func(err error) int {
		if pe, ok := err.(*prepareError); ok && pe.kind != 0 {
			return pe.kind
		}
		return kindOther + 1
	}
	sort.SliceStable(errs, func(i, j int) bool { return rank(errs[i]) < rank(errs[j]) })
	return errs[0]
}

// explain turns git/gh output into a sentence for a person.
func explain(out, repo, branch string, err error) error {
	low := strings.ToLower(out)
	switch {
	case strings.Contains(low, "remote branch") && strings.Contains(low, "not found"),
		strings.Contains(low, "couldn't find remote ref"):
		return failKind(kindBranch, "Branch %s was not found on GitHub.", branch)
	case strings.Contains(low, "no space left"), strings.Contains(low, "disk quota"):
		return failKind(kindDisk, "This machine is out of disk space.")
	case strings.Contains(low, "gh auth login"), strings.Contains(low, "authentication failed"),
		strings.Contains(low, "could not read username"), strings.Contains(low, "terminal prompts disabled"),
		strings.Contains(low, "bad credentials"), strings.Contains(low, "permission denied (publickey)"):
		return failKind(kindAuth, "This machine is not signed in to GitHub. Run “gh auth login” there.")
	case strings.Contains(low, "repository not found"), strings.Contains(low, "does not appear to be a git repository"), strings.Contains(low, "could not resolve to a repository"),
		strings.Contains(low, "not found"), strings.Contains(low, "403"):
		return failKind(kindNotFound, "%s was not found, or this machine's GitHub account has no access to it.", repo)
	case strings.Contains(low, "could not resolve host"), strings.Contains(low, "unable to access"),
		strings.Contains(low, "network is unreachable"), strings.Contains(low, "timed out"):
		return failKind(kindNet, "This machine could not reach GitHub.")
	}
	last := lastLine(out)
	if last == "" {
		last = err.Error()
	}
	return failf("Git said: %s", last)
}

func diskError(err error) error {
	if strings.Contains(strings.ToLower(err.Error()), "no space left") {
		return failf("This machine is out of disk space.")
	}
	return failf("Could not create the folder: %v", err)
}

func lastLine(out string) string {
	lines := strings.Split(strings.TrimSpace(out), "\n")
	return strings.TrimSpace(lines[len(lines)-1])
}

// ---- small helpers ----

// runCmd runs a command that must never prompt, returning its combined output.
func runCmd(ctx context.Context, dir, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "GCM_INTERACTIVE=never", "GH_PROMPT_DISABLED=1", "GH_NO_UPDATE_NOTIFIER=1", "LC_ALL=C")
	var buf bytes.Buffer
	cmd.Stdout, cmd.Stderr = &buf, &buf
	cmd.WaitDelay = 3 * time.Second
	err := cmd.Run()
	return buf.String(), err
}

// gitText runs git in dir and returns trimmed output.
func gitText(ctx context.Context, timeout time.Duration, dir string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	out, err := runCmd(ctx, dir, "git", args...)
	return strings.TrimSpace(out), err
}

// gitRun runs git in dir and words a failure for a person.
func gitRun(ctx context.Context, timeout time.Duration, dir, branch string, args ...string) error {
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	out, err := runCmd(cctx, dir, "git", args...)
	if err == nil {
		return nil
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	return explain(out, "this repo", branch, err)
}

func refExists(ctx context.Context, dir, ref string) bool {
	_, err := gitText(ctx, prepareQuickTimeout, dir, "show-ref", "--verify", "--quiet", ref)
	return err == nil
}

func validBranch(b string) bool {
	if b == "" || len(b) > 200 || b == "@" || strings.HasPrefix(b, "-") || strings.HasPrefix(b, "/") ||
		strings.HasSuffix(b, "/") || strings.HasSuffix(b, ".") || strings.HasSuffix(b, ".lock") ||
		strings.Contains(b, "..") || strings.Contains(b, "//") || strings.Contains(b, "@{") {
		return false
	}
	for _, r := range b {
		if r < 0x20 || r == 0x7f || strings.ContainsRune(" ~^:?*[\\", r) {
			return false
		}
	}
	return true
}

var slugRe = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

// branchSlug makes a branch name safe as one folder name: feature/x -> feature-x.
func branchSlug(branch string) string {
	s := strings.Trim(slugRe.ReplaceAllString(branch, "-"), ".-")
	if len(s) > 80 {
		s = strings.TrimRight(s[:80], ".-")
	}
	if s == "" {
		return "branch"
	}
	return s
}

func pathExists(p string) bool { _, err := os.Lstat(p); return err == nil }

func dirExists(p string) bool { st, err := os.Stat(p); return err == nil && st.IsDir() }

func emptyOrMissing(p string) bool {
	entries, err := os.ReadDir(p)
	if err != nil {
		return os.IsNotExist(err)
	}
	return len(entries) == 0
}

// realPath resolves symlinks so the same folder reached two ways compares equal
// (macOS /var vs /private/var).
func canonPath(p string) string {
	if r, err := filepath.EvalSymlinks(p); err == nil {
		return r
	}
	return filepath.Clean(p)
}
