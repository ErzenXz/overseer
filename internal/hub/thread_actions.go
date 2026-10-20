package hub

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// Native agent features on a thread: fork, compact, undo, answering
// questions, slash commands and capabilities.

const threadActionWait = 60 * time.Second

// actionError writes the HTTP error for a failed thread action.
func actionError(w http.ResponseWriter, err error) {
	var se startError
	switch {
	case err == errThreadGone:
		httpError(w, http.StatusNotFound, "thread not found")
	case err == errDeviceOffline:
		httpError(w, http.StatusServiceUnavailable, err.Error())
	case strings.Contains(err.Error(), protocol.ErrNotSupported):
		httpError(w, http.StatusConflict, err.Error())
	case errors.As(err, &se):
		httpError(w, http.StatusBadGateway, err.Error())
	default:
		httpError(w, http.StatusConflict, err.Error())
	}
}

func busyThread(t *Thread) bool {
	return t.Status == "working" || t.Status == "waiting" || t.Status == "starting"
}

// handleForkThread creates a new thread from t's transcript (up to and
// including the turn with messageId). The agent forks its own session on the
// first prompt where it can; otherwise that prompt carries the transcript.
func (s *Server) handleForkThread(w http.ResponseWriter, r *http.Request) {
	t := s.threadFromPath(w, r)
	if t == nil {
		return
	}
	var req struct {
		MessageId string `json:"messageId"`
		Title     string `json:"title"`
	}
	if r.ContentLength != 0 {
		if err := readJSON(r, &req); err != nil {
			httpError(w, http.StatusBadRequest, "invalid fork request")
			return
		}
	}
	msgs, err := s.store.ThreadMessages(t.Id)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	kept, cutUser, dropped, ok := forkCut(msgs, strings.TrimSpace(req.MessageId))
	if !ok {
		httpError(w, http.StatusNotFound, "message not found")
		return
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = "Fork of " + t.Title
	}
	if len(title) > 200 {
		title = strings.TrimSpace(title[:200])
	}
	now := time.Now().Unix()
	nt := &Thread{
		Id: randomToken()[:16], Title: title, DeviceId: t.DeviceId, Agent: t.Agent, Command: t.Command, Cwd: t.Cwd,
		Model: t.Model, Access: t.Access, Effort: t.Effort, Fast: t.Fast, Mode: t.Mode, Folder: t.Folder, ParentId: t.Id,
		Status: "idle", CreatedAt: now, UpdatedAt: now, LastReadAt: now,
		ResumeId: t.ResumeId, ForkPending: t.ResumeId != "", ForkContext: forkTranscript(kept),
	}
	if dropped > 0 && nt.ForkPending {
		nt.ForkAt = cutUser
	}
	if err := s.store.CreateThread(nt); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := s.store.CopyThreadMessages(nt.Id, kept); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.threads.changed(nt.Id, true)
	stored, err := s.store.ThreadById(nt.Id)
	if err != nil || stored == nil {
		httpError(w, http.StatusInternalServerError, "fork vanished")
		return
	}
	writeJSON(w, stored)
}

func (s *Server) handleCompactThread(w http.ResponseWriter, r *http.Request) {
	t := s.threadFromPath(w, r)
	if t == nil {
		return
	}
	if !capabilities(t).Compact {
		httpError(w, http.StatusConflict, "compact "+protocol.ErrNotSupported+" "+t.Agent)
		return
	}
	if busyThread(t) {
		httpError(w, http.StatusConflict, "the agent is working; compact after the turn ends")
		return
	}
	err := s.threads.withAgent(t.Id, func(t *Thread, c *agentConn) error {
		s.threads.setStatus(t.Id, "working", "")
		ctx, cancel := contextWithTimeout(threadActionWait)
		defer cancel()
		err := c.requestInto(ctx, protocol.TypeThreadCompact, protocol.ThreadRef{ThreadId: t.Id}, nil)
		if err != nil {
			s.threads.setStatus(t.Id, "idle", "")
		}
		return err
	})
	if err != nil {
		actionError(w, err)
		return
	}
	s.threads.appendEvent(t.Id, protocol.ThreadEvent{Id: "s-" + randomToken()[:12], Role: "status", Text: "Compacting the conversation"})
	writeJSON(w, map[string]bool{"ok": true})
}

