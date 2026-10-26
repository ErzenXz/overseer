package hub

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// Scheduled sessions: a session saved with everything needed to start it, and
// a trigger that says when. The trigger is a time, or "when this agent's plan
// limit on this machine resets". The hub starts the session through the same
// path as POST /api/threads (same validation, same clientRequestId
// idempotency), so a start that is retried can never run twice.

const (
	scheduleTick = 15 * time.Second
	// resetGrace is added to a limit's reset time before the hub checks it, so
	// the first look happens just after the window has rolled over.
	resetGrace      = 30 * time.Second
	scheduleKeep    = 3 * 24 * time.Hour  // finished rows stay this long
	scheduleFailed  = 14 * 24 * time.Hour // failed rows stay until dismissed or this long
	schedulePrepare = 13 * time.Minute    // a GitHub checkout may need a long clone
	maxScheduled    = 200

	trigTime  = "time"
	trigLimit = "limit_reset"

	schedWaiting  = "waiting"
	schedStarting = "starting"
	schedStarted  = "started"
	schedFailed   = "failed"

	reasonGuardrail = "guardrail"
)

func init() {
	extraSchemas = append(extraSchemas, `
CREATE TABLE IF NOT EXISTS scheduled_sessions (
	id         TEXT PRIMARY KEY,
	status     TEXT NOT NULL DEFAULT 'waiting',
	reason     TEXT NOT NULL DEFAULT '',
	trig       TEXT NOT NULL,
	payload    TEXT NOT NULL,
	fire_at    INTEGER NOT NULL DEFAULT 0,
	note       TEXT NOT NULL DEFAULT '',
	thread_id  TEXT NOT NULL DEFAULT '',
	error      TEXT NOT NULL DEFAULT '',
	request_id TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL,
	started_at INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS scheduled_sessions_request_id ON scheduled_sessions(request_id) WHERE request_id != '';
`)
}

// schedTrigger says when a scheduled session starts.
type schedTrigger struct {
	Kind string `json:"kind"` // trigTime | trigLimit
	// trigTime: unix seconds.
	At int64 `json:"at,omitempty"`
	// trigLimit: the window being waited on, the usage at which it counts as
	// "still limited", and when it is expected to reset (unix seconds).
	Window      string `json:"window,omitempty"`
	WindowLabel string `json:"windowLabel,omitempty"`
	Threshold   int    `json:"threshold,omitempty"`
	ResetsAt    int64  `json:"resetsAt,omitempty"`
}

// schedImage is one attached image, in the same shape the threads API takes.
type schedImage struct {
	Path string `json:"path"`
}

// schedSource is a GitHub repo and branch the machine checks out when the
// session starts, instead of a fixed folder.
type schedSource struct {
	Repo   string   `json:"repo"`
	Branch string   `json:"branch"`
	Known  []string `json:"known,omitempty"` // folders already known to hold a clone
}

// schedPayload is everything needed to start the session.
type schedPayload struct {
	DeviceId        string       `json:"deviceId"`
	Agent           string       `json:"agent"`
	Command         string       `json:"command,omitempty"`
	Cwd             string       `json:"cwd"`
	Prompt          string       `json:"prompt"`
	Model           string       `json:"model,omitempty"`
	Access          string       `json:"access,omitempty"`
	Effort          string       `json:"effort,omitempty"`
	Fast            bool         `json:"fast,omitempty"`
	Mode            string       `json:"mode,omitempty"`
	Title           string       `json:"title"`
	Images          []schedImage `json:"images,omitempty"`
	Source          *schedSource `json:"source,omitempty"`
	ClientRequestId string       `json:"clientRequestId,omitempty"`
}

func (p schedPayload) threadInput() threadInput {
	in := threadInput{
		DeviceId: p.DeviceId, Agent: p.Agent, Command: p.Command, Cwd: p.Cwd, Prompt: p.Prompt, Model: p.Model,
		Access: p.Access, Effort: p.Effort, Fast: p.Fast, Mode: p.Mode, Title: p.Title, ClientRequestId: p.ClientRequestId,
	}
	for _, img := range p.Images {
		in.Images = append(in.Images, img.Path)
	}
	return in
}

func payloadFromInput(in threadInput) schedPayload {
	p := schedPayload{
		DeviceId: in.DeviceId, Agent: in.Agent, Command: in.Command, Cwd: in.Cwd, Prompt: in.Prompt, Model: in.Model,
		Access: in.Access, Effort: in.Effort, Fast: in.Fast, Mode: in.Mode, Title: in.Title, ClientRequestId: in.ClientRequestId,
	}
	for _, path := range in.Images {
		p.Images = append(p.Images, schedImage{Path: path})
	}
	return p
}

