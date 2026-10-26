package hub

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Shared session links: a replay (frozen snapshot) or a live, view-only
// follow of one session, opened at /s/{token} with no login. The token is 32
// random bytes and only its hash is stored. Everything a public viewer can
// reach is built here from an explicit allow-list of fields (see
// sharePublic), so nothing else of the hub can leak through a link.

func init() {
	extraSchemas = append(extraSchemas, `
CREATE TABLE IF NOT EXISTS shares (
	id         TEXT PRIMARY KEY,
	token_hash TEXT NOT NULL UNIQUE,
	thread_id  TEXT NOT NULL,
	mode       TEXT NOT NULL,
	hide_names INTEGER NOT NULL DEFAULT 1,
	created_at INTEGER NOT NULL,
	expires_at INTEGER NOT NULL DEFAULT 0,
	views      INTEGER NOT NULL DEFAULT 0,
	snapshot   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS shares_thread_id ON shares(thread_id);
`)
}

const (
	shareReplay = "replay"
	shareLive   = "live"

	// shareDocs is where the share dialog sends people whose hub is private.
	shareDocs = "https://overseer.sh/docs/remote-access/"

	maxSnapshotBytes = 24 << 20
	maxPublicStreams = 200
)

// --- store ---

// Share is one shared link. The token itself is never stored.
type Share struct {
	Id        string `json:"id"`
	ThreadId  string `json:"threadId"`
	Title     string `json:"title"`
	Mode      string `json:"mode"`
	HideNames bool   `json:"hideNames"`
	CreatedAt int64  `json:"createdAt"`
	ExpiresAt int64  `json:"expiresAt"` // unix seconds, 0 = never
	Views     int64  `json:"views"`
	Expired   bool   `json:"expired"`

	snapshot string
}

func (sh *Share) expired(now time.Time) bool {
	return sh.ExpiresAt > 0 && now.Unix() >= sh.ExpiresAt
}

func hashShareToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func newShareToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func validShareToken(token string) bool {
	if len(token) < 20 || len(token) > 64 {
		return false
	}
	for _, c := range token {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}

func (s *Store) CreateShare(sh *Share, tokenHash string) error {
	_, err := s.db.Exec(`INSERT INTO shares (id, token_hash, thread_id, mode, hide_names, created_at, expires_at, views, snapshot)
		VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
		sh.Id, tokenHash, sh.ThreadId, sh.Mode, sh.HideNames, sh.CreatedAt, sh.ExpiresAt, sh.snapshot)
	return err
}

// ShareByToken finds a share by the raw token, or nil.
func (s *Store) ShareByToken(token string) (*Share, error) {
	var sh Share
	err := s.db.QueryRow(`SELECT id, thread_id, mode, hide_names, created_at, expires_at, views, snapshot
		FROM shares WHERE token_hash = ?`, hashShareToken(token)).
		Scan(&sh.Id, &sh.ThreadId, &sh.Mode, &sh.HideNames, &sh.CreatedAt, &sh.ExpiresAt, &sh.Views, &sh.snapshot)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &sh, err
}

// ListShares returns every share with its session's title, newest first.
// Shares whose session is gone are removed.
func (s *Store) ListShares() ([]Share, error) {
	if _, err := s.db.Exec(`DELETE FROM shares WHERE thread_id NOT IN (SELECT id FROM threads)`); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`SELECT s.id, s.thread_id, COALESCE(t.title, ''), s.mode, s.hide_names, s.created_at, s.expires_at, s.views
		FROM shares s LEFT JOIN threads t ON t.id = s.thread_id ORDER BY s.created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	now := time.Now()
	out := []Share{}
	for rows.Next() {
		var sh Share
		if err := rows.Scan(&sh.Id, &sh.ThreadId, &sh.Title, &sh.Mode, &sh.HideNames, &sh.CreatedAt, &sh.ExpiresAt, &sh.Views); err != nil {
			return nil, err
		}
		sh.Expired = sh.expired(now)
		out = append(out, sh)
	}
	return out, rows.Err()
}

func (s *Store) DeleteShare(id string) (bool, error) {
	res, err := s.db.Exec(`DELETE FROM shares WHERE id = ?`, id)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

func (s *Store) AddShareView(id string) {
	s.db.Exec(`UPDATE shares SET views = views + 1 WHERE id = ?`, id)
}

// --- rate limiting for the public endpoints ---

type windowLimiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	counts map[string]*rateWindow
}

func newWindowLimiter(max int, window time.Duration) *windowLimiter {
	return &windowLimiter{max: max, window: window, counts: map[string]*rateWindow{}}
}

func (l *windowLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	if len(l.counts) > 2048 {
		for k, v := range l.counts {
			if now.Sub(v.start) > l.window {
				delete(l.counts, k)
			}
		}
	}
	w := l.counts[key]
	if w == nil || now.Sub(w.start) > l.window {
		l.counts[key] = &rateWindow{start: now, n: 1}
		return true
	}
	w.n++
	return w.n <= l.max
}

// shareRuntime is the in-memory state of the public side, created on first use.
type shareRuntime struct {
	pages   *windowLimiter // page and JSON loads, per client
	streams *windowLimiter // live-stream connects, per client
	misses  *windowLimiter // unknown or expired tokens, per client
	open    atomic.Int32   // live streams currently open
}

var shareRuntimes sync.Map // *Server -> *shareRuntime

func (s *Server) shareRT() *shareRuntime {
	if v, ok := shareRuntimes.Load(s); ok {
		return v.(*shareRuntime)
	}
	v, _ := shareRuntimes.LoadOrStore(s, &shareRuntime{
		pages:   newWindowLimiter(120, time.Minute),
		streams: newWindowLimiter(30, time.Minute),
		misses:  newWindowLimiter(30, time.Minute),
	})
	return v.(*shareRuntime)
}

// shareClientIP is the caller's address. Forwarding headers are only believed
// when the connection comes from a proxy on this machine or its network.
func shareClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if ip := net.ParseIP(host); ip != nil && (ip.IsLoopback() || ip.IsPrivate()) {
		if v := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); v != "" {
			return v
		}
		if v := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-For"), ",")[0]); v != "" {
			return v
		}
	}
	return host
}

