package hub

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func newTestServer(t *testing.T, version string) *Server {
	t.Helper()
	srv, err := NewServer(Options{
		Addr: "127.0.0.1:0", DataDir: t.TempDir(), Version: version, GithubRepo: "ErzenXz/overseer",
	})
	if err != nil {
		t.Fatal(err)
	}
	return srv
}

func TestAgentBinaryRedirectsForOtherPlatform(t *testing.T) {
	srv := newTestServer(t, "v0.1.0")
	// Ask for a platform the running test host almost certainly isn't.
	req := httptest.NewRequest("GET", "/api/agent-binary?os=linux&arch=arm64", nil)
	// Force mismatch even if the host happens to be linux/arm64.
	req.URL.RawQuery = "os=plan9&arch=sparc64"
	w := httptest.NewRecorder()
	srv.handleAgentBinary(w, req)

	if w.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302", w.Code)
	}
	loc := w.Header().Get("Location")
	want := "https://github.com/ErzenXz/overseer/releases/download/v0.1.0/overseer_plan9_sparc64"
	if loc != want {
		t.Errorf("Location = %q, want %q", loc, want)
	}
}

func TestAgentBinaryDevVersionUsesLatest(t *testing.T) {
	srv := newTestServer(t, "0.1.0-dev") // non-tag version
	req := httptest.NewRequest("GET", "/api/agent-binary?os=plan9&arch=sparc64", nil)
	w := httptest.NewRecorder()
	srv.handleAgentBinary(w, req)

	loc := w.Header().Get("Location")
	if !strings.Contains(loc, "/releases/latest/download/overseer_plan9_sparc64") {
		t.Errorf("dev build should redirect to latest, got %q", loc)
	}
}

func TestAgentBinaryRejectsPathTraversal(t *testing.T) {
	srv := newTestServer(t, "v0.1.0")
	for _, bad := range []string{"../../../../etc/passwd", "linux/..", "a b", "arch;rm"} {
		req := httptest.NewRequest("GET", "/api/agent-binary", nil)
		q := req.URL.Query()
		q.Set("os", "linux")
		q.Set("arch", bad)
		req.URL.RawQuery = q.Encode()
		w := httptest.NewRecorder()
		srv.handleAgentBinary(w, req)
		if w.Code == http.StatusFound || w.Code == http.StatusOK {
			t.Errorf("arch=%q should be rejected, got %d", bad, w.Code)
		}
	}
}

func TestInstallScriptRejectsBadToken(t *testing.T) {
	srv := newTestServer(t, "v0.1.0")
	// A token with a quote would break out of the shell assignment.
	req := httptest.NewRequest("GET", "/install/placeholder.sh", nil)
	req.URL.Path = `/install/x".sh`
	w := httptest.NewRecorder()
	srv.handleInstallScript(w, req)
	if w.Code == http.StatusOK {
		t.Error("token with a quote should be rejected")
	}
}

func TestInstallScriptEmbedsHubAndToken(t *testing.T) {
	srv := newTestServer(t, "v0.1.0")
	req := httptest.NewRequest("GET", "/install/abc123.sh", nil)
	req.Host = "hub.example:4200"
	w := httptest.NewRecorder()
	srv.handleInstallScript(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	body := w.Body.String()
	if !strings.Contains(body, "http://hub.example:4200") {
		t.Error("script should embed the hub URL")
	}
	if !strings.Contains(body, "abc123") {
		t.Error("script should embed the enrollment token")
	}
	for _, want := range []string{
		"curl -fsSL", // follows the GitHub release redirect
		"/api/agent-binary/sha256",
		"checksum mismatch",
		"\nmain \"$@\"\n", // nothing runs until the whole script has arrived
	} {
		if !strings.Contains(body, want) {
			t.Errorf("script is missing %q", want)
		}
	}
}

// The checksum endpoint must describe exactly the bytes the binary endpoint
// serves, for local binaries; for release assets it points at checksums.txt.
func TestAgentBinarySumMatchesServedBinary(t *testing.T) {
	srv := newTestServer(t, "v0.1.0")
	dir := filepath.Join(srv.opts.DataDir, "binaries")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "overseer_plan9_sparc64"), []byte("custom build"), 0o755); err != nil {
		t.Fatal(err)
	}
	get := func(path string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		srv.mux.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		return w
	}
	bin := get("/api/agent-binary?os=plan9&arch=sparc64")
	sum := get("/api/agent-binary/sha256?os=plan9&arch=sparc64")
	if bin.Code != http.StatusOK || sum.Code != http.StatusOK {
		t.Fatalf("status binary=%d sum=%d", bin.Code, sum.Code)
	}
	want := sha256.Sum256(bin.Body.Bytes())
	if strings.TrimSpace(sum.Body.String()) != hex.EncodeToString(want[:]) {
		t.Fatalf("published sum %q does not match served bytes", sum.Body.String())
	}
	if bad := get("/api/agent-binary/sha256?os=../etc&arch=x"); bad.Code == http.StatusOK {
		t.Fatal("path traversal in os must be rejected")
	}
}