// ScheduledSession is one saved session. The payload fields are flattened
// into the JSON next to the scheduling fields.
type ScheduledSession struct {
	Id           string       `json:"id"`
	Status       string       `json:"status"`
	Reason       string       `json:"reason,omitempty"` // reasonGuardrail when a guardrail held it
	Trigger      schedTrigger `json:"trigger"`
	DeviceName   string       `json:"deviceName"`
	DeviceOnline bool         `json:"deviceOnline"`
	StartsAt     int64        `json:"startsAt"` // when the hub will try, unix seconds (0 = unknown)
	Note         string       `json:"note,omitempty"`
	ThreadId     string       `json:"threadId,omitempty"`
	Error        string       `json:"error,omitempty"`
	CreatedAt    int64        `json:"createdAt"`
	StartedAt    int64        `json:"startedAt,omitempty"`
	schedPayload
}

// --- store ---

const schedColumns = `id, status, reason, trig, payload, fire_at, note, thread_id, error, created_at, started_at`

func scanScheduled(row rowScanner) (*ScheduledSession, error) {
	var j ScheduledSession
	var trig, payload string
	if err := row.Scan(&j.Id, &j.Status, &j.Reason, &trig, &payload, &j.StartsAt, &j.Note, &j.ThreadId, &j.Error, &j.CreatedAt, &j.StartedAt); err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(trig), &j.Trigger); err != nil {
		return nil, fmt.Errorf("scheduled %s: bad trigger: %w", j.Id, err)
	}
	if err := json.Unmarshal([]byte(payload), &j.schedPayload); err != nil {
		return nil, fmt.Errorf("scheduled %s: bad payload: %w", j.Id, err)
	}
	return &j, nil
}

