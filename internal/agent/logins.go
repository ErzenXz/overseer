package agent

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"unicode"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// Shared sign-ins, the machine's side (see protocol/logins.go). Codex's
// auth.json is read from and written to $CODEX_HOME (default ~/.codex), with
// a backup of the person's own file. A shared Claude Code token is kept in
// ~/.overseer/claude-oauth-token and handed to every Claude Code process this
// agent starts as CLAUDE_CODE_OAUTH_TOKEN. Secrets are never logged.

const (
	maxLoginSize       = 64 << 10 // a sign-in file larger than this is not one
	maxClaudeTokenSize = 4 << 10
	codexAuthFile      = "auth.json"
	codexAuthBackup    = "auth.json.overseer-backup"
	claudeTokenFile    = "claude-oauth-token"
)

// claudeAuthVars are the variables that already sign Claude Code in; a token
// from the file never replaces them. CLAUDE_CODE_OAUTH_TOKEN loses to the
// other two in Claude Code's own order anyway.
var claudeAuthVars = []string{"CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"}

// loginPaths are where the sign-ins live (tests point them at a temp dir).
type loginPaths struct {
	codexDir    string // holds auth.json
	claudeToken string // the shared Claude Code token file
}

func defaultLoginPaths() (loginPaths, error) {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return loginPaths{}, errors.New("this machine has no home folder")
	}
	codex := os.Getenv("CODEX_HOME")
	if codex == "" {
		codex = filepath.Join(home, ".codex")
	}
	return loginPaths{codexDir: codex, claudeToken: filepath.Join(home, ".overseer", claudeTokenFile)}, nil
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// handleLogin serves login.read, login.apply and login.remove.
func handleLogin(typ string, data []byte) (any, error) {
	p, err := defaultLoginPaths()
	if err != nil {
		return nil, err
	}
	switch typ {
	case protocol.TypeLoginRead:
		var req protocol.LoginReadRequest
		if err := json.Unmarshal(data, &req); err != nil {
			return nil, err
		}
		return p.read(req)
	case protocol.TypeLoginApply:
		var req protocol.LoginApplyRequest
		if err := json.Unmarshal(data, &req); err != nil {
			return nil, err
		}
		return p.apply(req)
	case protocol.TypeLoginRemove:
		var req protocol.LoginRemoveRequest
		if err := json.Unmarshal(data, &req); err != nil {
			return nil, err
		}
		return p.remove(req)
	}
	return nil, fmt.Errorf("unsupported request %q", typ)
}

// --- login.read ---

const codexKeyringHelp = "Codex on this machine keeps its sign-in in the system keychain, or isn't signed in. " +
	`To share it, set cli_auth_credentials_store = "file" in ~/.codex/config.toml and sign in to Codex again.`

func (p loginPaths) read(req protocol.LoginReadRequest) (protocol.LoginReadResult, error) {
	if req.Agent != "codex" {
		return protocol.LoginReadResult{}, fmt.Errorf("only a Codex sign-in can be read from a machine, not %q", req.Agent)
	}
	f, err := os.Open(filepath.Join(p.codexDir, codexAuthFile))
	if errors.Is(err, fs.ErrNotExist) {
		return protocol.LoginReadResult{}, errors.New(codexKeyringHelp)
	}
	if err != nil {
		return protocol.LoginReadResult{}, fmt.Errorf("reading Codex's sign-in: %w", err)
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, maxLoginSize+1))
	if err != nil {
		return protocol.LoginReadResult{}, fmt.Errorf("reading Codex's sign-in: %w", err)
	}
	if len(b) > maxLoginSize {
		return protocol.LoginReadResult{}, errors.New("Codex's auth.json is too large to be a sign-in")
	}
	if len(bytes.TrimSpace(b)) == 0 {
		return protocol.LoginReadResult{}, errors.New(codexKeyringHelp)
	}
	return protocol.LoginReadResult{Secret: string(b)}, nil
}

// --- login.apply ---

func (p loginPaths) apply(req protocol.LoginApplyRequest) (protocol.LoginApplyResult, error) {
	switch req.Agent {
	case "codex":
		return p.applyCodex([]byte(req.Secret), req.Replaces)
	case "claude":
		token := strings.TrimSpace(req.Secret)
		if !plausibleToken(token) {
			return protocol.LoginApplyResult{}, errors.New("that is not a Claude Code token")
		}
		if err := writeFileAtomic(p.claudeToken, []byte(token)); err != nil {
			return protocol.LoginApplyResult{}, fmt.Errorf("saving the Claude Code token: %w", err)
		}
		return protocol.LoginApplyResult{Sha256: sha256Hex([]byte(token))}, nil
	}
	return protocol.LoginApplyResult{}, fmt.Errorf("sign-ins for %q can't be shared", req.Agent)
}

// applyCodex writes auth.json. A different file already there is backed up
// first, except when it is still what Overseer wrote last time (replaces) and
// a backup exists: that backup is the person's own sign-in and stays.
func (p loginPaths) applyCodex(secret []byte, replaces string) (protocol.LoginApplyResult, error) {
	if len(bytes.TrimSpace(secret)) == 0 || len(secret) > maxLoginSize {
		return protocol.LoginApplyResult{}, errors.New("that is not a Codex sign-in")
	}
	if err := os.MkdirAll(p.codexDir, 0o700); err != nil {
		return protocol.LoginApplyResult{}, fmt.Errorf("creating the Codex folder: %w", err)
	}
	path := filepath.Join(p.codexDir, codexAuthFile)
	backup := filepath.Join(p.codexDir, codexAuthBackup)
	old, err := os.ReadFile(path)
	switch {
	case err == nil && !bytes.Equal(old, secret):
		ours := replaces != "" && sha256Hex(old) == replaces
		if _, berr := os.Stat(backup); !ours || berr != nil {
			if err := writeFileAtomic(backup, old); err != nil {
				return protocol.LoginApplyResult{}, fmt.Errorf("backing up Codex's current sign-in: %w", err)
			}
		}
	case err != nil && !errors.Is(err, fs.ErrNotExist):
		return protocol.LoginApplyResult{}, fmt.Errorf("reading Codex's current sign-in: %w", err)
	}
	if err := writeFileAtomic(path, secret); err != nil {
		return protocol.LoginApplyResult{}, fmt.Errorf("saving Codex's sign-in: %w", err)
	}
	return protocol.LoginApplyResult{Sha256: sha256Hex(secret)}, nil
}

