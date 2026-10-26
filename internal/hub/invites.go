package hub

import (
	"database/sql"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

// Invites: an owner makes a one-time link, <hub>/invite/<token>. The token is
// shown once and stored hashed. The person who opens it picks a name and a
// password and joins as a member.

const inviteTTL = 7 * 24 * time.Hour

func init() {
	extraSchemas = append(extraSchemas, `
CREATE TABLE IF NOT EXISTS invites (
	id         TEXT PRIMARY KEY,
	token_hash TEXT NOT NULL UNIQUE,
	label      TEXT NOT NULL DEFAULT '',
	created_by TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL,
	expires_at INTEGER NOT NULL,
	used_at    INTEGER NOT NULL DEFAULT 0,
	used_by    TEXT NOT NULL DEFAULT '',
	revoked_at INTEGER NOT NULL DEFAULT 0
);
`)
}

type inviteView struct {
	Id        string `json:"id"`
	Label     string `json:"label,omitempty"`
	CreatedBy string `json:"createdBy"` // name
	CreatedAt int64  `json:"createdAt"`
	ExpiresAt int64  `json:"expiresAt"`
	Status    string `json:"status"` // pending | used | expired | revoked
	UsedBy    string `json:"usedBy,omitempty"`
}

const errInviteGone = "this invite link is invalid or has expired"

// ListInvites returns the latest invites with their state.
func (s *Store) ListInvites(now time.Time) ([]inviteView, error) {
	rows, err := s.db.Query(`SELECT i.id, i.label, COALESCE(c.name, ''), i.created_at, i.expires_at, i.used_at, i.revoked_at, COALESCE(u.name, '')
		FROM invites i LEFT JOIN users c ON c.id = i.created_by LEFT JOIN users u ON u.id = i.used_by
		ORDER BY i.created_at DESC, i.rowid DESC LIMIT 100`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []inviteView{}
	for rows.Next() {
		var v inviteView
		var used, revoked int64
		if err := rows.Scan(&v.Id, &v.Label, &v.CreatedBy, &v.CreatedAt, &v.ExpiresAt, &used, &revoked, &v.UsedBy); err != nil {
			return nil, err
		}
		switch {
		case used > 0:
			v.Status = "used"
		case revoked > 0:
			v.Status = "revoked"
		case v.ExpiresAt <= now.Unix():
			v.Status = "expired"
		default:
			v.Status = "pending"
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (s *Server) handleListInvites(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.ListInvites(time.Now())
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, list)
}

func (s *Server) handleCreateInvite(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Label string `json:"label"`
	}
	if r.ContentLength != 0 {
		if err := readJSON(r, &req); err != nil {
			httpError(w, http.StatusBadRequest, "bad request")
			return
		}
	}
	label := strings.Join(strings.Fields(req.Label), " ")
	if utf8.RuneCountInString(label) > 40 {
		httpError(w, http.StatusBadRequest, "the label can be at most 40 characters")
		return
	}
	actor := userFrom(r)
	token := randomToken()
	id := randomToken()[:12]
	now := time.Now()
	expires := now.Add(inviteTTL)
	if _, err := s.store.db.Exec(`INSERT INTO invites (id, token_hash, label, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
		id, hashToken(token), label, actor.ID, now.Unix(), expires.Unix()); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.auditAs(actor.ID, actor.Name, "invite.create", label, "")
	// The link is shown once; only its hash is stored.
	writeJSON(w, map[string]any{
		"id": id, "label": label, "token": token, "expiresAt": expires.Unix(),
		"url": requestBaseURL(r) + "/invite/" + token,
	})
}

func (s *Server) handleRevokeInvite(w http.ResponseWriter, r *http.Request) {
	var label string
	_ = s.store.db.QueryRow(`SELECT label FROM invites WHERE id = ?`, r.PathValue("id")).Scan(&label)
	res, err := s.store.db.Exec(`UPDATE invites SET revoked_at = ? WHERE id = ? AND used_at = 0 AND revoked_at = 0`,
		time.Now().Unix(), r.PathValue("id"))
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		httpError(w, http.StatusNotFound, "no pending invite with that id")
		return
	}
	actor := userFrom(r)
	s.auditAs(actor.ID, actor.Name, "invite.revoke", label, "")
	writeJSON(w, map[string]bool{"ok": true})
}

// inviteByToken finds a link that can still be used. Unknown, used, revoked
// and expired all look the same.
func (s *Store) inviteByToken(token string, now time.Time) (id, label, createdBy string, ok bool, err error) {
	err = s.db.QueryRow(`SELECT id, label, created_by FROM invites
		WHERE token_hash = ? AND used_at = 0 AND revoked_at = 0 AND expires_at > ?`, hashToken(token), now.Unix()).
		Scan(&id, &label, &createdBy)
	if err == sql.ErrNoRows {
		return "", "", "", false, nil
	}
	return id, label, createdBy, err == nil, err
}

// handleCheckInvite lets the join page show who invited you before you pick
// a name. It is public and rate limited.
func (s *Server) handleCheckInvite(w http.ResponseWriter, r *http.Request) {
	if !s.inviteLimiter().allow(r.RemoteAddr) {
		httpError(w, http.StatusTooManyRequests, "too many attempts, try again in a minute")
		return
	}
	_, label, createdBy, ok, err := s.store.inviteByToken(r.PathValue("token"), time.Now())
	if err != nil {
		httpError(w, http.StatusInternalServerError, "could not check the invite")
		return
	}
	if !ok {
		httpError(w, http.StatusNotFound, errInviteGone)
		return
	}
	writeJSON(w, map[string]any{"valid": true, "label": label, "invitedBy": s.userName(createdBy)})
}

// handleAcceptInvite creates the account and signs the new member in. The
// invite is burned in the same transaction, so a link can't be used twice and
// a taken name doesn't spend it.
func (s *Server) handleAcceptInvite(w http.ResponseWriter, r *http.Request) {
	if !s.sameOriginWrite(r) {
		httpError(w, http.StatusForbidden, "cross-origin request refused")
		return
	}
	if !s.inviteLimiter().allow(r.RemoteAddr) {
		httpError(w, http.StatusTooManyRequests, "too many attempts, try again in a minute")
		return
	}
	var req struct {
		Name     string `json:"name"`
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := readJSON(r, &req); err != nil {
		httpError(w, http.StatusBadRequest, "bad request")
		return
	}
	name, err := cleanName(req.Name)
	if err != nil {
		userErr(w, err)
		return
	}
	email, okEmail := cleanEmail(req.Email)
	if !okEmail {
		httpError(w, http.StatusBadRequest, "that email address doesn't look right")
		return
	}
	if len(req.Password) < minPasswordLen || len(req.Password) > 256 {
		httpError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}
	token := r.PathValue("token")
	if _, _, _, ok, err := s.store.inviteByToken(token, time.Now()); err != nil || !ok {
		if err != nil {
			httpError(w, http.StatusInternalServerError, "could not use the invite")
			return
		}
		httpError(w, http.StatusNotFound, errInviteGone)
		return
	}
	hash := hashPassword(req.Password) // slow on purpose, so outside the transaction

	user, err := s.acceptInvite(token, name, email, hash)
	if err != nil {
		if err == errInviteUsed {
			httpError(w, http.StatusNotFound, errInviteGone)
			return
		}
		userErr(w, err)
		return
	}
	s.invalidateUsers()
	s.issueSessionFor(w, r, user.ID)
	s.auditAs(user.ID, user.Name, "invite.accept", user.Name, "")
	writeJSON(w, map[string]bool{"ok": true})
}

var errInviteUsed = &inviteUsedError{}

type inviteUsedError struct{}

func (*inviteUsedError) Error() string { return errInviteGone }

func (s *Server) acceptInvite(token, name, email, hash string) (*User, error) {
	tx, err := s.store.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	id := randomToken()[:16]
	now := time.Now().Unix()
	// Burn the invite first; it only matches while it is still pending.
	res, err := tx.Exec(`UPDATE invites SET used_at = ?, used_by = ?
		WHERE token_hash = ? AND used_at = 0 AND revoked_at = 0 AND expires_at > ?`, now, id, hashToken(token), now)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n != 1 {
		return nil, errInviteUsed
	}
	if _, err := tx.Exec(`INSERT INTO users (id, name, email, password_hash, role, created_at, last_seen) VALUES (?, ?, ?, ?, 'member', ?, ?)`,
		id, name, email, hash, now, now); err != nil {
		if isUniqueErr(err) {
			return nil, errNameTaken
		}
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.store.UserByID(id)
}
