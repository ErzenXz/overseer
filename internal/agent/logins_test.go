package agent

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

func testLoginPaths(t *testing.T) loginPaths {
	dir := t.TempDir()
	return loginPaths{codexDir: filepath.Join(dir, "codex"), claudeToken: filepath.Join(dir, "overseer", claudeTokenFile)}
}

func checkMode(t *testing.T, path string, want os.FileMode) {
	t.Helper()
	if runtime.GOOS == "windows" {
		return
	}
	st, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := st.Mode().Perm(); got != want {
		t.Errorf("%s mode = %o, want %o", path, got, want)
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// noTempFiles fails when a write left a temp file behind.
func noTempFiles(t *testing.T, dir string) {
	t.Helper()
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if strings.Contains(e.Name(), ".tmp-") {
			t.Errorf("temp file left behind: %s", e.Name())
		}
	}
}

func TestApplyCodexWritesPrivatelyAndBacksUp(t *testing.T) {
	p := testLoginPaths(t)
	auth := filepath.Join(p.codexDir, codexAuthFile)
	backup := filepath.Join(p.codexDir, codexAuthBackup)

	// A machine with no Codex folder yet.
	first := `{"tokens":{"id_token":"a"}}`
	res, err := p.apply(protocol.LoginApplyRequest{Agent: "codex", Secret: first})
	if err != nil {
		t.Fatal(err)
	}
	if res.Sha256 != sha256Hex([]byte(first)) {
		t.Fatalf("sha = %s", res.Sha256)
	}
	checkMode(t, p.codexDir, 0o700)
	checkMode(t, auth, 0o600)
	if readFile(t, auth) != first {
		t.Fatal("auth.json content")
	}
	if _, err := os.Stat(backup); err == nil {
		t.Fatal("a backup was made with nothing to back up")
	}
	noTempFiles(t, p.codexDir)

	// The same content again: nothing to back up.
	if _, err := p.apply(protocol.LoginApplyRequest{Agent: "codex", Secret: first}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(backup); err == nil {
		t.Fatal("identical content was backed up")
	}

	// The person's own sign-in is backed up before it is replaced, and the
	// file is replaced by a rename, not rewritten in place.
	own := `{"tokens":{"id_token":"mine"}}`
	os.WriteFile(auth, []byte(own), 0o600)
	before, _ := os.Stat(auth)
	shared := `{"tokens":{"id_token":"shared"}}`
	if _, err := p.apply(protocol.LoginApplyRequest{Agent: "codex", Secret: shared}); err != nil {
		t.Fatal(err)
	}
	after, _ := os.Stat(auth)
	if os.SameFile(before, after) {
		t.Error("auth.json was written in place, not replaced atomically")
	}
	if readFile(t, backup) != own || readFile(t, auth) != shared {
		t.Fatal("backup or new file wrong")
	}
	checkMode(t, backup, 0o600)
	checkMode(t, auth, 0o600)
	noTempFiles(t, p.codexDir)

	// Replacing what Overseer wrote keeps the backup of the person's own.
	newer := `{"tokens":{"id_token":"newer"}}`
	if _, err := p.apply(protocol.LoginApplyRequest{Agent: "codex", Secret: newer, Replaces: sha256Hex([]byte(shared))}); err != nil {
		t.Fatal(err)
	}
	if readFile(t, backup) != own {
		t.Fatalf("backup of the person's sign-in was overwritten: %s", readFile(t, backup))
	}
	// A file that changed since (a new sign-in) is backed up again.
	theirs := `{"tokens":{"id_token":"theirs"}}`
	os.WriteFile(auth, []byte(theirs), 0o600)
	if _, err := p.apply(protocol.LoginApplyRequest{Agent: "codex", Secret: newer, Replaces: sha256Hex([]byte(newer))}); err != nil {
		t.Fatal(err)
	}
	if readFile(t, backup) != theirs {
		t.Fatal("a changed sign-in was not backed up")
	}
}

func TestApplyClaudeToken(t *testing.T) {
	p := testLoginPaths(t)
	token := "sk-ant-oat01-" + strings.Repeat("x", 40)
	res, err := p.apply(protocol.LoginApplyRequest{Agent: "claude", Secret: "  " + token + "\n"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Sha256 != sha256Hex([]byte(token)) || readFile(t, p.claudeToken) != token {
		t.Fatal("token not written trimmed")
	}
	checkMode(t, filepath.Dir(p.claudeToken), 0o700)
	checkMode(t, p.claudeToken, 0o600)
	noTempFiles(t, filepath.Dir(p.claudeToken))
	if _, err := p.apply(protocol.LoginApplyRequest{Agent: "claude", Secret: "two words"}); err == nil {
		t.Fatal("a token with a space was written")
	}
	if _, err := p.apply(protocol.LoginApplyRequest{Agent: "gemini", Secret: "x"}); err == nil {
		t.Fatal("an unsupported agent was accepted")
	}
}

func TestRemoveCodexOnlyWhenUnchanged(t *testing.T) {
	p := testLoginPaths(t)
	auth := filepath.Join(p.codexDir, codexAuthFile)
	backup := filepath.Join(p.codexDir, codexAuthBackup)
	own := `{"tokens":{"id_token":"mine"}}`
	shared := `{"tokens":{"id_token":"shared"}}`
	os.MkdirAll(p.codexDir, 0o700)
	os.WriteFile(auth, []byte(own), 0o600)
	res, err := p.apply(protocol.LoginApplyRequest{Agent: "codex", Secret: shared})
	if err != nil {
		t.Fatal(err)
	}

	// A different hash (Codex refreshed the tokens, or a new sign-in): left alone.
	out, err := p.remove(protocol.LoginRemoveRequest{Agent: "codex", Sha256: sha256Hex([]byte("other"))})
	if err != nil || out.Removed || out.Note == "" {
		t.Fatalf("mismatch: %+v %v", out, err)
	}
	if readFile(t, auth) != shared {
		t.Fatal("auth.json changed on a hash mismatch")
	}
	if out, _ := p.remove(protocol.LoginRemoveRequest{Agent: "codex"}); out.Removed {
		t.Fatal("removed with no hash")
	}

	// The matching hash restores the backup.
	out, err = p.remove(protocol.LoginRemoveRequest{Agent: "codex", Sha256: res.Sha256})
	if err != nil || !out.Removed {
		t.Fatalf("match: %+v %v", out, err)
	}
	if readFile(t, auth) != own {
		t.Fatal("the person's sign-in was not restored")
	}
	if _, err := os.Stat(backup); err == nil {
		t.Fatal("backup still there after restoring it")
	}

	// No backup: the file goes.
	os.Remove(auth)
	res, _ = p.apply(protocol.LoginApplyRequest{Agent: "codex", Secret: shared})
	if out, err := p.remove(protocol.LoginRemoveRequest{Agent: "codex", Sha256: res.Sha256}); err != nil || !out.Removed {
		t.Fatalf("no backup: %+v %v", out, err)
	}
	if _, err := os.Stat(auth); err == nil {
		t.Fatal("auth.json still there")
	}
	if out, err := p.remove(protocol.LoginRemoveRequest{Agent: "codex", Sha256: res.Sha256}); err != nil || out.Removed {
		t.Fatalf("already gone: %+v %v", out, err)
	}
}

func TestRemoveClaudeToken(t *testing.T) {
	p := testLoginPaths(t)
	p.apply(protocol.LoginApplyRequest{Agent: "claude", Secret: "sk-ant-oat01-" + strings.Repeat("y", 40)})
	if out, err := p.remove(protocol.LoginRemoveRequest{Agent: "claude"}); err != nil || !out.Removed {
		t.Fatalf("%+v %v", out, err)
	}
	if _, err := os.Stat(p.claudeToken); err == nil {
		t.Fatal("token file still there")
	}
	if out, err := p.remove(protocol.LoginRemoveRequest{Agent: "claude"}); err != nil || out.Removed {
		t.Fatalf("second remove: %+v %v", out, err)
	}
}

func TestReadCodexAuth(t *testing.T) {
	p := testLoginPaths(t)
	_, err := p.read(protocol.LoginReadRequest{Agent: "codex"})
	if err == nil || !strings.Contains(err.Error(), `cli_auth_credentials_store = "file"`) || !strings.Contains(err.Error(), "keychain") {
		t.Fatalf("missing file: %v", err)
	}
	os.MkdirAll(p.codexDir, 0o700)
	auth := filepath.Join(p.codexDir, codexAuthFile)
	os.WriteFile(auth, []byte(`{"OPENAI_API_KEY":"sk-x"}`), 0o600)
	res, err := p.read(protocol.LoginReadRequest{Agent: "codex"})
	if err != nil || res.Secret != `{"OPENAI_API_KEY":"sk-x"}` {
		t.Fatalf("%+v %v", res, err)
	}
	os.WriteFile(auth, []byte(strings.Repeat("x", maxLoginSize+1)), 0o600)
	if _, err := p.read(protocol.LoginReadRequest{Agent: "codex"}); err == nil {
		t.Fatal("an oversized file was read")
	}
	if _, err := p.read(protocol.LoginReadRequest{Agent: "claude"}); err == nil {
		t.Fatal("claude has no file to read")
	}
}

func TestHandleLoginDispatch(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("CODEX_HOME", filepath.Join(home, "elsewhere"))
	data, _ := json.Marshal(protocol.LoginApplyRequest{Agent: "codex", Secret: `{"tokens":{}}`})
	if _, err := handleLogin(protocol.TypeLoginApply, data); err != nil {
		t.Fatal(err)
	}
	if readFile(t, filepath.Join(home, "elsewhere", codexAuthFile)) != `{"tokens":{}}` {
		t.Fatal("CODEX_HOME not used")
	}
	data, _ = json.Marshal(protocol.LoginApplyRequest{Agent: "claude", Secret: "sk-ant-oat01-" + strings.Repeat("z", 40)})
	if _, err := handleLogin(protocol.TypeLoginApply, data); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(home, ".overseer", claudeTokenFile)); err != nil {
		t.Fatal("token not in ~/.overseer")
	}
}

func TestWithClaudeToken(t *testing.T) {
	dir := t.TempDir()
	tokenPath := filepath.Join(dir, claudeTokenFile)
	base := []string{"PATH=/bin", "HOME=/home/me"}

	if env, ok := withClaudeToken(base, tokenPath); ok || !slices.Equal(env, base) {
		t.Fatal("added a token with no token file")
	}
	os.WriteFile(tokenPath, []byte("sk-ant-oat01-secret\n"), 0o600)
	env, ok := withClaudeToken(base, tokenPath)
	if !ok || !slices.Contains(env, "CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-secret") {
		t.Fatalf("token not added: %v", env)
	}

	// Anything that already signs Claude Code in wins.
	for _, kv := range []string{"ANTHROPIC_API_KEY=sk-ant-api", "ANTHROPIC_AUTH_TOKEN=bearer", "CLAUDE_CODE_OAUTH_TOKEN=theirs"} {
		in := append(slices.Clone(base), kv)
		env, ok := withClaudeToken(in, tokenPath)
		if ok || !slices.Equal(env, in) {
			t.Errorf("with %s: env changed to %v", kv, env)
		}
	}
	// Empty values don't count, and an empty token variable is replaced, not duplicated.
	in := append(slices.Clone(base), "ANTHROPIC_API_KEY=", "CLAUDE_CODE_OAUTH_TOKEN=")
	env, ok = withClaudeToken(in, tokenPath)
	n := 0
	for _, kv := range env {
		if strings.HasPrefix(kv, "CLAUDE_CODE_OAUTH_TOKEN=") {
			n++
		}
	}
	if !ok || n != 1 || !slices.Contains(env, "CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-secret") {
		t.Fatalf("empty vars: %v", env)
	}

	// A file that is not a token is ignored.
	os.WriteFile(tokenPath, []byte("two words"), 0o600)
	if _, ok := withClaudeToken(base, tokenPath); ok {
		t.Fatal("a malformed token was used")
	}
}

// TestClaudeAuthProbeUsesSharedToken runs the sign-in probe against a fake
// claude that is signed in only when it gets a token.
func TestClaudeAuthProbeUsesSharedToken(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell script stand-in")
	}
	home := t.TempDir()
	t.Setenv("HOME", home)
	for _, k := range claudeAuthVars {
		t.Setenv(k, "")
	}
	bin := filepath.Join(t.TempDir(), "claude")
	script := "#!/bin/sh\nif [ -n \"$CLAUDE_CODE_OAUTH_TOKEN\" ]; then echo '{\"loggedIn\":true,\"authMethod\":\"oauth_token\"}'; " +
		"else echo '{\"loggedIn\":false}'; fi\n"
	if err := os.WriteFile(bin, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	if state, _ := agentAuth("claude", bin, 5*time.Second); state != "signed-out" {
		t.Fatalf("without a token: %q", state)
	}
	p, _ := defaultLoginPaths()
	if _, err := p.apply(protocol.LoginApplyRequest{Agent: "claude", Secret: "sk-ant-oat01-" + strings.Repeat("t", 40)}); err != nil {
		t.Fatal(err)
	}
	if state, _ := agentAuth("claude", bin, 5*time.Second); state != "ok" {
		t.Fatalf("with the shared token: %q", state)
	}
	// An API key in the environment is left to win: the token is not passed.
	t.Setenv("ANTHROPIC_API_KEY", "sk-ant-api-x")
	if state, account := agentAuth("claude", bin, 5*time.Second); state != "ok" || account != "API key" {
		t.Fatalf("with an API key: %q %q", state, account)
	}
}
