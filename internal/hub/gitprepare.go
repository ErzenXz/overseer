package hub

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// Getting a GitHub repo and branch ready on a machine can take minutes (a big
// clone), longer than a browser request should stay open behind a proxy. So the
// real work is a job: POST starts it, GET reports it, DELETE cancels it. The
// quick "what would you do" question (plan) is a plain request.

const (
	prepareJobTimeout  = 13 * time.Minute // a little over the agent's own limit
	preparePlanTimeout = 20 * time.Second
	prepareKeepDone    = 30 * time.Minute
)

var prepareKeyRe = regexp.MustCompile(`^[A-Za-z0-9_-]{8,64}$`)

var errAgentTooOldForPrepare = errors.New("this machine's agent is too old to set up a checkout; update it")

// prepareJob is one running or finished prepare.
type prepareJob struct {
	Key      string                     `json:"key"`
	DeviceId string                     `json:"deviceId"`
	State    string                     `json:"state"` // running | done | failed
	Result   *protocol.GitPrepareResult `json:"result,omitempty"`
	Error    string                     `json:"error,omitempty"`
	finished time.Time
	cancel   context.CancelFunc
	conn     *agentConn
}

type prepareJobs struct {
	mu   sync.Mutex
	jobs map[string]*prepareJob
}

// snapshot copies a job so callers can encode it without holding the lock.
func (p *prepareJobs) snapshot(key string) (prepareJob, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	j := p.jobs[key]
	if j == nil {
		return prepareJob{}, false
	}
	return prepareJob{Key: j.Key, DeviceId: j.DeviceId, State: j.State, Result: j.Result, Error: j.Error}, true
}

func (p *prepareJobs) finish(j *prepareJob, res protocol.GitPrepareResult, err error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if j.State != "running" {
		return // cancelled first
	}
	j.finished = time.Now()
	if err != nil {
		j.State, j.Error = "failed", prepareErrorText(err)
		return
	}
	j.State, j.Result = "done", &res
}

func prepareErrorText(err error) string {
	switch {
	case strings.Contains(err.Error(), "unsupported request"):
		return errAgentTooOldForPrepare.Error()
	case strings.Contains(err.Error(), "device disconnected"):
		return "The machine went offline before it finished."
	case errors.Is(err, context.DeadlineExceeded):
		return "This took too long and was stopped."
	}
	return err.Error()
}

type prepareBody struct {
	protocol.GitPrepareRequest
	Key string `json:"key"`
}

// handleDeviceGitPrepare either answers a plan ("plan": true) or starts a job
// (needs "key", an id the caller makes up; sending it again finds the job).
func (s *Server) handleDeviceGitPrepare(w http.ResponseWriter, r *http.Request) {
	var body prepareBody
	if err := readJSON(r, &body); err != nil {
		httpError(w, http.StatusBadRequest, "invalid request")
		return
	}
	req := body.GitPrepareRequest
	req.Key = body.Key
	if ref, _, ok := parseRepoRef(req.Repo); !ok || ref != req.Repo {
		httpError(w, http.StatusBadRequest, "repo must be owner/name")
		return
	}
	if req.Branch == "" || len(req.Branch) > 255 || strings.ContainsRune(req.Branch, 0) {
		httpError(w, http.StatusBadRequest, "branch is invalid")
		return
	}
	if len(req.Known) > 16 || len(req.Dir) > maxProjectPath || strings.ContainsRune(req.Dir, 0) {
		httpError(w, http.StatusBadRequest, "request is too large")
		return
	}
	for _, p := range req.Known {
		if len(p) > maxProjectPath || strings.ContainsRune(p, 0) {
			httpError(w, http.StatusBadRequest, "path is invalid")
			return
		}
	}
	c := s.deviceConn(w, r)
	if c == nil {
		return
	}

	if req.Plan {
		ctx, cancel := contextWithTimeout(preparePlanTimeout)
		defer cancel()
		var res protocol.GitPrepareResult
		if err := c.requestInto(ctx, protocol.TypeGitPrepare, req, &res); err != nil {
			httpError(w, http.StatusBadGateway, prepareErrorText(err))
			return
		}
		writeJSON(w, res)
		return
	}

	if !prepareKeyRe.MatchString(req.Key) {
		httpError(w, http.StatusBadRequest, "key must be 8 to 64 letters, digits, - or _")
		return
	}
	s.prepares.mu.Lock()
	if s.prepares.jobs == nil {
		s.prepares.jobs = map[string]*prepareJob{}
	}
	for k, j := range s.prepares.jobs {
		if j.State != "running" && time.Since(j.finished) > prepareKeepDone {
			delete(s.prepares.jobs, k)
		}
	}
	if existing := s.prepares.jobs[req.Key]; existing != nil {
		s.prepares.mu.Unlock()
		snap, _ := s.prepares.snapshot(req.Key)
		writeJSON(w, snap)
		return
	}
	ctx, cancel := contextWithTimeout(prepareJobTimeout)
	job := &prepareJob{Key: req.Key, DeviceId: r.PathValue("id"), State: "running", cancel: cancel, conn: c}
	s.prepares.jobs[req.Key] = job
	s.prepares.mu.Unlock()

	go func() {
		defer cancel()
		var res protocol.GitPrepareResult
		err := c.requestInto(ctx, protocol.TypeGitPrepare, req, &res)
		if err != nil && ctx.Err() != nil {
			// Stop the work on the machine too; it checks the same key.
			if m, merr := protocol.NewMsg(protocol.TypeGitPrepareCancel, 0, 0, protocol.GitPrepareRequest{Key: req.Key}); merr == nil {
				c.sendJSON(m)
			}
		}
		s.prepares.finish(job, res, err)
	}()
	snap, _ := s.prepares.snapshot(req.Key)
	writeJSON(w, snap)
}

func (s *Server) handleGitPrepareStatus(w http.ResponseWriter, r *http.Request) {
	snap, ok := s.prepares.snapshot(r.PathValue("key"))
	if !ok {
		httpError(w, http.StatusNotFound, "no such job")
		return
	}
	writeJSON(w, snap)
}

// handleGitPrepareCancel stops a running job. The machine removes a clone it
// had half made; a finished job is left as it is.
func (s *Server) handleGitPrepareCancel(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	s.prepares.mu.Lock()
	job := s.prepares.jobs[key]
	if job == nil {
		s.prepares.mu.Unlock()
		httpError(w, http.StatusNotFound, "no such job")
		return
	}
	if job.State == "running" {
		job.State, job.Error, job.finished = "failed", "Cancelled.", time.Now()
		job.cancel()
	}
	s.prepares.mu.Unlock()
	snap, _ := s.prepares.snapshot(key)
	writeJSON(w, snap)
}
