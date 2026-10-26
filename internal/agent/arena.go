package agent

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// Agent Arena, machine side (see protocol/arena.go). The rules:
//
//   - A contestant never touches the user's checkout. It gets its own git
//     worktree under ~/.overseer/worktrees/arena/<arenaId>/<n>-<agent>, made at
//     one commit with a fresh branch arena/<arenaId>/<agent>. Only the clone's
//     .git gains a branch and a worktree entry.
//   - Every step that takes a worktree path refuses one outside that arena's
//     folder, and removal only ever deletes inside it.
//   - The one step that writes into the user's own folder is apply, and only
//     when that folder has no uncommitted changes.
//   - Commands are run with argument lists, never through a shell; the check
//     command is the one exception because the user typed it to be a shell line.

const (
	arenaStepTimeout  = 3 * time.Minute
	arenaFetchTimeout = 3 * time.Minute
	arenaMaxChanged   = 200
	arenaOutputTail   = 12000
	arenaMaxPatch     = 6 << 20
)

var (
	arenaIdRe     = regexp.MustCompile(`^[A-Za-z0-9_-]{6,40}$`)
	arenaNameRe   = regexp.MustCompile(`^[0-9]{1,2}-[A-Za-z0-9_.-]{1,40}$`)
	arenaCommitRe = regexp.MustCompile(`^[0-9a-f]{7,64}$`)
)

