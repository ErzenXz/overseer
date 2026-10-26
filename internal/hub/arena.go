package hub

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// Agent Arena: one prompt, several agents racing, each in its own git worktree
// of the same commit. The hub keeps the arena (its own tables), starts the
// contestants as ordinary threads, notices when each one finishes, measures it
// and runs the check command, and hands the winner on. Everything that touches
// files runs on the machines through the arena.op request (agent/arena.go).

func init() {
	extraSchemas = append(extraSchemas,
		`CREATE TABLE IF NOT EXISTS arenas (
			id            TEXT PRIMARY KEY,
			title         TEXT NOT NULL,
			prompt        TEXT NOT NULL,
			device_id     TEXT NOT NULL,
			cwd           TEXT NOT NULL,
			repo_root     TEXT NOT NULL DEFAULT '',
			remote_key    TEXT NOT NULL DEFAULT '',
			base_commit   TEXT NOT NULL,
			base_branch   TEXT NOT NULL DEFAULT '',
			dirty_at_start INTEGER NOT NULL DEFAULT 0,
			check_command TEXT NOT NULL DEFAULT '',
			access        TEXT NOT NULL DEFAULT 'auto',
			winner        INTEGER NOT NULL DEFAULT 0,
			outcome       TEXT NOT NULL DEFAULT '',
			outcome_url   TEXT NOT NULL DEFAULT '',
			outcome_note  TEXT NOT NULL DEFAULT '',
			cleaned       INTEGER NOT NULL DEFAULT 0,
			created_at    INTEGER NOT NULL,
			finished_at   INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE IF NOT EXISTS arena_contestants (
			arena_id    TEXT NOT NULL,
			n           INTEGER NOT NULL,
			agent       TEXT NOT NULL,
			model       TEXT NOT NULL DEFAULT '',
			effort      TEXT NOT NULL DEFAULT '',
			fast        INTEGER NOT NULL DEFAULT 0,
			device_id   TEXT NOT NULL,
			cwd         TEXT NOT NULL,
			thread_id   TEXT NOT NULL DEFAULT '',
			worktree    TEXT NOT NULL DEFAULT '',
			branch      TEXT NOT NULL DEFAULT '',
			state       TEXT NOT NULL DEFAULT 'preparing',
			error       TEXT NOT NULL DEFAULT '',
			started_at  INTEGER NOT NULL DEFAULT 0,
			finished_at INTEGER NOT NULL DEFAULT 0,
			stats       TEXT NOT NULL DEFAULT '',
			check_result TEXT NOT NULL DEFAULT '',
			removed     INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (arena_id, n)
		)`,
	)
}

const (
	arenaMinContestants = 2
	arenaMaxContestants = 4
	arenaOpWait         = 4 * time.Minute
	arenaCheckWait      = 11 * time.Minute
	arenaFolder         = "Arena" // sidebar folder the contestants' sessions sit in
)

// Contestant states.
const (
	arenaPreparing = "preparing" // making the worktree and starting the session
	arenaRunning   = "running"
	arenaChecking  = "checking" // finished; the check command is running
	arenaDone      = "done"
	arenaFailed    = "failed"
)

// Arena is one arena as the UI sees it.
type Arena struct {
	Id           string `json:"id"`
	Title        string `json:"title"`
	Prompt       string `json:"prompt"`
	DeviceId     string `json:"deviceId"`
	DeviceName   string `json:"deviceName"`
	Cwd          string `json:"cwd"`
	RepoRoot     string `json:"repoRoot,omitempty"`
	RemoteKey    string `json:"remoteKey,omitempty"`
	BaseCommit   string `json:"baseCommit"`
	BaseBranch   string `json:"baseBranch,omitempty"`
	DirtyAtStart int    `json:"dirtyAtStart,omitempty"` // uncommitted changes in the folder, not in the copies
	Check        string `json:"check,omitempty"`
	Access       string `json:"access"`
	// Status is worked out, not stored: preparing | running | finished.
	Status      string             `json:"status"`
	Winner      int                `json:"winner,omitempty"`
	Outcome     string             `json:"outcome,omitempty"` // pr | applied | kept
	OutcomeUrl  string             `json:"outcomeUrl,omitempty"`
	OutcomeNote string             `json:"outcomeNote,omitempty"`
	Cleaned     bool               `json:"cleaned,omitempty"`
	CreatedAt   int64              `json:"createdAt"`
	FinishedAt  int64              `json:"finishedAt,omitempty"`
	Contestants []*ArenaContestant `json:"contestants"`
}

