package hub

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

// Teams: more than one person can use one hub. The first account (the admin
// password every hub already has) becomes the first owner; owners invite
// members (invites.go), see who did what (audit.go), and hand sessions to
// each other (handoff.go). Presence lives in presence.go.

const (
	roleOwner  = "owner"
	roleMember = "member"
)

func init() {
	extraSchemas = append(extraSchemas, `
CREATE TABLE IF NOT EXISTS users (
	id            TEXT PRIMARY KEY,
	name          TEXT NOT NULL,
	email         TEXT NOT NULL DEFAULT '',
	password_hash TEXT NOT NULL DEFAULT '',
	role          TEXT NOT NULL DEFAULT 'member',
	created_at    INTEGER NOT NULL,
	last_seen     INTEGER NOT NULL DEFAULT 0,
	disabled      INTEGER NOT NULL DEFAULT 0,
	removed_at    INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS users_name_active ON users(lower(name)) WHERE removed_at = 0;
`)
}

// User is one person on the hub. Removed people stay in the table (without a
// password) so the sessions they started keep their name.
type User struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Email     string `json:"email,omitempty"`
	Role      string `json:"role"`
	CreatedAt int64  `json:"createdAt"`
	LastSeen  int64  `json:"lastSeen"`
	Disabled  bool   `json:"disabled"`
	Removed   bool   `json:"removed,omitempty"`

	hash string
}

// IsOwner reports whether the user may use owner-only routes.
func (u User) IsOwner() bool { return u.Role == roleOwner && !u.Disabled && !u.Removed }

// apiTokenUser is who an API token acts as: owners hand tokens out, so a
// token has owner rights. It has no id, so it never owns a session.
var apiTokenUser = User{Name: "API token", Role: roleOwner}

// legacyUser is who a session made without a user acts as when the hub has no
// owner row yet (only tests create such sessions).
var legacyUser = User{Name: "Admin", Role: roleOwner}

// --- request context ---

type userCtxKey struct{}

func withUser(r *http.Request, u User) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), userCtxKey{}, u))
}

// userFrom is the signed-in user of a request that went through requireAuth
// (or requireOwner). Outside those it is the zero User: empty Role and ID.
func userFrom(r *http.Request) User {
	u, _ := r.Context().Value(userCtxKey{}).(User)
	return u
}

// requireOwner is requireAuth plus an owner check, for routes that manage the
// hub itself: people, API tokens, updates, security settings.
func (s *Server) requireOwner(next http.HandlerFunc) http.HandlerFunc {
	return s.requireAuth(func(w http.ResponseWriter, r *http.Request) {
		if !userFrom(r).IsOwner() {
			httpError(w, http.StatusForbidden, "only an owner can do this")
			return
		}
		next(w, r)
	})
}

// --- per-server state ---

const userCacheTTL = 5 * time.Second

type cachedUser struct {
	u  User
	at time.Time
}

// teamState is the in-memory side of teams. The zero value is ready to use.
type teamState struct {
	mu       sync.Mutex
	cache    map[string]cachedUser
	seen     map[string]time.Time // last_seen writes, at most one a minute per user
	inviteRL *rateLimiter
	presence map[string]map[string]*presenceSlot // thread id -> user id -> open views
}

func (s *Server) inviteLimiter() *rateLimiter {
	s.team.mu.Lock()
	defer s.team.mu.Unlock()
	if s.team.inviteRL == nil {
		s.team.inviteRL = newRateLimiter()
	}
	return s.team.inviteRL
}

func (s *Server) invalidateUsers() {
	s.team.mu.Lock()
	s.team.cache = nil
	s.team.mu.Unlock()
}

// userByID is a short-lived cached lookup used on every authenticated request.
func (s *Server) userByID(id string) (*User, error) {
	s.team.mu.Lock()
	if c, ok := s.team.cache[id]; ok && time.Since(c.at) < userCacheTTL {
		s.team.mu.Unlock()
		u := c.u
		return &u, nil
	}
	s.team.mu.Unlock()
	u, err := s.store.UserByID(id)
	if err != nil || u == nil {
		return nil, err
	}
	s.team.mu.Lock()
	if s.team.cache == nil {
		s.team.cache = map[string]cachedUser{}
	}
	s.team.cache[id] = cachedUser{u: *u, at: time.Now()}
	s.team.mu.Unlock()
	return u, nil
}