func (a *Agent) arenaOp(req protocol.ArenaRequest) (protocol.ArenaResult, error) {
	home, _ := os.UserHomeDir()
	if home == "" {
		return protocol.ArenaResult{}, fmt.Errorf("this machine has no home folder")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	var res protocol.ArenaResult
	var err error
	switch req.Action {
	case protocol.ArenaInspect:
		res, err = arenaInspect(ctx, home, req)
	case protocol.ArenaCreate:
		res, err = arenaCreate(ctx, home, req)
	case protocol.ArenaStats:
		res, err = arenaStats(ctx, home, req)
	case protocol.ArenaCheck:
		res, err = a.arenaCheck(home, req)
	case protocol.ArenaCommit:
		res, err = arenaCommitOp(ctx, home, req)
	case protocol.ArenaPR:
		res, err = arenaPR(ctx, home, req)
	case protocol.ArenaApply:
		res, err = arenaApply(ctx, home, req)
	case protocol.ArenaPatch:
		res, err = arenaPatch(ctx, home, req)
	case protocol.ArenaRemove:
		res, err = arenaRemove(ctx, home, req)
	default:
		return res, fmt.Errorf("unsupported arena action")
	}
	res.Home = home
	return res, err
}

// arenaBase is where all arena worktrees live.
func arenaBase(home string) string {
	return filepath.Join(home, ".overseer", "worktrees", "arena")
}

// arenaWorktreePath checks that path is exactly one folder below
// <base>/<arenaId>/ (after resolving symlinks) and returns it cleaned.
func arenaWorktreePath(home, arenaId, path string) (string, error) {
	if !arenaIdRe.MatchString(arenaId) {
		return "", fmt.Errorf("invalid arena id")
	}
	if path == "" || strings.ContainsRune(path, 0) || !filepath.IsAbs(path) {
		return "", fmt.Errorf("invalid worktree path")
	}
	parent := canonDeep(filepath.Join(arenaBase(home), arenaId))
	clean := filepath.Clean(path)
	resolved := canonDeep(filepath.Dir(clean))
	if resolved != parent || !arenaNameRe.MatchString(filepath.Base(clean)) {
		return "", fmt.Errorf("that folder is not one of this arena's worktrees")
	}
	return filepath.Join(parent, filepath.Base(clean)), nil
}

// canonDeep resolves symlinks in the part of p that exists, so a folder that
// is already gone still compares equal to the same folder reached another way
// (macOS /var vs /private/var).
func canonDeep(p string) string {
	p = filepath.Clean(p)
	var rest []string
	for cur := p; ; {
		if r, err := filepath.EvalSymlinks(cur); err == nil {
			for i := len(rest) - 1; i >= 0; i-- {
				r = filepath.Join(r, rest[i])
			}
			return r
		}
		next := filepath.Dir(cur)
		if next == cur {
			return p
		}
		rest = append(rest, filepath.Base(cur))
		cur = next
	}
}

func arenaBranchOK(arenaId, branch string) bool {
	return validBranch(branch) && strings.HasPrefix(branch, "arena/"+arenaId+"/") && !strings.HasSuffix(branch, "/")
}

func arenaGit(ctx context.Context, dir string, env []string, args ...string) (string, error) {
	cctx, cancel := context.WithTimeout(ctx, arenaStepTimeout)
	defer cancel()
	cmd := exec.CommandContext(cctx, "git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "GCM_INTERACTIVE=never", "LC_ALL=C")
	cmd.Env = append(cmd.Env, env...)
	var buf bytes.Buffer
	cmd.Stdout, cmd.Stderr = &buf, &buf
	cmd.WaitDelay = 3 * time.Second
	err := cmd.Run()
	out := strings.TrimSpace(buf.String())
	if err != nil {
		if out == "" {
			out = err.Error()
		}
		return out, fmt.Errorf("git %s: %s", args[0], lastLine(out))
	}
	return out, nil
}

// arenaRepo resolves a folder to the top of its repo and checks it is the
// repo the caller means.
func arenaRepo(ctx context.Context, home, path, remoteKey string) (protocol.GitPathInfo, error) {
	info := gitPathInfo(ctx, home, path)
	switch {
	case !info.Exists:
		return info, fmt.Errorf("that folder does not exist on this machine")
	case !info.IsRepo:
		return info, fmt.Errorf("that folder is not a git repository")
	case remoteKey != "" && info.RemoteKey != remoteKey:
		return info, fmt.Errorf("that folder is a clone of a different repository")
	}
	return info, nil
}

func arenaInspect(ctx context.Context, home string, req protocol.ArenaRequest) (protocol.ArenaResult, error) {
	info, err := arenaRepo(ctx, home, req.Repo, "")
	if err != nil {
		return protocol.ArenaResult{}, err
	}
	head, err := gitOut(ctx, info.Root, "rev-parse", "--verify", "HEAD^{commit}")
	if err != nil || head == "" {
		return protocol.ArenaResult{}, fmt.Errorf("this repository has no commits yet")
	}
	res := protocol.ArenaResult{Root: info.Root, Head: head, Branch: info.Branch, RemoteKey: info.RemoteKey}
	if info.Dirty != nil {
		res.Dirty = *info.Dirty
	}
	return res, nil
}

func arenaCreate(ctx context.Context, home string, req protocol.ArenaRequest) (protocol.ArenaResult, error) {
	switch {
	case !arenaIdRe.MatchString(req.ArenaId):
		return protocol.ArenaResult{}, fmt.Errorf("invalid arena id")
	case !arenaNameRe.MatchString(req.Name):
		return protocol.ArenaResult{}, fmt.Errorf("invalid worktree name")
	case !arenaCommitRe.MatchString(req.Commit):
		return protocol.ArenaResult{}, fmt.Errorf("invalid commit")
	case !arenaBranchOK(req.ArenaId, req.Branch):
		return protocol.ArenaResult{}, fmt.Errorf("invalid branch name")
	}
	info, err := arenaRepo(ctx, home, req.Repo, req.RemoteKey)
	if err != nil {
		return protocol.ArenaResult{}, err
	}
	// Serialise per clone: parallel worktree adds race on git's own locks.
	mu, _ := prepareRepoLocks.LoadOrStore("arena:"+info.Root, new(sync.Mutex))
	lock := mu.(*sync.Mutex)
	lock.Lock()
	defer lock.Unlock()

	short := req.Commit[:7]
	if _, err := arenaGit(ctx, info.Root, nil, "cat-file", "-e", req.Commit+"^{commit}"); err != nil {
		// The commit may only exist on the remote: fetching moves only
		// remote-tracking refs.
		fctx, cancel := context.WithTimeout(ctx, arenaFetchTimeout)
		arenaGit(fctx, info.Root, nil, "fetch", "--quiet", "origin")
		cancel()
		if _, err := arenaGit(ctx, info.Root, nil, "cat-file", "-e", req.Commit+"^{commit}"); err != nil {
			return protocol.ArenaResult{}, fmt.Errorf("this machine does not have commit %s yet. Pull or push it there first", short)
		}
	}
	dir := filepath.Join(arenaBase(home), req.ArenaId)
	path := filepath.Join(dir, req.Name)
	if pathExists(path) {
		return protocol.ArenaResult{}, fmt.Errorf("the worktree folder already exists")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return protocol.ArenaResult{}, diskError(err)
	}
	if _, err := arenaGit(ctx, info.Root, nil, "worktree", "prune"); err != nil {
		_ = err // best effort
	}
	if out, err := arenaGit(ctx, info.Root, nil, "worktree", "add", "-b", req.Branch, path, req.Commit); err != nil {
		os.Remove(dir) // only succeeds when empty
		if strings.Contains(strings.ToLower(out), "no space left") {
			return protocol.ArenaResult{}, fmt.Errorf("this machine is out of disk space")
		}
		return protocol.ArenaResult{}, err
	}
	wt := canonPath(path)
	cwd := wt
	if rel, err := filepath.Rel(canonPath(info.Root), canonPath(info.Resolved)); err == nil && rel != "." && !strings.HasPrefix(rel, "..") {
		if sub := filepath.Join(wt, rel); dirExists(sub) {
			cwd = sub
		}
	}
	return protocol.ArenaResult{Path: wt, Cwd: cwd, Root: info.Root}, nil
}

// arenaStats counts what changed in a worktree since the base commit,
// untracked files included, without touching the worktree's own index (a
// running agent may be using it): a throwaway index is filled from the base
// and then from the files on disk.
func arenaStats(ctx context.Context, home string, req protocol.ArenaRequest) (protocol.ArenaResult, error) {
	path, err := arenaWorktreePath(home, req.ArenaId, req.Worktree)
	if err != nil {
		return protocol.ArenaResult{}, err
	}
	if !arenaCommitRe.MatchString(req.Base) {
		return protocol.ArenaResult{}, fmt.Errorf("invalid commit")
	}
	if !dirExists(path) {
		return protocol.ArenaResult{}, fmt.Errorf("the worktree is gone")
	}
	tmp, err := os.CreateTemp("", "overseer-arena-index-*")
	if err != nil {
		return protocol.ArenaResult{}, err
	}
	name := tmp.Name()
	tmp.Close()
	os.Remove(name) // git wants to create it
	defer os.Remove(name)
	env := []string{"GIT_INDEX_FILE=" + name}
	if _, err := arenaGit(ctx, path, env, "read-tree", req.Base); err != nil {
		return protocol.ArenaResult{}, err
	}
	if _, err := arenaGit(ctx, path, env, "add", "-A"); err != nil {
		return protocol.ArenaResult{}, err
	}
	out, err := arenaGit(ctx, path, env, "diff", "--cached", "--numstat", "--no-renames", "-z", req.Base)
	if err != nil {
		return protocol.ArenaResult{}, err
	}
	return parseNumstat(out), nil
}

// parseNumstat reads `git diff --numstat -z`: "add\tdel\tpath\0" records
// ("-" for binary files).
func parseNumstat(out string) protocol.ArenaResult {
	var res protocol.ArenaResult
	for _, rec := range strings.Split(out, "\x00") {
		rec = strings.TrimSpace(rec)
		if rec == "" {
			continue
		}
		parts := strings.SplitN(rec, "\t", 3)
		if len(parts) != 3 {
			continue
		}
		add, _ := strconv.Atoi(parts[0]) // "-" (binary) counts as 0
		del, _ := strconv.Atoi(parts[1])
		res.Files++
		res.Additions += add
		res.Deletions += del
		if len(res.Changed) < arenaMaxChanged {
			res.Changed = append(res.Changed, protocol.ArenaFile{Path: parts[2], Additions: add, Deletions: del})
		}
	}
	return res
}

func (a *Agent) arenaCheck(home string, req protocol.ArenaRequest) (protocol.ArenaResult, error) {
	path, err := arenaWorktreePath(home, req.ArenaId, req.Worktree)
	if err != nil {
		return protocol.ArenaResult{}, err
	}
	command := strings.TrimSpace(req.Command)
	if command == "" || len(command) > 2000 || strings.ContainsRune(command, 0) {
		return protocol.ArenaResult{}, fmt.Errorf("invalid check command")
	}
	if !dirExists(path) {
		return protocol.ArenaResult{}, fmt.Errorf("the worktree is gone")
	}
	timeout := req.TimeoutSec
	if timeout <= 0 || timeout > 600 {
		timeout = 600
	}
	started := time.Now()
	r := a.execCommand(protocol.Exec{Command: command, Cwd: path, TimeoutSec: timeout})
	out := strings.TrimSpace(r.Stdout)
	if e := strings.TrimSpace(r.Stderr); e != "" {
		if out != "" {
			out += "\n"
		}
		out += e
	}
	if len(out) > arenaOutputTail {
		out = "…" + out[len(out)-arenaOutputTail:]
	}
	return protocol.ArenaResult{ExitCode: r.ExitCode, Output: out, DurationMs: time.Since(started).Milliseconds()}, nil
}

// arenaCommit saves everything the contestant left in its worktree as one
// commit on its own branch, so branch, patch and PR all see the same thing.
// It returns the branch's head.
func arenaCommit(ctx context.Context, path, title string) (string, error) {
	if _, err := arenaGit(ctx, path, nil, "add", "-A"); err != nil {
		return "", err
	}
	if st, err := arenaGit(ctx, path, nil, "status", "--porcelain"); err == nil && st != "" {
		args := []string{"-c", "commit.gpgsign=false"}
		if email, _ := arenaGit(ctx, path, nil, "config", "user.email"); email == "" {
			args = append(args, "-c", "user.name=Overseer Arena", "-c", "user.email=arena@overseer.invalid")
		}
		if title == "" {
			title = "Arena result"
		}
		args = append(args, "commit", "--no-verify", "-q", "-m", title)
		if _, err := arenaGit(ctx, path, nil, args...); err != nil {
			return "", err
		}
	}
	return arenaGit(ctx, path, nil, "rev-parse", "HEAD")
}

func arenaCommitOp(ctx context.Context, home string, req protocol.ArenaRequest) (protocol.ArenaResult, error) {
	path, err := arenaWorktreePath(home, req.ArenaId, req.Worktree)
	if err != nil {
		return protocol.ArenaResult{}, err
	}
	title := strings.Join(strings.Fields(arenaClean(req.Title, 200)), " ")
	head, err := arenaCommit(ctx, path, title)
	if err != nil {
		return protocol.ArenaResult{}, err
	}
	return protocol.ArenaResult{Head: head}, nil
}

func arenaClean(s string, max int) string {
	s = strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' || r >= 0x20 && r != 0x7f {
			return r
		}
		return -1
	}, s)
	if len(s) > max {
		s = s[:max]
	}
	return strings.TrimSpace(s)
}