// ArenaContestant is one agent in an arena.
type ArenaContestant struct {
	N          int         `json:"n"`
	Agent      string      `json:"agent"`
	Model      string      `json:"model,omitempty"`
	Effort     string      `json:"effort,omitempty"`
	Fast       bool        `json:"fast,omitempty"`
	DeviceId   string      `json:"deviceId"`
	DeviceName string      `json:"deviceName"`
	Cwd        string      `json:"cwd"` // the repo folder on that machine
	ThreadId   string      `json:"threadId,omitempty"`
	Worktree   string      `json:"worktree,omitempty"`
	Branch     string      `json:"branch,omitempty"`
	State      string      `json:"state"`
	Error      string      `json:"error,omitempty"`
	StartedAt  int64       `json:"startedAt,omitempty"`
	FinishedAt int64       `json:"finishedAt,omitempty"`
	Stats      *ArenaStats `json:"stats,omitempty"`
	Check      *ArenaCheck `json:"check,omitempty"`
	Removed    bool        `json:"removed,omitempty"`
	Thread     *Thread     `json:"thread,omitempty"`
}

// ArenaStats is what a contestant changed.
type ArenaStats struct {
	Files     int                  `json:"files"`
	Additions int                  `json:"additions"`
	Deletions int                  `json:"deletions"`
	Changed   []protocol.ArenaFile `json:"changed,omitempty"`
}

// ArenaCheck is the check command's result.
type ArenaCheck struct {
	ExitCode   int    `json:"exitCode"`
	Output     string `json:"output,omitempty"`
	DurationMs int64  `json:"durationMs,omitempty"`
	Error      string `json:"error,omitempty"` // the check could not run at all
}

// ---- store ----

const arenaColumns = `id, title, prompt, device_id, cwd, repo_root, remote_key, base_commit, base_branch, dirty_at_start,
	check_command, access, winner, outcome, outcome_url, outcome_note, cleaned, created_at, finished_at`

const arenaContestantColumns = `n, agent, model, effort, fast, device_id, cwd, thread_id, worktree, branch, state, error,
	started_at, finished_at, stats, check_result, removed`

func scanArena(row interface{ Scan(...any) error }) (*Arena, error) {
	var a Arena
	err := row.Scan(&a.Id, &a.Title, &a.Prompt, &a.DeviceId, &a.Cwd, &a.RepoRoot, &a.RemoteKey, &a.BaseCommit, &a.BaseBranch,
		&a.DirtyAtStart, &a.Check, &a.Access, &a.Winner, &a.Outcome, &a.OutcomeUrl, &a.OutcomeNote, &a.Cleaned, &a.CreatedAt, &a.FinishedAt)
	return &a, err
}

func (s *Store) loadContestants(arenaId string) ([]*ArenaContestant, error) {
	rows, err := s.db.Query(`SELECT `+arenaContestantColumns+` FROM arena_contestants WHERE arena_id = ? ORDER BY n`, arenaId)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*ArenaContestant
	for rows.Next() {
		var c ArenaContestant
		var stats, check string
		if err := rows.Scan(&c.N, &c.Agent, &c.Model, &c.Effort, &c.Fast, &c.DeviceId, &c.Cwd, &c.ThreadId, &c.Worktree, &c.Branch,
			&c.State, &c.Error, &c.StartedAt, &c.FinishedAt, &stats, &check, &c.Removed); err != nil {
			return nil, err
		}
		if stats != "" {
			json.Unmarshal([]byte(stats), &c.Stats)
		}
		if check != "" {
			json.Unmarshal([]byte(check), &c.Check)
		}
		out = append(out, &c)
	}
	return out, rows.Err()
}