// sessionUser resolves a browser session cookie to its user. Disabled and
// removed people lose the session on the spot.
func (s *Server) sessionUser(token string) (User, bool) {
	id, ok := s.sessions.lookup(token)
	if !ok {
		return User{}, false
	}
	if id == "" {
		if u, _ := s.store.PrimaryOwner(); u != nil {
			return *u, true
		}
		return legacyUser, true
	}
	u, err := s.userByID(id)
	if err != nil || u == nil || u.Disabled || u.Removed {
		s.sessions.revoke(token)
		return User{}, false
	}
	s.touchUser(u.ID)
	return *u, true
}

func (s *Server) touchUser(id string) {
	s.team.mu.Lock()
	if s.team.seen == nil {
		s.team.seen = map[string]time.Time{}
	}
	if time.Since(s.team.seen[id]) < time.Minute {
		s.team.mu.Unlock()
		return
	}
	s.team.seen[id] = time.Now()
	s.team.mu.Unlock()
	s.store.TouchUser(id)
}

// userName names a user id for display ("" stays "").
func (s *Server) userName(id string) string {
	if id == "" {
		return ""
	}
	if u, _ := s.userByID(id); u != nil {
		return u.Name
	}
	return ""
}

// issueSessionFor starts a browser session for one user.
func (s *Server) issueSessionFor(w http.ResponseWriter, r *http.Request, userID string) {
	s.rememberPublicURL(r) // live previews send browsers back here to sign in
	token := s.sessions.createFor(userID)
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: token, Path: "/",
		HttpOnly: true, SameSite: http.SameSiteLaxMode,
		Secure: r.TLS != nil,
		MaxAge: int(sessionTTL.Seconds()),
	})
}

// --- store ---

var (
	errNameTaken   = errors.New("that name is already taken")
	errBadName     = errors.New("name must be 1-32 characters, no line breaks")
	errLastOwner   = errors.New("the hub needs at least one owner who can sign in")
	errUserMissing = errors.New("no such person")
)

// cleanName trims and checks a display name.
func cleanName(name string) (string, error) {
	name = strings.Join(strings.Fields(name), " ")
	if name == "" || utf8.RuneCountInString(name) > 32 {
		return "", errBadName
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return "", errBadName
		}
	}
	return name, nil
}

func cleanEmail(email string) (string, bool) {
	email = strings.TrimSpace(email)
	if email == "" {
		return "", true
	}
	at := strings.IndexByte(email, '@')
	ok := len(email) <= 120 && at > 0 && at < len(email)-1 && !strings.ContainsAny(email, " \t\r\n<>\"")
	return email, ok
}

const userColumns = `id, name, email, password_hash, role, created_at, last_seen, disabled, removed_at`

func scanUser(row rowScanner) (*User, error) {
	var u User
	var disabled int
	var removedAt int64
	if err := row.Scan(&u.ID, &u.Name, &u.Email, &u.hash, &u.Role, &u.CreatedAt, &u.LastSeen, &disabled, &removedAt); err != nil {
		return nil, err
	}
	u.Disabled, u.Removed = disabled == 1, removedAt > 0
	return &u, nil
}