func arenaPR(ctx context.Context, home string, req protocol.ArenaRequest) (protocol.ArenaResult, error) {
	path, err := arenaWorktreePath(home, req.ArenaId, req.Worktree)
	if err != nil {
		return protocol.ArenaResult{}, err
	}
	if !arenaBranchOK(req.ArenaId, req.Branch) {
		return protocol.ArenaResult{}, fmt.Errorf("invalid branch name")
	}
	title := strings.Join(strings.Fields(arenaClean(req.Title, 200)), " ")
	if title == "" {
		title = "Arena result"
	}
	if _, err := arenaCommit(ctx, path, title); err != nil {
		return protocol.ArenaResult{}, err
	}
	if out, err := arenaGit(ctx, path, nil, "push", "-u", "origin", req.Branch+":"+req.Branch); err != nil {
		low := strings.ToLower(out)
		if strings.Contains(low, "could not read username") || strings.Contains(low, "authentication") || strings.Contains(low, "permission denied") {
			return protocol.ArenaResult{}, fmt.Errorf("this machine is not signed in to GitHub. Run “gh auth login” there")
		}
		return protocol.ArenaResult{}, fmt.Errorf("could not push the branch: %s", lastLine(out))
	}
	gh := ghLookup()
	if gh == "" {
		return protocol.ArenaResult{Note: "pushed"}, fmt.Errorf("pushed %s, but the GitHub CLI is not installed on this machine, so no pull request was opened", req.Branch)
	}
	args := []string{"pr", "create", "--head", req.Branch, "--title", title, "--body", arenaClean(req.Body, 8000)}
	if b := strings.TrimSpace(req.BaseBranch); b != "" && validBranch(b) {
		args = append(args, "--base", b)
	}
	out, err := runCmd(ctx, path, gh, args...)
	if err != nil {
		if strings.Contains(out, "already exists") {
			if m := regexp.MustCompile(`https://\S+/pull/\d+`).FindString(out); m != "" {
				return protocol.ArenaResult{Url: m, Note: "A pull request for this branch already existed."}, nil
			}
		}
		return protocol.ArenaResult{Note: "pushed"}, fmt.Errorf("pushed %s, but opening the pull request failed: %s", req.Branch, lastLine(out))
	}
	url := regexp.MustCompile(`https://\S+/pull/\d+`).FindString(out)
	if url == "" {
		url = lastLine(out)
	}
	return protocol.ArenaResult{Url: url}, nil
}

