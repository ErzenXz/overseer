package hub

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
)

func startBody(deviceId, exe, cwd, key string) map[string]any {
	body := map[string]any{"deviceId": deviceId, "agent": "acp", "command": fmt.Sprintf("%q", exe), "cwd": cwd, "prompt": "ping"}
	if key != "" {
		body["clientRequestId"] = key
	}
	return body
}

// A start retried with the same key finds the first session instead of
// creating a second one, even when the retries race.
func TestStartIsIdempotent(t *testing.T) {
	t.Setenv(fakeACPEnv, "1")
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	srv, base := startHub(t)
	deviceId := connectAgent(t, srv, base)
	token, _ := srv.store.CreateApiToken("idem-test")
	api := apiClient{t: t, base: base, token: token}
	cwd := t.TempDir()
	cleanup := func(id string) {
		t.Cleanup(func() { exec.Command("tmux", "kill-session", "-t", "thread-"+id[:8]).Run() })
	}

	// Before the first try the key is definitely unused.
	var lookup struct {
		Found  bool    `json:"found"`
		Thread *Thread `json:"thread"`
	}
	api.do("GET", "/api/sessions/by-request/req-unused-1", nil, &lookup)
	if lookup.Found || lookup.Thread != nil {
		t.Fatalf("unused key: %+v", lookup)
	}

	var first Thread
	api.do("POST", "/api/threads", startBody(deviceId, exe, cwd, "req-abcdef-01"), &first)
	cleanup(first.Id)

	var again Thread
	api.do("POST", "/api/threads", startBody(deviceId, exe, cwd, "req-abcdef-01"), &again)
	if again.Id != first.Id {
		t.Errorf("retry made session %s, want the first one %s", again.Id, first.Id)
	}

	api.do("GET", "/api/sessions/by-request/req-abcdef-01", nil, &lookup)
	if !lookup.Found || lookup.Thread == nil || lookup.Thread.Id != first.Id || lookup.Thread.DeviceId != deviceId {
		t.Errorf("by-request: %+v", lookup)
	}

	// Concurrent tries with one key still create exactly one session.
	var wg sync.WaitGroup
	ids := make([]string, 8)
	for i := range ids {
		wg.Add(1)
		go func() {
			defer wg.Done()
			var th Thread
			api.do("POST", "/api/threads", startBody(deviceId, exe, cwd, "req-race-0001"), &th)
			ids[i] = th.Id
		}()
	}
	wg.Wait()
	for _, id := range ids {
		if id != ids[0] || id == "" {
			t.Fatalf("racing starts made different sessions: %v", ids)
		}
	}
	cleanup(ids[0])

	// A new key is a new session; no key never dedupes.
	var other, plain1, plain2 Thread
	api.do("POST", "/api/threads", startBody(deviceId, exe, cwd, "req-abcdef-02"), &other)
	api.do("POST", "/api/threads", startBody(deviceId, exe, cwd, ""), &plain1)
	api.do("POST", "/api/threads", startBody(deviceId, exe, cwd, ""), &plain2)
	for _, th := range []Thread{other, plain1, plain2} {
		cleanup(th.Id)
	}
	if other.Id == first.Id || plain1.Id == plain2.Id {
		t.Errorf("distinct starts collapsed: %s %s %s", other.Id, plain1.Id, plain2.Id)
	}
	var all []Thread
	api.do("GET", "/api/threads", nil, &all)
	if len(all) != 5 { // first, race, other, plain1, plain2
		t.Errorf("%d sessions exist, want 5", len(all))
	}

	// Bad keys are rejected, not silently ignored.
	if code := api.do("POST", "/api/threads", startBody(deviceId, exe, cwd, "bad key!"), nil); code != http.StatusBadRequest {
		t.Errorf("invalid key: %d, want 400", code)
	}
	if code := api.do("GET", "/api/sessions/by-request/short", nil, nil); code != http.StatusBadRequest {
		t.Errorf("short lookup key: %d, want 400", code)
	}
}

// An offline machine fails the start with 503 and the key stays unused, so a
// retry (same key) can still create the session once the machine is back.
func TestStartOfflineKeepsKeyFree(t *testing.T) {
	srv, base := startHub(t)
	token, _ := srv.store.CreateApiToken("idem-test")
	api := apiClient{t: t, base: base, token: token}
	deviceId, _, err := srv.store.CreateDevice("laptop", "laptop", "linux", "amd64", false)
	if err != nil {
		t.Fatal(err)
	}
	code := api.do("POST", "/api/threads", map[string]any{"deviceId": deviceId, "agent": "claude", "cwd": "/tmp", "prompt": "hi", "clientRequestId": "req-offline-01"}, nil)
	if code != http.StatusServiceUnavailable {
		t.Fatalf("offline start: %d, want 503", code)
	}
	var lookup struct{ Found bool }
	api.do("GET", "/api/sessions/by-request/req-offline-01", nil, &lookup)
	if lookup.Found {
		t.Error("an offline start must not remember its key")
	}
}

// The hub relays git.info to the machine and reports offline machines as 503.
func TestDeviceGitInfo(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	srv, base := startHub(t)
	deviceId := connectAgent(t, srv, base)
	token, _ := srv.store.CreateApiToken("git-test")
	api := apiClient{t: t, base: base, token: token}

	repo := filepath.Join(t.TempDir(), "proj")
	os.MkdirAll(repo, 0o755)
	for _, args := range [][]string{{"init", "-q", "-b", "trunk"}, {"remote", "add", "origin", "git@github.com:acme/proj.git"}} {
		if out, err := exec.Command("git", append([]string{"-C", repo}, args...)...).CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
	}

	var res struct {
		Home  string `json:"home"`
		Paths []struct {
			Path      string `json:"path"`
			Exists    bool   `json:"exists"`
			IsRepo    bool   `json:"isRepo"`
			Branch    string `json:"branch"`
			RemoteKey string `json:"remoteKey"`
		} `json:"paths"`
	}
	api.do("POST", "/api/devices/"+deviceId+"/git-info", map[string]any{"paths": []string{repo, "/definitely/not/here"}}, &res)
	if len(res.Paths) != 2 || !res.Paths[0].IsRepo || res.Paths[0].Branch != "trunk" || res.Paths[0].RemoteKey != "github.com/acme/proj" {
		t.Errorf("repo: %+v", res.Paths)
	}
	if res.Paths[1].Exists || res.Paths[1].IsRepo {
		t.Errorf("missing: %+v", res.Paths[1])
	}

	for name, body := range map[string]any{
		"no paths": map[string]any{"paths": []string{}},
		"too many": map[string]any{"paths": make([]string, 33)},
	} {
		if code := api.do("POST", "/api/devices/"+deviceId+"/git-info", body, nil); code != http.StatusBadRequest {
			t.Errorf("%s: %d, want 400", name, code)
		}
	}
	if code := api.do("POST", "/api/devices/nope/git-info", map[string]any{"paths": []string{"~"}}, nil); code != http.StatusServiceUnavailable {
		t.Errorf("offline device: %d, want 503", code)
	}
}