func oneUser(row *sql.Row) (*User, error) {
	u, err := scanUser(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return u, err
}

func (s *Store) UserByID(id string) (*User, error) {
	return oneUser(s.db.QueryRow(`SELECT `+userColumns+` FROM users WHERE id = ?`, id))
}

// UserByName finds a person who has not been removed, ignoring case.
func (s *Store) UserByName(name string) (*User, error) {
	return oneUser(s.db.QueryRow(`SELECT `+userColumns+` FROM users WHERE lower(name) = lower(?) AND removed_at = 0`, name))
}

// OnlyUser is the one person of a single-person hub.
func (s *Store) OnlyUser() (*User, error) {
	return oneUser(s.db.QueryRow(`SELECT ` + userColumns + ` FROM users WHERE removed_at = 0 ORDER BY created_at, rowid LIMIT 1`))
}

// PrimaryOwner is the oldest owner who can sign in.
func (s *Store) PrimaryOwner() (*User, error) {
	return oneUser(s.db.QueryRow(`SELECT ` + userColumns + ` FROM users
		WHERE role = 'owner' AND disabled = 0 AND removed_at = 0 ORDER BY created_at, rowid LIMIT 1`))
}

// CountUsers counts people who have not been removed.
func (s *Store) CountUsers() (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM users WHERE removed_at = 0`).Scan(&n)
	return n, err
}

// ListUsers returns everyone, removed people last.
func (s *Store) ListUsers() ([]User, error) {
	rows, err := s.db.Query(`SELECT ` + userColumns + ` FROM users ORDER BY removed_at > 0, created_at, rowid`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []User{}
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *u)
	}
	return out, rows.Err()
}

func isUniqueErr(err error) bool {
	return err != nil && strings.Contains(err.Error(), "UNIQUE")
}

// CreateUser adds a person. hash is an already-hashed password.
func (s *Store) CreateUser(name, email, hash, role string) (*User, error) {
	id := randomToken()[:16]
	_, err := s.db.Exec(`INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		id, name, email, hash, role, time.Now().Unix())
	if isUniqueErr(err) {
		return nil, errNameTaken
	}
	if err != nil {
		return nil, err
	}
	return s.UserByID(id)
}

func (s *Store) TouchUser(id string) {
	s.db.Exec(`UPDATE users SET last_seen = ? WHERE id = ?`, time.Now().Unix(), id)
}

