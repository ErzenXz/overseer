package hub

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

const ownerPass = "an-owner-password"

type teamEnv struct {
	t     *testing.T
	srv   *Server
	ts    *httptest.Server
	owner *http.Client
}

func newClient() *http.Client {
	jar, _ := cookiejar.New(nil)
	return &http.Client{Jar: jar}
}

// newTeamEnv starts a hub that is set up with one owner who is signed in.
func newTeamEnv(t *testing.T) *teamEnv {
	t.Helper()
	srv, err := NewServer(Options{Addr: "127.0.0.1:0", DataDir: t.TempDir(), Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(srv.mux)
	t.Cleanup(ts.Close)
	e := &teamEnv{t: t, srv: srv, ts: ts, owner: newClient()}
	code, err := srv.ensureSetupCode()
	if err != nil {
		t.Fatal(err)
	}
	if st, body := e.do(e.owner, "POST", "/api/setup", map[string]string{"password": ownerPass, "code": code}); st != 200 {
		t.Fatalf("setup: %d %s", st, body)
	}
	return e
}

func (e *teamEnv) do(c *http.Client, method, path string, body any) (int, string) {
	e.t.Helper()
	return e.doWith(c, method, path, body, nil)
}

func (e *teamEnv) doWith(c *http.Client, method, path string, body any, headers map[string]string) (int, string) {
	e.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, e.ts.URL+path, rd)
	if err != nil {
		e.t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := c.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b)
}

func decode[T any](e *teamEnv, body string) T {
	e.t.Helper()
	var v T
	if err := json.Unmarshal([]byte(body), &v); err != nil {
		e.t.Fatalf("decode %q: %v", body, err)
	}
	return v
}

// invite makes an invite as the owner and returns its token.
func (e *teamEnv) invite(label string) string {
	e.t.Helper()
	st, body := e.do(e.owner, "POST", "/api/invites", map[string]string{"label": label})
	if st != 200 {
		e.t.Fatalf("create invite: %d %s", st, body)
	}
	out := decode[struct {
		Token string `json:"token"`
		URL   string `json:"url"`
	}](e, body)
	if !strings.HasSuffix(out.URL, "/invite/"+out.Token) {
		e.t.Fatalf("invite url %q", out.URL)
	}
	return out.Token
}

// join accepts an invite as a new member and returns a signed-in client.
func (e *teamEnv) join(name, password string) *http.Client {
	e.t.Helper()
	c := newClient()
	st, body := e.do(c, "POST", "/api/invites/"+e.invite("for "+name)+"/accept", map[string]string{"name": name, "password": password})
	if st != 200 {
		e.t.Fatalf("accept: %d %s", st, body)
	}
	return c
}

func (e *teamEnv) userID(name string) string {
	e.t.Helper()
	u, _ := e.srv.store.UserByName(name)
	if u == nil {
		e.t.Fatalf("no user %q", name)
	}
	return u.ID
}

func TestSetupMakesTheOwner(t *testing.T) {
	e := newTeamEnv(t)
	st, body := e.do(e.owner, "GET", "/api/me", nil)
	if st != 200 {
		t.Fatal(st)
	}
	me := decode[struct {
		Authenticated bool  `json:"authenticated"`
		MultiUser     bool  `json:"multiUser"`
		User          *User `json:"user"`
	}](e, body)
	if !me.Authenticated || me.MultiUser || me.User == nil || me.User.Role != roleOwner || me.User.ID == "" {
		t.Fatalf("me = %+v", me)
	}
	// A one-person hub keeps today's password-only login.
	c := newClient()
	if st, _ := e.do(c, "POST", "/api/login", map[string]string{"password": ownerPass}); st != 200 {
		t.Fatalf("password-only login: %d", st)
	}
	if st, body := e.do(newClient(), "POST", "/api/login", map[string]string{"password": "nope-nope-nope"}); st != 401 || !strings.Contains(body, "wrong password") {
		t.Fatalf("wrong password: %d %s", st, body)
	}
}

func TestLegacyUserlessSessionStillWorks(t *testing.T) {
	e := newTeamEnv(t)
	c := newClient()
	u, _ := http.NewRequest("GET", e.ts.URL+"/api/updates", nil)
	u.AddCookie(&http.Cookie{Name: sessionCookie, Value: e.srv.sessions.create()})
	resp, err := c.Do(u)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("userless session: %d", resp.StatusCode)
	}
}

