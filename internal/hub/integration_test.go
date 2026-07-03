package hub

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/ErzenXz/overseer/internal/agent"
	"github.com/ErzenXz/overseer/internal/protocol"
)

// startHub boots a real hub on a loopback port with a temp data dir.
func startHub(t *testing.T) (*Server, string) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	ln.Close() // free it for the server (tiny race, fine in tests)

	srv, err := NewServer(Options{Addr: addr, DataDir: t.TempDir(), Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go srv.Run(ctx)

	base := "http://" + addr
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if resp, err := http.Get(base + "/api/me"); err == nil {
			resp.Body.Close()
			return srv, base
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("hub did not come up")
	return nil, ""
}

// connectAgent enrolls and runs an in-process device agent against the hub.
func connectAgent(t *testing.T, srv *Server, base string) string {
	t.Helper()
	enrollToken, err := srv.store.CreateEnrollToken(time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]string{
		"token": enrollToken, "hostname": "test-device", "os": "linux", "arch": "amd64",
	})
	resp, err := http.Post(base+"/api/enroll", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("enroll: %s", resp.Status)
	}
	var er struct {
		DeviceId    string `json:"deviceId"`
		DeviceToken string `json:"deviceToken"`
	}
	json.NewDecoder(resp.Body).Decode(&er)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go agent.New(agent.Config{HubURL: base, Token: er.DeviceToken}, "test").Run(ctx)

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if srv.registry.get(er.DeviceId) != nil {
			return er.DeviceId
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("agent never connected")
	return ""
}

func TestEndToEnd(t *testing.T) {
	srv, base := startHub(t)
	deviceId := connectAgent(t, srv, base)
	conn := srv.registry.get(deviceId)

	t.Run("exec round trip", func(t *testing.T) {
		res, err := srv.execOnDevice(conn, "echo overseer-$((20+22))", "", 15)
		if err != nil {
			t.Fatal(err)
		}
		if res.ExitCode != 0 || !strings.Contains(res.Stdout, "overseer-42") {
			t.Errorf("got exit=%d stdout=%q stderr=%q", res.ExitCode, res.Stdout, res.Stderr)
		}
	})

	t.Run("exec nonzero exit", func(t *testing.T) {
		res, err := srv.execOnDevice(conn, "exit 3", "", 15)
		if err != nil {
			t.Fatal(err)
		}
		if res.ExitCode != 3 {
			t.Errorf("exit = %d, want 3", res.ExitCode)
		}
	})

	t.Run("fs list", func(t *testing.T) {
		ctx, cancel := deviceCtx()
		defer cancel()
		var res protocol.FsListResult
		err := conn.requestInto(ctx, protocol.TypeFsList, protocol.FsList{Path: "/"}, &res)
		if err != nil {
			t.Fatal(err)
		}
		if len(res.Entries) == 0 {
			t.Error("expected entries in /")
		}
	})

	t.Run("sessions via tmux", func(t *testing.T) {
		if _, err := exec.LookPath("tmux"); err != nil {
			t.Skip("tmux not installed")
		}
		name := fmt.Sprintf("ovsr-test-%d", time.Now().UnixNano())
		ctx, cancel := deviceCtx()
		defer cancel()
		err := conn.requestInto(ctx, protocol.TypeSessionCreate,
			protocol.SessionCreate{Name: name, Kind: "shell"}, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer conn.requestInto(context.Background(), protocol.TypeSessionKill, protocol.SessionKill{Name: name}, nil)

		var list protocol.SessionsListResult
		if err := conn.requestInto(ctx, protocol.TypeSessionsList, nil, &list); err != nil {
			t.Fatal(err)
		}
		found := false
		for _, s := range list.Sessions {
			if s.Name == name {
				found = true
				if s.Kind != "shell" {
					t.Errorf("kind = %q, want shell", s.Kind)
				}
			}
		}
		if !found {
			t.Errorf("session %q not in list", name)
		}
		if err := conn.requestInto(ctx, protocol.TypeSessionKill, protocol.SessionKill{Name: name}, nil); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("bad session name rejected", func(t *testing.T) {
		ctx, cancel := deviceCtx()
		defer cancel()
		err := conn.requestInto(ctx, protocol.TypeSessionCreate,
			protocol.SessionCreate{Name: "bad name; rm -rf /"}, nil)
		if err == nil {
			t.Error("expected rejection of malicious session name")
		}
	})
}

func TestAuthFlow(t *testing.T) {
	srv, err := NewServer(Options{Addr: "127.0.0.1:0", DataDir: t.TempDir(), Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(srv.mux)
	t.Cleanup(ts.Close)

	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	post := func(path string, body any) *http.Response {
		b, _ := json.Marshal(body)
		resp, err := client.Post(ts.URL+path, "application/json", bytes.NewReader(b))
		if err != nil {
			t.Fatal(err)
		}
		return resp
	}

	// Protected route without auth.
	if resp, _ := client.Get(ts.URL + "/api/devices"); resp.StatusCode != 401 {
		t.Fatalf("unauthenticated devices: %d, want 401", resp.StatusCode)
	}
	// Short password rejected.
	if resp := post("/api/setup", map[string]string{"password": "short"}); resp.StatusCode != 400 {
		t.Fatalf("short password: %d, want 400", resp.StatusCode)
	}
	// Proper setup logs us in.
	if resp := post("/api/setup", map[string]string{"password": "a-strong-password"}); resp.StatusCode != 200 {
		t.Fatalf("setup: %d", resp.StatusCode)
	}
	if resp, _ := client.Get(ts.URL + "/api/devices"); resp.StatusCode != 200 {
		t.Fatalf("authed devices: %d, want 200", resp.StatusCode)
	}
	// Second setup attempt is blocked.
	if resp := post("/api/setup", map[string]string{"password": "another-password"}); resp.StatusCode != 409 {
		t.Fatalf("re-setup: %d, want 409", resp.StatusCode)
	}
	// Fresh client: wrong then right password.
	jar2, _ := cookiejar.New(nil)
	client2 := &http.Client{Jar: jar2}
	b, _ := json.Marshal(map[string]string{"password": "wrong-password"})
	resp, _ := client2.Post(ts.URL+"/api/login", "application/json", bytes.NewReader(b))
	if resp.StatusCode != 401 {
		t.Fatalf("wrong login: %d, want 401", resp.StatusCode)
	}
	b, _ = json.Marshal(map[string]string{"password": "a-strong-password"})
	resp, _ = client2.Post(ts.URL+"/api/login", "application/json", bytes.NewReader(b))
	if resp.StatusCode != 200 {
		t.Fatalf("login: %d, want 200", resp.StatusCode)
	}
	// API token auth.
	apiToken, _ := srv.store.CreateApiToken("test")
	req, _ := http.NewRequest("GET", ts.URL+"/api/devices", nil)
	req.Header.Set("Authorization", "Bearer "+apiToken)
	resp, _ = http.DefaultClient.Do(req)
	if resp.StatusCode != 200 {
		t.Fatalf("api token auth: %d, want 200", resp.StatusCode)
	}
}