// otherOwners counts enabled owners besides one user.
func (s *Store) otherOwners(except string) (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM users WHERE role = 'owner' AND disabled = 0 AND removed_at = 0 AND id != ?`, except).Scan(&n)
	return n, err
}

type userPatch struct {
	Name     *string
	Email    *string
	Role     *string
	Disabled *bool
}

// UpdateUser applies a partial change, keeping at least one working owner.
func (s *Store) UpdateUser(id string, p userPatch) (*User, error) {
	cur, err := s.UserByID(id)
	if err != nil {
		return nil, err
	}
	if cur == nil || cur.Removed {
		return nil, errUserMissing
	}
	role, disabled := cur.Role, cur.Disabled
	if p.Role != nil {
		role = *p.Role
	}
	if p.Disabled != nil {
		disabled = *p.Disabled
	}
	if cur.IsOwner() && (role != roleOwner || disabled) {
		if n, err := s.otherOwners(id); err != nil {
			return nil, err
		} else if n == 0 {
			return nil, errLastOwner
		}
	}
	name, email := cur.Name, cur.Email
	if p.Name != nil {
		name = *p.Name
	}
	if p.Email != nil {
		email = *p.Email
	}
	_, err = s.db.Exec(`UPDATE users SET name = ?, email = ?, role = ?, disabled = ? WHERE id = ?`,
		name, email, role, boolInt(disabled), id)
	if isUniqueErr(err) {
		return nil, errNameTaken
	}
	if err != nil {
		return nil, err
	}
	return s.UserByID(id)
}

func (s *Store) SetUserPassword(id, hash string) error {
	_, err := s.db.Exec(`UPDATE users SET password_hash = ? WHERE id = ? AND removed_at = 0`, hash, id)
	return err
}

// RemoveUser takes a person off the hub. Their sessions stay and keep their
// name; sessions currently with them go to heir (when there is one).
func (s *Store) RemoveUser(id, heir string) error {
	cur, err := s.UserByID(id)
	if err != nil {
		return err
	}
	if cur == nil || cur.Removed {
		return errUserMissing
	}
	if cur.IsOwner() {
		if n, err := s.otherOwners(id); err != nil {
			return err
		} else if n == 0 {
			return errLastOwner
		}
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE users SET removed_at = ?, disabled = 1, password_hash = '' WHERE id = ?`, time.Now().Unix(), id); err != nil {
		return err
	}
	if heir != "" {
		if _, err := tx.Exec(`UPDATE threads SET assignee = ? WHERE assignee = ?`, heir, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// migrateUsers turns the single admin password every existing hub has into
// the first owner. It runs on every start and does nothing once there are
// users. Sessions started before teams belong to the hub's one admin, so the
// owner gets them. The old password_hash setting is left alone: it still
// marks the hub as set up, and an older binary can still read it.
func (s *Store) migrateUsers() error {
	var any int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&any); err != nil {
		return err
	}
	if any > 0 {
		return nil
	}
	hash, err := s.Setting("password_hash")
	if err != nil || hash == "" {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	id := randomToken()[:16]
	if _, err := tx.Exec(`INSERT INTO users (id, name, password_hash, role, created_at) VALUES (?, 'Admin', ?, 'owner', ?)`,
		id, hash, time.Now().Unix()); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE threads SET created_by = ?, assignee = ? WHERE created_by = ''`, id, id); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO settings (key, value) VALUES ('primary_owner_id', ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`, id); err != nil {
		return err
	}
	return tx.Commit()
}

// --- login ---

var (
	dummyHashOnce sync.Once
	dummyHashVal  string
)

// dummyHash is verified against when the name is unknown, so a wrong name
// costs as much time as a wrong password.
func dummyHash() string {
	dummyHashOnce.Do(func() { dummyHashVal = hashPassword("overseer-no-such-user") })
	return dummyHashVal
}

// handleLoginUsers signs a person in. With one person on the hub the password
// is enough; with more, the name picks the account. Errors never say which of
// the two was wrong.
func (s *Server) handleLoginUsers(w http.ResponseWriter, r *http.Request) {
	if !s.loginRL.allow(r.RemoteAddr) {
		httpError(w, http.StatusTooManyRequests, "too many attempts, try again in a minute")
		return
	}
	var req struct {
		Name     string `json:"name"`
		Password string `json:"password"`
	}
	if err := readJSON(r, &req); err != nil {
		httpError(w, http.StatusBadRequest, "bad request")
		return
	}
	n, err := s.store.CountUsers()
	if err != nil {
		httpError(w, http.StatusInternalServerError, "could not sign in")
		return
	}
	multi := n > 1
	var u *User
	if multi {
		if name := strings.TrimSpace(req.Name); name != "" {
			u, _ = s.store.UserByName(name)
		}
	} else {
		u, _ = s.store.OnlyUser()
	}
	ok := false
	if u != nil && !u.Disabled && !u.Removed && u.hash != "" {
		ok = verifyPassword(u.hash, req.Password)
	} else {
		verifyPassword(dummyHash(), req.Password)
	}
	if !ok {
		if u != nil && !u.Removed {
			s.auditAs(u.ID, u.Name, "login.failed", "", "")
		}
		if multi {
			httpError(w, http.StatusUnauthorized, "wrong name or password")
		} else {
			httpError(w, http.StatusUnauthorized, "wrong password")
		}
		return
	}
	s.touchUser(u.ID)
	s.issueSessionFor(w, r, u.ID)
	s.auditAs(u.ID, u.Name, "login", "", "")
	writeJSON(w, map[string]bool{"ok": true})
}

// teamMe adds who is signed in and whether the login screen needs a name.
func (s *Server) teamMe(out map[string]any, u *User) {
	n, _ := s.store.CountUsers()
	out["multiUser"] = n > 1
	if u != nil {
		view := *u
		out["user"] = view
	}
}

// --- people API ---

func (s *Server) routesTeams(m *http.ServeMux) {
	m.HandleFunc("GET /api/users", s.requireAuth(s.handleListUsers))
	m.HandleFunc("PATCH /api/users/{id}", s.requireOwner(s.handlePatchUser))
	m.HandleFunc("DELETE /api/users/{id}", s.requireOwner(s.handleRemoveUser))
	m.HandleFunc("PATCH /api/me", s.requireAuth(s.handlePatchMe))
	m.HandleFunc("POST /api/me/password", s.requireAuth(s.handleChangePassword))

	m.HandleFunc("GET /api/invites", s.requireOwner(s.handleListInvites))
	m.HandleFunc("POST /api/invites", s.requireOwner(s.handleCreateInvite))
	m.HandleFunc("DELETE /api/invites/{id}", s.requireOwner(s.handleRevokeInvite))
	// Public, so a new person can join: rate limited, same-origin only.
	m.HandleFunc("GET /api/invites/{token}", s.handleCheckInvite)
	m.HandleFunc("POST /api/invites/{token}/accept", s.handleAcceptInvite)

	m.HandleFunc("GET /api/audit", s.requireOwner(s.handleAudit))
	m.HandleFunc("POST /api/threads/{id}/assign", s.requireAuth(s.handleAssignThread))
}

// handleListUsers lists everyone, for the People page and for naming whoever
// started or holds a session. Only owners see email addresses.
func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.store.ListUsers()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	viewer := userFrom(r)
	for i := range users {
		if !viewer.IsOwner() && users[i].ID != viewer.ID {
			users[i].Email = ""
		}
	}
	writeJSON(w, users)
}

