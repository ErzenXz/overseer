package hub

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Activity log: who did what, newest first, owners only. Entries keep the
// actor's name as it was, so they still read right after someone is removed.

const (
	auditKeep      = 20000 // rows kept; older ones are dropped
	auditPageLimit = 50
)

func init() {
	extraSchemas = append(extraSchemas, `
CREATE TABLE IF NOT EXISTS audit_log (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	at         INTEGER NOT NULL,
	actor_id   TEXT NOT NULL DEFAULT '',
	actor_name TEXT NOT NULL DEFAULT '',
	action     TEXT NOT NULL,
	target     TEXT NOT NULL DEFAULT '',
	detail     TEXT NOT NULL DEFAULT ''
);
`)
}

type auditEntry struct {
	Id     int64  `json:"id"`
	At     int64  `json:"at"`
	Actor  string `json:"actor"`
	Action string `json:"action"`
	Target string `json:"target,omitempty"`
	Detail string `json:"detail,omitempty"`
}

func auditClip(v string, n int) string {
	if len(v) <= n {
		return v
	}
	return strings.ToValidUTF8(v[:n], "") + "…"
}

// auditAs records an action by a named actor.
func (s *Server) auditAs(actorID, actorName, action, target, detail string) {
	res, err := s.store.db.Exec(`INSERT INTO audit_log (at, actor_id, actor_name, action, target, detail) VALUES (?, ?, ?, ?, ?, ?)`,
		time.Now().Unix(), actorID, auditClip(actorName, 64), action, auditClip(target, 200), auditClip(detail, 500))
	if err != nil {
		log.Printf("audit: %v", err)
		return
	}
	if id, _ := res.LastInsertId(); id%500 == 0 && id > auditKeep {
		s.store.db.Exec(`DELETE FROM audit_log WHERE id <= ?`, id-auditKeep)
	}
}

// audit records an action by whoever made the request.
func (s *Server) audit(r *http.Request, action, target, detail string) {
	u := userFrom(r)
	s.auditAs(u.ID, u.Name, action, target, detail)
}

func (s *Store) AuditPage(before int64, limit int) ([]auditEntry, error) {
	if before <= 0 {
		before = 1 << 62
	}
	rows, err := s.db.Query(`SELECT id, at, actor_name, action, target, detail FROM audit_log WHERE id < ? ORDER BY id DESC LIMIT ?`, before, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []auditEntry{}
	for rows.Next() {
		var e auditEntry
		if err := rows.Scan(&e.Id, &e.At, &e.Actor, &e.Action, &e.Target, &e.Detail); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// handleAudit pages through the log: ?before=<id> continues after the last
// entry of the previous page; next is 0 on the last page.
func (s *Server) handleAudit(w http.ResponseWriter, r *http.Request) {
	before, _ := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
	limit := clampInt(r.URL.Query().Get("limit"), auditPageLimit, 1, 200)
	entries, err := s.store.AuditPage(before, limit+1)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	var next int64
	if len(entries) > limit {
		entries = entries[:limit]
		next = entries[len(entries)-1].Id
	}
	writeJSON(w, map[string]any{"entries": entries, "next": next})
}

// --- route wrappers ---

// statusRecorder remembers the status a handler answered with.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (w *statusRecorder) WriteHeader(code int) {
	if w.status == 0 {
		w.status = code
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusRecorder) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.ResponseWriter.Write(b)
}

func (w *statusRecorder) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *statusRecorder) ok() bool { return w.status == 0 || w.status < 400 }

// routeTarget names what a request acts on for the log: a session's title, or
// the path ids.
func (s *Server) routeTarget(r *http.Request) string {
	id := r.PathValue("id")
	if strings.HasPrefix(r.URL.Path, "/api/threads/") && id != "" {
		if t, _ := s.store.ThreadById(id); t != nil {
			return t.Title
		}
	}
	if name := r.PathValue("name"); name != "" {
		if d, _ := s.store.DeviceById(id); d != nil {
			return name + " on " + d.Name
		}
		return name
	}
	if strings.HasPrefix(r.URL.Path, "/api/devices/") && id != "" {
		if d, _ := s.store.DeviceById(id); d != nil {
			return d.Name
		}
	}
	return id
}

// audited logs a request after it succeeds. The target is read before the
// handler runs, because the handler may delete it.
func (s *Server) audited(action string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		target := s.routeTarget(r)
		rec := &statusRecorder{ResponseWriter: w}
		next(rec, r)
		if rec.ok() {
			s.audit(r, action, target, "")
		}
	}
}

// ownerAudited is requireOwner plus an activity log entry on success.
func (s *Server) ownerAudited(action string, next http.HandlerFunc) http.HandlerFunc {
	return s.requireOwner(s.audited(action, next))
}

// authAudited is requireAuth plus an activity log entry on success.
func (s *Server) authAudited(action string, next http.HandlerFunc) http.HandlerFunc {
	return s.requireAuth(s.audited(action, next))
}

// answeredApproval wraps the approval route: when the agent accepts the
// answer, the person who gave it is recorded on the approval and in the log.
func (s *Server) answeredApproval(next http.HandlerFunc) http.HandlerFunc {
	return s.requireAuth(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
		r.Body = io.NopCloser(bytes.NewReader(body))
		var req struct {
			ApprovalId string `json:"approvalId"`
			OptionId   string `json:"optionId"`
		}
		_ = json.Unmarshal(body, &req)
		title := s.routeTarget(r)
		rec := &statusRecorder{ResponseWriter: w}
		next(rec, r)
		if !rec.ok() || req.ApprovalId == "" {
			return
		}
		actor := userFrom(r)
		threadID := r.PathValue("id")
		if actor.Name != "" {
			if m, err := s.store.SetApprovalAnsweredBy(threadID, req.ApprovalId, actor.Name); err == nil && m != nil {
				s.threads.pushMessage(threadID, m)
			}
		}
		s.audit(r, "approval", title, req.OptionId)
	})
}

// SetApprovalAnsweredBy records who answered an approval request. It matches
// the approval by its own id or its message id.
func (s *Store) SetApprovalAnsweredBy(threadID, approvalID, name string) (*ThreadMessage, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	rows, err := tx.Query(`SELECT id, seq, at, updated_at, role, text, data FROM thread_messages
		WHERE thread_id = ? AND role = 'approval' ORDER BY seq DESC`, threadID)
	if err != nil {
		return nil, err
	}
	var found *ThreadMessage
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		if m.Approval != nil && (m.Approval.Id == approvalID || m.Id == approvalID) {
			found = m
			break
		}
	}
	rows.Close()
	if found == nil {
		return nil, nil
	}
	found.Approval.AnsweredBy = name
	if _, err := tx.Exec(`UPDATE thread_messages SET data = ? WHERE thread_id = ? AND id = ?`, found.data(), threadID, found.Id); err != nil {
		return nil, err
	}
	return found, tx.Commit()
}