func (s *Store) ScheduledById(id string) (*ScheduledSession, error) {
	j, err := scanScheduled(s.db.QueryRow(`SELECT `+schedColumns+` FROM scheduled_sessions WHERE id = ?`, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return j, err
}

func (s *Store) ScheduledByRequestId(key string) (*ScheduledSession, error) {
	if key == "" {
		return nil, nil
	}
	j, err := scanScheduled(s.db.QueryRow(`SELECT `+schedColumns+` FROM scheduled_sessions WHERE request_id = ?`, key))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return j, err
}

// ListScheduled returns rows with the given statuses (all when none), soonest
// first. The rows are read fully before returning: the database has one
// connection, so callers may query again while looping.
func (s *Store) ListScheduled(statuses ...string) ([]ScheduledSession, error) {
	q := `SELECT ` + schedColumns + ` FROM scheduled_sessions`
	var args []any
	if len(statuses) > 0 {
		q += ` WHERE status IN (` + strings.TrimSuffix(strings.Repeat("?,", len(statuses)), ",") + `)`
		for _, st := range statuses {
			args = append(args, st)
		}
	}
	q += ` ORDER BY CASE WHEN fire_at = 0 THEN 1 ELSE 0 END, fire_at, created_at`
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ScheduledSession{}
	for rows.Next() {
		j, err := scanScheduled(rows)
		if err != nil {
			log.Printf("scheduled sessions: %v", err)
			continue
		}
		out = append(out, *j)
	}
	return out, rows.Err()
}

func (s *Store) SaveScheduled(j *ScheduledSession) error {
	trig, _ := json.Marshal(j.Trigger)
	payload, _ := json.Marshal(j.schedPayload)
	_, err := s.db.Exec(`INSERT INTO scheduled_sessions (`+schedColumns+`, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET status = excluded.status, reason = excluded.reason, trig = excluded.trig,
		payload = excluded.payload, fire_at = excluded.fire_at, note = excluded.note, thread_id = excluded.thread_id,
		error = excluded.error, request_id = excluded.request_id, started_at = excluded.started_at`,
		j.Id, j.Status, j.Reason, string(trig), string(payload), j.StartsAt, j.Note, j.ThreadId, j.Error, j.CreatedAt, j.StartedAt, j.ClientRequestId)
	return err
}

func (s *Store) DeleteScheduled(id string) error {
	_, err := s.db.Exec(`DELETE FROM scheduled_sessions WHERE id = ?`, id)
	return err
}

// ClaimScheduled moves a row from one of the given statuses to starting. Only
// one caller wins, so the tick and "Start now" can't both start it.
func (s *Store) ClaimScheduled(id string, from ...string) (bool, error) {
	args := []any{schedStarting, id}
	for _, f := range from {
		args = append(args, f)
	}
	res, err := s.db.Exec(`UPDATE scheduled_sessions SET status = ?, note = '', error = '' WHERE id = ? AND status IN (`+
		strings.TrimSuffix(strings.Repeat("?,", len(from)), ",")+`)`, args...)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n == 1, nil
}

func (s *Store) setScheduledWait(id string, fireAt int64, note string, trig schedTrigger) error {
	b, _ := json.Marshal(trig)
	_, err := s.db.Exec(`UPDATE scheduled_sessions SET status = 'waiting', fire_at = ?, note = ?, trig = ? WHERE id = ?`, fireAt, note, string(b), id)
	return err
}

func (s *Store) setScheduledStarted(id, threadId string, at int64) error {
	_, err := s.db.Exec(`UPDATE scheduled_sessions SET status = 'started', thread_id = ?, started_at = ?, note = '', error = '' WHERE id = ?`, threadId, at, id)
	return err
}

func (s *Store) setScheduledFailed(id, msg string) error {
	_, err := s.db.Exec(`UPDATE scheduled_sessions SET status = 'failed', error = ?, note = '' WHERE id = ?`, msg, id)
	return err
}

// resetStartingScheduled puts rows left "starting" by a stopped hub back to
// waiting. Starting again is safe: the request id finds a session that
// already exists.
func (s *Store) resetStartingScheduled() error {
	_, err := s.db.Exec(`UPDATE scheduled_sessions SET status = 'waiting' WHERE status = 'starting'`)
	return err
}

func (s *Store) purgeScheduled(now time.Time) error {
	_, err := s.db.Exec(`DELETE FROM scheduled_sessions WHERE (status = 'started' AND started_at < ?) OR (status = 'failed' AND created_at < ?)`,
		now.Add(-scheduleKeep).Unix(), now.Add(-scheduleFailed).Unix())
	return err
}

// --- deciding when to start ---

// schedHost is what the trigger logic needs from the hub, so it can be tested
// with a fake clock and fake limits.
type schedHost interface {
	Online(deviceId string) bool
	DeviceName(deviceId string) string
	// Limits returns the agent's plan limits on the device. refresh asks the
	// machine again when it is online.
	Limits(deviceId, agent string, refresh bool) (protocol.PlanLimits, bool)
	Guard(agent string) guardCfg
}

type schedDecision struct {
	Start   bool
	FireAt  int64
	Note    string
	Trigger schedTrigger
}

func offlineNote(name string) string {
	if name == "" {
		name = "The machine"
	}
	return "Waiting for " + name + " to come online"
}

// decide says whether j should start now, or when to look again.
func decide(j *ScheduledSession, now time.Time, h schedHost) schedDecision {
	nowU := now.Unix()
	trig := j.Trigger
	name := h.DeviceName(j.DeviceId)
	switch trig.Kind {
	case trigTime:
		if nowU < trig.At {
			return schedDecision{FireAt: trig.At, Trigger: trig}
		}
		if !h.Online(j.DeviceId) {
			return schedDecision{FireAt: trig.At, Note: offlineNote(name), Trigger: trig}
		}
		return schedDecision{Start: true, FireAt: trig.At, Trigger: trig}
	case trigLimit:
		if j.StartsAt > nowU {
			return schedDecision{FireAt: j.StartsAt, Trigger: trig}
		}
		if !h.Online(j.DeviceId) {
			return schedDecision{FireAt: j.StartsAt, Note: offlineNote(name), Trigger: trig}
		}
		// The time has come: ask the machine again rather than trusting the
		// reading the schedule was made from.
		l, ok := h.Limits(j.DeviceId, j.Agent, true)
		if !ok {
			return schedDecision{Start: true, FireAt: j.StartsAt, Trigger: trig}
		}
		w, found := findWindow(l, trig.Window, j.Model)
		if !found {
			return schedDecision{Start: true, FireAt: j.StartsAt, Trigger: trig}
		}
		threshold := trig.Threshold
		if j.Reason == reasonGuardrail {
			if g := h.Guard(j.Agent); g.HoldEnabled && g.HoldPercent > 0 {
				threshold = g.HoldPercent
			}
		}
		if threshold <= 0 {
			threshold = 100
		}
		if w.UsedPercent >= float64(threshold) && w.ResetsAt > nowU {
			trig.ResetsAt = w.ResetsAt
			return schedDecision{FireAt: w.ResetsAt + int64(resetGrace/time.Second), Note: "The limit had not reset yet. Waiting for the new reset time.", Trigger: trig}
		}
		return schedDecision{Start: true, FireAt: j.StartsAt, Trigger: trig}
	}
	return schedDecision{Start: true, Trigger: trig}
}

// findWindow looks up a limit window by id; when the id is gone (the CLI
// renamed it) the tightest window that applies to the model is used.
func findWindow(l protocol.PlanLimits, id, model string) (protocol.LimitWindow, bool) {
	for _, w := range l.Windows {
		if w.Id == id {
			return w, true
		}
	}
	var best protocol.LimitWindow
	found := false
	for _, w := range l.Windows {
		if !windowApplies(w, model) {
			continue
		}
		if !found || w.UsedPercent > best.UsedPercent {
			best, found = w, true
		}
	}
	return best, found
}

// windowModel is the model a window is specific to ("opus" for Claude's
// "seven_day_opus" or a label like "Weekly (Opus)"), or "" for a plain window.
func windowModel(w protocol.LimitWindow) string {
	if id := strings.ToLower(w.Id); strings.HasPrefix(id, "seven_day_") {
		return strings.TrimPrefix(id, "seven_day_")
	}
	if i, j := strings.Index(w.Label, "("), strings.LastIndex(w.Label, ")"); i >= 0 && j > i {
		return strings.ToLower(strings.TrimSpace(w.Label[i+1 : j]))
	}
	return ""
}

// windowApplies is false for a model-specific window (Claude's Opus weekly)
// when the session does not use that model.
func windowApplies(w protocol.LimitWindow, model string) bool {
	m := windowModel(w)
	return m == "" || strings.Contains(strings.ToLower(model), m)
}

// resolveLimitWindow picks the window a "when my limit resets" schedule waits
// on: among the windows that are used up (100 %), else at or above threshold,
// the one that resets last, since all of them have to clear.
func resolveLimitWindow(l protocol.PlanLimits, model string, threshold int, now time.Time) (protocol.LimitWindow, bool) {
	if threshold <= 0 || threshold > 100 {
		threshold = 90
	}
	pick := func(min float64) (protocol.LimitWindow, bool) {
		var best protocol.LimitWindow
		found := false
		for _, w := range l.Windows {
			if !windowApplies(w, model) || w.UsedPercent < min || w.ResetsAt <= now.Unix() {
				continue
			}
			if !found || w.ResetsAt > best.ResetsAt {
				best, found = w, true
			}
		}
		return best, found
	}
	if w, ok := pick(100); ok {
		return w, true
	}
	return pick(float64(threshold))
}

// --- the hub side ---

// schedState is the scheduler's in-memory state (zero value is ready to use).
type schedState struct {
	mu     sync.Mutex
	paused map[string]string // thread id -> turn that was paused (guardrails.go)
	seen   map[string]bool   // pause notices already raised this process
}

type serverSched struct{ s *Server }

func (h serverSched) Online(deviceId string) bool { return h.s.registry.get(deviceId) != nil }

func (h serverSched) DeviceName(deviceId string) string {
	if d, err := h.s.store.DeviceById(deviceId); err == nil && d != nil {
		return d.Name
	}
	return ""
}

func (h serverSched) Limits(deviceId, agent string, refresh bool) (protocol.PlanLimits, bool) {
	return h.s.limitsFor(deviceId, agent, refresh)
}

func (h serverSched) Guard(agent string) guardCfg { return h.s.guardFor(agent) }

// limitsFor returns the cached (or, with refresh and an online machine, freshly
// read) plan limits of one agent on one machine.
func (s *Server) limitsFor(deviceId, agent string, refresh bool) (protocol.PlanLimits, bool) {
	if refresh {
		if c := s.registry.get(deviceId); c != nil {
			s.readDeviceLimits(c, true)
		}
	}
	for _, l := range s.usageLimits.readings(deviceId) {
		if l.Agent == agent && len(l.Windows) > 0 {
			return l, true
		}
	}
	return protocol.PlanLimits{}, false
}

// runSchedule is the scheduler loop: it starts what is due, applies the pause
// guardrail, and tidies old rows.
func (s *Server) runSchedule(ctx context.Context) {
	if err := s.store.resetStartingScheduled(); err != nil {
		log.Printf("scheduled sessions: %v", err)
	}
	ticker := time.NewTicker(scheduleTick)
	defer ticker.Stop()
	for {
		now := time.Now()
		s.runDueScheduled(now)
		s.checkPauseGuardrails(now)
		select {
		case <-ticker.C:
		case <-ctx.Done():
			return
		}
	}
}

func (s *Server) runDueScheduled(now time.Time) {
	list, err := s.store.ListScheduled(schedWaiting)
	if err != nil {
		log.Printf("scheduled sessions: %v", err)
		return
	}
	host := serverSched{s}
	changed := false
	for i := range list {
		j := &list[i]
		d := decide(j, now, host)
		if d.Start {
			if ok, err := s.store.ClaimScheduled(j.Id, schedWaiting); err == nil && ok {
				go s.startScheduled(j.Id)
			}
			continue
		}
		if d.FireAt != j.StartsAt || d.Note != j.Note || d.Trigger != j.Trigger {
			if err := s.store.setScheduledWait(j.Id, d.FireAt, d.Note, d.Trigger); err == nil {
				changed = true
			}
		}
	}
	if changed {
		s.events.publish(event{Type: "schedule.changed"})
	}
	if now.Minute()%10 == 0 && now.Second() < int(scheduleTick/time.Second) {
		s.store.purgeScheduled(now)
	}
}

var errBadStart = errors.New("bad start")

// startThreadOnce starts a session through the same path as POST
// /api/threads. A key that already started one returns that session.
func (s *Server) startThreadOnce(in threadInput) (t *Thread, replayed bool, err error) {
	if msg := in.validate(s.agents); msg != "" {
		return nil, false, fmt.Errorf("%w: %s", errBadStart, msg)
	}
	s.startMu.Lock()
	defer s.startMu.Unlock()
	if in.ClientRequestId != "" {
		existing, err := s.store.ThreadByRequestId(in.ClientRequestId)
		if err != nil {
			return nil, false, err
		}
		if existing != nil {
			return existing, true, nil
		}
	}
	if d, err := s.store.DeviceById(in.DeviceId); err != nil {
		return nil, false, err
	} else if d == nil {
		return nil, false, fmt.Errorf("%w: device does not exist", errBadStart)
	}
	if s.registry.get(in.DeviceId) == nil {
		return nil, false, errDeviceOffline
	}
	t, err = s.createThread(in)
	return t, false, err
}

// startScheduled starts one claimed row. It runs in its own goroutine because
// getting a GitHub checkout ready can take minutes.
func (s *Server) startScheduled(id string) {
	j, err := s.store.ScheduledById(id)
	if err != nil || j == nil {
		return
	}
	defer s.events.publish(event{Type: "schedule.changed"})
	back := func(note string) {
		// Not started: go back to waiting and look again on the next tick.
		fire := j.StartsAt
		if err := s.store.setScheduledWait(j.Id, fire, note, j.Trigger); err != nil {
			log.Printf("scheduled %s: %v", j.Id, err)
		}
	}
	fail := func(msg string) {
		s.store.setScheduledFailed(j.Id, msg)
		s.addGuardNotice(guardNotice{Kind: "failed", Agent: j.Agent, DeviceId: j.DeviceId, RefId: j.Id, Title: j.Title,
			Message: "Couldn't start the scheduled session: " + msg})
	}
	in := j.threadInput()
	if in.ClientRequestId == "" {
		in.ClientRequestId = "sched-" + j.Id
	}
	if s.registry.get(j.DeviceId) == nil {
		back(offlineNote(serverSched{s}.DeviceName(j.DeviceId)))
		return
	}
	if j.Source != nil {
		path, err := s.prepareSource(j.DeviceId, *j.Source)
		if err != nil {
			if errors.Is(err, errDeviceOffline) {
				back(offlineNote(serverSched{s}.DeviceName(j.DeviceId)))
			} else {
				fail(err.Error())
			}
			return
		}
		in.Cwd = path
	}
	t, _, err := s.startThreadOnce(in)
	switch {
	case err == nil:
		s.store.setScheduledStarted(j.Id, t.Id, time.Now().Unix())
		s.events.publish(event{Type: "schedule.started", ThreadId: t.Id})
	case errors.Is(err, errDeviceOffline):
		back(offlineNote(serverSched{s}.DeviceName(j.DeviceId)))
	default:
		fail(strings.TrimPrefix(err.Error(), errBadStart.Error()+": "))
	}
}

// prepareSource has the machine check out the repo and branch and returns the
// folder to run in.
func (s *Server) prepareSource(deviceId string, src schedSource) (string, error) {
	c := s.registry.get(deviceId)
	if c == nil {
		return "", errDeviceOffline
	}
	ctx, cancel := contextWithTimeout(schedulePrepare)
	defer cancel()
	var res protocol.GitPrepareResult
	err := c.requestInto(ctx, protocol.TypeGitPrepare, protocol.GitPrepareRequest{Repo: src.Repo, Branch: src.Branch, Known: src.Known, Key: "sched-" + randomToken()[:16]}, &res)
	if err != nil {
		if strings.Contains(err.Error(), "device disconnected") {
			return "", errDeviceOffline
		}
		return "", fmt.Errorf("could not get %s ready: %s", src.Repo, prepareErrorText(err))
	}
	if res.Path == "" {
		return "", errors.New("the machine did not say where the checkout is")
	}
	return res.Path, nil
}

// --- HTTP ---

type schedulePatchTrigger struct {
	Kind      string `json:"kind"`
	At        int64  `json:"at"`
	Threshold int    `json:"threshold"`
}

type scheduleBody struct {
	threadInputBody
	Trigger *schedulePatchTrigger `json:"trigger"`
	Source  *schedSource          `json:"source"`
}

// threadInputBody is threadInput with pointers so a PATCH can leave fields out.
type threadInputBody struct {
	DeviceId        *string       `json:"deviceId"`
	Agent           *string       `json:"agent"`
	Command         *string       `json:"command"`
	Cwd             *string       `json:"cwd"`
	Prompt          *string       `json:"prompt"`
	Model           *string       `json:"model"`
	Access          *string       `json:"access"`
	Effort          *string       `json:"effort"`
	Fast            *bool         `json:"fast"`
	Mode            *string       `json:"mode"`
	Title           *string       `json:"title"`
	Images          *[]schedImage `json:"images"`
	ClientRequestId *string       `json:"clientRequestId"`
}

func (b threadInputBody) apply(p *schedPayload) {
	set := func(dst *string, src *string) {
		if src != nil {
			*dst = strings.TrimSpace(*src)
		}
	}
	set(&p.DeviceId, b.DeviceId)
	set(&p.Agent, b.Agent)
	set(&p.Command, b.Command)
	set(&p.Cwd, b.Cwd)
	set(&p.Model, b.Model)
	set(&p.Access, b.Access)
	set(&p.Effort, b.Effort)
	set(&p.Mode, b.Mode)
	set(&p.Title, b.Title)
	set(&p.ClientRequestId, b.ClientRequestId)
	if b.Prompt != nil {
		p.Prompt = *b.Prompt
	}
	if b.Fast != nil {
		p.Fast = *b.Fast
	}
	if b.Images != nil {
		p.Images = *b.Images
	}
}

// validatePayload normalises the payload and returns a user-facing problem.
func (s *Server) validatePayload(p *schedPayload) string {
	in := p.threadInput()
	if msg := in.validate(s.agents); msg != "" {
		return msg
	}
	p.DeviceId, p.Agent, p.Command, p.Cwd, p.Model = in.DeviceId, in.Agent, in.Command, in.Cwd, in.Model
	p.Effort, p.Mode, p.Access, p.ClientRequestId = in.Effort, in.Mode, in.Access, in.ClientRequestId
	if len(p.Title) > 200 {
		p.Title = strings.TrimSpace(p.Title[:200])
	}
	if d, err := s.store.DeviceById(p.DeviceId); err != nil || d == nil {
		return "device does not exist"
	}
	if src := p.Source; src != nil {
		if repo, _, ok := parseRepoRef(src.Repo); !ok || repo != src.Repo {
			return "repo must be owner/name"
		}
		if src.Branch == "" || len(src.Branch) > 255 || strings.ContainsRune(src.Branch, 0) {
			return "branch is invalid"
		}
		if len(src.Known) > 16 {
			return "too many known folders"
		}
		for _, k := range src.Known {
			if len(k) > maxProjectPath || strings.ContainsRune(k, 0) {
				return "path is invalid"
			}
		}
	}
	if p.Title == "" {
		p.Title = titleFromPrompt(p.Prompt)
	}
	return ""
}

// applyTrigger sets j.Trigger and j.StartsAt from a request. now is injected
// for tests.
func (s *Server) applyTrigger(j *ScheduledSession, t schedulePatchTrigger, now time.Time) string {
	switch t.Kind {
	case trigTime:
		// A couple of minutes back is allowed (slow clocks, a slow click);
		// anything older is a mistake, and "Start now" covers the rest.
		if t.At < now.Add(-2*time.Minute).Unix() {
			return "choose a time in the future"
		}
		if t.At > now.Add(366*24*time.Hour).Unix() {
			return "choose a time within the next year"
		}
		j.Trigger = schedTrigger{Kind: trigTime, At: t.At}
		j.StartsAt = t.At
	case trigLimit:
		l, ok := s.limitsFor(j.DeviceId, j.Agent, false)
		if !ok {
			l, ok = s.limitsFor(j.DeviceId, j.Agent, true)
		}
		if !ok {
			return "no plan limit is known for that agent on that machine"
		}
		w, ok := resolveLimitWindow(l, j.Model, t.Threshold, now)
		if !ok {
			return "that limit is not high right now"
		}
		threshold := t.Threshold
		if threshold <= 0 || threshold > 100 {
			threshold = 90
		}
		j.Trigger = schedTrigger{Kind: trigLimit, Window: w.Id, WindowLabel: w.Label, Threshold: threshold, ResetsAt: w.ResetsAt}
		j.StartsAt = w.ResetsAt + int64(resetGrace/time.Second)
	default:
		return "trigger must be a time or a limit reset"
	}
	return ""
}

// present fills in the live fields of a row for the API.
func (s *Server) presentScheduled(j *ScheduledSession) {
	j.DeviceName = serverSched{s}.DeviceName(j.DeviceId)
	j.DeviceOnline = s.registry.get(j.DeviceId) != nil
	if j.Status == schedWaiting && j.Note == "" && !j.DeviceOnline && j.StartsAt > 0 && j.StartsAt <= time.Now().Unix() {
		j.Note = offlineNote(j.DeviceName)
	}
	if j.Status == schedStarting && j.Source != nil {
		j.Note = "Getting " + j.Source.Repo + " ready"
	}
	if j.Images == nil {
		j.Images = []schedImage{}
	}
}

func (s *Server) handleListScheduled(w http.ResponseWriter, r *http.Request) {
	var statuses []string
	if r.URL.Query().Get("all") == "" {
		statuses = []string{schedWaiting, schedStarting, schedFailed}
	}
	list, err := s.store.ListScheduled(statuses...)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	for i := range list {
		s.presentScheduled(&list[i])
	}
	writeJSON(w, list)
}

func (s *Server) handleCreateScheduled(w http.ResponseWriter, r *http.Request) {
	var body scheduleBody
	if err := readJSON(r, &body); err != nil || body.Trigger == nil {
		httpError(w, http.StatusBadRequest, "invalid scheduled session")
		return
	}
	now := time.Now()
	j := &ScheduledSession{Id: randomToken()[:16], Status: schedWaiting, CreatedAt: now.Unix()}
	body.apply(&j.schedPayload)
	j.Source = body.Source
	if j.ClientRequestId == "" {
		j.ClientRequestId = "sched-" + j.Id
	}
	if existing, err := s.store.ScheduledByRequestId(j.ClientRequestId); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	} else if existing != nil { // a retried request
		s.presentScheduled(existing)
		writeJSON(w, existing)
		return
	}
	if msg := s.validatePayload(&j.schedPayload); msg != "" {
		httpError(w, http.StatusBadRequest, msg)
		return
	}
	if msg := s.applyTrigger(j, *body.Trigger, now); msg != "" {
		httpError(w, http.StatusBadRequest, msg)
		return
	}
	if list, err := s.store.ListScheduled(schedWaiting, schedStarting, schedFailed); err == nil && len(list) >= maxScheduled {
		httpError(w, http.StatusConflict, "too many scheduled sessions")
		return
	}
	if err := s.store.SaveScheduled(j); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.rememberPublicURL(r)
	s.presentScheduled(j)
	s.events.publish(event{Type: "schedule.changed"})
	writeJSON(w, j)
}

func (s *Server) scheduledFromPath(w http.ResponseWriter, r *http.Request) *ScheduledSession {
	j, err := s.store.ScheduledById(r.PathValue("id"))
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return nil
	}
	if j == nil {
		httpError(w, http.StatusNotFound, "scheduled session not found")
		return nil
	}
	return j
}