// --- the hub's address, as people outside would use it ---

// shareBase is the address the link is built on: the hub's public address
// when it has one, else the address this request came in on.
func (s *Server) shareBase(r *http.Request) string {
	if s.opts.TLSDomain != "" {
		return "https://" + s.opts.TLSDomain
	}
	if u, _ := s.store.Setting(settingHubPublicURL); u != "" {
		return strings.TrimRight(u, "/")
	}
	scheme := "http"
	if r.TLS != nil || strings.EqualFold(strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0]), "https") {
		scheme = "https"
	}
	host := r.Host
	if fwd := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Host"), ",")[0]); fwd != "" {
		host = fwd
	}
	return scheme + "://" + host
}

// privateHost reports whether a hub address is one only people on the same
// machine, network or tailnet can reach.
func privateHost(base string) bool {
	u, err := url.Parse(base)
	if err != nil || u.Hostname() == "" {
		return true
	}
	host := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
	if ip := net.ParseIP(host); ip != nil {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() {
			return true
		}
		if v4 := ip.To4(); v4 != nil && v4[0] == 100 && v4[1]&0xc0 == 64 { // 100.64.0.0/10, Tailscale
			return true
		}
		return false
	}
	if !strings.Contains(host, ".") {
		return true // a bare machine name
	}
	for _, suffix := range []string{".localhost", ".local", ".lan", ".internal", ".home", ".home.arpa", ".ts.net", ".test"} {
		if strings.HasSuffix(host, suffix) {
			return true
		}
	}
	return false
}

// --- routes ---

