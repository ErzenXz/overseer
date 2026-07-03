package hub

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/argon2"
)

const sessionCookie = "overseer_session"

// --- password hashing (argon2id) ---

func hashPassword(password string) string {
	salt := make([]byte, 16)
	rand.Read(salt)
	key := argon2.IDKey([]byte(password), salt, 3, 64*1024, 2, 32)
	return fmt.Sprintf("argon2id$%s$%s",
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key))
}

func verifyPassword(stored, password string) bool {
	parts := strings.Split(stored, "$")
	if len(parts) != 3 || parts[0] != "argon2id" {
		return false
	}
	salt, err1 := base64.RawStdEncoding.DecodeString(parts[1])
	want, err2 := base64.RawStdEncoding.DecodeString(parts[2])
	if err1 != nil || err2 != nil {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, 3, 64*1024, 2, 32)
	return subtle.ConstantTimeCompare(got, want) == 1
}

// --- browser sessions (in-memory; hub restart = re-login) ---

type sessionManager struct {
	mu       sync.Mutex
	sessions map[string]time.Time // token -> expiry
}

const sessionTTL = 30 * 24 * time.Hour

func newSessionManager() *sessionManager {
	return &sessionManager{sessions: map[string]time.Time{}}
}

func (m *sessionManager) create() string {
	b := make([]byte, 32)
	rand.Read(b)
	token := hex.EncodeToString(b)
	m.mu.Lock()
	m.sessions[token] = time.Now().Add(sessionTTL)
	m.mu.Unlock()
	return token
}

func (m *sessionManager) valid(token string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	exp, ok := m.sessions[token]
	if !ok {
		return false
	}
	if time.Now().After(exp) {
		delete(m.sessions, token)
		return false
	}
	return true
}

func (m *sessionManager) revoke(token string) {
	m.mu.Lock()
	delete(m.sessions, token)
	m.mu.Unlock()
}

// --- login rate limiting (per remote IP, fixed window) ---

type rateLimiter struct {
	mu     sync.Mutex
	counts map[string]*rateWindow
}

type rateWindow struct {
	start time.Time
	n     int
}

const (
	rateWindowLen = time.Minute
	rateMax       = 10
)

func newRateLimiter() *rateLimiter {
	return &rateLimiter{counts: map[string]*rateWindow{}}
}

func (r *rateLimiter) allow(remoteAddr string) bool {
	ip, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		ip = remoteAddr
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	w := r.counts[ip]
	now := time.Now()
	if w == nil || now.Sub(w.start) > rateWindowLen {
		r.counts[ip] = &rateWindow{start: now, n: 1}
		return true
	}
	w.n++
	return w.n <= rateMax
}

// --- middleware ---

// requireAuth accepts either a valid browser session cookie or an API token
// via Authorization: Bearer (used by the CLI and MCP server).
func (s *Server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if c, err := r.Cookie(sessionCookie); err == nil && s.sessions.valid(c.Value) {
			next(w, r)
			return
		}
		if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
			token := strings.TrimPrefix(auth, "Bearer ")
			if ok, _ := s.store.ValidApiToken(token); ok {
				next(w, r)
				return
			}
		}
		httpError(w, http.StatusUnauthorized, "not authenticated")
	}
}