func (s *Server) handlePatchScheduled(w http.ResponseWriter, r *http.Request) {
	j := s.scheduledFromPath(w, r)
	if j == nil {
		return
	}
	if j.Status != schedWaiting && j.Status != schedFailed {
		httpError(w, http.StatusConflict, "this session already started")
		return
	}
	var body scheduleBody
	if err := readJSON(r, &body); err != nil {
		httpError(w, http.StatusBadRequest, "invalid scheduled session")
		return
	}
	oldDerived := titleFromPrompt(j.Prompt)
	keepKey := j.ClientRequestId
	body.ClientRequestId = nil // the idempotency key never changes
	body.apply(&j.schedPayload)
	j.ClientRequestId = keepKey
	if body.Source != nil {
		j.Source = body.Source
		if j.Source.Repo == "" {
			j.Source = nil
		}
	}
	if body.Title == nil && body.Prompt != nil && j.Title == oldDerived {
		j.Title = ""
	}
	if msg := s.validatePayload(&j.schedPayload); msg != "" {
		httpError(w, http.StatusBadRequest, msg)
		return
	}
	trig := body.Trigger
	if trig == nil && j.Trigger.Kind == trigLimit && (body.DeviceId != nil || body.Agent != nil || body.Model != nil) {
		trig = &schedulePatchTrigger{Kind: trigLimit, Threshold: j.Trigger.Threshold}
	}
	if trig != nil {
		if msg := s.applyTrigger(j, *trig, time.Now()); msg != "" {
			httpError(w, http.StatusBadRequest, msg)
			return
		}
	}
	j.Status, j.Error, j.Note = schedWaiting, "", ""
	if err := s.store.SaveScheduled(j); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.presentScheduled(j)
	s.events.publish(event{Type: "schedule.changed"})
	writeJSON(w, j)
}

