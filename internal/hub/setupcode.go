package hub

import (
	"crypto/rand"
	"crypto/subtle"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// A fresh hub has no password yet, so whoever reaches it first could claim
// it. Until setup completes, POST /api/setup also requires a one-time code
// that only someone with access to the hub machine can read: it is written
// to <data-dir>/setup-code, printed in the hub's log, and shown by the
// installers as a ready-to-open link.

const setupCodeFile = "setup-code"

// setupCodeAlphabet avoids look-alike characters (0/O, 1/I/L).
const setupCodeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

func newSetupCode() (string, error) {
	b := make([]byte, 10)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	out := make([]byte, 0, 11)
	for i, v := range b {
		if i == 5 {
			out = append(out, '-')
		}
		out = append(out, setupCodeAlphabet[int(v)%len(setupCodeAlphabet)])
	}
	return string(out), nil
}

// ensureSetupCode returns the pending setup code, creating it on first use.
// It returns "" once a password exists.
func (s *Server) ensureSetupCode() (string, error) {
	if hash, err := s.store.Setting("password_hash"); err != nil || hash != "" {
		return "", err
	}
	path := filepath.Join(s.opts.DataDir, setupCodeFile)
	if b, err := os.ReadFile(path); err == nil {
		if code := strings.TrimSpace(string(b)); code != "" {
			return code, nil
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	code, err := newSetupCode()
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(path, []byte(code+"\n"), 0o600); err != nil {
		return "", err
	}
	return code, nil
}

// checkSetupCode compares in constant time, ignoring case, spaces and dashes
// so a code read aloud or typed loosely still works.
func checkSetupCode(want, got string) bool {
	norm := func(v string) string {
		return strings.ToUpper(strings.NewReplacer("-", "", " ", "").Replace(strings.TrimSpace(v)))
	}
	w, g := norm(want), norm(got)
	return w != "" && subtle.ConstantTimeCompare([]byte(w), []byte(g)) == 1
}

func (s *Server) clearSetupCode() {
	_ = os.Remove(filepath.Join(s.opts.DataDir, setupCodeFile))
}