// --- login.remove ---

func (p loginPaths) remove(req protocol.LoginRemoveRequest) (protocol.LoginRemoveResult, error) {
	switch req.Agent {
	case "claude":
		err := os.Remove(p.claudeToken)
		if errors.Is(err, fs.ErrNotExist) {
			return protocol.LoginRemoveResult{Note: "The shared token was already gone"}, nil
		}
		if err != nil {
			return protocol.LoginRemoveResult{}, fmt.Errorf("removing the Claude Code token: %w", err)
		}
		return protocol.LoginRemoveResult{Removed: true}, nil
	case "codex":
		return p.removeCodex(req.Sha256)
	}
	return protocol.LoginRemoveResult{}, fmt.Errorf("sign-ins for %q can't be shared", req.Agent)
}

// removeCodex deletes auth.json only while it is exactly what Overseer wrote,
// and puts the person's own sign-in back when there is a backup.
func (p loginPaths) removeCodex(sum string) (protocol.LoginRemoveResult, error) {
	path := filepath.Join(p.codexDir, codexAuthFile)
	backup := filepath.Join(p.codexDir, codexAuthBackup)
	cur, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return protocol.LoginRemoveResult{Note: "Codex's sign-in file was already gone"}, nil
	}
	if err != nil {
		return protocol.LoginRemoveResult{}, fmt.Errorf("reading Codex's sign-in: %w", err)
	}
	if sum == "" || sha256Hex(cur) != sum {
		return protocol.LoginRemoveResult{Note: "Codex's sign-in on this machine has changed since it was shared (a new sign-in or a token refresh), so it was left as it is"}, nil
	}
	if _, err := os.Stat(backup); err == nil {
		if err := os.Rename(backup, path); err != nil {
			return protocol.LoginRemoveResult{}, fmt.Errorf("restoring Codex's previous sign-in: %w", err)
		}
		return protocol.LoginRemoveResult{Removed: true, Note: "Restored the sign-in Codex had before"}, nil
	}
	if err := os.Remove(path); err != nil {
		return protocol.LoginRemoveResult{}, fmt.Errorf("removing Codex's sign-in: %w", err)
	}
	return protocol.LoginRemoveResult{Removed: true}, nil
}

// --- files ---

// writeFileAtomic writes data to path through a temp file in the same folder
// and a rename, so a reader never sees half a file. The folder is created
// 0700 if missing and the file is 0600.
func writeFileAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	ok := false
	defer func() {
		if !ok {
			tmp.Close()
			os.Remove(name)
		}
	}()
	if err := tmp.Chmod(0o600); err != nil {
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		return err
	}
	if err := tmp.Sync(); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(name, path); err != nil {
		return err
	}
	ok = true
	return nil
}

// --- Claude Code environment ---

// plausibleToken is a non-empty value with no spaces or control characters,
// safe to put in an environment variable.
func plausibleToken(s string) bool {
	if s == "" || len(s) > maxClaudeTokenSize {
		return false
	}
	for _, r := range s {
		if unicode.IsSpace(r) || unicode.IsControl(r) {
			return false
		}
	}
	return true
}

// readClaudeToken is the shared token, or "" when there is none (or the file
// is not a token).
func readClaudeToken(path string) string {
	if path == "" {
		return ""
	}
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	b, _ := io.ReadAll(io.LimitReader(f, maxClaudeTokenSize+1))
	token := strings.TrimSpace(string(b))
	if !plausibleToken(token) {
		return ""
	}
	return token
}

// withClaudeToken adds CLAUDE_CODE_OAUTH_TOKEN from the token file to env,
// unless env already signs Claude Code in some other way. It reports whether
// it did.
func withClaudeToken(env []string, tokenPath string) ([]string, bool) {
	for _, kv := range env {
		for _, k := range claudeAuthVars {
			if v, ok := strings.CutPrefix(kv, k+"="); ok && v != "" {
				return env, false
			}
		}
	}
	token := readClaudeToken(tokenPath)
	if token == "" {
		return env, false
	}
	out := make([]string, 0, len(env)+1)
	for _, kv := range env {
		if !strings.HasPrefix(kv, "CLAUDE_CODE_OAUTH_TOKEN=") { // an empty one
			out = append(out, kv)
		}
	}
	return append(out, "CLAUDE_CODE_OAUTH_TOKEN="+token), true
}

// claudeEnv is the environment for a Claude Code process: agentEnv plus the
// shared token when there is one. The bool says the token was added.
func claudeEnv() ([]string, bool) {
	env := agentEnv()
	p, err := defaultLoginPaths()
	if err != nil {
		return env, false
	}
	return withClaudeToken(env, p.claudeToken)
}

// claudeProcEnv is claudeEnv without the flag, for starting processes.
func claudeProcEnv() []string {
	env, _ := claudeEnv()
	return env
}
