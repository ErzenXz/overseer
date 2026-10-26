package agent

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// git.info answers "is this folder a repo on this machine, and on what
// branch" for a handful of known folders. It is a bounded check, never a
// filesystem crawl: at most MaxGitInfoPaths folders, a few git calls each,
// each call under a short timeout.

const (
	gitCallTimeout  = 3 * time.Second
	gitTotalTimeout = 8 * time.Second
	gitParallel     = 6
)

func (a *Agent) gitInfo(req protocol.GitInfoRequest) protocol.GitInfoResult {
	home, _ := os.UserHomeDir()
	paths := req.Paths
	if len(paths) > protocol.MaxGitInfoPaths {
		paths = paths[:protocol.MaxGitInfoPaths]
	}
	res := protocol.GitInfoResult{Home: home, Paths: make([]protocol.GitPathInfo, len(paths))}
	ctx, cancel := context.WithTimeout(context.Background(), gitTotalTimeout)
	defer cancel()
	sem := make(chan struct{}, gitParallel)
	var wg sync.WaitGroup
	for i, p := range paths {
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			res.Paths[i] = gitPathInfo(ctx, home, p)
		}()
	}
	wg.Wait()
	return res
}

// resolveGitPath expands "~" (an empty path means home) and cleans the result.
func resolveGitPath(home, path string) string {
	if path == "" {
		path = home
	}
	path = expandHome(path)
	if path == "" {
		return ""
	}
	return filepath.Clean(path)
}

func gitPathInfo(ctx context.Context, home, path string) protocol.GitPathInfo {
	info := protocol.GitPathInfo{Path: path, Resolved: resolveGitPath(home, path)}
	if info.Resolved == "" {
		return info
	}
	st, err := os.Stat(info.Resolved)
	if err != nil || !st.IsDir() {
		return info
	}
	info.Exists = true
	root, err := gitOut(ctx, info.Resolved, "rev-parse", "--show-toplevel")
	if err != nil || root == "" {
		return info // no git installed, or not a work tree
	}
	info.IsRepo = true
	info.Root = filepath.FromSlash(root)

	if out, err := gitOut(ctx, info.Resolved, "status", "--porcelain=v2", "--branch", "--untracked-files=normal"); err == nil {
		dirty := 0
		oid := ""
		for _, line := range strings.Split(out, "\n") {
			switch {
			case strings.HasPrefix(line, "# branch.head "):
				info.Branch = strings.TrimPrefix(line, "# branch.head ")
			case strings.HasPrefix(line, "# branch.oid "):
				oid = strings.TrimPrefix(line, "# branch.oid ")
			case line != "" && !strings.HasPrefix(line, "#"):
				dirty++
			}
		}
		info.Dirty = &dirty
		if info.Branch == "(detached)" {
			info.Detached = true
			info.Branch = oid
			if len(oid) > 7 {
				info.Branch = oid[:7]
			}
		}
	} else if out, err := gitOut(ctx, info.Resolved, "rev-parse", "--abbrev-ref", "HEAD"); err == nil {
		// status was too slow (a huge work tree): the branch is still cheap.
		info.Branch = out
		info.Detached = out == "HEAD"
	}

	remote, _ := gitOut(ctx, info.Resolved, "config", "--get", "remote.origin.url")
	if remote == "" {
		if names, _ := gitOut(ctx, info.Resolved, "remote"); names != "" {
			first := strings.Fields(names)[0]
			remote, _ = gitOut(ctx, info.Resolved, "config", "--get", "remote."+first+".url")
		}
	}
	info.RemoteKey, info.Remote = protocol.NormalizeRemote(remote)
	return info
}

// gitOut runs one git command in dir and returns its trimmed stdout. Git
// never prompts and never takes the index lock, so asking cannot disturb a
// running agent.
func gitOut(ctx context.Context, dir string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, gitCallTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_OPTIONAL_LOCKS=0", "GIT_TERMINAL_PROMPT=0", "LC_ALL=C")
	cmd.WaitDelay = time.Second
	out, err := cmd.Output()
	return strings.TrimSpace(string(out)), err
}