func (s *Server) routesShare(m *http.ServeMux) {
	// Public: no login, no cookies read or set.
	m.HandleFunc("GET /s/{token}", s.handleSharePage)
	m.HandleFunc("GET /api/public/shares/{token}", s.handlePublicShare)
	m.HandleFunc("GET /api/public/shares/{token}/stream", s.handlePublicShareStream)

	// Managing shares needs the hub login.
	m.HandleFunc("GET /api/shares/info", s.requireAuth(s.handleShareInfo))
	m.HandleFunc("GET /api/shares", s.requireAuth(s.handleListShares))
	m.HandleFunc("POST /api/shares", s.requireAuth(s.handleCreateShare))
	m.HandleFunc("DELETE /api/shares/{id}", s.requireAuth(s.handleDeleteShare))
}

func (s *Server) handleShareInfo(w http.ResponseWriter, r *http.Request) {
	base := s.shareBase(r)
	writeJSON(w, map[string]any{"baseUrl": base, "private": privateHost(base), "docsUrl": shareDocs})
}

func (s *Server) handleListShares(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.ListShares()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, list)
}

func (s *Server) handleDeleteShare(w http.ResponseWriter, r *http.Request) {
	ok, err := s.store.DeleteShare(r.PathValue("id"))
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		httpError(w, http.StatusNotFound, "share not found")
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

var shareExpiry = map[string]time.Duration{"1d": 24 * time.Hour, "7d": 7 * 24 * time.Hour, "never": 0}

func (s *Server) handleCreateShare(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ThreadId  string `json:"threadId"`
		Mode      string `json:"mode"`
		HideNames *bool  `json:"hideNames"`
		Expires   string `json:"expires"`
	}
	if err := readJSON(r, &in); err != nil {
		httpError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if in.Mode != shareReplay && in.Mode != shareLive {
		httpError(w, http.StatusBadRequest, "mode must be replay or live")
		return
	}
	if in.Expires == "" {
		in.Expires = "7d"
	}
	ttl, ok := shareExpiry[in.Expires]
	if !ok {
		httpError(w, http.StatusBadRequest, "expires must be 1d, 7d or never")
		return
	}
	t, err := s.store.ThreadById(in.ThreadId)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if t == nil {
		httpError(w, http.StatusNotFound, "session not found")
		return
	}
	now := time.Now()
	sh := &Share{
		Id: "sh_" + shareRandomHex(5), ThreadId: t.Id, Title: t.Title, Mode: in.Mode,
		HideNames: in.HideNames == nil || *in.HideNames, CreatedAt: now.Unix(),
	}
	if ttl > 0 {
		sh.ExpiresAt = now.Add(ttl).Unix()
	}
	if in.Mode == shareReplay {
		pub, err := s.buildPublic(t, sh, true)
		if err != nil {
			httpError(w, http.StatusInternalServerError, err.Error())
			return
		}
		b, err := json.Marshal(pub)
		if err != nil {
			httpError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if len(b) > maxSnapshotBytes {
			httpError(w, http.StatusRequestEntityTooLarge, "this session is too large to share as a replay")
			return
		}
		sh.snapshot = string(b)
	}
	token, err := newShareToken()
	if err != nil {
		httpError(w, http.StatusInternalServerError, "could not create a link")
		return
	}
	if err := s.store.CreateShare(sh, hashShareToken(token)); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	base := s.shareBase(r)
	writeJSON(w, map[string]any{"share": sh, "token": token, "url": base + "/s/" + token, "private": privateHost(base)})
}

func shareRandomHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// --- the public side ---

// lookupShare resolves a token to a usable share and its session. Anything
// wrong with it (unknown, revoked, expired, session deleted) is one answer,
// so a link never says which.
func (s *Server) lookupShare(token string) (*Share, *Thread) {
	if !validShareToken(token) {
		return nil, nil
	}
	sh, err := s.store.ShareByToken(token)
	if err != nil || sh == nil || sh.expired(time.Now()) {
		return nil, nil
	}
	t, err := s.store.ThreadById(sh.ThreadId)
	if err != nil || t == nil {
		return nil, nil
	}
	return sh, t
}

// publicGuard applies the shared headers and the per-client limits. It
// reports false after answering.
func (s *Server) publicGuard(w http.ResponseWriter, r *http.Request, limiter *windowLimiter, asJSON bool) bool {
	h := w.Header()
	h.Set("Cache-Control", "no-store")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("X-Robots-Tag", "noindex, nofollow")
	h.Set("Content-Security-Policy", "frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'")
	if limiter.allow(shareClientIP(r)) {
		return true
	}
	h.Set("Retry-After", "60")
	if asJSON {
		httpError(w, http.StatusTooManyRequests, "too many requests")
	} else {
		http.Error(w, "Too many requests. Try again in a minute.", http.StatusTooManyRequests)
	}
	return false
}

func (s *Server) handlePublicShare(w http.ResponseWriter, r *http.Request) {
	rt := s.shareRT()
	if !s.publicGuard(w, r, rt.pages, true) {
		return
	}
	sh, t := s.lookupShare(r.PathValue("token"))
	if sh == nil {
		if !rt.misses.allow(shareClientIP(r)) {
			httpError(w, http.StatusTooManyRequests, "too many requests")
			return
		}
		httpError(w, http.StatusNotFound, "This link has expired")
		return
	}
	if r.URL.Query().Get("peek") == "" {
		s.store.AddShareView(sh.Id)
	}
	w.Header().Set("Content-Type", "application/json")
	if sh.Mode == shareReplay {
		w.Write([]byte(sh.snapshot))
		return
	}
	pub, err := s.buildPublic(t, sh, false)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "could not load this session")
		return
	}
	json.NewEncoder(w).Encode(pub)
}