// TestMigrationFromPreTeamsDatabase builds the database an older hub left
// behind (one admin password, a session, no users table) and opens it.
func TestMigrationFromPreTeamsDatabase(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "overseer.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(schema); err != nil {
		t.Fatal(err)
	}
	oldHash := hashPassword("old-admin-password")
	if _, err := db.Exec(`INSERT INTO settings (key, value) VALUES ('password_hash', ?)`, oldHash); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO threads (id, title, device_id, agent, created_at, updated_at) VALUES ('old1', 'Old session', 'dev', 'claude', 1, 1)`); err != nil {
		t.Fatal(err)
	}
	db.Close()

	open := func() *Server {
		srv, err := NewServer(Options{Addr: "127.0.0.1:0", DataDir: dir, Version: "test"})
		if err != nil {
			t.Fatal(err)
		}
		return srv
	}
	srv := open()
	users, err := srv.store.ListUsers()
	if err != nil || len(users) != 1 {
		t.Fatalf("users = %+v, %v", users, err)
	}
	owner := users[0]
	if owner.Role != roleOwner || owner.Disabled || owner.hash != oldHash {
		t.Fatalf("owner = %+v", owner)
	}
	th, _ := srv.store.ThreadById("old1")
	if th == nil || th.Title != "Old session" || th.CreatedBy != owner.ID || th.Assignee != owner.ID {
		t.Fatalf("old thread = %+v", th)
	}
	ts := httptest.NewServer(srv.mux)
	e := &teamEnv{t: t, srv: srv, ts: ts}
	c := newClient()
	if st, body := e.do(c, "POST", "/api/login", map[string]string{"password": "old-admin-password"}); st != 200 {
		t.Fatalf("old password login: %d %s", st, body)
	}
	if st, _ := e.do(c, "GET", "/api/threads", nil); st != 200 {
		t.Fatal("threads after login")
	}
	ts.Close()
	srv.store.Close()

	// Starting again changes nothing.
	srv = open()
	defer srv.store.Close()
	again, _ := srv.store.ListUsers()
	if len(again) != 1 || again[0].ID != owner.ID {
		t.Fatalf("second start: %+v", again)
	}
	if n := countRows(t, srv, `SELECT COUNT(*) FROM threads`); n != 1 {
		t.Fatalf("threads = %d", n)
	}
}

func countRows(t *testing.T, srv *Server, q string, args ...any) int {
	t.Helper()
	var n int
	if err := srv.store.db.QueryRow(q, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestInviteJoinAndNamedLogin(t *testing.T) {
	e := newTeamEnv(t)
	sam := e.join("Sam", "sams-password-1")

	st, body := e.do(sam, "GET", "/api/me", nil)
	me := decode[struct {
		MultiUser bool  `json:"multiUser"`
		User      *User `json:"user"`
	}](e, body)
	if st != 200 || !me.MultiUser || me.User == nil || me.User.Name != "Sam" || me.User.Role != roleMember {
		t.Fatalf("sam me: %d %s", st, body)
	}
	// With two people, a name is needed.
	if st, _ := e.do(newClient(), "POST", "/api/login", map[string]string{"password": ownerPass}); st != 401 {
		t.Fatalf("login without a name: %d", st)
	}
	if st, _ := e.do(newClient(), "POST", "/api/login", map[string]string{"name": "sam", "password": "sams-password-1"}); st != 200 {
		t.Fatalf("login as sam (any case): %d", st)
	}
	if st, _ := e.do(newClient(), "POST", "/api/login", map[string]string{"name": "Admin", "password": ownerPass}); st != 200 {
		t.Fatalf("login as the owner: %d", st)
	}
}

func TestLoginErrorsDoNotRevealWhoExists(t *testing.T) {
	e := newTeamEnv(t)
	e.join("Sam", "sams-password-1")
	// Disable Sam too: that must look the same as everything else.
	samID := e.userID("Sam")
	e.join("Kim", "kims-password-1")
	if st, _ := e.do(e.owner, "PATCH", "/api/users/"+samID, map[string]any{"disabled": true}); st != 200 {
		t.Fatal("disable")
	}
	attempts := []map[string]string{
		{"name": "Sam", "password": "sams-password-1"},  // disabled, right password
		{"name": "Kim", "password": "wrong-password-1"}, // real, wrong password
		{"name": "Nobody", "password": "whatever-1234"}, // unknown
		{"password": "whatever-1234"},                   // no name
	}
	var firstStatus int
	var firstBody string
	for i, a := range attempts {
		st, body := e.do(newClient(), "POST", "/api/login", a)
		if i == 0 {
			firstStatus, firstBody = st, body
		}
		if st != 401 || st != firstStatus || body != firstBody {
			t.Fatalf("attempt %v: %d %q, want %d %q", a, st, body, firstStatus, firstBody)
		}
	}
}

func TestLoginRateLimitCoversUsers(t *testing.T) {
	e := newTeamEnv(t)
	e.join("Sam", "sams-password-1")
	c := newClient()
	var last int
	for i := 0; i < rateMax+3; i++ {
		last, _ = e.do(c, "POST", "/api/login", map[string]string{"name": "Sam", "password": "bad-password-1"})
	}
	if last != 429 {
		t.Fatalf("after %d bad logins: %d, want 429", rateMax+3, last)
	}
}

// ownerRoutes are the routes a member must never reach.
var ownerRoutes = []struct{ method, path string }{
	{"GET", "/api/invites"},
	{"POST", "/api/agent-updates"},
	{"PUT", "/api/agent-updates/settings"},
	{"POST", "/api/invites"},
	{"DELETE", "/api/invites/abc"},
	{"PATCH", "/api/users/abc"},
	{"DELETE", "/api/users/abc"},
	{"GET", "/api/tokens"},
	{"POST", "/api/tokens"},
	{"DELETE", "/api/tokens/1"},
	{"PATCH", "/api/updates"},
	{"POST", "/api/updates/install"},
	{"POST", "/api/updates/rollback"},
	{"PUT", "/api/previews/config"},
	{"GET", "/api/audit"},
	{"POST", "/api/enroll-tokens"},
	{"DELETE", "/api/devices/abc"},
}

func TestMembersCannotUseOwnerRoutes(t *testing.T) {
	e := newTeamEnv(t)
	sam := e.join("Sam", "sams-password-1")
	for _, rt := range ownerRoutes {
		if st, body := e.do(sam, rt.method, rt.path, map[string]any{}); st != 403 {
			t.Errorf("member %s %s: %d %s, want 403", rt.method, rt.path, st, body)
		}
		if st, _ := e.do(newClient(), rt.method, rt.path, map[string]any{}); st != 401 {
			t.Errorf("anonymous %s %s: %d, want 401", rt.method, rt.path, st)
		}
		if st, _ := e.do(e.owner, rt.method, rt.path, map[string]any{}); st == 403 || st == 401 {
			t.Errorf("owner %s %s: %d", rt.method, rt.path, st)
		}
	}
	// Members can't escalate through their own profile or by guessing ids.
	owner := e.userID("Admin")
	e.do(sam, "PATCH", "/api/me", map[string]any{"name": "Sam", "role": "owner"})
	if u, _ := e.srv.store.UserByName("Sam"); u.Role != roleMember {
		t.Fatalf("member became %s", u.Role)
	}
	if st, _ := e.do(sam, "PATCH", "/api/users/"+e.userID("Sam"), map[string]any{"role": "owner"}); st != 403 {
		t.Fatalf("member promoting self: %d", st)
	}
	if st, _ := e.do(sam, "DELETE", "/api/users/"+owner, nil); st != 403 {
		t.Fatalf("member removing owner: %d", st)
	}
	// Ordinary routes stay open to members.
	for _, p := range []string{"/api/devices", "/api/threads", "/api/users", "/api/updates"} {
		if st, _ := e.do(sam, "GET", p, nil); st != 200 {
			t.Errorf("member GET %s: %d", p, st)
		}
	}
	// Members see people, but not their email addresses.
	e.do(e.owner, "PATCH", "/api/me", map[string]any{"email": "boss@example.com"})
	_, body := e.do(sam, "GET", "/api/users", nil)
	if strings.Contains(body, "boss@example.com") {
		t.Fatal("a member saw the owner's email")
	}
	_, body = e.do(e.owner, "GET", "/api/users", nil)
	if !strings.Contains(body, "boss@example.com") {
		t.Fatal("the owner could not see their own email")
	}
	if strings.Contains(body, "argon2id") {
		t.Fatal("password hashes leaked in /api/users")
	}
}

func TestAPITokenActsAsOwner(t *testing.T) {
	e := newTeamEnv(t)
	tok, _ := e.srv.store.CreateApiToken("cli")
	req, _ := http.NewRequest("GET", e.ts.URL+"/api/tokens", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	resp, _ := http.DefaultClient.Do(req)
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("token on an owner route: %d", resp.StatusCode)
	}
}

func TestOwnerRoutesKeepTheCSRFGuard(t *testing.T) {
	e := newTeamEnv(t)
	st, _ := e.doWith(e.owner, "POST", "/api/invites", map[string]string{}, map[string]string{"Origin": "https://evil.example"})
	if st != 403 {
		t.Fatalf("cross-origin owner write: %d, want 403", st)
	}
	st, _ = e.doWith(e.owner, "POST", "/api/invites", map[string]string{}, map[string]string{"Origin": e.ts.URL})
	if st != 200 {
		t.Fatalf("same-origin owner write: %d", st)
	}
}

func TestInviteIsOneTimeHashedAndExpires(t *testing.T) {
	e := newTeamEnv(t)
	token := e.invite("Sam")
	// Only a hash is stored.
	if n := countRows(t, e.srv, `SELECT COUNT(*) FROM invites WHERE token_hash = ?`, hashToken(token)); n != 1 {
		t.Fatal("invite not stored by hash")
	}
	var dump string
	rows, _ := e.srv.store.db.Query(`SELECT id || token_hash || label || created_by FROM invites`)
	for rows.Next() {
		var s string
		rows.Scan(&s)
		dump += s
	}
	rows.Close()
	if strings.Contains(dump, token) {
		t.Fatal("the raw token is in the database")
	}

	if st, _ := e.do(newClient(), "GET", "/api/invites/"+token, nil); st != 200 {
		t.Fatalf("check: %d", st)
	}
	c := newClient()
	if st, body := e.do(c, "POST", "/api/invites/"+token+"/accept", map[string]string{"name": "Sam", "password": "sams-password-1"}); st != 200 {
		t.Fatalf("accept: %d %s", st, body)
	}
	// Used once.
	if st, _ := e.do(newClient(), "POST", "/api/invites/"+token+"/accept", map[string]string{"name": "Sam2", "password": "sams-password-1"}); st != 404 {
		t.Fatalf("second use: %d, want 404", st)
	}
	if st, _ := e.do(newClient(), "GET", "/api/invites/"+token, nil); st != 404 {
		t.Fatalf("check after use: %d", st)
	}

	// Expiry: seven days.
	var expires int64
	tok2 := e.invite("late")
	e.srv.store.db.QueryRow(`SELECT expires_at - created_at FROM invites WHERE token_hash = ?`, hashToken(tok2)).Scan(&expires)
	if expires != int64(7*24*time.Hour/time.Second) {
		t.Fatalf("invite lasts %ds, want 7 days", expires)
	}
	e.srv.store.db.Exec(`UPDATE invites SET expires_at = ? WHERE token_hash = ?`, time.Now().Unix()-1, hashToken(tok2))
	if st, _ := e.do(newClient(), "POST", "/api/invites/"+tok2+"/accept", map[string]string{"name": "Late", "password": "lates-password-1"}); st != 404 {
		t.Fatalf("expired invite: %d, want 404", st)
	}

	// Revoked.
	tok3 := e.invite("revoked")
	_, body := e.do(e.owner, "GET", "/api/invites", nil)
	list := decode[[]inviteView](e, body)
	var id string
	for _, v := range list {
		if v.Label == "revoked" {
			id = v.Id
			if v.Status != "pending" {
				t.Fatalf("status %s", v.Status)
			}
		}
	}
	if st, _ := e.do(e.owner, "DELETE", "/api/invites/"+id, nil); st != 200 {
		t.Fatal("revoke")
	}
	if st, _ := e.do(newClient(), "POST", "/api/invites/"+tok3+"/accept", map[string]string{"name": "Rev", "password": "revs-password-1"}); st != 404 {
		t.Fatalf("revoked invite: %d, want 404", st)
	}
	if st, _ := e.do(newClient(), "POST", "/api/invites/not-a-token/accept", map[string]string{"name": "X", "password": "xxxxxxxx-1"}); st != 404 {
		t.Fatalf("unknown invite: %d", st)
	}
}

func TestInviteAcceptRules(t *testing.T) {
	e := newTeamEnv(t)
	token := e.invite("Sam")
	accept := func(body map[string]string, headers map[string]string) (int, string) {
		return e.doWith(newClient(), "POST", "/api/invites/"+token+"/accept", body, headers)
	}
	if st, _ := accept(map[string]string{"name": "Sam", "password": "short"}, nil); st != 400 {
		t.Fatalf("short password: %d", st)
	}
	if st, _ := accept(map[string]string{"name": "  ", "password": "long-enough-1"}, nil); st != 400 {
		t.Fatalf("blank name: %d", st)
	}
	if st, _ := accept(map[string]string{"name": "Sam", "password": "long-enough-1"}, map[string]string{"Origin": "https://evil.example"}); st != 403 {
		t.Fatalf("cross-origin accept: %d, want 403", st)
	}
	// A taken name (any case) doesn't spend the invite.
	if st, _ := accept(map[string]string{"name": "admin", "password": "long-enough-1"}, nil); st != 409 {
		t.Fatalf("taken name: %d, want 409", st)
	}
	if st, body := accept(map[string]string{"name": "Sam", "password": "long-enough-1"}, nil); st != 200 {
		t.Fatalf("accept after a refused name: %d %s", st, body)
	}
}

func TestInviteAcceptIsRateLimited(t *testing.T) {
	e := newTeamEnv(t)
	c := newClient()
	var last int
	for i := 0; i < rateMax+3; i++ {
		last, _ = e.do(c, "POST", "/api/invites/guess-"+strings.Repeat("x", i+1)+"/accept", map[string]string{"name": "X", "password": "xxxxxxxx-1"})
	}
	if last != 429 {
		t.Fatalf("after %d guesses: %d, want 429", rateMax+3, last)
	}
	// The check endpoint shares the budget.
	if st, _ := e.do(c, "GET", "/api/invites/anything", nil); st != 429 {
		t.Fatalf("check while limited: %d", st)
	}
}

func TestDisableRemoveAndPasswordChangeEndSessions(t *testing.T) {
	e := newTeamEnv(t)
	sam := e.join("Sam", "sams-password-1")
	samID := e.userID("Sam")
	if st, _ := e.do(sam, "GET", "/api/threads", nil); st != 200 {
		t.Fatal("sam can't list threads")
	}

	// Disabling kills the session at once, enabling lets a new login in.
	if st, _ := e.do(e.owner, "PATCH", "/api/users/"+samID, map[string]any{"disabled": true}); st != 200 {
		t.Fatal("disable")
	}
	if st, _ := e.do(sam, "GET", "/api/threads", nil); st != 401 {
		t.Fatalf("disabled member: %d, want 401", st)
	}
	if st, _ := e.do(newClient(), "POST", "/api/login", map[string]string{"name": "Sam", "password": "sams-password-1"}); st != 401 {
		t.Fatal("disabled member could log in")
	}
	if st, _ := e.do(e.owner, "PATCH", "/api/users/"+samID, map[string]any{"disabled": false}); st != 200 {
		t.Fatal("enable")
	}
	sam2 := newClient()
	if st, _ := e.do(sam2, "POST", "/api/login", map[string]string{"name": "Sam", "password": "sams-password-1"}); st != 200 {
		t.Fatal("re-enabled login")
	}
	sam3 := newClient()
	e.do(sam3, "POST", "/api/login", map[string]string{"name": "Sam", "password": "sams-password-1"})

	// Password change: the wrong current password is refused; the right one
	// signs out every other session but keeps this one.
	if st, _ := e.do(sam2, "POST", "/api/me/password", map[string]string{"current": "wrong-current-1", "password": "brand-new-password"}); st != 403 {
		t.Fatalf("wrong current: %d", st)
	}
	if st, _ := e.do(sam2, "POST", "/api/me/password", map[string]string{"current": "sams-password-1", "password": "short"}); st != 400 {
		t.Fatalf("short new password: %d", st)
	}
	if st, body := e.do(sam2, "POST", "/api/me/password", map[string]string{"current": "sams-password-1", "password": "brand-new-password"}); st != 200 {
		t.Fatalf("change: %d %s", st, body)
	}
	if st, _ := e.do(sam3, "GET", "/api/threads", nil); st != 401 {
		t.Fatalf("other session after password change: %d, want 401", st)
	}
	if st, _ := e.do(sam2, "GET", "/api/threads", nil); st != 200 {
		t.Fatalf("this session after password change: %d, want 200", st)
	}
	if st, _ := e.do(newClient(), "POST", "/api/login", map[string]string{"name": "Sam", "password": "sams-password-1"}); st != 401 {
		t.Fatal("old password still works")
	}
	if st, _ := e.do(newClient(), "POST", "/api/login", map[string]string{"name": "Sam", "password": "brand-new-password"}); st != 200 {
		t.Fatal("new password does not work")
	}

	// Removing: sessions end, login fails, the name stays on their sessions.
	e.srv.store.CreateThread(&Thread{Id: "t-sam", Title: "Sam's work", DeviceId: "d", Agent: "claude", Access: "edits",
		Status: "idle", CreatedAt: 1, UpdatedAt: 1, CreatedBy: samID})
	if st, _ := e.do(e.owner, "DELETE", "/api/users/"+samID, nil); st != 200 {
		t.Fatal("remove")
	}
	if st, _ := e.do(sam2, "GET", "/api/threads", nil); st != 401 {
		t.Fatalf("removed member: %d, want 401", st)
	}
	// One person is left, so login is password-only again: the owner's works,
	// and a removed member's password signs in nobody.
	if st, _ := e.do(newClient(), "POST", "/api/login", map[string]string{"password": ownerPass}); st != 200 {
		t.Fatalf("owner password-only login after the removal: %d", st)
	}
	if st, _ := e.do(newClient(), "POST", "/api/login", map[string]string{"password": "brand-new-password"}); st != 401 {
		t.Fatalf("a removed member's password: %d, want 401", st)
	}
	th, _ := e.srv.store.ThreadById("t-sam")
	if th == nil || th.CreatedBy != samID || th.Assignee != e.userID("Admin") {
		t.Fatalf("thread after removal: %+v", th)
	}
	_, body := e.do(e.owner, "GET", "/api/users", nil)
	users := decode[[]User](e, body)
	var found bool
	for _, u := range users {
		if u.ID == samID {
			found = u.Removed && u.Name == "Sam"
		}
	}
	if !found {
		t.Fatalf("removed user not kept for attribution: %s", body)
	}
	// The name is free again.
	if st, _ := e.do(newClient(), "POST", "/api/invites/"+e.invite("again")+"/accept", map[string]string{"name": "Sam", "password": "sams-password-2"}); st != 200 {
		t.Fatalf("reusing a removed name: %d", st)
	}
}

func TestTheLastOwnerCannotBeLost(t *testing.T) {
	e := newTeamEnv(t)
	e.join("Sam", "sams-password-1")
	admin, samID := e.userID("Admin"), e.userID("Sam")
	for _, patch := range []map[string]any{{"role": "member"}, {"disabled": true}} {
		if st, _ := e.do(e.owner, "PATCH", "/api/users/"+admin, patch); st != 409 {
			t.Fatalf("patch %v on the last owner: %d, want 409", patch, st)
		}
	}
	if st, _ := e.do(e.owner, "DELETE", "/api/users/"+admin, nil); st != 409 {
		t.Fatalf("removing yourself: %d, want 409", st)
	}
	// A second owner makes demoting the first fine, and then it is the last.
	if st, _ := e.do(e.owner, "PATCH", "/api/users/"+samID, map[string]any{"role": "owner"}); st != 200 {
		t.Fatal("promote")
	}
	if st, _ := e.do(e.owner, "PATCH", "/api/users/"+admin, map[string]any{"role": "member"}); st != 200 {
		t.Fatal("demote with another owner present")
	}
	if st, _ := e.do(e.owner, "GET", "/api/audit", nil); st != 403 {
		t.Fatalf("demoted owner on an owner route: %d, want 403", st)
	}
	sam := newClient()
	e.do(sam, "POST", "/api/login", map[string]string{"name": "Sam", "password": "sams-password-1"})
	if st, _ := e.do(sam, "PATCH", "/api/users/"+samID, map[string]any{"role": "member"}); st != 409 {
		t.Fatalf("demoting the last owner: %d, want 409", st)
	}
	if st, _ := e.do(sam, "PATCH", "/api/users/"+samID, map[string]any{"disabled": true}); st != 409 {
		t.Fatalf("disabling yourself: %d, want 409", st)
	}
}

func TestHandOffAndActivityLog(t *testing.T) {
	e := newTeamEnv(t)
	sam := e.join("Sam", "sams-password-1")
	admin, samID := e.userID("Admin"), e.userID("Sam")
	e.srv.store.CreateThread(&Thread{Id: "t1", Title: "Fix the build", DeviceId: "d", Agent: "claude", Access: "edits",
		Status: "idle", CreatedAt: 1, UpdatedAt: 1, LastReadAt: 5, CreatedBy: admin})
	th, _ := e.srv.store.ThreadById("t1")
	if th.CreatedBy != admin || th.Assignee != admin {
		t.Fatalf("a new session starts with its creator: %+v", th)
	}

	st, body := e.do(e.owner, "POST", "/api/threads/t1/assign", map[string]string{"to": samID, "note": "  needs your eyes on CI  "})
	if st != 200 {
		t.Fatalf("hand off: %d %s", st, body)
	}
	th = decode[*Thread](e, body)
	if th.Assignee != samID || th.HandoffBy != admin || th.HandoffNote != "needs your eyes on CI" || th.HandoffAt == 0 || th.CreatedBy != admin || th.LastReadAt != 0 {
		t.Fatalf("thread after hand-off: %+v", th)
	}
	if st, _ := e.do(e.owner, "POST", "/api/threads/t1/assign", map[string]string{"to": admin}); st != 400 && st != 200 {
		t.Fatalf("hand off to the same person: %d", st)
	}
	if st, _ := e.do(e.owner, "POST", "/api/threads/t1/assign", map[string]string{"to": "nobody"}); st != 400 {
		t.Fatalf("hand off to nobody: %d", st)
	}
	if st, _ := e.do(e.owner, "POST", "/api/threads/t1/assign", map[string]string{"to": samID, "note": strings.Repeat("x", 501)}); st != 400 {
		t.Fatalf("long note: %d", st)
	}
	if st, _ := e.do(e.owner, "POST", "/api/threads/missing/assign", map[string]string{"to": samID}); st != 404 {
		t.Fatalf("missing thread: %d", st)
	}
	// A teammate can hand it back.
	if st, _ := e.do(sam, "POST", "/api/threads/t1/assign", map[string]string{"to": admin, "note": "done"}); st != 200 {
		t.Fatal("hand back")
	}
	// Disabled people can't receive.
	e.do(e.owner, "PATCH", "/api/users/"+samID, map[string]any{"disabled": true})
	if st, _ := e.do(e.owner, "POST", "/api/threads/t1/assign", map[string]string{"to": samID}); st != 400 {
		t.Fatalf("hand off to a disabled person: %d", st)
	}

	// The log, newest first, with paging.
	st, body = e.do(e.owner, "GET", "/api/audit?limit=3", nil)
	if st != 200 {
		t.Fatal(st)
	}
	page := decode[struct {
		Entries []auditEntry `json:"entries"`
		Next    int64        `json:"next"`
	}](e, body)
	if len(page.Entries) != 3 || page.Next == 0 {
		t.Fatalf("page 1 = %+v", page)
	}
	seen := map[string]bool{}
	all := page.Entries
	for next := page.Next; next != 0; {
		_, body = e.do(e.owner, "GET", "/api/audit?limit=3&before="+itoa(next), nil)
		p := decode[struct {
			Entries []auditEntry `json:"entries"`
			Next    int64        `json:"next"`
		}](e, body)
		all = append(all, p.Entries...)
		next = p.Next
	}
	for i, en := range all {
		seen[en.Action] = true
		if i > 0 && en.Id >= all[i-1].Id {
			t.Fatalf("log is not newest first at %d", i)
		}
	}
	for _, want := range []string{"setup", "invite.create", "invite.accept", "thread.handoff", "user.disable"} {
		if !seen[want] {
			t.Errorf("no %q in the log (%v)", want, seen)
		}
	}
	for _, en := range all {
		if en.Action == "thread.handoff" && (en.Target != "Fix the build" || en.Actor == "") {
			t.Errorf("hand-off entry %+v", en)
		}
	}
	if st, _ := e.do(sam, "GET", "/api/audit", nil); st != 401 && st != 403 {
		t.Fatalf("member reading the log: %d", st)
	}
}

func itoa(n int64) string { b, _ := json.Marshal(n); return string(b) }

func TestAuditRecordsLoginsAndOwnerActions(t *testing.T) {
	e := newTeamEnv(t)
	e.do(newClient(), "POST", "/api/login", map[string]string{"password": ownerPass})
	e.do(newClient(), "POST", "/api/login", map[string]string{"password": "wrong-wrong-1"})
	e.do(e.owner, "PUT", "/api/previews/config", map[string]string{"domain": "preview.example.com"})
	e.do(e.owner, "POST", "/api/tokens", map[string]string{"name": "ci"})
	_, body := e.do(e.owner, "GET", "/api/audit", nil)
	actions := map[string]bool{}
	for _, en := range decode[struct {
		Entries []auditEntry `json:"entries"`
	}](e, body).Entries {
		actions[en.Action] = true
	}
	for _, want := range []string{"login", "login.failed", "settings.previews", "token.create"} {
		if !actions[want] {
			t.Errorf("no %q in the log: %v", want, actions)
		}
	}
	// A failed owner action is not logged as done.
	e.do(e.owner, "PUT", "/api/previews/config", map[string]string{"domain": "not a domain!!"})
	n := countRows(t, e.srv, `SELECT COUNT(*) FROM audit_log WHERE action = 'settings.previews'`)
	if n != 1 {
		t.Errorf("settings.previews logged %d times, want 1", n)
	}
}

func TestApprovalRecordsWhoAnswered(t *testing.T) {
	e := newTeamEnv(t)
	sam := e.join("Sam", "sams-password-1")
	e.srv.store.CreateThread(&Thread{Id: "t1", Title: "Deploy", DeviceId: "d", Agent: "claude", Access: "ask",
		Status: "waiting", CreatedAt: 1, UpdatedAt: 1})
	if _, err := e.srv.store.ApplyThreadEvent("t1", protocol.ThreadEvent{Id: "a1", Role: "approval",
		Approval: &protocol.ThreadApprovalRequest{Id: "ap-1", Title: "Run rm", Options: []protocol.ApprovalOption{{Id: "allow", Label: "Allow", Kind: "allow_once"}}}}, "", time.Now()); err != nil {
		t.Fatal(err)
	}
	// The agent side is offline in a unit test, so wrap a handler that accepts.
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/threads/{id}/approval", e.srv.answeredApproval(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]bool{"ok": true})
	}))
	ts := httptest.NewServer(mux)
	defer ts.Close()
	e2 := &teamEnv{t: t, srv: e.srv, ts: ts}
	if st, body := e2.do(sam, "POST", "/api/threads/t1/approval", map[string]string{"approvalId": "ap-1", "optionId": "allow"}); st != 200 {
		t.Fatalf("approval: %d %s", st, body)
	}
	msgs, _ := e.srv.store.ThreadMessages("t1")
	if len(msgs) != 1 || msgs[0].Approval == nil || msgs[0].Approval.AnsweredBy != "Sam" {
		t.Fatalf("approval message: %+v", msgs)
	}
	// A later event from the agent (resolved) keeps the name.
	e.srv.store.ApplyThreadEvent("t1", protocol.ThreadEvent{Id: "a1", Approval: &protocol.ThreadApprovalRequest{Resolved: "allow"}}, "", time.Now())
	msgs, _ = e.srv.store.ThreadMessages("t1")
	if msgs[0].Approval.AnsweredBy != "Sam" || msgs[0].Approval.Resolved != "allow" {
		t.Fatalf("after resolve: %+v", msgs[0].Approval)
	}
	if n := countRows(t, e.srv, `SELECT COUNT(*) FROM audit_log WHERE action = 'approval' AND actor_name = 'Sam' AND target = 'Deploy'`); n != 1 {
		t.Fatalf("approval audit entries: %d", n)
	}
	// An approval the agent refused is not attributed.
	refuse := http.NewServeMux()
	refuse.HandleFunc("POST /api/threads/{id}/approval", e.srv.answeredApproval(func(w http.ResponseWriter, r *http.Request) {
		httpError(w, http.StatusConflict, "already answered")
	}))
	ts2 := httptest.NewServer(refuse)
	defer ts2.Close()
	e3 := &teamEnv{t: t, srv: e.srv, ts: ts2}
	if st, _ := e3.do(sam, "POST", "/api/threads/t1/approval", map[string]string{"approvalId": "ap-1", "optionId": "reject"}); st != 409 {
		t.Fatalf("refused approval: %d", st)
	}
	if n := countRows(t, e.srv, `SELECT COUNT(*) FROM audit_log WHERE action = 'approval'`); n != 1 {
		t.Fatalf("a refused approval was logged: %d entries", n)
	}
}

func TestThreadsRecordWhoStartedThem(t *testing.T) {
	e := newTeamEnv(t)
	adminID := e.userID("Admin")
	th, err := e.srv.createThreadForTest(adminID)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := e.srv.store.ThreadById(th)
	if got.CreatedBy != adminID || got.Assignee != adminID {
		t.Fatalf("thread = %+v", got)
	}
	// And an API token's sessions belong to nobody in particular.
	other, _ := e.srv.createThreadForTest("")
	got, _ = e.srv.store.ThreadById(other)
	if got.CreatedBy != "" || got.Assignee != "" {
		t.Fatalf("token thread = %+v", got)
	}
}

func (s *Server) createThreadForTest(by string) (string, error) {
	t := &Thread{Id: randomToken()[:16], Title: "x", DeviceId: "d", Agent: "claude", Access: "edits", Status: "idle",
		CreatedAt: 1, UpdatedAt: 1, CreatedBy: by}
	return t.Id, s.store.CreateThread(t)
}

func TestPresenceCountsViewsPerPerson(t *testing.T) {
	e := newTeamEnv(t)
	e.join("Sam", "sams-password-1")
	admin, _ := e.srv.store.UserByName("Admin")
	sam, _ := e.srv.store.UserByName("Sam")
	sub := e.srv.threads.subscribe("t1")
	defer e.srv.threads.unsubscribe("t1", sub)

	leaveA := e.srv.presenceJoin("t1", *admin)
	leaveA2 := e.srv.presenceJoin("t1", *admin) // second tab
	leaveS := e.srv.presenceJoin("t1", *sam)
	if got := e.srv.presentIn("t1"); len(got) != 2 || got[0].Name != "Admin" || got[1].Name != "Sam" {
		t.Fatalf("present = %+v", got)
	}
	leaveA()
	if got := e.srv.presentIn("t1"); len(got) != 2 {
		t.Fatalf("one tab closed, still present: %+v", got)
	}
	leaveA2()
	leaveS()
	if got := e.srv.presentIn("t1"); len(got) != 0 {
		t.Fatalf("everyone left: %+v", got)
	}
	e.srv.presenceJoin("t1", apiTokenUser)() // API tokens never show up
	if got := e.srv.presentIn("t1"); len(got) != 0 {
		t.Fatalf("api token present: %+v", got)
	}
	// Every change was pushed to the session's watchers.
	var last map[string]any
	for len(sub.ch) > 0 {
		json.Unmarshal(<-sub.ch, &last)
	}
	if last["type"] != "presence" {
		t.Fatalf("last push = %v", last)
	}
}

func TestPeopleValidation(t *testing.T) {
	e := newTeamEnv(t)
	e.join("Sam", "sams-password-1")
	samID := e.userID("Sam")
	for _, bad := range []string{"", "   ", strings.Repeat("a", 33), "bell\x07name"} {
		if st, _ := e.do(e.owner, "PATCH", "/api/users/"+samID, map[string]any{"name": bad}); st != 400 {
			t.Errorf("name %q: %d, want 400", bad, st)
		}
	}
	if st, _ := e.do(e.owner, "PATCH", "/api/users/"+samID, map[string]any{"name": "admin"}); st != 409 {
		t.Fatalf("renaming onto another person's name: %d", st)
	}
	if st, _ := e.do(e.owner, "PATCH", "/api/users/"+samID, map[string]any{"role": "root"}); st != 400 {
		t.Fatalf("bad role: %d", st)
	}
	if st, _ := e.do(e.owner, "PATCH", "/api/users/"+samID, map[string]any{"email": "not-an-email"}); st != 400 {
		t.Fatalf("bad email: %d", st)
	}
	if st, _ := e.do(e.owner, "PATCH", "/api/users/missing", map[string]any{"name": "Z"}); st != 404 {
		t.Fatalf("missing user: %d", st)
	}
	if st, _ := e.do(e.owner, "PATCH", "/api/users/"+samID, map[string]any{"name": "Samantha", "email": "sam@example.com"}); st != 200 {
		t.Fatal("rename")
	}
}