func (s *Server) handleDeleteScheduled(w http.ResponseWriter, r *http.Request) {
	j := s.scheduledFromPath(w, r)
	if j == nil {
		return
	}
	if j.Status == schedStarting {
		httpError(w, http.StatusConflict, "it is starting right now")
		return
	}
	if err := s.store.DeleteScheduled(j.Id); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.events.publish(event{Type: "schedule.changed"})
	writeJSON(w, map[string]bool{"ok": true})
}

// handleStartScheduled is "Start now": it skips the trigger and the guardrail,
// since the person asked for it. The answer waits for the start so the page can
// open the new session; a GitHub checkout that takes long is answered 202.
func (s *Server) handleStartScheduled(w http.ResponseWriter, r *http.Request) {
	j := s.scheduledFromPath(w, r)
	if j == nil {
		return
	}
	if j.Source == nil && s.registry.get(j.DeviceId) == nil {
		httpError(w, http.StatusServiceUnavailable, "device is offline")
		return
	}
	ok, err := s.store.ClaimScheduled(j.Id, schedWaiting, schedFailed)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		httpError(w, http.StatusConflict, "it is already starting or started")
		return
	}
	s.events.publish(event{Type: "schedule.changed"})
	go s.startScheduled(j.Id)
	// Wait briefly for a plain start so the caller can navigate to it.
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		cur, err := s.store.ScheduledById(j.Id)
		if err == nil && cur != nil && cur.Status != schedStarting {
			s.presentScheduled(cur)
			if cur.Status == schedFailed {
				httpError(w, http.StatusBadGateway, cur.Error)
				return
			}
			writeJSON(w, cur)
			return
		}
		time.Sleep(150 * time.Millisecond)
	}
	cur, _ := s.store.ScheduledById(j.Id)
	if cur == nil {
		cur = j
	}
	s.presentScheduled(cur)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(cur)
}