// arenaPatchText commits the worktree and returns its changes since base.
func arenaPatchText(ctx context.Context, home string, req protocol.ArenaRequest) (string, string, error) {
	path, err := arenaWorktreePath(home, req.ArenaId, req.Worktree)
	if err != nil {
		return "", "", err
	}
	if !arenaCommitRe.MatchString(req.Base) {
		return "", "", fmt.Errorf("invalid commit")
	}
	head, err := arenaCommit(ctx, path, req.Title)
	if err != nil {
		return "", "", err
	}
	cctx, cancel := context.WithTimeout(ctx, arenaStepTimeout)
	defer cancel()
	cmd := exec.CommandContext(cctx, "git", "diff", "--binary", "--no-color", "--no-ext-diff", req.Base, head)
	cmd.Dir = path
	var stdout bytes.Buffer
	cmd.Stdout = &arenaCapWriter{w: &stdout, left: arenaMaxPatch + 1}
	if err := cmd.Run(); err != nil {
		return "", "", fmt.Errorf("could not make the patch: %v", err)
	}
	if stdout.Len() > arenaMaxPatch {
		return "", "", fmt.Errorf("the patch is larger than %d MB. Open a pull request instead", arenaMaxPatch>>20)
	}
	return stdout.String(), head, nil
}

