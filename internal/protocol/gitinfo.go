package protocol

import (
	"net/url"
	"strings"
)

// Git info for "where will this run": whether a folder exists on a device,
// which repo and branch it is on, and where its origin points. The UI uses it
// to show the same repo across machines. See "Where it runs" in the UI.

// TypeGitInfo is a hub -> agent request (carries Id); the reply is GitInfoResult.
const TypeGitInfo = "git.info"

// GitInfoRequest asks about up to MaxGitInfoPaths folders. "~" is expanded on
// the device.
type GitInfoRequest struct {
	Paths []string `json:"paths"`
}

// MaxGitInfoPaths bounds one request: the check is per folder, not a crawl.
const MaxGitInfoPaths = 32

// GitPathInfo is the answer for one requested path.
type GitPathInfo struct {
	Path      string `json:"path"`             // as requested
	Resolved  string `json:"resolved"`         // absolute, after "~" and Clean
	Exists    bool   `json:"exists"`           // the folder exists
	IsRepo    bool   `json:"isRepo"`           // inside a git work tree
	Root      string `json:"root,omitempty"`   // work tree root (may be above Resolved)
	Branch    string `json:"branch,omitempty"` // branch name, or a short commit when detached
	Detached  bool   `json:"detached,omitempty"`
	Remote    string `json:"remote,omitempty"`    // origin URL with credentials removed
	RemoteKey string `json:"remoteKey,omitempty"` // normalised remote: the same repo on any machine
	// Dirty counts changed and untracked entries; nil when it could not be
	// read in time.
	Dirty *int `json:"dirty,omitempty"`
}

// GitInfoResult is the reply to git.info. Home lets the UI show "~" paths.
type GitInfoResult struct {
	Home  string        `json:"home"`
	Paths []GitPathInfo `json:"paths"`
}

// NormalizeRemote turns any git remote URL into "host/owner/repo" so ssh and
// https forms of one repo compare equal. It also returns the URL with any
// user:password removed. Empty or unparseable input returns empty strings.
func NormalizeRemote(raw string) (key, clean string) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", ""
	}
	host, path := "", ""
	if strings.Contains(raw, "://") {
		u, err := url.Parse(raw)
		if err != nil {
			return "", ""
		}
		host, path = u.Hostname(), u.Path
		clean = u.Scheme + "://" + u.Host + u.Path
		if u.Scheme == "file" || host == "" {
			return strings.TrimSuffix(strings.TrimRight(path, "/"), ".git"), clean
		}
	} else if at := strings.Index(raw, "@"); at >= 0 && strings.Contains(raw[at:], ":") {
		// scp-like: git@github.com:owner/repo.git
		rest := raw[at+1:]
		i := strings.Index(rest, ":")
		host, path = rest[:i], rest[i+1:]
		clean = raw[at+1:]
	} else if i := strings.Index(raw, ":"); i > 0 && !strings.ContainsAny(raw[:i], `/\`) {
		host, path = raw[:i], raw[i+1:]
		clean = raw
	} else {
		// A local path used as the remote.
		return strings.TrimSuffix(strings.TrimRight(raw, "/"), ".git"), raw
	}
	path = strings.TrimSuffix(strings.Trim(path, "/"), ".git")
	if host == "" || path == "" {
		return "", clean
	}
	return strings.ToLower(host) + "/" + path, clean
}