// handlePublicShareStream follows a live share as server-sent events:
// "snapshot" first, then "message" and "thread" as the session changes.
func (s *Server) handlePublicShareStream(w http.ResponseWriter, r *http.Request) {
	rt := s.shareRT()
	if !s.publicGuard(w, r, rt.streams, true) {
		return
	}
	sh, t := s.lookupShare(r.PathValue("token"))
	if sh == nil || sh.Mode != shareLive {
		if !rt.misses.allow(shareClientIP(r)) {
			httpError(w, http.StatusTooManyRequests, "too many requests")
			return
		}
		httpError(w, http.StatusNotFound, "This link has expired")
		return
	}
	if rt.open.Add(1) > maxPublicStreams {
		rt.open.Add(-1)
		httpError(w, http.StatusServiceUnavailable, "too many viewers right now")
		return
	}
	defer rt.open.Add(-1)

	rc := http.NewResponseController(w)
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	send := func(event string, v any) bool {
		b, err := json.Marshal(v)
		if err != nil {
			return true
		}
		rc.SetWriteDeadline(time.Now().Add(15 * time.Second))
		if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, b); err != nil {
			return false
		}
		return rc.Flush() == nil
	}

	// Subscribe before reading the snapshot so nothing falls in between.
	sub := s.threads.subscribe(t.Id)
	defer s.threads.unsubscribe(t.Id, sub)
	pub, err := s.buildPublic(t, sh, false)
	if err != nil || !send("snapshot", pub) {
		return
	}
	san := s.newSharePublicizer(t, sh.HideNames)

	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case b := <-sub.ch:
			var ev struct {
				Type    string         `json:"type"`
				Message *ThreadMessage `json:"message"`
				Thread  *Thread        `json:"thread"`
			}
			if json.Unmarshal(b, &ev) != nil {
				continue
			}
			switch {
			case ev.Type == "message" && ev.Message != nil:
				if m := san.message(*ev.Message); m != nil && !send("message", map[string]any{"message": m}) {
					return
				}
			case ev.Type == "thread" && ev.Thread != nil:
				if !send("thread", map[string]any{"thread": san.thread(ev.Thread)}) {
					return
				}
			}
		case <-sub.kick:
			send("end", map[string]string{"reason": "ended"})
			return
		case <-ticker.C:
			// Still valid? Revoking a link ends the stream within seconds.
			if again, _ := s.lookupShare(r.PathValue("token")); again == nil {
				send("end", map[string]string{"reason": "expired"})
				return
			}
			rc.SetWriteDeadline(time.Now().Add(15 * time.Second))
			if _, err := fmt.Fprint(w, ": keepalive\n\n"); err != nil || rc.Flush() != nil {
				return
			}
		case <-r.Context().Done():
			return
		}
	}
}
