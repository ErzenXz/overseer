package hub

import (
	"context"
	"log"
	"net/http"
	"strings"
	"time"
)

// Automations run a prompt on a cron schedule by creating a new thread, the
// same way POST /api/threads does.

const automationTick = 30 * time.Second

// automationInput is a create/patch body; pointers distinguish "absent".
type automationInput struct {
	Name     *string `json:"name"`
	Prompt   *string `json:"prompt"`
	DeviceId *string `json:"deviceId"`
	Agent    *string `json:"agent"`
	Command  *string `json:"command"`
	Model    *string `json:"model"`
	Cwd      *string `json:"cwd"`
	Access   *string `json:"access"`
	Schedule *string `json:"schedule"`
	Enabled  *bool   `json:"enabled"`
}

func (in automationInput) apply(a *Automation) {
	set := func(dst *string, src *string) {
		if src != nil {
			*dst = strings.TrimSpace(*src)
		}
	}
	set(&a.Name, in.Name)
	if in.Prompt != nil {
		a.Prompt = *in.Prompt
	}
	set(&a.DeviceId, in.DeviceId)
	set(&a.Agent, in.Agent)
	set(&a.Command, in.Command)
	set(&a.Model, in.Model)
	set(&a.Cwd, in.Cwd)
	set(&a.Access, in.Access)
	set(&a.Schedule, in.Schedule)
	if in.Enabled != nil {
		a.Enabled = *in.Enabled
	}
}

// threadInput is what a run of this automation submits.
func (a *Automation) threadInput() threadInput {
	return threadInput{
		DeviceId: a.DeviceId, Agent: a.Agent, Command: a.Command, Cwd: a.Cwd, Prompt: a.Prompt,
		Model: a.Model, Access: a.Access, Title: a.Name, AutomationId: a.Id,
	}
}

// validate checks a and computes its next run time.
func (s *Server) validateAutomation(a *Automation) string {
	if a.Name == "" || len(a.Name) > 120 {
		return "name must be 1-120 characters"
	}
	in := a.threadInput()
	if msg := in.validate(); msg != "" {
		return msg
	}
	a.Access, a.Command = in.Access, in.Command
	sched, err := parseCron(a.Schedule)
	if err != nil {
		return "schedule: " + err.Error()
	}
	if d, err := s.store.DeviceById(a.DeviceId); err != nil || d == nil {
		return "device does not exist"
	}
	a.NextRunAt = 0
	if next := sched.next(time.Now()); !next.IsZero() {
		a.NextRunAt = next.Unix()
	}
	return ""
}

func (s *Server) handleListAutomations(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.ListAutomations()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, list)
}

func (s *Server) handleCreateAutomation(w http.ResponseWriter, r *http.Request) {
	var in automationInput
	if err := readJSON(r, &in); err != nil {
		httpError(w, http.StatusBadRequest, "invalid automation")
		return
	}
	a := Automation{Id: randomToken()[:16], Enabled: true, CreatedAt: time.Now().Unix()}
	in.apply(&a)
	if msg := s.validateAutomation(&a); msg != "" {
		httpError(w, http.StatusBadRequest, msg)
		return
	}
	if err := s.store.SaveAutomation(a); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.rememberPublicURL(r)
	writeJSON(w, a)
}

func (s *Server) automationFromPath(w http.ResponseWriter, r *http.Request) *Automation {
	a, err := s.store.AutomationById(r.PathValue("id"))
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return nil
	}
	if a == nil {
		httpError(w, http.StatusNotFound, "automation not found")
		return nil
	}
	return a
}

func (s *Server) handlePatchAutomation(w http.ResponseWriter, r *http.Request) {
	a := s.automationFromPath(w, r)
	if a == nil {
		return
	}
	var in automationInput
	if err := readJSON(r, &in); err != nil {
		httpError(w, http.StatusBadRequest, "invalid automation")
		return
	}
	in.apply(a)
	if msg := s.validateAutomation(a); msg != "" {
		httpError(w, http.StatusBadRequest, msg)
		return
	}
	if err := s.store.SaveAutomation(*a); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, a)
}

func (s *Server) handleDeleteAutomation(w http.ResponseWriter, r *http.Request) {
	a := s.automationFromPath(w, r)
	if a == nil {
		return
	}
	if err := s.store.DeleteAutomation(a.Id); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) handleRunAutomation(w http.ResponseWriter, r *http.Request) {
	a := s.automationFromPath(w, r)
	if a == nil {
		return
	}
	s.rememberPublicURL(r)
	t, err := s.runAutomation(a, time.Now())
	if err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, t)
}

type automationError string

func (e automationError) Error() string { return string(e) }

// runAutomation creates the thread for one run and records it. An offline
// device still gets a thread (in the error state) so the miss is visible.
func (s *Server) runAutomation(a *Automation, now time.Time) (*Thread, error) {
	in := a.threadInput()
	if msg := in.validate(); msg != "" {
		return nil, automationError(msg)
	}
	t, err := s.createThread(in)
	if err != nil {
		return nil, err
	}
	var next int64
	if sched, err := parseCron(a.Schedule); err == nil {
		if n := sched.next(now); !n.IsZero() {
			next = n.Unix()
		}
	}
	if err := s.store.RecordAutomationRun(a.Id, now.Unix(), t.Id, next); err != nil {
		log.Printf("automation %s: %v", a.Id, err)
	}
	a.LastRunAt, a.LastThreadId, a.NextRunAt = now.Unix(), t.Id, next
	return t, nil
}

// runAutomations is the scheduler loop.
func (s *Server) runAutomations(ctx context.Context) {
	ticker := time.NewTicker(automationTick)
	defer ticker.Stop()
	for {
		s.runDueAutomations(time.Now())
		select {
		case <-ticker.C:
		case <-ctx.Done():
			return
		}
	}
}

// runDueAutomations runs every enabled automation whose time has come. A
// run missed while the hub was down fires once, then the schedule resumes.
func (s *Server) runDueAutomations(now time.Time) {
	list, err := s.store.ListAutomations()
	if err != nil {
		log.Printf("automations: %v", err)
		return
	}
	for i := range list {
		a := &list[i]
		if !a.Enabled {
			continue
		}
		if a.NextRunAt == 0 {
			// Never scheduled (or schedule has no future match): compute it.
			if sched, err := parseCron(a.Schedule); err == nil {
				if n := sched.next(now); !n.IsZero() {
					s.store.RecordAutomationRun(a.Id, a.LastRunAt, a.LastThreadId, n.Unix())
				}
			}
			continue
		}
		if now.Unix() < a.NextRunAt {
			continue
		}
		if _, err := s.runAutomation(a, now); err != nil {
			log.Printf("automation %q: %v", a.Name, err)
			// Skip to the next slot so a broken automation doesn't retry
			// every tick.
			if sched, perr := parseCron(a.Schedule); perr == nil {
				if n := sched.next(now); !n.IsZero() {
					s.store.RecordAutomationRun(a.Id, a.LastRunAt, a.LastThreadId, n.Unix())
				}
			}
		}
	}
}
