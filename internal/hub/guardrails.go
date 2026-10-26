package hub

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// Guardrails keep a subscription from running dry. Per agent, two optional
// limits on the weekly window:
//   - hold: a new session is not started above this usage; it is saved as a
//     scheduled session that starts when the limit resets;
//   - pause: running turns are stopped (the same cancel as the Stop button,
//     sessions stay) above this usage.
// Both are off by default.

const (
	guardrailsKey   = "guardrails"
	noticeKeep      = 7 * 24 * time.Hour
	defaultHoldPct  = 90
	defaultPausePct = 98
)

func init() {
	extraSchemas = append(extraSchemas, `
CREATE TABLE IF NOT EXISTS guardrail_notices (
	id          TEXT PRIMARY KEY,
	kind        TEXT NOT NULL,
	agent       TEXT NOT NULL DEFAULT '',
	device_id   TEXT NOT NULL DEFAULT '',
	device_name TEXT NOT NULL DEFAULT '',
	percent     REAL NOT NULL DEFAULT 0,
	threshold   INTEGER NOT NULL DEFAULT 0,
	ref_id      TEXT NOT NULL DEFAULT '',
	title       TEXT NOT NULL DEFAULT '',
	message     TEXT NOT NULL,
	created_at  INTEGER NOT NULL,
	dismissed   INTEGER NOT NULL DEFAULT 0
);
`)
}

// guardCfg is one agent's guardrails.
type guardCfg struct {
	HoldEnabled  bool `json:"holdEnabled"`
	HoldPercent  int  `json:"holdPercent"`
	PauseEnabled bool `json:"pauseEnabled"`
	PausePercent int  `json:"pausePercent"`
}

func defaultGuard() guardCfg {
	return guardCfg{HoldPercent: defaultHoldPct, PausePercent: defaultPausePct}
}

// guardrailSettings returns the stored guardrails with defaults filled in for
// every agent that reports plan limits.
func (s *Server) guardrailSettings() map[string]guardCfg {
	out := map[string]guardCfg{}
	for _, a := range usageLimitAgents {
		out[a] = defaultGuard()
	}
	raw, err := s.store.Setting(guardrailsKey)
	if err != nil || raw == "" {
		return out
	}
	var stored map[string]guardCfg
	if json.Unmarshal([]byte(raw), &stored) != nil {
		return out
	}
	for agent, cfg := range stored {
		if !validUsageAgent(agent) {
			continue
		}
		if cfg.HoldPercent < 1 || cfg.HoldPercent > 100 {
			cfg.HoldPercent = defaultHoldPct
		}
		if cfg.PausePercent < 1 || cfg.PausePercent > 100 {
			cfg.PausePercent = defaultPausePct
		}
		out[agent] = cfg
	}
	return out
}

func (s *Server) guardFor(agent string) guardCfg {
	if cfg, ok := s.guardrailSettings()[agent]; ok {
		return cfg
	}
	return defaultGuard()
}

// isWeekly says whether a window is the weekly kind.
func isWeekly(w protocol.LimitWindow) bool {
	if w.WindowMinutes > 0 {
		return w.WindowMinutes >= 7*24*60
	}
	key := strings.ToLower(w.Id + " " + w.Label)
	return strings.Contains(key, "seven_day") || strings.Contains(key, "week") || strings.Contains(key, "secondary")
}

// weeklyWindow is the weekly window the guardrails watch: the most used one
// that applies to the model (Claude's Opus weekly only counts for Opus).
func weeklyWindow(l protocol.PlanLimits, model string) (protocol.LimitWindow, bool) {
	var best protocol.LimitWindow
	found := false
	for _, w := range l.Windows {
		if !isWeekly(w) || !windowApplies(w, model) {
			continue
		}
		if !found || w.UsedPercent > best.UsedPercent {
			best, found = w, true
		}
	}
	return best, found
}