func (s *Server) userFromPath(w http.ResponseWriter, r *http.Request) *User {
	u, err := s.store.UserByID(r.PathValue("id"))
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return nil
	}
	if u == nil || u.Removed {
		httpError(w, http.StatusNotFound, errUserMissing.Error())
		return nil
	}
	return u
}

func userErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errNameTaken):
		httpError(w, http.StatusConflict, err.Error())
	case errors.Is(err, errLastOwner):
		httpError(w, http.StatusConflict, err.Error())
	case errors.Is(err, errUserMissing):
		httpError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, errBadName):
		httpError(w, http.StatusBadRequest, err.Error())
	default:
		httpError(w, http.StatusInternalServerError, err.Error())
	}
}

// handlePatchUser lets an owner rename someone, change their role, or disable
// and re-enable them. Everyone's sessions end when they are disabled.
func (s *Server) handlePatchUser(w http.ResponseWriter, r *http.Request) {
	target := s.userFromPath(w, r)
	if target == nil {
		return
	}
	var req struct {
		Name     *string `json:"name"`
		Email    *string `json:"email"`
		Role     *string `json:"role"`
		Disabled *bool   `json:"disabled"`
	}
	if err := readJSON(r, &req); err != nil {
		httpError(w, http.StatusBadRequest, "bad request")
		return
	}
	actor := userFrom(r)
	p := userPatch{Role: req.Role, Disabled: req.Disabled}
	if req.Name != nil {
		name, err := cleanName(*req.Name)
		if err != nil {
			userErr(w, err)
			return
		}
		p.Name = &name
	}
	if req.Email != nil {
		email, ok := cleanEmail(*req.Email)
		if !ok {
			httpError(w, http.StatusBadRequest, "that email address doesn't look right")
			return
		}
		p.Email = &email
	}
	if req.Role != nil && *req.Role != roleOwner && *req.Role != roleMember {
		httpError(w, http.StatusBadRequest, "role must be owner or member")
		return
	}
	if req.Disabled != nil && *req.Disabled && target.ID == actor.ID {
		httpError(w, http.StatusConflict, "you can't disable yourself")
		return
	}
	updated, err := s.store.UpdateUser(target.ID, p)
	if err != nil {
		userErr(w, err)
		return
	}
	s.invalidateUsers()
	if updated.Disabled {
		s.sessions.revokeUser(updated.ID, "")
		s.previewAuth.revokeAll()
	}
	if updated.Role != target.Role {
		s.auditAs(actor.ID, actor.Name, "user.role", updated.Name, target.Role+" to "+updated.Role)
	}
	if updated.Disabled != target.Disabled {
		action := "user.enable"
		if updated.Disabled {
			action = "user.disable"
		}
		s.auditAs(actor.ID, actor.Name, action, updated.Name, "")
	}
	if updated.Name != target.Name {
		s.auditAs(actor.ID, actor.Name, "user.rename", updated.Name, "was "+target.Name)
	}
	writeJSON(w, updated)
}

