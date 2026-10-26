package hub

import (
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

const maxHandoffNote = 500

// handleAssignThread (hand off to a teammate) gives a session to a teammate. They see it in "Needs you"
// until they open it, and the session shows who passed it on and why.
func (s *Server) handleAssignThread(w http.ResponseWriter, r *http.Request) {
	t := s.threadFromPath(w, r)
	if t == nil {
		return
	}
	var req struct {
		To   string `json:"to"`
		Note string `json:"note"`
	}
	if err := readJSON(r, &req); err != nil || req.To == "" {
		httpError(w, http.StatusBadRequest, "to is required")
		return
	}
	note := strings.TrimSpace(req.Note)
	if utf8.RuneCountInString(note) > maxHandoffNote {
		httpError(w, http.StatusBadRequest, "the note can be at most 500 characters")
		return
	}
	to, err := s.store.UserByID(req.To)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if to == nil || to.Removed || to.Disabled {
		httpError(w, http.StatusBadRequest, "that person can't take sessions")
		return
	}
	from := userFrom(r)
	if to.ID == from.ID {
		httpError(w, http.StatusBadRequest, "pick someone else; this session is already with you")
		return
	}
	// Opening the session marks it read, so reset that for the new holder.
	if _, err := s.store.db.Exec(`UPDATE threads SET assignee = ?, handoff_by = ?, handoff_note = ?, handoff_at = ?, last_read_at = 0 WHERE id = ?`,
		to.ID, from.ID, note, time.Now().Unix(), t.Id); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.audit(r, "thread.handoff", t.Title, "to "+to.Name)
	s.threads.pushThread(t.Id)
	updated, err := s.store.ThreadById(t.Id)
	if err != nil || updated == nil {
		httpError(w, http.StatusInternalServerError, "thread vanished")
		return
	}
	writeJSON(w, updated)
}