// guardHolds reports whether new sessions are held, and by which window.
func guardHolds(cfg guardCfg, l protocol.PlanLimits, model string) (protocol.LimitWindow, bool) {
	if !cfg.HoldEnabled {
		return protocol.LimitWindow{}, false
	}
	w, ok := weeklyWindow(l, model)
	if !ok || w.UsedPercent < float64(cfg.HoldPercent) {
		return protocol.LimitWindow{}, false
	}
	return w, true
}

// guardPauses reports whether running turns are paused.
func guardPauses(cfg guardCfg, l protocol.PlanLimits, model string) (protocol.LimitWindow, bool) {
	if !cfg.PauseEnabled {
		return protocol.LimitWindow{}, false
	}
	w, ok := weeklyWindow(l, model)
	if !ok || w.UsedPercent < float64(cfg.PausePercent) {
		return protocol.LimitWindow{}, false
	}
	return w, true
}

// humanIn renders a duration the way the UI does: 45m, 1h 12m, 3d 5h.
func humanIn(secs int64) string {
	if secs < 60 {
		return "under a minute"
	}
	mins := secs / 60
	if mins < 60 {
		return fmt.Sprintf("%dm", mins)
	}
	hours := mins / 60
	if hours < 24 {
		return fmt.Sprintf("%dh %dm", hours, mins%60)
	}
	return fmt.Sprintf("%dd %dh", hours/24, hours%24)
}

func agentName(s *Server, id string) string {
	if a, ok := s.agents.lookup(id); ok && a.Name != "" {
		return a.Name
	}
	return id
}

// --- notices ---

// guardNotice is a persistent "your guardrail did something" message, shown
// until it is dismissed.
type guardNotice struct {
	Id         string  `json:"id"`
	Kind       string  `json:"kind"` // hold | pause | failed
	Agent      string  `json:"agent"`
	DeviceId   string  `json:"deviceId"`
	DeviceName string  `json:"deviceName"`
	Percent    float64 `json:"percent,omitempty"`
	Threshold  int     `json:"threshold,omitempty"`
	RefId      string  `json:"refId,omitempty"` // scheduled session (hold, failed) or thread (pause)
	Title      string  `json:"title,omitempty"`
	Message    string  `json:"message"`
	CreatedAt  int64   `json:"createdAt"`
}