// ArenaById returns the arena with its contestants, or nil.
func (s *Store) ArenaById(id string) (*Arena, error) {
	a, err := scanArena(s.db.QueryRow(`SELECT `+arenaColumns+` FROM arenas WHERE id = ?`, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if a.Contestants, err = s.loadContestants(id); err != nil {
		return nil, err
	}
	return a, nil
}

func (s *Store) ListArenas() ([]*Arena, error) {
	rows, err := s.db.Query(`SELECT ` + arenaColumns + ` FROM arenas ORDER BY created_at DESC LIMIT 100`)
	if err != nil {
		return nil, err
	}
	var out []*Arena
	for rows.Next() {
		a, err := scanArena(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, a)
	}
	rows.Close()
	for _, a := range out {
		if a.Contestants, err = s.loadContestants(a.Id); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (s *Store) CreateArena(a *Arena) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`INSERT INTO arenas (id, title, prompt, device_id, cwd, repo_root, remote_key, base_commit, base_branch,
		dirty_at_start, check_command, access, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		a.Id, a.Title, a.Prompt, a.DeviceId, a.Cwd, a.RepoRoot, a.RemoteKey, a.BaseCommit, a.BaseBranch,
		a.DirtyAtStart, a.Check, a.Access, a.CreatedAt); err != nil {
		return err
	}
	for _, c := range a.Contestants {
		if _, err := tx.Exec(`INSERT INTO arena_contestants (arena_id, n, agent, model, effort, fast, device_id, cwd, state)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, a.Id, c.N, c.Agent, c.Model, c.Effort, c.Fast, c.DeviceId, c.Cwd, arenaPreparing); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) arenaExec(query string, args ...any) { s.db.Exec(query, args...) }

func (s *Store) DeleteArena(id string) error {
	if _, err := s.db.Exec(`DELETE FROM arena_contestants WHERE arena_id = ?`, id); err != nil {
		return err
	}
	_, err := s.db.Exec(`DELETE FROM arenas WHERE id = ?`, id)
	return err
}

// ---- views ----

// view fills in what is not stored: the sessions, machine names and status.
func (s *Server) arenaView(a *Arena) *Arena {
	names := map[string]string{}
	name := func(id string) string {
		if n, ok := names[id]; ok {
			return n
		}
		n := ""
		if d, _ := s.store.DeviceById(id); d != nil {
			n = d.Name
		}
		names[id] = n
		return n
	}
	a.DeviceName = name(a.DeviceId)
	pending := 0
	for _, c := range a.Contestants {
		c.DeviceName = name(c.DeviceId)
		if c.ThreadId != "" {
			if t, _ := s.store.ThreadById(c.ThreadId); t != nil {
				c.Thread = t
			}
		}
		if c.State != arenaDone && c.State != arenaFailed {
			pending++
		}
	}
	switch {
	case pending == 0:
		a.Status = "finished"
		if a.FinishedAt == 0 { // the watcher records it a moment later
			for _, c := range a.Contestants {
				if c.FinishedAt > a.FinishedAt {
					a.FinishedAt = c.FinishedAt
				}
			}
		}
	case a.allInState(arenaPreparing):
		a.Status = "preparing"
	default:
		a.Status = "running"
	}
	return a
}

func (a *Arena) allInState(state string) bool {
	for _, c := range a.Contestants {
		if c.State != state {
			return false
		}
	}
	return true
}

func (a *Arena) contestant(n int) *ArenaContestant {
	for _, c := range a.Contestants {
		if c.N == n {
			return c
		}
	}
	return nil
}

// ---- machine calls ----

func arenaOpError(err error) error {
	switch {
	case strings.Contains(err.Error(), "unsupported request"), strings.Contains(err.Error(), "unsupported arena action"):
		return fmt.Errorf("this machine's agent is too old for arenas; update it")
	case strings.Contains(err.Error(), "device disconnected"):
		return fmt.Errorf("the machine went offline")
	}
	return err
}

func (s *Server) arenaCall(deviceId string, wait time.Duration, req protocol.ArenaRequest) (protocol.ArenaResult, error) {
	var res protocol.ArenaResult
	c := s.registry.get(deviceId)
	if c == nil {
		return res, fmt.Errorf("the machine is offline")
	}
	ctx, cancel := contextWithTimeout(wait)
	defer cancel()
	if err := c.requestInto(ctx, protocol.TypeArena, req, &res); err != nil {
		return res, arenaOpError(err)
	}
	return res, nil
}

// ---- starting an arena ----

type arenaContestantInput struct {
	Agent    string `json:"agent"`
	Model    string `json:"model"`
	Effort   string `json:"effort"`
	Fast     bool   `json:"fast"`
	DeviceId string `json:"deviceId"`
	Cwd      string `json:"cwd"`
}

type arenaInput struct {
	Title       string                 `json:"title"`
	Prompt      string                 `json:"prompt"`
	DeviceId    string                 `json:"deviceId"`
	Cwd         string                 `json:"cwd"`
	Check       string                 `json:"check"`
	Access      string                 `json:"access"`
	Contestants []arenaContestantInput `json:"contestants"`
}

var arenaSlugRe = regexp.MustCompile(`[^A-Za-z0-9_.-]+`)

func arenaSlug(agent string) string {
	s := strings.Trim(arenaSlugRe.ReplaceAllString(agent, "-"), ".-")
	if len(s) > 30 {
		s = strings.TrimRight(s[:30], ".-")
	}
	if s == "" {
		return "agent"
	}
	return s
}

func validArenaPath(p string) bool {
	return p != "" && len(p) <= maxProjectPath && !strings.ContainsRune(p, 0)
}

func (in *arenaInput) validate(s *Server) string {
	in.Title = strings.TrimSpace(in.Title)
	in.Prompt = strings.TrimSpace(in.Prompt)
	in.DeviceId = strings.TrimSpace(in.DeviceId)
	in.Cwd = strings.TrimSpace(in.Cwd)
	in.Check = strings.TrimSpace(in.Check)
	if in.Access == "" {
		in.Access = "auto"
	}
	switch {
	case in.Prompt == "":
		return "prompt is required"
	case len(in.Prompt) > maxPromptBytes:
		return "prompt is too long"
	case len(in.Title) > 200:
		return "title must be at most 200 characters"
	case in.DeviceId == "" || !validArenaPath(in.Cwd):
		return "choose a machine and a folder"
	case len(in.Check) > 1000 || strings.ContainsRune(in.Check, 0):
		return "check command is too long"
	case !validAccess(in.Access):
		return "access must be ask, edits, auto or full"
	case len(in.Contestants) < arenaMinContestants || len(in.Contestants) > arenaMaxContestants:
		return fmt.Sprintf("an arena needs %d to %d contestants", arenaMinContestants, arenaMaxContestants)
	}
	for i := range in.Contestants {
		c := &in.Contestants[i]
		c.Agent = strings.TrimSpace(c.Agent)
		c.Model = strings.TrimSpace(c.Model)
		c.Effort = strings.TrimSpace(c.Effort)
		c.DeviceId = strings.TrimSpace(c.DeviceId)
		c.Cwd = strings.TrimSpace(c.Cwd)
		if c.DeviceId == "" {
			c.DeviceId = in.DeviceId
		}
		if c.Cwd == "" && c.DeviceId == in.DeviceId {
			c.Cwd = in.Cwd
		}
		switch {
		case c.Agent == "acp" || !s.agents.valid(c.Agent):
			return "unknown agent"
		case !validOptionId(c.Effort):
			return "effort is invalid"
		case len(c.Model) > 200 || strings.ContainsRune(c.Model, 0):
			return "model is invalid"
		case !validArenaPath(c.Cwd):
			return "choose the repo folder on every machine"
		}
	}
	return ""
}

func (s *Server) agentName(id string) string {
	for _, a := range s.agents.list() {
		if a.Id == id {
			return a.Name
		}
	}
	return id
}

func (s *Server) handleCreateArena(w http.ResponseWriter, r *http.Request) {
	var in arenaInput
	if err := readJSON(r, &in); err != nil {
		httpError(w, http.StatusBadRequest, "invalid arena")
		return
	}
	if msg := in.validate(s); msg != "" {
		httpError(w, http.StatusBadRequest, msg)
		return
	}
	// Every machine must exist and be online: contestants start at once.
	seen := map[string]bool{}
	ids := []string{in.DeviceId}
	for _, c := range in.Contestants {
		ids = append(ids, c.DeviceId)
	}
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		d, err := s.store.DeviceById(id)
		if err != nil {
			httpError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if d == nil {
			httpError(w, http.StatusBadRequest, "device does not exist")
			return
		}
		if s.registry.get(id) == nil {
			httpError(w, http.StatusServiceUnavailable, d.Name+" is offline")
			return
		}
	}
	// The base: where the folder is now. Uncommitted changes stay behind.
	origin, err := s.arenaCall(in.DeviceId, 40*time.Second, protocol.ArenaRequest{Action: protocol.ArenaInspect, Repo: in.Cwd})
	if err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	for _, c := range in.Contestants {
		if c.DeviceId == in.DeviceId {
			continue
		}
		if origin.RemoteKey == "" {
			httpError(w, http.StatusBadRequest, "the folder has no git remote, so other machines cannot run it. Use one machine")
			return
		}
		other, err := s.arenaCall(c.DeviceId, 40*time.Second, protocol.ArenaRequest{Action: protocol.ArenaInspect, Repo: c.Cwd})
		if err != nil {
			httpError(w, http.StatusBadRequest, err.Error())
			return
		}
		if other.RemoteKey != origin.RemoteKey {
			httpError(w, http.StatusBadRequest, "the folder on the other machine is a clone of a different repository")
			return
		}
	}

	title := in.Title
	if title == "" {
		title = titleFromPrompt(in.Prompt)
	}
	a := &Arena{
		Id: randomToken()[:12], Title: title, Prompt: in.Prompt, DeviceId: in.DeviceId, Cwd: in.Cwd,
		RepoRoot: origin.Root, RemoteKey: origin.RemoteKey, BaseCommit: origin.Head, BaseBranch: origin.Branch,
		DirtyAtStart: origin.Dirty, Check: in.Check, Access: in.Access, CreatedAt: time.Now().Unix(),
	}
	if a.BaseBranch == "HEAD" || a.BaseBranch == "(detached)" || len(a.BaseBranch) == 40 || len(a.BaseBranch) == 7 && arenaHexRe.MatchString(a.BaseBranch) {
		a.BaseBranch = ""
	}
	for i, c := range in.Contestants {
		a.Contestants = append(a.Contestants, &ArenaContestant{N: i + 1, Agent: c.Agent, Model: c.Model, Effort: c.Effort, Fast: c.Fast, DeviceId: c.DeviceId, Cwd: c.Cwd, State: arenaPreparing})
	}
	if err := s.store.CreateArena(a); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.rememberPublicURL(r)
	go s.arenaStart(a)
	s.arenaEnsureWatcher(a.Id)
	s.arenaWrite(w, a.Id)
}

var arenaHexRe = regexp.MustCompile(`^[0-9a-f]+$`)

// arenaStart makes every contestant's worktree and session, all at once.
func (s *Server) arenaStart(a *Arena) {
	// Names: branch arena/<id>/<agent>, with -2, -3 when an agent repeats.
	used := map[string]int{}
	var wg sync.WaitGroup
	for _, c := range a.Contestants {
		slug := arenaSlug(c.Agent)
		used[slug]++
		branchSlug := slug
		if used[slug] > 1 {
			branchSlug = fmt.Sprintf("%s-%d", slug, used[slug])
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			s.arenaStartOne(a, c, fmt.Sprintf("%d-%s", c.N, slug), "arena/"+a.Id+"/"+branchSlug)
		}()
	}
	wg.Wait()
}

func (s *Server) arenaFail(a *Arena, c *ArenaContestant, msg string) {
	s.store.arenaExec(`UPDATE arena_contestants SET state = ?, error = ?, finished_at = ? WHERE arena_id = ? AND n = ?`,
		arenaFailed, msg, time.Now().Unix(), a.Id, c.N)
}

func (s *Server) arenaStartOne(a *Arena, c *ArenaContestant, folder, branch string) {
	res, err := s.arenaCall(c.DeviceId, arenaOpWait, protocol.ArenaRequest{
		Action: protocol.ArenaCreate, ArenaId: a.Id, Repo: c.Cwd, Commit: a.BaseCommit, Name: folder, Branch: branch, RemoteKey: a.RemoteKey,
	})
	if err != nil {
		s.arenaFail(a, c, err.Error())
		return
	}
	title := a.Title
	if len(title) > 150 {
		title = title[:150]
	}
	t, err := s.createThread(threadInput{
		DeviceId: c.DeviceId, Agent: c.Agent, Cwd: res.Cwd, Prompt: a.Prompt, Model: c.Model, Effort: c.Effort, Fast: c.Fast,
		Access: a.Access, Title: title + " · " + s.agentName(c.Agent),
	})
	if err != nil {
		s.arenaFail(a, c, "could not start the session: "+err.Error())
		s.arenaCall(c.DeviceId, arenaOpWait, protocol.ArenaRequest{Action: protocol.ArenaRemove, ArenaId: a.Id, Repo: c.Cwd, Worktree: res.Path, Branch: branch})
		return
	}
	folderName := arenaFolder
	s.store.PatchThread(t.Id, threadPatch{Folder: &folderName})
	s.store.arenaExec(`UPDATE arena_contestants SET thread_id = ?, worktree = ?, branch = ?, state = ?, started_at = ? WHERE arena_id = ? AND n = ?`,
		t.Id, res.Path, branch, arenaRunning, time.Now().Unix(), a.Id, c.N)
	s.threads.changed(t.Id, true)
}

// ---- watching ----

var arenaWatchers = struct {
	sync.Mutex
	running map[string]bool
}{running: map[string]bool{}}

var arenaFinalizing sync.Map // "<arena>:<n>" while a contestant is being measured

// arenaEnsureWatcher makes sure one goroutine follows the arena until every
// contestant has finished. Opening the arena page calls it too, so an arena
// that was running when the hub restarted picks up again.
func (s *Server) arenaEnsureWatcher(id string) {
	arenaWatchers.Lock()
	if arenaWatchers.running[id] {
		arenaWatchers.Unlock()
		return
	}
	arenaWatchers.running[id] = true
	arenaWatchers.Unlock()
	go func() {
		defer func() {
			arenaWatchers.Lock()
			delete(arenaWatchers.running, id)
			arenaWatchers.Unlock()
		}()
		s.arenaWatch(id)
	}()
}

func (s *Server) arenaWatch(id string) {
	stop := time.Now().Add(12 * time.Hour)
	for time.Now().Before(stop) {
		a, err := s.store.ArenaById(id)
		if err != nil {
			time.Sleep(5 * time.Second)
			continue
		}
		if a == nil {
			return
		}
		busy := false
		for _, c := range a.Contestants {
			switch c.State {
			case arenaPreparing:
				// Starting takes seconds; one older than this was cut off by a restart.
				if time.Now().Unix()-a.CreatedAt > 600 {
					s.arenaFail(a, c, "Overseer restarted before this one started.")
				} else {
					busy = true
				}
			case arenaRunning, arenaChecking:
				busy = true
				t, _ := s.store.ThreadById(c.ThreadId)
				switch {
				case t == nil:
					s.arenaFail(a, c, "The session was deleted.")
				case t.Status == "idle" || t.Status == "error" || t.Status == "stopped":
					go s.arenaFinalize(a, c, t)
				}
			}
		}
		if !busy {
			s.store.arenaExec(`UPDATE arenas SET finished_at = ? WHERE id = ? AND finished_at = 0`, time.Now().Unix(), id)
			return
		}
		time.Sleep(2 * time.Second)
	}
}

// arenaFinalize measures a contestant that stopped, then runs the check.
func (s *Server) arenaFinalize(a *Arena, c *ArenaContestant, t *Thread) {
	key := a.Id + ":" + strconv.Itoa(c.N)
	if _, busy := arenaFinalizing.LoadOrStore(key, true); busy {
		return
	}
	defer arenaFinalizing.Delete(key)
	if s.registry.get(c.DeviceId) == nil {
		return // try again when the machine is back
	}
	finished := t.UpdatedAt
	if finished < c.StartedAt {
		finished = time.Now().Unix()
	}
	failed := t.Status != "idle"
	base := protocol.ArenaRequest{ArenaId: a.Id, Worktree: c.Worktree, Base: a.BaseCommit}

	if st, err := s.arenaCall(c.DeviceId, arenaOpWait, withAction(base, protocol.ArenaStats)); err == nil {
		b, _ := json.Marshal(ArenaStats{Files: st.Files, Additions: st.Additions, Deletions: st.Deletions, Changed: st.Changed})
		s.store.arenaExec(`UPDATE arena_contestants SET stats = ? WHERE arena_id = ? AND n = ?`, string(b), a.Id, c.N)
	}
	if failed {
		msg := t.Error
		if msg == "" {
			msg = "The agent stopped before finishing."
		}
		s.store.arenaExec(`UPDATE arena_contestants SET state = ?, error = ?, finished_at = ? WHERE arena_id = ? AND n = ?`, arenaFailed, msg, finished, a.Id, c.N)
		return
	}
	if a.Check != "" {
		s.store.arenaExec(`UPDATE arena_contestants SET state = ?, finished_at = ? WHERE arena_id = ? AND n = ?`, arenaChecking, finished, a.Id, c.N)
		req := withAction(base, protocol.ArenaCheck)
		req.Command, req.TimeoutSec = a.Check, 600
		check := ArenaCheck{}
		if res, err := s.arenaCall(c.DeviceId, arenaCheckWait, req); err != nil {
			check.Error = err.Error()
			check.ExitCode = -1
		} else {
			check = ArenaCheck{ExitCode: res.ExitCode, Output: res.Output, DurationMs: res.DurationMs}
		}
		b, _ := json.Marshal(check)
		s.store.arenaExec(`UPDATE arena_contestants SET check_result = ? WHERE arena_id = ? AND n = ?`, string(b), a.Id, c.N)
	}
	s.store.arenaExec(`UPDATE arena_contestants SET state = ?, finished_at = ? WHERE arena_id = ? AND n = ?`, arenaDone, finished, a.Id, c.N)
}

func withAction(r protocol.ArenaRequest, action string) protocol.ArenaRequest {
	r.Action = action
	return r
}

// ---- picking a winner ----

type arenaWinnerInput struct {
	Contestant int    `json:"contestant"`
	Action     string `json:"action"` // pr | apply | keep
}

func arenaPRBody(a *Arena, c *ArenaContestant, agentName string) string {
	var b strings.Builder
	b.WriteString(a.Prompt)
	b.WriteString("\n\n---\nOpened from an Overseer arena. ")
	b.WriteString(agentName)
	if c.Model != "" {
		b.WriteString(" (" + c.Model + ")")
	}
	b.WriteString(" won against ")
	b.WriteString(strconv.Itoa(len(a.Contestants) - 1))
	b.WriteString(" other agent(s) on this task.")
	if c.Stats != nil {
		fmt.Fprintf(&b, "\n\n%d file(s) changed, +%d −%d.", c.Stats.Files, c.Stats.Additions, c.Stats.Deletions)
	}
	if c.Check != nil && c.Check.Error == "" {
		verdict := "passed"
		if c.Check.ExitCode != 0 {
			verdict = fmt.Sprintf("failed (exit %d)", c.Check.ExitCode)
		}
		fmt.Fprintf(&b, "\n\nCheck `%s` %s.", strings.ReplaceAll(a.Check, "`", "'"), verdict)
	}
	return b.String()
}

func (s *Server) handleArenaWinner(w http.ResponseWriter, r *http.Request) {
	a := s.arenaFromPath(w, r)
	if a == nil {
		return
	}
	var in arenaWinnerInput
	if err := readJSON(r, &in); err != nil {
		httpError(w, http.StatusBadRequest, "invalid request")
		return
	}
	c := a.contestant(in.Contestant)
	switch {
	case c == nil:
		httpError(w, http.StatusBadRequest, "no such contestant")
		return
	case c.Worktree == "" || c.Removed:
		httpError(w, http.StatusConflict, "that copy of the repo is gone")
		return
	case c.State != arenaDone:
		httpError(w, http.StatusConflict, "only a contestant that finished can win")
		return
	}
	agent := s.agentName(c.Agent)
	base := protocol.ArenaRequest{ArenaId: a.Id, Worktree: c.Worktree, Base: a.BaseCommit, Branch: c.Branch, Title: a.Title}
	outcome, url, note := "", "", ""
	switch in.Action {
	case "keep":
		if _, err := s.arenaCall(c.DeviceId, arenaOpWait, withAction(base, protocol.ArenaCommit)); err != nil {
			httpError(w, http.StatusBadGateway, err.Error())
			return
		}
		outcome, note = "kept", "Kept the branch "+c.Branch+" on "+c.deviceLabel(s)+"."
	case "pr":
		req := withAction(base, protocol.ArenaPR)
		req.BaseBranch, req.Body = a.BaseBranch, arenaPRBody(a, c, agent)
		res, err := s.arenaCall(c.DeviceId, 6*time.Minute, req)
		if err != nil {
			httpError(w, http.StatusBadGateway, err.Error())
			return
		}
		outcome, url, note = "pr", res.Url, res.Note
	case "apply":
		if c.DeviceId != a.DeviceId {
			httpError(w, http.StatusConflict, "that contestant ran on another machine. Open a pull request or download the patch")
			return
		}
		req := withAction(base, protocol.ArenaApply)
		req.Repo, req.RemoteKey = a.Cwd, a.RemoteKey
		res, err := s.arenaCall(c.DeviceId, arenaOpWait, req)
		if err != nil {
			if res.Dirty > 0 || strings.Contains(err.Error(), "uncommitted changes") {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusConflict)
				json.NewEncoder(w).Encode(map[string]any{"error": "The folder has uncommitted changes, so nothing was changed. Commit or stash them, or open a pull request instead.", "code": "dirty", "dirty": res.Dirty})
				return
			}
			httpError(w, http.StatusBadGateway, err.Error())
			return
		}
		outcome = "applied"
		note = res.Note
		if note == "" {
			note = fmt.Sprintf("Applied to %s as uncommitted changes.", a.Cwd)
		}
	default:
		httpError(w, http.StatusBadRequest, "action must be pr, apply or keep")
		return
	}
	s.store.arenaExec(`UPDATE arenas SET winner = ?, outcome = ?, outcome_url = ?, outcome_note = ? WHERE id = ?`, c.N, outcome, url, note, a.Id)
	s.arenaWrite(w, a.Id)
}

func (c *ArenaContestant) deviceLabel(s *Server) string {
	if c.DeviceName != "" {
		return c.DeviceName
	}
	if d, _ := s.store.DeviceById(c.DeviceId); d != nil {
		return d.Name
	}
	return "its machine"
}

func (s *Server) handleArenaPatch(w http.ResponseWriter, r *http.Request) {
	a := s.arenaFromPath(w, r)
	if a == nil {
		return
	}
	n, _ := strconv.Atoi(r.URL.Query().Get("contestant"))
	c := a.contestant(n)
	if c == nil || c.Worktree == "" || c.Removed {
		httpError(w, http.StatusNotFound, "no such copy of the repo")
		return
	}
	res, err := s.arenaCall(c.DeviceId, arenaOpWait, protocol.ArenaRequest{Action: protocol.ArenaPatch, ArenaId: a.Id, Worktree: c.Worktree, Base: a.BaseCommit, Title: a.Title})
	if err != nil {
		httpError(w, http.StatusBadGateway, err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/x-diff; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="arena-%s-%s.patch"`, a.Id, arenaSlug(c.Agent)))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Write([]byte(res.Patch))
}

// ---- clean up ----

type arenaCleanupInput struct {
	Confirm bool `json:"confirm"`
	// IncludeWinner also removes the winner's copy; only once its changes live
	// somewhere else (applied to the folder, or pushed in a pull request).
	IncludeWinner bool `json:"includeWinner"`
}

func (s *Server) handleArenaCleanup(w http.ResponseWriter, r *http.Request) {
	a := s.arenaFromPath(w, r)
	if a == nil {
		return
	}
	var in arenaCleanupInput
	if err := readJSON(r, &in); err != nil || !in.Confirm {
		httpError(w, http.StatusBadRequest, "confirmation is required")
		return
	}
	if a.Winner == 0 {
		httpError(w, http.StatusConflict, "pick a winner first")
		return
	}
	if in.IncludeWinner && a.Outcome != "applied" && a.Outcome != "pr" {
		httpError(w, http.StatusConflict, "the winner's copy is only removed after it was applied or opened as a pull request")
		return
	}
	var problems []string
	for _, c := range a.Contestants {
		if c.Removed || c.Worktree == "" || (c.N == a.Winner && !in.IncludeWinner) {
			continue
		}
		if c.State != arenaDone && c.State != arenaFailed {
			problems = append(problems, fmt.Sprintf("%s is still running", s.agentName(c.Agent)))
			continue
		}
		_, err := s.arenaCall(c.DeviceId, arenaOpWait, protocol.ArenaRequest{Action: protocol.ArenaRemove, ArenaId: a.Id, Repo: c.Cwd, Worktree: c.Worktree, Branch: c.Branch})
		if err != nil {
			problems = append(problems, fmt.Sprintf("%s on %s: %v", s.agentName(c.Agent), c.deviceLabel(s), err))
			continue
		}
		s.store.arenaExec(`UPDATE arena_contestants SET removed = 1 WHERE arena_id = ? AND n = ?`, a.Id, c.N)
	}
	if len(problems) == 0 {
		s.store.arenaExec(`UPDATE arenas SET cleaned = 1 WHERE id = ?`, a.Id)
	}
	if len(problems) > 0 {
		sort.Strings(problems)
		httpError(w, http.StatusBadGateway, "Could not remove everything: "+strings.Join(problems, "; "))
		return
	}
	s.arenaWrite(w, a.Id)
}

// ---- the rest of the HTTP surface ----

func (s *Server) arenaFromPath(w http.ResponseWriter, r *http.Request) *Arena {
	a, err := s.store.ArenaById(r.PathValue("id"))
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return nil
	}
	if a == nil {
		httpError(w, http.StatusNotFound, "arena not found")
		return nil
	}
	return a
}

func (s *Server) arenaWrite(w http.ResponseWriter, id string) {
	a, err := s.store.ArenaById(id)
	if err != nil || a == nil {
		httpError(w, http.StatusInternalServerError, "arena not found")
		return
	}
	writeJSON(w, s.arenaView(a))
}

func (s *Server) handleListArenas(w http.ResponseWriter, _ *http.Request) {
	list, err := s.store.ListArenas()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]*Arena, 0, len(list))
	for _, a := range list {
		out = append(out, s.arenaView(a))
	}
	writeJSON(w, out)
}

func (s *Server) handleGetArena(w http.ResponseWriter, r *http.Request) {
	a := s.arenaFromPath(w, r)
	if a == nil {
		return
	}
	s.arenaEnsureWatcher(a.Id)
	writeJSON(w, s.arenaView(a))
}

// handleStopArena stops every contestant that is still working.
func (s *Server) handleStopArena(w http.ResponseWriter, r *http.Request) {
	a := s.arenaFromPath(w, r)
	if a == nil {
		return
	}
	for _, c := range a.Contestants {
		if c.State != arenaRunning || c.ThreadId == "" {
			continue
		}
		conn := s.registry.get(c.DeviceId)
		if conn == nil {
			continue
		}
		ctx, cancel := deviceCtx()
		err := conn.requestInto(ctx, protocol.TypeThreadCancel, protocol.ThreadRef{ThreadId: c.ThreadId}, nil)
		cancel()
		if err != nil && strings.Contains(err.Error(), errNotRunning) {
			s.threads.setStatus(c.ThreadId, "idle", "")
		}
	}
	s.arenaWrite(w, a.Id)
}

// handleDeleteArena forgets the arena. Worktrees and branches on the machines
// are not touched: that is what "Clean up" is for.
func (s *Server) handleDeleteArena(w http.ResponseWriter, r *http.Request) {
	a := s.arenaFromPath(w, r)
	if a == nil {
		return
	}
	if err := s.store.DeleteArena(a.Id); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) routesArena(m *http.ServeMux) {
	m.HandleFunc("GET /api/arenas", s.requireAuth(s.handleListArenas))
	m.HandleFunc("POST /api/arenas", s.requireAuth(s.handleCreateArena))
	m.HandleFunc("GET /api/arenas/{id}", s.requireAuth(s.handleGetArena))
	m.HandleFunc("DELETE /api/arenas/{id}", s.requireAuth(s.handleDeleteArena))
	m.HandleFunc("POST /api/arenas/{id}/winner", s.requireAuth(s.handleArenaWinner))
	m.HandleFunc("POST /api/arenas/{id}/stop", s.requireAuth(s.handleStopArena))
	m.HandleFunc("POST /api/arenas/{id}/cleanup", s.requireAuth(s.handleArenaCleanup))
	m.HandleFunc("GET /api/arenas/{id}/patch", s.requireAuth(s.handleArenaPatch))
}