func arenaPatch(ctx context.Context, home string, req protocol.ArenaRequest) (protocol.ArenaResult, error) {
	patch, _, err := arenaPatchText(ctx, home, req)
	if err != nil {
		return protocol.ArenaResult{}, err
	}
	return protocol.ArenaResult{Patch: patch}, nil
}

// arenaApply writes the winner's changes into the user's own folder as
// uncommitted edits. It refuses a folder with any uncommitted change,
// untracked files included, and checks the patch applies before touching it.
func arenaApply(ctx context.Context, home string, req protocol.ArenaRequest) (protocol.ArenaResult, error) {
	info, err := arenaRepo(ctx, home, req.Repo, req.RemoteKey)
	if err != nil {
		return protocol.ArenaResult{}, err
	}
	if info.Dirty == nil || *info.Dirty > 0 {
		n := 0
		if info.Dirty != nil {
			n = *info.Dirty
		}
		return protocol.ArenaResult{Dirty: n}, fmt.Errorf("the folder has uncommitted changes")
	}
	patch, _, err := arenaPatchText(ctx, home, req)
	if err != nil {
		return protocol.ArenaResult{}, err
	}
	if strings.TrimSpace(patch) == "" {
		return protocol.ArenaResult{Note: "This contestant made no changes."}, nil
	}
	f, err := os.CreateTemp("", "overseer-arena-*.patch")
	if err != nil {
		return protocol.ArenaResult{}, err
	}
	defer os.Remove(f.Name())
	if _, err := f.WriteString(patch); err != nil {
		f.Close()
		return protocol.ArenaResult{}, err
	}
	f.Close()
	if out, err := arenaGit(ctx, info.Root, nil, "apply", "--check", f.Name()); err != nil {
		return protocol.ArenaResult{}, fmt.Errorf("the changes do not apply cleanly here (the folder has moved on since the arena started): %s", lastLine(out))
	}
	if _, err := arenaGit(ctx, info.Root, nil, "apply", f.Name()); err != nil {
		return protocol.ArenaResult{}, err
	}
	res := protocol.ArenaResult{Root: info.Root}
	if out, err := arenaGit(ctx, info.Root, nil, "diff", "--numstat", "--no-renames", "-z", "HEAD"); err == nil {
		stat := parseNumstat(out)
		res.Files, res.Additions, res.Deletions = stat.Files, stat.Additions, stat.Deletions
	}
	return res, nil
}