// handleRemoveUser takes someone off the hub. Their sessions stay, still
// under their name; the ones they hold now go to the owner who removed them.
func (s *Server) handleRemoveUser(w http.ResponseWriter, r *http.Request) {
	target := s.userFromPath(w, r)
	if target == nil {
		return
	}
	actor := userFrom(r)
	if target.ID == actor.ID {
		httpError(w, http.StatusConflict, "you can't remove yourself")
		return
	}
	if err := s.store.RemoveUser(target.ID, actor.ID); err != nil {
		userErr(w, err)
		return
	}
	s.invalidateUsers()
	s.sessions.revokeUser(target.ID, "")
	s.previewAuth.revokeAll()
	s.auditAs(actor.ID, actor.Name, "user.remove", target.Name, "")
	writeJSON(w, map[string]bool{"ok": true})
}

// handlePatchMe lets anyone change their own name and email.
func (s *Server) handlePatchMe(w http.ResponseWriter, r *http.Request) {
	me := userFrom(r)
	if me.ID == "" {
		httpError(w, http.StatusForbidden, "this sign-in has no profile")
		return
	}
	var req struct {
		Name  *string `json:"name"`
		Email *string `json:"email"`
	}
	if err := readJSON(r, &req); err != nil {
		httpError(w, http.StatusBadRequest, "bad request")
		return
	}
	p := userPatch{}
	if req.Name != nil {
		name, err := cleanName(*req.Name)
		if err != nil {
			userErr(w, err)
			return
		}
		p.Name = &name
	}
	if req.Email != nil {
		email, ok := cleanEmail(*req.Email)
		if !ok {
			httpError(w, http.StatusBadRequest, "that email address doesn't look right")
			return
		}
		p.Email = &email
	}
	updated, err := s.store.UpdateUser(me.ID, p)
	if err != nil {
		userErr(w, err)
		return
	}
	s.invalidateUsers()
	if updated.Name != me.Name {
		s.auditAs(me.ID, updated.Name, "user.rename", updated.Name, "was "+me.Name)
	}
	writeJSON(w, updated)
}

const minPasswordLen = 8

// handleChangePassword changes your own password and signs you out
// everywhere else.
func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	me := userFrom(r)
	if me.ID == "" {
		httpError(w, http.StatusForbidden, "this sign-in has no password")
		return
	}
	var req struct {
		Current  string `json:"current"`
		Password string `json:"password"`
	}
	if err := readJSON(r, &req); err != nil || len(req.Password) < minPasswordLen || len(req.Password) > 256 {
		httpError(w, http.StatusBadRequest, "the new password must be at least 8 characters")
		return
	}
	if !s.loginRL.allow(r.RemoteAddr) {
		httpError(w, http.StatusTooManyRequests, "too many attempts, try again in a minute")
		return
	}
	full, err := s.store.UserByID(me.ID)
	if err != nil || full == nil || !verifyPassword(full.hash, req.Current) {
		httpError(w, http.StatusForbidden, "your current password is wrong")
		return
	}
	hash := hashPassword(req.Password)
	if err := s.store.SetUserPassword(me.ID, hash); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if primary, _ := s.store.Setting("primary_owner_id"); primary == me.ID {
		s.store.SetSetting("password_hash", hash) // keep the legacy copy from going stale
	}
	keep := ""
	if c, err := r.Cookie(sessionCookie); err == nil {
		keep = c.Value
	}
	s.sessions.revokeUser(me.ID, keep)
	s.previewAuth.revokeAll()
	s.invalidateUsers()
	s.auditAs(me.ID, me.Name, "password.change", "", "")
	writeJSON(w, map[string]bool{"ok": true})
}
