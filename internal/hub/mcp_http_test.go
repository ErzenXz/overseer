package hub

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// mcpCall posts one JSON-RPC message to the /mcp endpoint with the given token.
func mcpCall(t *testing.T, base, token, body string) (int, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest("POST", base+"/mcp", bytes.NewReader([]byte(body)))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func TestMCPHTTPEndpoint(t *testing.T) {
	srv, base := startHub(t)
	connectAgent(t, srv, base)
	token, err := srv.store.CreateApiToken("mcp-http-test")
	if err != nil {
		t.Fatal(err)
	}

	t.Run("rejects missing token", func(t *testing.T) {
		code, _ := mcpCall(t, base, "", `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
		if code != http.StatusUnauthorized {
			t.Fatalf("got %d, want 401", code)
		}
	})

	t.Run("rejects bad token", func(t *testing.T) {
		code, _ := mcpCall(t, base, "nope", `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
		if code != http.StatusUnauthorized {
			t.Fatalf("got %d, want 401", code)
		}
	})

	t.Run("initialize", func(t *testing.T) {
		code, out := mcpCall(t, base, token, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}`)
		if code != 200 {
			t.Fatalf("got %d", code)
		}
		res, _ := out["result"].(map[string]any)
		info, _ := res["serverInfo"].(map[string]any)
		if info["name"] != "overseer" {
			t.Errorf("serverInfo = %v", info)
		}
	})

	t.Run("tools/list includes file tools", func(t *testing.T) {
		_, out := mcpCall(t, base, token, `{"jsonrpc":"2.0","id":2,"method":"tools/list"}`)
		res, _ := out["result"].(map[string]any)
		tools, _ := res["tools"].([]any)
		names := map[string]bool{}
		for _, tl := range tools {
			m, _ := tl.(map[string]any)
			names[m["name"].(string)] = true
		}
		for _, want := range []string{"run_command", "read_file", "write_file", "list_files"} {
			if !names[want] {
				t.Errorf("missing tool %q; have %v", want, names)
			}
		}
	})

	t.Run("tools/call run_command", func(t *testing.T) {
		body := `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"run_command","arguments":{"device":"test-device","command":"echo mcp-http-$((11*11))"}}}`
		code, out := mcpCall(t, base, token, body)
		if code != 200 {
			t.Fatalf("got %d", code)
		}
		res, _ := out["result"].(map[string]any)
		content, _ := res["content"].([]any)
		first, _ := content[0].(map[string]any)
		text, _ := first["text"].(string)
		if !strings.Contains(text, "mcp-http-121") {
			t.Errorf("run_command output = %q", text)
		}
	})

	t.Run("notification returns 202", func(t *testing.T) {
		code, _ := mcpCall(t, base, token, `{"jsonrpc":"2.0","method":"notifications/initialized"}`)
		if code != http.StatusAccepted {
			t.Fatalf("got %d, want 202", code)
		}
	})
}