// arenaRemove deletes one contestant's worktree and branch. The folder must
// be one level below this arena's own folder; nothing else is ever removed.
func arenaRemove(ctx context.Context, home string, req protocol.ArenaRequest) (protocol.ArenaResult, error) {
	path, err := arenaWorktreePath(home, req.ArenaId, req.Worktree)
	if err != nil {
		return protocol.ArenaResult{}, err
	}
	if req.Branch != "" && !arenaBranchOK(req.ArenaId, req.Branch) {
		return protocol.ArenaResult{}, fmt.Errorf("invalid branch name")
	}
	var repoRoot string
	if req.Repo != "" {
		if info := gitPathInfo(ctx, home, req.Repo); info.IsRepo {
			repoRoot = info.Root
		}
	}
	if repoRoot == "" && dirExists(path) {
		// The worktree knows its clone: <common dir>/.. is the clone's top.
		if common, err := gitOut(ctx, path, "rev-parse", "--path-format=absolute", "--git-common-dir"); err == nil && common != "" {
			repoRoot = filepath.Dir(filepath.FromSlash(common))
		}
	}
	if repoRoot != "" && dirExists(path) {
		arenaGit(ctx, repoRoot, nil, "worktree", "remove", "--force", path)
	}
	// Still there (git refused, or it was never a worktree): it is inside the
	// arena's own folder, so it can go. A symlink is unlinked, not followed.
	if st, err := os.Lstat(path); err == nil {
		if st.Mode()&os.ModeSymlink != 0 {
			os.Remove(path)
		} else if err := os.RemoveAll(path); err != nil {
			return protocol.ArenaResult{}, fmt.Errorf("could not remove the folder: %v", err)
		}
	}
	if repoRoot != "" {
		arenaGit(ctx, repoRoot, nil, "worktree", "prune")
		if req.Branch != "" {
			if exists := refExists(ctx, repoRoot, "refs/heads/"+req.Branch); exists {
				arenaGit(ctx, repoRoot, nil, "branch", "-D", req.Branch)
			}
		}
	}
	os.Remove(filepath.Dir(path)) // the arena's folder, once it is empty
	return protocol.ArenaResult{}, nil
}

// arenaCapWriter stops copying after left bytes but keeps accepting writes, so
// the child never blocks on a full pipe.
type arenaCapWriter struct {
	w    *bytes.Buffer
	left int
}

func (l *arenaCapWriter) Write(p []byte) (int, error) {
	if l.left > 0 {
		n := len(p)
		if n > l.left {
			n = l.left
		}
		l.w.Write(p[:n])
		l.left -= n
	}
	return len(p), nil
}
