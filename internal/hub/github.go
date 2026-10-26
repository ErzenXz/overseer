package hub

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
)

// GitHub lookups for "start a session in this repo": the user's repos, a
// repo's branches, and finding a repo by name or link. They run the GitHub CLI
// on one of the user's machines, exactly like the Review page, so they see
// what `gh` is signed in to there and nothing is stored on the hub.
//
// Every command is built from values checked against the patterns below, so
// nothing the browser sends is ever passed to a shell unchecked.

var (
	ghOwnerRe  = regexp.MustCompile(`^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$`)
	ghRepoRe   = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,100}$`)
	ghSearchRe = regexp.MustCompile(`^[A-Za-z0-9_. /-]{2,80}$`)
)

const (
	ghRepoFields = "nameWithOwner,description,updatedAt,pushedAt,isPrivate,isFork,defaultBranchRef"
	ghMaxOrgs    = 8
)

// githubRepo is one repo as the picker shows it.
type githubRepo struct {
	NameWithOwner string `json:"nameWithOwner"`
	Description   string `json:"description,omitempty"`
	UpdatedAt     string `json:"updatedAt,omitempty"`
	IsPrivate     bool   `json:"isPrivate"`
	IsFork        bool   `json:"isFork,omitempty"`
	DefaultBranch string `json:"defaultBranch,omitempty"`
	pushedAt      string
}

// githubReply is every GitHub answer. Status is "ok", or why it is not:
// "no-gh" (the CLI is missing), "no-auth" (not signed in), "error".
type githubReply struct {
	Status  string `json:"status"`
	Message string `json:"message,omitempty"`

	Login string       `json:"login,omitempty"`
	Repos []githubRepo `json:"repos,omitempty"`
	// Branch is a branch named in a pasted link (…/tree/x).
	Branch string `json:"branch,omitempty"`

	DefaultBranch string         `json:"defaultBranch,omitempty"`
	Branches      []githubBranch `json:"branches,omitempty"`
	More          bool           `json:"more,omitempty"` // the repo has more branches than listed
}

type githubBranch struct {
	Name      string `json:"name"`
	IsDefault bool   `json:"isDefault,omitempty"`
	PR        *struct {
		Number int    `json:"number"`
		Title  string `json:"title"`
		Draft  bool   `json:"draft,omitempty"`
	} `json:"pr,omitempty"`
}

// ghFailure says why a gh command failed, in a form the UI can act on.
type ghFailure struct {
	status  string
	message string
}

func (f *ghFailure) Error() string { return f.message }

// ghRun runs one gh command on the device and returns its stdout.
func (s *Server) ghRun(c *agentConn, command string, timeoutSec int) (string, error) {
	res, err := s.execOnDevice(c, command, "", timeoutSec)
	if err != nil {
		if strings.Contains(err.Error(), "context deadline") {
			return "", &ghFailure{"error", "GitHub took too long to answer."}
		}
		return "", err
	}
	if res.ExitCode == 0 {
		return res.Stdout, nil
	}
	text := strings.TrimSpace(res.Stderr + "\n" + res.Stdout)
	low := strings.ToLower(text)
	switch {
	case res.ExitCode == 127, strings.Contains(low, "command not found"), strings.Contains(low, "not recognized as"),
		strings.Contains(low, "is not recognized"), strings.Contains(low, "no such file or directory") && strings.Contains(low, " gh"):
		return "", &ghFailure{"no-gh", "The GitHub CLI is not installed on this machine."}
	case strings.Contains(low, "gh auth login"), strings.Contains(low, "not logged in"), strings.Contains(low, "http 401"),
		strings.Contains(low, "bad credentials"), strings.Contains(low, "authentication required"):
		return "", &ghFailure{"no-auth", "The GitHub CLI is not signed in on this machine."}
	case strings.Contains(low, "http 404"), strings.Contains(low, "could not resolve to a repository"), strings.Contains(low, "not found"):
		return "", &ghFailure{"not-found", "That repo was not found, or this account has no access to it."}
	case strings.Contains(low, "rate limit"):
		return "", &ghFailure{"error", "GitHub rate limit reached. Try again in a few minutes."}
	case strings.Contains(low, "timed out"):
		return "", &ghFailure{"error", "GitHub took too long to answer."}
	}
	lines := strings.Split(text, "\n")
	return "", &ghFailure{"error", strings.TrimSpace(lines[len(lines)-1])}
}

// ghParallel runs commands at once and returns their outputs in order.
func (s *Server) ghParallel(c *agentConn, commands []string, timeoutSec int) ([]string, []error) {
	outs := make([]string, len(commands))
	errs := make([]error, len(commands))
	var wg sync.WaitGroup
	for i, cmd := range commands {
		wg.Add(1)
		go func() {
			defer wg.Done()
			outs[i], errs[i] = s.ghRun(c, cmd, timeoutSec)
		}()
	}
	wg.Wait()
	return outs, errs
}

// replyGH writes a failure as a normal answer (status + message) so the UI can
// show "sign in" or "install" instead of a generic error. Device-level
// problems (offline, too old) stay HTTP errors.
func replyGH(w http.ResponseWriter, err error) {
	var f *ghFailure
	if errors.As(err, &f) {
		writeJSON(w, githubReply{Status: f.status, Message: f.message})
		return
	}
	if strings.Contains(err.Error(), "unsupported request") {
		err = errors.New("this machine's agent is too old; update it")
	}
	httpError(w, http.StatusBadGateway, err.Error())
}

type ghRawRepo struct {
	NameWithOwner string `json:"nameWithOwner"`
	FullName      string `json:"fullName"` // gh search
	Description   string `json:"description"`
	UpdatedAt     string `json:"updatedAt"`
	PushedAt      string `json:"pushedAt"`
	IsPrivate     bool   `json:"isPrivate"`
	IsFork        bool   `json:"isFork"`
	DefaultBranch string `json:"defaultBranch"` // gh search
	DefaultRef    *struct {
		Name string `json:"name"`
	} `json:"defaultBranchRef"`
}

func parseGHRepos(out string) []githubRepo {
	var raw []ghRawRepo
	if json.Unmarshal([]byte(out), &raw) != nil {
		var one ghRawRepo
		if json.Unmarshal([]byte(out), &one) != nil || (one.NameWithOwner == "" && one.FullName == "") {
			return nil
		}
		raw = []ghRawRepo{one}
	}
	repos := make([]githubRepo, 0, len(raw))
	for _, r := range raw {
		name := r.NameWithOwner
		if name == "" {
			name = r.FullName
		}
		if name == "" {
			continue
		}
		def := r.DefaultBranch
		if r.DefaultRef != nil && r.DefaultRef.Name != "" {
			def = r.DefaultRef.Name
		}
		desc := strings.TrimSpace(r.Description)
		if len(desc) > 160 {
			desc = desc[:160]
		}
		repos = append(repos, githubRepo{NameWithOwner: name, Description: desc, UpdatedAt: r.UpdatedAt, pushedAt: r.PushedAt, IsPrivate: r.IsPrivate, IsFork: r.IsFork, DefaultBranch: def})
	}
	return repos
}

// handleGitHubRepos lists the repos of the signed-in user and of the
// organizations they belong to, most recently pushed first. `gh repo list` is
// slow for long lists (seconds), so ?quick=1 answers with only the 30 newest
// of the user's own: enough to show something while the full list loads.
func (s *Server) handleGitHubRepos(w http.ResponseWriter, r *http.Request) {
	c := s.deviceConn(w, r)
	if c == nil {
		return
	}
	quick := r.URL.Query().Get("quick") != ""
	limit := "100"
	if quick {
		limit = "30"
	}
	cmds := []string{
		"gh repo list --limit " + limit + " --no-archived --json " + ghRepoFields,
		`gh api user --jq ".login"`,
	}
	if !quick {
		cmds = append(cmds, `gh api user/orgs --jq ".[].login"`)
	}
	outs, errs := s.ghParallel(c, cmds, 45)
	if errs[0] != nil {
		replyGH(w, errs[0])
		return
	}
	reply := githubReply{Status: "ok", Login: strings.TrimSpace(outs[1]), Repos: parseGHRepos(outs[0])}

	// Organizations are a bonus: if listing them fails the user's own repos
	// still show.
	if !quick && errs[2] == nil {
		var orgs []string
		for _, org := range strings.Fields(outs[2]) {
			if ghOwnerRe.MatchString(org) && len(orgs) < ghMaxOrgs {
				orgs = append(orgs, org)
			}
		}
		orgCmds := make([]string, len(orgs))
		for i, org := range orgs {
			orgCmds[i] = "gh repo list " + org + " --limit 40 --no-archived --json " + ghRepoFields
		}
		orgOuts, orgErrs := s.ghParallel(c, orgCmds, 45)
		for i := range orgs {
			if orgErrs[i] == nil {
				reply.Repos = append(reply.Repos, parseGHRepos(orgOuts[i])...)
			}
		}
	}

	seen := map[string]bool{}
	repos := reply.Repos[:0]
	for _, repo := range reply.Repos {
		if k := strings.ToLower(repo.NameWithOwner); !seen[k] {
			seen[k] = true
			repos = append(repos, repo)
		}
	}
	sort.SliceStable(repos, func(i, j int) bool { return repos[i].pushedAt > repos[j].pushedAt })
	if len(repos) > 300 {
		repos = repos[:300]
	}
	reply.Repos = repos
	writeJSON(w, reply)
}

// parseRepoRef reads "owner/name", a github.com URL or an ssh remote, and
// returns the repo plus a branch if the link names one (…/tree/feature/x).
func parseRepoRef(text string) (repo, branch string, ok bool) {
	text = strings.TrimSpace(text)
	switch {
	case strings.HasPrefix(text, "git@github.com:"):
		text = strings.TrimPrefix(text, "git@github.com:")
	case strings.Contains(text, "github.com/"):
		if !strings.Contains(text, "://") {
			text = "https://" + text
		}
		u, err := url.Parse(text)
		if err != nil || !strings.EqualFold(strings.TrimPrefix(u.Hostname(), "www."), "github.com") {
			return "", "", false
		}
		text = strings.TrimPrefix(u.Path, "/")
	}
	parts := strings.Split(strings.Trim(text, "/"), "/")
	if len(parts) < 2 {
		return "", "", false
	}
	owner, name := parts[0], strings.TrimSuffix(parts[1], ".git")
	if !ghOwnerRe.MatchString(owner) || !ghRepoRe.MatchString(name) || name == "." || name == ".." {
		return "", "", false
	}
	if len(parts) >= 4 && parts[2] == "tree" {
		branch = strings.Join(parts[3:], "/")
	}
	return owner + "/" + name, branch, true
}

// handleGitHubFind finds repos by a typed name: "owner/name" or a link
// resolves that repo (whoever owns it); other text searches GitHub.
func (s *Server) handleGitHubFind(w http.ResponseWriter, r *http.Request) {
	c := s.deviceConn(w, r)
	if c == nil {
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if repo, branch, ok := parseRepoRef(q); ok {
		out, err := s.ghRun(c, "gh repo view "+repo+" --json "+ghRepoFields, 30)
		if err != nil {
			replyGH(w, err)
			return
		}
		writeJSON(w, githubReply{Status: "ok", Repos: parseGHRepos(out), Branch: branch})
		return
	}
	if !ghSearchRe.MatchString(q) {
		writeJSON(w, githubReply{Status: "ok"})
		return
	}
	out, err := s.ghRun(c, `gh search repos "`+q+`" --limit 12 --json fullName,description,updatedAt,isPrivate,isFork,defaultBranch`, 30)
	if err != nil {
		replyGH(w, err)
		return
	}
	writeJSON(w, githubReply{Status: "ok", Repos: parseGHRepos(out)})
}

// handleGitHubBranches lists a repo's branches: the default first, then
// branches that have an open pull request, then the rest.
func (s *Server) handleGitHubBranches(w http.ResponseWriter, r *http.Request) {
	c := s.deviceConn(w, r)
	if c == nil {
		return
	}
	repo, _, ok := parseRepoRef(r.URL.Query().Get("repo"))
	if !ok {
		httpError(w, http.StatusBadRequest, "repo must be owner/name")
		return
	}
	const perPage = 100
	outs, errs := s.ghParallel(c, []string{
		`gh api "repos/` + repo + `/branches?per_page=100"`,
		"gh repo view " + repo + " --json defaultBranchRef",
		"gh pr list -R " + repo + " --state open --limit 50 --json headRefName,number,title,isDraft,isCrossRepository",
	}, 40)
	if errs[0] != nil {
		replyGH(w, errs[0])
		return
	}
	var listed []struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal([]byte(outs[0]), &listed); err != nil {
		httpError(w, http.StatusBadGateway, "GitHub sent something unexpected")
		return
	}
	reply := githubReply{Status: "ok", More: len(listed) >= perPage}
	if errs[1] == nil {
		var view ghRawRepo
		if json.Unmarshal([]byte(outs[1]), &view) == nil && view.DefaultRef != nil {
			reply.DefaultBranch = view.DefaultRef.Name
		}
	}
	type pr struct {
		Head  string `json:"headRefName"`
		Num   int    `json:"number"`
		Title string `json:"title"`
		Draft bool   `json:"isDraft"`
		Fork  bool   `json:"isCrossRepository"`
	}
	prs := map[string]pr{}
	var prOrder []pr
	if errs[2] == nil {
		var list []pr
		if json.Unmarshal([]byte(outs[2]), &list) == nil {
			for _, p := range list {
				// A branch on someone's fork is not a branch of this repo.
				if p.Fork || p.Head == "" {
					continue
				}
				if _, dup := prs[p.Head]; !dup {
					prs[p.Head] = p
					prOrder = append(prOrder, p)
				}
			}
		}
	}
	sort.SliceStable(prOrder, func(i, j int) bool { return prOrder[i].Num > prOrder[j].Num })

	has := map[string]bool{}
	add := func(name string) {
		if has[name] || name == "" {
			return
		}
		has[name] = true
		b := githubBranch{Name: name, IsDefault: name == reply.DefaultBranch}
		if p, ok := prs[name]; ok {
			b.PR = &struct {
				Number int    `json:"number"`
				Title  string `json:"title"`
				Draft  bool   `json:"draft,omitempty"`
			}{p.Num, p.Title, p.Draft}
		}
		reply.Branches = append(reply.Branches, b)
	}
	add(reply.DefaultBranch)
	for _, p := range prOrder {
		add(p.Head)
	}
	for _, b := range listed {
		add(b.Name)
	}
	writeJSON(w, reply)
}
