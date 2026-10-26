package hub

import (
	"database/sql"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Issue autopilot: label a GitHub issue "overseer" and an agent picks it up on
// a free machine, works on it in its own worktree and opens a pull request.
//
// Issues are untrusted input, so nothing runs for a repo the user has not
// opted in, and by default only issues labelled by the repo's owner or by
// someone with write access are picked up (autopilot_gh.go checks who added
// the label). This file holds the data (repos and runs), the HTTP API and the
// settings validation; the poller and the run lifecycle are in
// autopilot_run.go, the GitHub calls in autopilot_gh.go.

func init() {
	extraSchemas = append(extraSchemas, `
CREATE TABLE IF NOT EXISTS autopilot_repos (
	id             TEXT PRIMARY KEY,
	repo           TEXT NOT NULL COLLATE NOCASE UNIQUE,
	enabled        INTEGER NOT NULL DEFAULT 1,
	label          TEXT NOT NULL DEFAULT 'overseer',
	agent          TEXT NOT NULL DEFAULT 'claude',
	model          TEXT NOT NULL DEFAULT '',
	effort         TEXT NOT NULL DEFAULT '',
	mode           TEXT NOT NULL DEFAULT '',
	access         TEXT NOT NULL DEFAULT 'auto',
	device_id      TEXT NOT NULL DEFAULT '',
	gh_device_id   TEXT NOT NULL DEFAULT '',
	max_concurrent INTEGER NOT NULL DEFAULT 1,
	trust          TEXT NOT NULL DEFAULT 'writers',
	comment        INTEGER NOT NULL DEFAULT 1,
	footer         INTEGER NOT NULL DEFAULT 1,
	created_at     INTEGER NOT NULL,
	acknowledged_at INTEGER NOT NULL DEFAULT 0,
	last_poll_at   INTEGER NOT NULL DEFAULT 0,
	last_error     TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS autopilot_runs (
	id           TEXT PRIMARY KEY,
	repo_id      TEXT NOT NULL DEFAULT '',
	repo         TEXT NOT NULL COLLATE NOCASE,
	number       INTEGER NOT NULL,
	title        TEXT NOT NULL DEFAULT '',
	url          TEXT NOT NULL DEFAULT '',
	author       TEXT NOT NULL DEFAULT '',
	labeller     TEXT NOT NULL DEFAULT '',
	status       TEXT NOT NULL,
	detail       TEXT NOT NULL DEFAULT '',
	device_id    TEXT NOT NULL DEFAULT '',
	thread_id    TEXT NOT NULL DEFAULT '',
	branch       TEXT NOT NULL DEFAULT '',
	base         TEXT NOT NULL DEFAULT '',
	worktree     TEXT NOT NULL DEFAULT '',
	pr_number    INTEGER NOT NULL DEFAULT 0,
	pr_url       TEXT NOT NULL DEFAULT '',
	attempt      INTEGER NOT NULL DEFAULT 1,
	labelled     INTEGER NOT NULL DEFAULT 0,
	commented    INTEGER NOT NULL DEFAULT 0,
	approved     INTEGER NOT NULL DEFAULT 0,
	resumes      INTEGER NOT NULL DEFAULT 0,
	seen_updated TEXT NOT NULL DEFAULT '',
	created_at   INTEGER NOT NULL,
	updated_at   INTEGER NOT NULL,
	phase_at     INTEGER NOT NULL DEFAULT 0,
	started_at   INTEGER NOT NULL DEFAULT 0,
	finished_at  INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS autopilot_runs_issue ON autopilot_runs(repo, number);
CREATE INDEX IF NOT EXISTS autopilot_runs_thread ON autopilot_runs(thread_id);
`)
}

// Run statuses.
const (
	apQueued    = "queued"    // verified, waiting for a free slot or machine
	apPreparing = "preparing" // claiming the issue, making the worktree, starting the session
	apWorking   = "working"   // the agent is working
	apFinishing = "finishing" // committing, pushing, opening the pull request
	apPROpen    = "pr_open"   // a pull request is open
	apMerged    = "merged"
	apClosed    = "closed" // the pull request was closed without merging
	apFailed    = "failed"
	apSkipped   = "skipped" // not picked up: waits for the user's OK
)

func apActive(status string) bool {
	return status == apQueued || status == apPreparing || status == apWorking || status == apFinishing
}

// autopilotRepo is one opted-in repo and how its issues are handled.
type autopilotRepo struct {
	Id            string `json:"id"`
	Repo          string `json:"repo"`
	Enabled       bool   `json:"enabled"`
	Label         string `json:"label"`
	Agent         string `json:"agent"`
	Model         string `json:"model,omitempty"`
	Effort        string `json:"effort,omitempty"`
	Mode          string `json:"mode,omitempty"`
	Access        string `json:"access"`
	DeviceId      string `json:"deviceId"`   // "" = any online machine with a clone
	GhDeviceId    string `json:"ghDeviceId"` // the machine whose gh looks at GitHub
	MaxConcurrent int    `json:"maxConcurrent"`
	Trust         string `json:"trust"` // "writers" or "me"
	Comment       bool   `json:"comment"`
	Footer        bool   `json:"footer"`
	CreatedAt     int64  `json:"createdAt"`
	LastPollAt    int64  `json:"lastPollAt"`
	LastError     string `json:"lastError,omitempty"`
	Active        int    `json:"active"` // runs in flight, filled in by the API
}

// autopilotRun is one issue's journey.
type autopilotRun struct {
	Id         string `json:"id"`
	RepoId     string `json:"repoId"`
	Repo       string `json:"repo"`
	Number     int    `json:"number"`
	Title      string `json:"title"`
	Url        string `json:"url"`
	Author     string `json:"author,omitempty"`
	Labeller   string `json:"labeller,omitempty"`
	Status     string `json:"status"`
	Detail     string `json:"detail,omitempty"`
	DeviceId   string `json:"deviceId,omitempty"`
	DeviceName string `json:"deviceName,omitempty"`
	ThreadId   string `json:"threadId,omitempty"`
	Branch     string `json:"branch,omitempty"`
	Base       string `json:"base,omitempty"`
	Worktree   string `json:"worktree,omitempty"`
	PRNumber   int    `json:"prNumber,omitempty"`
	PRUrl      string `json:"prUrl,omitempty"`
	Attempt    int    `json:"attempt"`
	Approved   bool   `json:"approved,omitempty"`
	CreatedAt  int64  `json:"createdAt"`
	UpdatedAt  int64  `json:"updatedAt"`
	StartedAt  int64  `json:"startedAt,omitempty"`
	FinishedAt int64  `json:"finishedAt,omitempty"`
	// ThreadStatus is the session's own status while it runs (API only).
	ThreadStatus string `json:"threadStatus,omitempty"`

	Labelled  bool   `json:"-"` // the issue carries overseer:working
	Commented bool   `json:"-"` // "working on this" was posted
	Resumes   int    `json:"-"`
	PhaseAt   int64  `json:"-"` // when Status last changed
	Seen      string `json:"-"` // the issue's updatedAt when it was last judged
}

// ---- store ----

const apRepoColumns = `id, repo, enabled, label, agent, model, effort, mode, access, device_id, gh_device_id,
	max_concurrent, trust, comment, footer, created_at, last_poll_at, last_error`

func scanAutopilotRepo(row rowScanner) (*autopilotRepo, error) {
	var r autopilotRepo
	err := row.Scan(&r.Id, &r.Repo, &r.Enabled, &r.Label, &r.Agent, &r.Model, &r.Effort, &r.Mode, &r.Access,
		&r.DeviceId, &r.GhDeviceId, &r.MaxConcurrent, &r.Trust, &r.Comment, &r.Footer, &r.CreatedAt, &r.LastPollAt, &r.LastError)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func (s *Store) apListRepos() ([]autopilotRepo, error) {
	rows, err := s.db.Query(`SELECT ` + apRepoColumns + ` FROM autopilot_repos ORDER BY created_at, repo`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []autopilotRepo{}
	for rows.Next() {
		r, err := scanAutopilotRepo(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

func (s *Store) apRepoById(id string) (*autopilotRepo, error) {
	r, err := scanAutopilotRepo(s.db.QueryRow(`SELECT `+apRepoColumns+` FROM autopilot_repos WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return r, err
}

func (s *Store) apRepoByName(repo string) (*autopilotRepo, error) {
	r, err := scanAutopilotRepo(s.db.QueryRow(`SELECT `+apRepoColumns+` FROM autopilot_repos WHERE repo = ?`, repo))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return r, err
}

func (s *Store) apInsertRepo(r autopilotRepo) error {
	_, err := s.db.Exec(`INSERT INTO autopilot_repos (id, repo, enabled, label, agent, model, effort, mode, access, device_id,
		gh_device_id, max_concurrent, trust, comment, footer, created_at, acknowledged_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		r.Id, r.Repo, r.Enabled, r.Label, r.Agent, r.Model, r.Effort, r.Mode, r.Access, r.DeviceId, r.GhDeviceId,
		r.MaxConcurrent, r.Trust, r.Comment, r.Footer, r.CreatedAt, r.CreatedAt)
	return err
}

func (s *Store) apSaveRepo(r autopilotRepo) error {
	_, err := s.db.Exec(`UPDATE autopilot_repos SET enabled=?, label=?, agent=?, model=?, effort=?, mode=?, access=?, device_id=?,
		gh_device_id=?, max_concurrent=?, trust=?, comment=?, footer=? WHERE id=?`,
		r.Enabled, r.Label, r.Agent, r.Model, r.Effort, r.Mode, r.Access, r.DeviceId, r.GhDeviceId,
		r.MaxConcurrent, r.Trust, r.Comment, r.Footer, r.Id)
	return err
}

func (s *Store) apRecordPoll(id, errText string) {
	s.db.Exec(`UPDATE autopilot_repos SET last_poll_at = ?, last_error = ? WHERE id = ?`, time.Now().Unix(), errText, id)
}

func (s *Store) apDeleteRepo(id string) error {
	_, err := s.db.Exec(`DELETE FROM autopilot_repos WHERE id = ?`, id)
	return err
}

const apRunColumns = `r.id, r.repo_id, r.repo, r.number, r.title, r.url, r.author, r.labeller, r.status, r.detail, r.device_id,
	COALESCE(d.name, ''), r.thread_id, r.branch, r.base, r.worktree, r.pr_number, r.pr_url, r.attempt, r.labelled, r.commented,
	r.approved, r.resumes, r.seen_updated, r.created_at, r.updated_at, r.phase_at, r.started_at, r.finished_at`

func scanAutopilotRun(row rowScanner) (*autopilotRun, error) {
	var r autopilotRun
	err := row.Scan(&r.Id, &r.RepoId, &r.Repo, &r.Number, &r.Title, &r.Url, &r.Author, &r.Labeller, &r.Status, &r.Detail, &r.DeviceId,
		&r.DeviceName, &r.ThreadId, &r.Branch, &r.Base, &r.Worktree, &r.PRNumber, &r.PRUrl, &r.Attempt, &r.Labelled, &r.Commented,
		&r.Approved, &r.Resumes, &r.Seen, &r.CreatedAt, &r.UpdatedAt, &r.PhaseAt, &r.StartedAt, &r.FinishedAt)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func (s *Store) apQueryRuns(where string, args ...any) ([]autopilotRun, error) {
	rows, err := s.db.Query(`SELECT `+apRunColumns+` FROM autopilot_runs r LEFT JOIN devices d ON d.id = r.device_id `+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []autopilotRun{}
	for rows.Next() {
		r, err := scanAutopilotRun(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

func (s *Store) apRecentRuns(limit int) ([]autopilotRun, error) {
	return s.apQueryRuns(`ORDER BY r.updated_at DESC, r.number DESC LIMIT ?`, limit)
}

func (s *Store) apActiveRuns() ([]autopilotRun, error) {
	return s.apQueryRuns(`WHERE r.status IN ('queued','preparing','working','finishing') ORDER BY r.created_at, r.number`)
}

func (s *Store) apRunById(id string) (*autopilotRun, error) {
	runs, err := s.apQueryRuns(`WHERE r.id = ?`, id)
	if err != nil || len(runs) == 0 {
		return nil, err
	}
	return &runs[0], nil
}

func (s *Store) apRunByIssue(repo string, number int) (*autopilotRun, error) {
	runs, err := s.apQueryRuns(`WHERE r.repo = ? AND r.number = ?`, repo, number)
	if err != nil || len(runs) == 0 {
		return nil, err
	}
	return &runs[0], nil
}

func (s *Store) apRunByThread(threadId string) (*autopilotRun, error) {
	runs, err := s.apQueryRuns(`WHERE r.thread_id = ? ORDER BY r.updated_at DESC LIMIT 1`, threadId)
	if err != nil || len(runs) == 0 {
		return nil, err
	}
	return &runs[0], nil
}

func (s *Store) apRunsOfRepo(repo, status string) ([]autopilotRun, error) {
	return s.apQueryRuns(`WHERE r.repo = ? AND r.status = ? ORDER BY r.number`, repo, status)
}

// apInsertRun stores a newly seen issue. It returns false when the issue was
// already known: the unique (repo, number) index is what guarantees one issue
// never runs twice, even if two polls overlap.
func (s *Store) apInsertRun(r autopilotRun) (bool, error) {
	now := time.Now().Unix()
	res, err := s.db.Exec(`INSERT OR IGNORE INTO autopilot_runs (id, repo_id, repo, number, title, url, author, labeller, status, detail,
		attempt, approved, seen_updated, created_at, updated_at, phase_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		r.Id, r.RepoId, r.Repo, r.Number, r.Title, r.Url, r.Author, r.Labeller, r.Status, r.Detail, 1, r.Approved, r.Seen, now, now, now)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// apFields are the columns a run update may set; the keys are code constants.
type apFields map[string]any

var apSettable = map[string]bool{
	"title": true, "url": true, "author": true, "labeller": true, "status": true, "detail": true, "device_id": true,
	"thread_id": true, "branch": true, "base": true, "worktree": true, "pr_number": true, "pr_url": true, "attempt": true,
	"labelled": true, "commented": true, "approved": true, "resumes": true, "seen_updated": true, "started_at": true,
	"finished_at": true, "repo_id": true,
}

// apUpdate sets columns of a run. Changing status also stamps phase_at.
func (s *Store) apUpdate(id string, f apFields) error {
	sets := []string{"updated_at = ?"}
	args := []any{time.Now().Unix()}
	if _, ok := f["status"]; ok {
		sets = append(sets, "phase_at = ?")
		args = append(args, time.Now().Unix())
	}
	for k, v := range f {
		if !apSettable[k] {
			return errors.New("autopilot: unknown column " + k)
		}
		sets = append(sets, k+" = ?")
		args = append(args, v)
	}
	args = append(args, id)
	_, err := s.db.Exec(`UPDATE autopilot_runs SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...)
	return err
}

// ---- state kept in memory ----

// autopilotState is the part of the autopilot that lives only while the hub
// runs. Everything that must survive a restart is in the tables above.
type autopilotState struct {
	mu        sync.Mutex
	driving   map[string]bool      // run id -> a goroutine is driving it
	nextPoll  map[string]time.Time // repo id -> when to look again
	polling   map[string]bool      // repo id -> a poll is running
	labelsOK  map[string]bool      // "device|repo" -> the overseer:* labels exist
	holdUntil map[string]time.Time // run id -> do not retry placing it before this
	resumedAt map[string]time.Time // run id -> last time a stopped session was nudged
	waitingAt map[string]time.Time // run id -> since when the session has waited for an approval
	offlineAt map[string]time.Time // run id -> since when its machine has been offline
}

func (a *autopilotState) markDriving(id string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.driving == nil {
		a.driving = map[string]bool{}
	}
	if a.driving[id] {
		return false
	}
	a.driving[id] = true
	return true
}

func (a *autopilotState) doneDriving(id string) {
	a.mu.Lock()
	delete(a.driving, id)
	delete(a.holdUntil, id)
	delete(a.resumedAt, id)
	delete(a.waitingAt, id)
	delete(a.offlineAt, id)
	a.mu.Unlock()
}

// ---- validation ----

var apLabelRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9 _.:/-]{0,49}$`)

const (
	apDefaultLabel = "overseer"
	apLabelWorking = "overseer:working"
	apLabelDone    = "overseer:done"
	apLabelFailed  = "overseer:failed"
)

// apRepoInput is a create or patch body; pointers tell "absent" from "empty".
type apRepoInput struct {
	Repo          *string `json:"repo"`
	Enabled       *bool   `json:"enabled"`
	Label         *string `json:"label"`
	Agent         *string `json:"agent"`
	Model         *string `json:"model"`
	Effort        *string `json:"effort"`
	Mode          *string `json:"mode"`
	Access        *string `json:"access"`
	DeviceId      *string `json:"deviceId"`
	GhDeviceId    *string `json:"ghDeviceId"`
	MaxConcurrent *int    `json:"maxConcurrent"`
	Trust         *string `json:"trust"`
	Comment       *bool   `json:"comment"`
	Footer        *bool   `json:"footer"`
	// Acknowledge is the user's explicit opt-in: required to add a repo.
	Acknowledge bool `json:"acknowledge"`
}

func (in apRepoInput) apply(r *autopilotRepo) {
	str := func(dst *string, src *string) {
		if src != nil {
			*dst = strings.TrimSpace(*src)
		}
	}
	str(&r.Label, in.Label)
	str(&r.Agent, in.Agent)
	str(&r.Model, in.Model)
	str(&r.Effort, in.Effort)
	str(&r.Mode, in.Mode)
	str(&r.Access, in.Access)
	str(&r.DeviceId, in.DeviceId)
	str(&r.GhDeviceId, in.GhDeviceId)
	str(&r.Trust, in.Trust)
	if in.Enabled != nil {
		r.Enabled = *in.Enabled
	}
	if in.MaxConcurrent != nil {
		r.MaxConcurrent = *in.MaxConcurrent
	}
	if in.Comment != nil {
		r.Comment = *in.Comment
	}
	if in.Footer != nil {
		r.Footer = *in.Footer
	}
}

// validateAutopilotRepo checks r and returns a problem for the user, if any.
func (s *Server) validateAutopilotRepo(r *autopilotRepo) string {
	if r.Label == "" {
		r.Label = apDefaultLabel
	}
	if r.Access == "" {
		r.Access = "auto"
	}
	if r.Trust == "" {
		r.Trust = "writers"
	}
	if r.MaxConcurrent == 0 {
		r.MaxConcurrent = 1
	}
	switch {
	case !apLabelRe.MatchString(r.Label):
		return "the label can use letters, digits, spaces and - _ . : / (up to 50 characters)"
	case strings.HasPrefix(strings.ToLower(r.Label), "overseer:"):
		return "that label is used by Overseer itself; choose another trigger label"
	case !s.agents.valid(r.Agent) || r.Agent == "acp":
		return "choose one of the listed agents"
	case !validAccess(r.Access):
		return "access must be ask, edits, auto or full"
	case !validOptionId(r.Effort) || !validOptionId(r.Mode) || len(r.Model) > 128 || strings.ContainsAny(r.Model, "\x00\n"):
		return "model, thinking or mode is invalid"
	case r.Trust != "writers" && r.Trust != "me":
		return "trust must be writers or me"
	case r.MaxConcurrent < 1 || r.MaxConcurrent > 5:
		return "max concurrent must be between 1 and 5"
	case r.GhDeviceId == "":
		return "choose the machine whose GitHub CLI should watch this repo"
	}
	for _, id := range []string{r.GhDeviceId, r.DeviceId} {
		if id == "" {
			continue
		}
		if d, err := s.store.DeviceById(id); err != nil || d == nil {
			return "that machine does not exist"
		}
	}
	return ""
}

// ---- HTTP ----

func (s *Server) routesAutopilot(m *http.ServeMux) {
	s.routesShots(m) // the screenshots share this hook
	m.HandleFunc("GET /api/autopilot", s.requireAuth(s.handleAutopilotOverview))
	m.HandleFunc("POST /api/autopilot/repos", s.requireAuth(s.handleAutopilotAddRepo))
	m.HandleFunc("PATCH /api/autopilot/repos/{id}", s.requireAuth(s.handleAutopilotPatchRepo))
	m.HandleFunc("DELETE /api/autopilot/repos/{id}", s.requireAuth(s.handleAutopilotDeleteRepo))
	m.HandleFunc("POST /api/autopilot/repos/{id}/poll", s.requireAuth(s.handleAutopilotPoll))
	m.HandleFunc("POST /api/autopilot/runs/{id}/retry", s.requireAuth(s.handleAutopilotRetry))
	m.HandleFunc("POST /api/autopilot/runs/{id}/approve", s.requireAuth(s.handleAutopilotApprove))
	m.HandleFunc("POST /api/autopilot/runs/{id}/stop", s.requireAuth(s.handleAutopilotStop))
	m.HandleFunc("GET /api/autopilot/clones", s.requireAuth(s.handleAutopilotClones))
	m.HandleFunc("GET /api/autopilot/by-thread/{id}", s.requireAuth(s.handleAutopilotByThread))
}

func (s *Server) handleAutopilotOverview(w http.ResponseWriter, r *http.Request) {
	repos, err := s.store.apListRepos()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	runs, err := s.store.apRecentRuns(200)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.apDecorate(runs)
	active := map[string]int{}
	for _, run := range runs {
		if run.Status == apPreparing || run.Status == apWorking || run.Status == apFinishing {
			active[strings.ToLower(run.Repo)]++
		}
	}
	for i := range repos {
		repos[i].Active = active[strings.ToLower(repos[i].Repo)]
	}
	writeJSON(w, map[string]any{"repos": repos, "runs": runs})
}

// apDecorate adds the live session status to runs that have one.
func (s *Server) apDecorate(runs []autopilotRun) {
	for i := range runs {
		if runs[i].ThreadId != "" && apActive(runs[i].Status) {
			if t, err := s.store.ThreadById(runs[i].ThreadId); err == nil && t != nil {
				runs[i].ThreadStatus = t.Status
			}
		}
	}
}

func (s *Server) handleAutopilotAddRepo(w http.ResponseWriter, r *http.Request) {
	var in apRepoInput
	if err := readJSON(r, &in); err != nil || in.Repo == nil {
		httpError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if !in.Acknowledge {
		httpError(w, http.StatusBadRequest, "confirm that you understand issues are untrusted input before turning this on")
		return
	}
	name, _, ok := parseRepoRef(*in.Repo)
	if !ok || name != strings.TrimSpace(*in.Repo) {
		httpError(w, http.StatusBadRequest, "repo must be owner/name")
		return
	}
	repo := autopilotRepo{Id: randomToken()[:16], Repo: name, Enabled: true, Comment: true, Footer: true, Agent: "claude", CreatedAt: time.Now().Unix()}
	in.apply(&repo)
	if msg := s.validateAutopilotRepo(&repo); msg != "" {
		httpError(w, http.StatusBadRequest, msg)
		return
	}
	if existing, _ := s.store.apRepoByName(name); existing != nil {
		httpError(w, http.StatusConflict, name+" is already set up")
		return
	}
	if err := s.store.apInsertRepo(repo); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.autopilot.mu.Lock()
	delete(s.autopilot.nextPoll, repo.Id) // look at it soon
	s.autopilot.mu.Unlock()
	writeJSON(w, repo)
}

func (s *Server) apRepoFromPath(w http.ResponseWriter, r *http.Request) *autopilotRepo {
	repo, err := s.store.apRepoById(r.PathValue("id"))
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return nil
	}
	if repo == nil {
		httpError(w, http.StatusNotFound, "that repo is not set up")
		return nil
	}
	return repo
}

func (s *Server) handleAutopilotPatchRepo(w http.ResponseWriter, r *http.Request) {
	repo := s.apRepoFromPath(w, r)
	if repo == nil {
		return
	}
	var in apRepoInput
	if err := readJSON(r, &in); err != nil {
		httpError(w, http.StatusBadRequest, "invalid request")
		return
	}
	in.apply(repo)
	if msg := s.validateAutopilotRepo(repo); msg != "" {
		httpError(w, http.StatusBadRequest, msg)
		return
	}
	if err := s.store.apSaveRepo(*repo); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, repo)
}

func (s *Server) handleAutopilotDeleteRepo(w http.ResponseWriter, r *http.Request) {
	repo := s.apRepoFromPath(w, r)
	if repo == nil {
		return
	}
	active, err := s.store.apQueryRuns(`WHERE r.repo = ? AND r.status IN ('preparing','working','finishing')`, repo.Repo)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if len(active) > 0 {
		httpError(w, http.StatusConflict, "stop the runs in progress first")
		return
	}
	// Queued runs go with the setup; finished ones stay as history and keep
	// the issue from ever running twice if the repo is added back.
	s.store.db.Exec(`UPDATE autopilot_runs SET status = 'skipped', detail = 'Autopilot was turned off for this repo.', updated_at = ? WHERE repo = ? AND status = 'queued'`, time.Now().Unix(), repo.Repo)
	if err := s.store.apDeleteRepo(repo.Id); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) handleAutopilotPoll(w http.ResponseWriter, r *http.Request) {
	repo := s.apRepoFromPath(w, r)
	if repo == nil {
		return
	}
	if !s.autopilotPollNow(repo.Id) {
		httpError(w, http.StatusConflict, "already checking")
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) apRunFromPath(w http.ResponseWriter, r *http.Request) *autopilotRun {
	run, err := s.store.apRunById(r.PathValue("id"))
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return nil
	}
	if run == nil {
		httpError(w, http.StatusNotFound, "no such run")
		return nil
	}
	return run
}

// handleAutopilotRetry puts a failed run back in the queue. It starts again
// from a fresh session on the same branch.
func (s *Server) handleAutopilotRetry(w http.ResponseWriter, r *http.Request) {
	run := s.apRunFromPath(w, r)
	if run == nil {
		return
	}
	if run.Status != apFailed {
		httpError(w, http.StatusConflict, "only a failed run can be retried")
		return
	}
	err := s.store.apUpdate(run.Id, apFields{"status": apQueued, "detail": "", "attempt": run.Attempt + 1, "thread_id": "",
		"resumes": 0, "finished_at": 0, "pr_url": "", "pr_number": 0})
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	updated, _ := s.store.apRunById(run.Id)
	writeJSON(w, updated)
}

// handleAutopilotApprove lets the user say "yes, run this one" for an issue
// autopilot would not pick up by itself (the label was added by someone
// without write access). This is the only way past the trust check.
func (s *Server) handleAutopilotApprove(w http.ResponseWriter, r *http.Request) {
	run := s.apRunFromPath(w, r)
	if run == nil {
		return
	}
	if run.Status != apSkipped {
		httpError(w, http.StatusConflict, "this issue is not waiting for approval")
		return
	}
	repo, _ := s.store.apRepoById(run.RepoId)
	if repo == nil || !repo.Enabled {
		httpError(w, http.StatusConflict, "autopilot is off for this repo")
		return
	}
	if err := s.store.apUpdate(run.Id, apFields{"status": apQueued, "detail": "", "approved": 1}); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	updated, _ := s.store.apRunById(run.Id)
	writeJSON(w, updated)
}

func (s *Server) handleAutopilotStop(w http.ResponseWriter, r *http.Request) {
	run := s.apRunFromPath(w, r)
	if run == nil {
		return
	}
	if !apActive(run.Status) {
		httpError(w, http.StatusConflict, "this run is not in progress")
		return
	}
	s.apStop(run)
	updated, _ := s.store.apRunById(run.Id)
	writeJSON(w, updated)
}

func (s *Server) handleAutopilotByThread(w http.ResponseWriter, r *http.Request) {
	run, err := s.store.apRunByThread(r.PathValue("id"))
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if run == nil {
		writeJSON(w, map[string]any{"run": nil})
		return
	}
	writeJSON(w, map[string]any{"run": run})
}
