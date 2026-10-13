package mcp

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ErzenXz/overseer/internal/fleet"
)

func TestListDevicesCapacity(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/devices":
			w.Write([]byte(`[
				{"id":"busy","name":"Builder","os":"linux","arch":"amd64","online":true,"tmux":true,"isHub":true,"stats":{"cpuPercent":32,"cpuCores":8,"memUsed":410,"memTotal":1000,"load1":1.4,"load5":1.2,"load15":0.8}},
				{"id":"empty","name":"Empty","os":"windows","online":true,"stats":{"cpuCores":4}},
				{"id":"missing","name":"Starting","online":true,"tmux":true},
				{"id":"failed","name":"Unreachable","online":true,"tmux":true},
				{"id":"offline","name":"Offline","online":false,"stats":{"cpuPercent":99}}
			]`))
		case "/api/devices/busy/sessions":
			w.Write([]byte(`[{"name":"a","status":"working","kind":"claude"},{"name":"b","status":"idle","kind":"shell"},{"name":"c","status":"exited"},{"name":"d","status":"unknown"}]`))
		case "/api/devices/empty/sessions", "/api/devices/missing/sessions":
			w.Write([]byte(`[]`))
		case "/api/devices/failed/sessions":
			http.Error(w, `{"error":"device not responding"}`, http.StatusBadGateway)
		default:
			t.Errorf("unexpected request: %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	response, notification := HandleMessage(fleet.New(server.URL, "test"), "test", []byte(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_devices","arguments":{}}}`))
	if notification {
		t.Fatal("tool call treated as notification")
	}
	var result struct {
		Result struct {
			Content []struct {
				Text string `json:"text"`
			} `json:"content"`
			IsError bool `json:"isError"`
		} `json:"result"`
	}
	if err := json.Unmarshal(response, &result); err != nil {
		t.Fatal(err)
	}
	if result.Result.IsError || len(result.Result.Content) != 1 {
		t.Fatalf("unexpected response: %s", response)
	}
	got := result.Result.Content[0].Text
	for _, want := range []string{
		"Builder [hub] — id busy, linux/amd64, online\n  CPU 32.0% (8 cores)\n  RAM 41.0% (410 / 1000 bytes)\n  Load (1/5/15 min): 1.40 / 1.20 / 0.80\n  Sessions: 3 live (1 working, 1 idle, 1 other; exited excluded)",
		"CPU 0.0% (4 cores)\n  RAM: unavailable\n  Load: unavailable on Windows\n  Sessions: 0 live (0 working, 0 idle, 0 other; exited excluded)",
		"Starting — id missing, /, online\n  CPU / RAM / load: unavailable\n  Sessions: 0 live",
		"Unreachable — id failed, /, online\n  CPU / RAM / load: unavailable\n  Sessions: unavailable",
		"Offline — id offline, /, offline\n  CPU / RAM / load: unavailable\n  Sessions: unavailable",
		"(no tmux: sessions won't persist)",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in:\n%s", want, got)
		}
	}
}

func TestListDevicesEmptyAndError(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		status     int
		wantError  bool
	}{
		{"empty", `[]`, http.StatusOK, false},
		{"failure", `{"error":"hub unavailable"}`, http.StatusServiceUnavailable, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/api/devices" {
					t.Errorf("unexpected request: %s", r.URL.Path)
				}
				w.WriteHeader(tc.status)
				w.Write([]byte(tc.body))
			}))
			defer server.Close()
			got, err := callTool(fleet.New(server.URL, "test"), "list_devices", json.RawMessage(`{}`))
			if (err != nil) != tc.wantError {
				t.Fatalf("error = %v, wantError = %v", err, tc.wantError)
			}
			if !tc.wantError && got != "No devices in the fleet yet." {
				t.Errorf("unexpected output: %s", got)
			}
		})
	}
}
