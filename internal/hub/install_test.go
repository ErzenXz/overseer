package hub

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
	if !strings.Contains(body, "curl -fSL") {
		t.Error("script should follow redirects when downloading the binary")
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