// addGuardNotice stores a notice and tells browsers.
func (s *Server) addGuardNotice(n guardNotice) {
	n.Id = randomToken()[:16]
	n.CreatedAt = time.Now().Unix()
	if n.DeviceName == "" && n.DeviceId != "" {
		n.DeviceName = serverSched{s}.DeviceName(n.DeviceId)
	}
	_, err := s.store.db.Exec(`INSERT INTO guardrail_notices (id, kind, agent, device_id, device_name, percent, threshold, ref_id, title, message, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, n.Id, n.Kind, n.Agent, n.DeviceId, n.DeviceName, n.Percent, n.Threshold, n.RefId, n.Title, n.Message, n.CreatedAt)
	if err != nil {
		log.Printf("guardrail notice: %v", err)
		return
	}
	s.events.publish(event{Type: "guardrail.notice", DeviceId: n.DeviceId, Agent: n.Agent})
}

func (s *Store) listGuardNotices(now time.Time) ([]guardNotice, error) {
	rows, err := s.db.Query(`SELECT id, kind, agent, device_id, device_name, percent, threshold, ref_id, title, message, created_at
		FROM guardrail_notices WHERE dismissed = 0 AND created_at >= ? ORDER BY created_at DESC LIMIT 50`, now.Add(-noticeKeep).Unix())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []guardNotice{}
	for rows.Next() {
		var n guardNotice
		if err := rows.Scan(&n.Id, &n.Kind, &n.Agent, &n.DeviceId, &n.DeviceName, &n.Percent, &n.Threshold, &n.RefId, &n.Title, &n.Message, &n.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func (s *Server) handleListGuardNotices(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.listGuardNotices(time.Now())
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, list)
}

func (s *Server) handleDismissGuardNotice(w http.ResponseWriter, r *http.Request) {
	if _, err := s.store.db.Exec(`UPDATE guardrail_notices SET dismissed = 1 WHERE id = ?`, r.PathValue("id")); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.events.publish(event{Type: "guardrail.notice"})
	writeJSON(w, map[string]bool{"ok": true})
}

// --- settings API ---

func (s *Server) handleGetGuardrails(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.guardrailSettings())
}

func (s *Server) handlePutGuardrails(w http.ResponseWriter, r *http.Request) {
	var in map[string]guardCfg
	if err := readJSON(r, &in); err != nil {
		httpError(w, http.StatusBadRequest, "invalid guardrails")
		return
	}
	merged := s.guardrailSettings()
	for agent, cfg := range in {
		if !validUsageAgent(agent) {
			httpError(w, http.StatusBadRequest, "unknown agent "+agent)
			return
		}
		if cfg.HoldPercent < 1 || cfg.HoldPercent > 100 || cfg.PausePercent < 1 || cfg.PausePercent > 100 {
			httpError(w, http.StatusBadRequest, "percentages must be between 1 and 100")
			return
		}
		merged[agent] = cfg
	}
	b, _ := json.Marshal(merged)
	if err := s.store.SetSetting(guardrailsKey, string(b)); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, merged)
}

// --- hold: new sessions ---

// holdNewSession is called by POST /api/threads. When a guardrail holds the
// session it saves it as a scheduled session (same key, so a retry finds it),
// answers 202 and returns true.
func (s *Server) holdNewSession(w http.ResponseWriter, in threadInput) bool {
	j, err := s.holdForGuardrail(in, time.Now())
	if err != nil {
		log.Printf("guardrail hold: %v", err)
		return false // never block a start because the guardrail itself failed
	}
	if j == nil {
		return false
	}
	s.presentScheduled(j)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]any{
		"held":      true,
		"scheduled": j,
		"message":   j.Note,
	})
	return true
}

func (s *Server) holdForGuardrail(in threadInput, now time.Time) (*ScheduledSession, error) {
	cfg := s.guardFor(in.Agent)
	if !cfg.HoldEnabled || !validUsageAgent(in.Agent) {
		return nil, nil
	}
	l, ok := s.limitsFor(in.DeviceId, in.Agent, false)
	if !ok {
		return nil, nil
	}
	win, hold := guardHolds(cfg, l, in.Model)
	if !hold || win.ResetsAt <= now.Unix() {
		return nil, nil // not high, or no reset time to wait for
	}
	if in.ClientRequestId != "" {
		if existing, err := s.store.ScheduledByRequestId(in.ClientRequestId); err != nil {
			return nil, err
		} else if existing != nil {
			return existing, nil
		}
	}
	j := &ScheduledSession{
		Id: randomToken()[:16], Status: schedWaiting, Reason: reasonGuardrail, CreatedAt: now.Unix(),
		Trigger:      schedTrigger{Kind: trigLimit, Window: win.Id, WindowLabel: win.Label, Threshold: cfg.HoldPercent, ResetsAt: win.ResetsAt},
		StartsAt:     win.ResetsAt + int64(resetGrace/time.Second),
		schedPayload: payloadFromInput(in),
	}
	if j.ClientRequestId == "" {
		j.ClientRequestId = "sched-" + j.Id
	}
	if j.Title == "" {
		j.Title = titleFromPrompt(j.Prompt)
	}
	if err := s.store.SaveScheduled(j); err != nil {
		return nil, err
	}
	name := agentName(s, in.Agent)
	device := serverSched{s}.DeviceName(in.DeviceId)
	j.Note = fmt.Sprintf("Held by your guardrail: %s's weekly limit is at %d%%. It starts when the limit resets, in %s.",
		name, int(win.UsedPercent+0.5), humanIn(win.ResetsAt-now.Unix()))
	s.addGuardNotice(guardNotice{Kind: "hold", Agent: in.Agent, DeviceId: in.DeviceId, DeviceName: device,
		Percent: win.UsedPercent, Threshold: cfg.HoldPercent, RefId: j.Id, Title: j.Title,
		Message: fmt.Sprintf("Held “%s”: %s's weekly limit on %s is at %d%% (hold at %d%%). It starts when the limit resets, in %s.",
			j.Title, name, device, int(win.UsedPercent+0.5), cfg.HoldPercent, humanIn(win.ResetsAt-now.Unix()))})
	s.events.publish(event{Type: "schedule.changed"})
	return j, nil
}

// --- pause: running turns ---

// checkPauseGuardrails stops the running turns of agents whose weekly window is
// at or above the pause level. A turn is paused once; the session stays and the
// next message starts a new turn.
func (s *Server) checkPauseGuardrails(now time.Time) {
	cfgs := s.guardrailSettings()
	any := false
	for _, c := range cfgs {
		any = any || c.PauseEnabled
	}
	if !any {
		return
	}
	var threads []Thread
	loaded := false
	for _, c := range s.registry.all() {
		for _, l := range s.usageLimits.readings(c.deviceId) {
			cfg := cfgs[l.Agent]
			if !cfg.PauseEnabled {
				continue
			}
			if !loaded {
				list, err := s.store.ListThreads()
				if err != nil {
					return
				}
				threads, loaded = list, true
			}
			var paused []string
			var shown protocol.LimitWindow
			for i := range threads {
				t := &threads[i]
				if t.DeviceId != c.deviceId || t.Agent != l.Agent || (t.Status != "working" && t.Status != "starting") {
					continue
				}
				win, ok := guardPauses(cfg, l, t.Model)
				if !ok {
					continue
				}
				if s.pauseThread(t, win, cfg) {
					paused = append(paused, t.Title)
					shown = win
				}
			}
			if len(paused) == 0 {
				continue
			}
			name := agentName(s, l.Agent)
			device := serverSched{s}.DeviceName(c.deviceId)
			what := fmt.Sprintf("“%s”", paused[0])
			if len(paused) > 1 {
				what = fmt.Sprintf("%d sessions", len(paused))
			}
			s.addGuardNotice(guardNotice{Kind: "pause", Agent: l.Agent, DeviceId: c.deviceId, DeviceName: device,
				Percent: shown.UsedPercent, Threshold: cfg.PausePercent, Title: paused[0],
				Message: fmt.Sprintf("Paused %s: %s's weekly limit on %s is at %d%% (pause at %d%%). Send a message to carry on; it resets in %s.",
					what, name, device, int(shown.UsedPercent+0.5), cfg.PausePercent, humanIn(shown.ResetsAt-now.Unix()))})
		}
	}
}

// pauseThread cancels the running turn of t, once per turn. It reports
// whether it paused it.
func (s *Server) pauseThread(t *Thread, win protocol.LimitWindow, cfg guardCfg) bool {
	turn := s.threads.currentTurn(t.Id)
	s.sched.mu.Lock()
	if s.sched.paused == nil {
		s.sched.paused = map[string]string{}
	}
	if done, ok := s.sched.paused[t.Id]; ok && done == turn {
		s.sched.mu.Unlock()
		return false
	}
	s.sched.mu.Unlock()
	c := s.registry.get(t.DeviceId)
	if c == nil {
		return false
	}
	ctx, cancel := deviceCtx()
	defer cancel()
	err := c.requestInto(ctx, protocol.TypeThreadCancel, protocol.ThreadRef{ThreadId: t.Id}, nil)
	if err != nil && !strings.Contains(err.Error(), errNotRunning) {
		log.Printf("guardrail: pausing thread %s: %v", t.Id, err)
		return false
	}
	s.sched.mu.Lock()
	s.sched.paused[t.Id] = turn
	s.sched.mu.Unlock()
	if err != nil {
		s.threads.setStatus(t.Id, "idle", "")
	}
	s.threads.appendEvent(t.Id, protocol.ThreadEvent{Id: "s-" + randomToken()[:12], Role: "status",
		Text: fmt.Sprintf("Paused by your guardrail: %s's weekly limit is at %d%% (pause at %d%%). Send a message to carry on.",
			agentName(s, t.Agent), int(win.UsedPercent+0.5), cfg.PausePercent)})
	return true
}