// routesSchedule registers the scheduled-session, guardrail and continue-in-another-agent routes.
func (s *Server) routesSchedule(m *http.ServeMux) {
	m.HandleFunc("GET /api/scheduled", s.requireAuth(s.handleListScheduled))
	m.HandleFunc("POST /api/scheduled", s.requireAuth(s.handleCreateScheduled))
	m.HandleFunc("PATCH /api/scheduled/{id}", s.requireAuth(s.handlePatchScheduled))
	m.HandleFunc("DELETE /api/scheduled/{id}", s.requireAuth(s.handleDeleteScheduled))
	m.HandleFunc("POST /api/scheduled/{id}/start", s.requireAuth(s.handleStartScheduled))
	m.HandleFunc("GET /api/guardrails", s.requireAuth(s.handleGetGuardrails))
	m.HandleFunc("PUT /api/guardrails", s.requireAuth(s.handlePutGuardrails))
	m.HandleFunc("GET /api/guardrails/notices", s.requireAuth(s.handleListGuardNotices))
	m.HandleFunc("DELETE /api/guardrails/notices/{id}", s.requireAuth(s.handleDismissGuardNotice))
	m.HandleFunc("GET /api/threads/{id}/continue", s.requireAuth(s.handleContinueLinks))
	m.HandleFunc("POST /api/threads/{id}/continue/preview", s.requireAuth(s.handleContinuePreview))
	m.HandleFunc("POST /api/threads/{id}/continue", s.requireAuth(s.handleContinueStart))
}