// Runs the generated join script end to end against a live test hub, with a
// fake agent binary and a throwaway HOME, so nothing on the host changes.
func TestInstallScriptRunsEndToEnd(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX script")
	}
	srv := newTestServer(t, "v0.1.0")
	ts := httptest.NewServer(srv.mux)
	defer ts.Close()
	home := t.TempDir()
	calls := filepath.Join(home, "calls.log")
	fake := "#!/bin/sh\nprintf '%s\\n' \"$*\" >> " + calls + "\n[ \"$1\" = version ] && echo 'overseer v0.1.0'\nexit 0\n"
	dir := filepath.Join(srv.opts.DataDir, "binaries")
	os.MkdirAll(dir, 0o755)
	osName := runtime.GOOS
	arch := runtime.GOARCH
	if err := os.WriteFile(filepath.Join(dir, "overseer_"+osName+"_"+arch), []byte(fake), 0o755); err != nil {
		t.Fatal(err)
	}
	resp, err := http.Get(ts.URL + "/install/tok12345.sh")
	if err != nil {
		t.Fatal(err)
	}
	script, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	cmd := exec.Command("sh", "-s")
	cmd.Stdin = bytes.NewReader(script)
	cmd.Env = append(os.Environ(), "HOME="+home)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("script failed: %v\n%s", err, out)
	}
	logged, _ := os.ReadFile(calls)
	for _, want := range []string{"version", "agent enroll --hub " + ts.URL + " --token tok12345", "agent install-service"} {
		if !strings.Contains(string(logged), want) {
			t.Errorf("agent was not called with %q; calls:\n%s", want, logged)
		}
	}
	if _, err := os.Stat(filepath.Join(home, ".overseer", "bin", "overseer")); err != nil {
		t.Errorf("agent not installed: %v", err)
	}
	if !strings.Contains(string(out), "Agent downloaded and verified") {
		t.Errorf("unexpected output:\n%s", out)
	}
}

func TestWindowsInstallScriptEmbedsHubAndToken(t *testing.T) {
	srv := newTestServer(t, "v0.1.0")
	req := httptest.NewRequest("GET", "/install/abc123.ps1", nil)
	req.Host = "hub.example:4200"
	w := httptest.NewRecorder()
	srv.handleInstallScript(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	body := w.Body.String()
	if !strings.Contains(body, `$Hub = "http://hub.example:4200"`) {
		t.Error("script should embed the hub URL")
	}
	if !strings.Contains(body, `$Token = "abc123"`) {
		t.Error("script should embed the enrollment token")
	}
	if !strings.Contains(body, "Invoke-WebRequest") {
		t.Error("script should download the Windows binary")
	}
	if !strings.Contains(body, "os=windows&arch=$Arch") {
		t.Error("script should request a Windows binary")
	}
}

func TestCreateEnrollTokenReturnsUnixAndWindowsCommands(t *testing.T) {
	srv := newTestServer(t, "v0.1.0")
	req := httptest.NewRequest("POST", "/api/enroll-tokens", nil)
	req.Host = "hub.example:4200"
	w := httptest.NewRecorder()
	srv.handleCreateEnrollToken(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	var got map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got["token"] == "" {
		t.Fatal("token should be returned")
	}
	if !strings.Contains(got["command"], "/install/"+got["token"]+".sh") {
		t.Errorf("unix command should include .sh installer, got %q", got["command"])
	}
	if !strings.Contains(got["windowsCommand"], "/install/"+got["token"]+".ps1") {
		t.Errorf("windows command should include .ps1 installer, got %q", got["windowsCommand"])
	}
}

// If the binary that arrives differs from what the hub published (a corrupted
// download, or something rewriting traffic), the script must stop before it
// runs anything.
func TestInstallScriptRejectsTamperedBinary(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX script")
	}
	srv := newTestServer(t, "v0.1.0")
	dir := filepath.Join(srv.opts.DataDir, "binaries")
	os.MkdirAll(dir, 0o755)
	home := t.TempDir()
	ran := filepath.Join(home, "ran")
	os.WriteFile(filepath.Join(dir, "overseer_"+runtime.GOOS+"_"+runtime.GOARCH), []byte("#!/bin/sh\nexit 0\n"), 0o755)
	tampering := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/agent-binary" {
			fmt.Fprintf(w, "#!/bin/sh\ntouch %s\n", ran)
			return
		}
		srv.mux.ServeHTTP(w, r)
	}))
	defer tampering.Close()
	resp, err := http.Get(tampering.URL + "/install/tok12345.sh")
	if err != nil {
		t.Fatal(err)
	}
	script, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	cmd := exec.Command("sh", "-s")
	cmd.Stdin = bytes.NewReader(script)
	cmd.Env = append(os.Environ(), "HOME="+home)
	out, err := cmd.CombinedOutput()
	if err == nil {
		t.Fatalf("script accepted a tampered binary:\n%s", out)
	}
	if !strings.Contains(string(out), "checksum mismatch") {
		t.Errorf("unexpected output:\n%s", out)
	}
	if _, err := os.Stat(ran); err == nil {
		t.Fatal("tampered binary was executed")
	}
	if _, err := os.Stat(filepath.Join(home, ".overseer", "bin", "overseer")); err == nil {
		t.Fatal("tampered binary was installed")
	}
}