// handleUndoThread drops the last turn in the agent and in the transcript.
func (s *Server) handleUndoThread(w http.ResponseWriter, r *http.Request) {
	t := s.threadFromPath(w, r)
	if t == nil {
		return
	}
	if !capabilities(t).Undo {
		httpError(w, http.StatusConflict, "undo "+protocol.ErrNotSupported+" "+t.Agent)
		return
	}
	if busyThread(t) {
		httpError(w, http.StatusConflict, "the agent is working; undo after the turn ends")
		return
	}
	msgs, err := s.store.ThreadMessages(t.Id)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	ids := lastTurnIds(msgs)
	if len(ids) == 0 {
		httpError(w, http.StatusConflict, "nothing to undo")
		return
	}
	err = s.threads.withAgent(t.Id, func(t *Thread, c *agentConn) error {
		ctx, cancel := contextWithTimeout(threadActionWait)
		defer cancel()
		return c.requestInto(ctx, protocol.TypeThreadUndo, protocol.ThreadRef{ThreadId: t.Id}, nil)
	})
	if err != nil {
		actionError(w, err)
		return
	}
	if err := s.store.DeleteThreadMessages(t.Id, ids); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.threads.forgetTurn(t.Id)
	s.threads.pushSnapshot(t.Id)
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) handleAnswerThread(w http.ResponseWriter, r *http.Request) {
	t := s.threadFromPath(w, r)
	if t == nil {
		return
	}
	var req struct {
		QuestionId string   `json:"questionId"`
		Answers    []string `json:"answers"`
		Text       string   `json:"text"`
	}
	if err := readJSON(r, &req); err != nil || req.QuestionId == "" || (len(req.Answers) == 0 && strings.TrimSpace(req.Text) == "") {
		httpError(w, http.StatusBadRequest, "questionId and answers or text are required")
		return
	}
	c := s.registry.get(t.DeviceId)
	if c == nil {
		httpError(w, http.StatusServiceUnavailable, "device is offline")
		return
	}
	ctx, cancel := deviceCtx()
	defer cancel()
	err := c.requestInto(ctx, protocol.TypeThreadAnswer, protocol.ThreadAnswer{
		ThreadId: t.Id, QuestionId: req.QuestionId, Answers: req.Answers, Text: strings.TrimSpace(req.Text),
	}, nil)
	if err != nil {
		httpError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) handleThreadCommands(w http.ResponseWriter, r *http.Request) {
	t := s.threadFromPath(w, r)
	if t == nil {
		return
	}
	cmds := t.Meta.Commands
	if cmds == nil {
		cmds = []protocol.AgentCommand{}
	}
	writeJSON(w, cmds)
}

func (s *Server) handleThreadCapabilities(w http.ResponseWriter, r *http.Request) {
	t := s.threadFromPath(w, r)
	if t == nil {
		return
	}
	writeJSON(w, capabilities(t))
}

// forgetTurn makes the current turn reload from the store (after undo).
func (ts *threadService) forgetTurn(id string) {
	rt := ts.runtime(id)
	rt.tmu.Lock()
	rt.turnSet = false
	rt.tmu.Unlock()
}

// pushSnapshot resends the whole thread to watchers (after messages were
// removed, which message events can't express).
func (ts *threadService) pushSnapshot(id string) {
	t, err := ts.s.store.ThreadById(id)
	if err != nil || t == nil {
		return
	}
	messages, err := ts.s.store.ThreadMessages(id)
	if err != nil {
		return
	}
	ts.push(id, map[string]any{"type": "snapshot", "thread": t, "messages": messages})
	ts.changed(id, true)
}
