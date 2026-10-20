package hub

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// The hub test binary doubles as a tiny ACP agent (see TestMain) so threads
// can be driven end to end through hub, agent and adapter.
const fakeACPEnv = "OVERSEER_HUB_FAKE_ACP"

func TestMain(m *testing.M) {
	agentRegistryURL = "" // tests never fetch the ACP registry
	if os.Getenv(fakeACPEnv) == "1" {
		fakeACPAgent()
		os.Exit(0)
	}
	if os.Getenv(fakeHTTPEnv) == "1" {
		fakeHTTPApp()
		os.Exit(0)
	}
	os.Exit(m.Run())
}

// fakeACPAgent replies "pong: <prompt>" after a permission-gated tool call.
func fakeACPAgent() {
	in := bufio.NewScanner(os.Stdin)
	out := json.NewEncoder(os.Stdout)
	send := func(v map[string]any) { v["jsonrpc"] = "2.0"; out.Encode(v) }
	update := func(u map[string]any) {
		send(map[string]any{"method": "session/update", "params": map[string]any{"sessionId": "s", "update": u}})
	}
	var pendingPrompt json.RawMessage
	var promptText string
	for in.Scan() {
		var m struct {
			Id     json.RawMessage `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
			Result json.RawMessage `json:"result"`
		}
		if json.Unmarshal(in.Bytes(), &m) != nil {
			continue
		}
		switch m.Method {
		case "initialize":
			send(map[string]any{"id": m.Id, "result": map[string]any{"protocolVersion": 1}})
		case "session/new":
			send(map[string]any{"id": m.Id, "result": map[string]any{"sessionId": "s"}})
		case "session/prompt":
			var p struct {
				Prompt []struct{ Text string } `json:"prompt"`
			}
			json.Unmarshal(m.Params, &p)
			pendingPrompt, promptText = m.Id, p.Prompt[0].Text
			update(map[string]any{"sessionUpdate": "tool_call", "toolCallId": "t", "title": "Touch file", "kind": "edit", "status": "pending"})
			send(map[string]any{"id": 900, "method": "session/request_permission", "params": map[string]any{
				"sessionId": "s", "toolCall": map[string]any{"toolCallId": "t"},
				"options": []map[string]string{{"optionId": "ok", "name": "Allow", "kind": "allow_once"}, {"optionId": "no", "name": "Reject", "kind": "reject_once"}},
			}})
		case "":
			if string(m.Id) == "900" && pendingPrompt != nil { // permission answered
				update(map[string]any{"sessionUpdate": "tool_call_update", "toolCallId": "t", "status": "completed",
					"content": []any{map[string]any{"type": "content", "content": map[string]any{"type": "text", "text": string(m.Result)}}}})
				update(map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]any{"type": "text", "text": "pong: "}})
				update(map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]any{"type": "text", "text": promptText}})
				send(map[string]any{"id": pendingPrompt, "result": map[string]any{"stopReason": "end_turn"}})
				pendingPrompt = nil
			}
		}
	}
}

type apiClient struct {
	t     *testing.T
	base  string
	token string
}

func (c apiClient) do(method, path string, body any, out any) int {
	c.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, c.base+path, rd)
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if out != nil && resp.StatusCode < 300 {
		if err := json.Unmarshal(data, out); err != nil {
			c.t.Fatalf("%s %s: decoding %q: %v", method, path, data, err)
		}
	}
	if resp.StatusCode >= 300 && out != nil {
		c.t.Fatalf("%s %s: %d %s", method, path, resp.StatusCode, data)
	}
	return resp.StatusCode
}

func (c apiClient) dial(path string, protocols ...string) *websocket.Conn {
	c.t.Helper()
	url := strings.Replace(c.base, "http://", "ws://", 1) + path
	d := websocket.Dialer{Subprotocols: protocols}
	ws, _, err := d.Dial(url, http.Header{"Authorization": {"Bearer " + c.token}})
	if err != nil {
		c.t.Fatalf("dial %s: %v", path, err)
	}
	c.t.Cleanup(func() { ws.Close() })
	return ws
}

// threadWatcher folds a thread WebSocket stream into the latest state.
type threadWatcher struct {
	t        *testing.T
	ws       *websocket.Conn
	thread   Thread
	messages map[string]ThreadMessage
}

func (w *threadWatcher) until(what string, cond func() bool) {
	w.t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			w.t.Fatalf("timed out waiting for %s (thread=%+v messages=%+v)", what, w.thread, w.messages)
		}
		w.ws.SetReadDeadline(time.Now().Add(20 * time.Second))
		var push struct {
			Type     string          `json:"type"`
			Thread   *Thread         `json:"thread"`
			Message  *ThreadMessage  `json:"message"`
			Messages []ThreadMessage `json:"messages"`
		}
		if err := w.ws.ReadJSON(&push); err != nil {
			w.t.Fatalf("reading thread ws: %v", err)
		}
		if push.Thread != nil {
			w.thread = *push.Thread
		}
		for _, m := range push.Messages {
			w.messages[m.Id] = m
		}
		if push.Message != nil {
			w.messages[push.Message.Id] = *push.Message
		}
	}
}

func (w *threadWatcher) find(role string, match func(ThreadMessage) bool) *ThreadMessage {
	for _, m := range w.messages {
		if m.Role == role && (match == nil || match(m)) {
			return &m
		}
	}
	return nil
}

func TestThreadsEndToEnd(t *testing.T) {
	t.Setenv(fakeACPEnv, "1")
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	srv, base := startHub(t)
	deviceId := connectAgent(t, srv, base)
	token, _ := srv.store.CreateApiToken("threads-test")
	api := apiClient{t: t, base: base, token: token}

	events := api.dial("/api/ws/events")
	sawChanged := make(chan struct{}, 16)
	go func() {
		for {
			var e event
			if events.ReadJSON(&e) != nil {
				return
			}
			if e.Type == "threads.changed" {
				sawChanged <- struct{}{}
			}
		}
	}()

	var kinds []agentKind
	api.do("GET", "/api/agent-kinds", nil, &kinds)
	if len(kinds) != len(srv.agentKinds()) || kinds[0].Id != "claude" || kinds[len(kinds)-1].Id != "acp" {
		t.Errorf("agent kinds = %+v", kinds)
	}

	var created Thread
	api.do("POST", "/api/threads", map[string]any{
		"deviceId": deviceId, "agent": "acp", "command": fmt.Sprintf("%q", exe), "cwd": t.TempDir(), "prompt": "ping",
	}, &created)
	t.Cleanup(func() { exec.Command("tmux", "kill-session", "-t", "thread-"+created.Id[:8]).Run() })
	if created.Title != "ping" || created.Status != "starting" || created.DeviceName != "test-device" {
		t.Errorf("created = %+v", created)
	}
	select {
	case <-sawChanged:
	case <-time.After(5 * time.Second):
		t.Error("no threads.changed event after create")
	}

	w := &threadWatcher{t: t, ws: api.dial("/api/ws/threads/" + created.Id), messages: map[string]ThreadMessage{}}
	w.until("approval", func() bool { return w.find("approval", nil) != nil && w.thread.Status == "waiting" })
	approval := w.find("approval", nil)
	if code := api.do("POST", "/api/threads/"+created.Id+"/approval", map[string]string{"approvalId": approval.Approval.Id, "optionId": "nope"}, nil); code != http.StatusConflict {
		t.Errorf("bad option: %d, want 409", code)
	}
	api.do("POST", "/api/threads/"+created.Id+"/approval", map[string]string{"approvalId": approval.Approval.Id, "optionId": "ok"}, &map[string]bool{})
	w.until("first reply", func() bool {
		return w.thread.Status == "idle" && w.find("assistant", func(m ThreadMessage) bool { return m.Text == "pong: ping" && m.DurationMs > 0 }) != nil
	})
	user := w.find("user", nil)
	reply := w.find("assistant", nil)
	tool := w.find("tool", nil)
	if user == nil || reply.Turn != user.Id || reply.Seq <= user.Seq {
		t.Errorf("turn/seq: user=%+v reply=%+v", user, reply)
	}
	if tool == nil || tool.Tool.Status != "completed" || tool.Tool.Name != "edit" || !strings.Contains(tool.Tool.Output, `"ok"`) {
		t.Errorf("tool = %+v", tool)
	}
	if a := w.find("approval", nil); a.Approval.Resolved != "ok" {
		t.Errorf("approval not resolved: %+v", a.Approval)
	}

	// Kill the agent process behind the hub's back: the next prompt must
	// restart it transparently.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.registry.get(deviceId).requestInto(ctx, protocol.TypeThreadStop, protocol.ThreadRef{ThreadId: created.Id}, nil); err != nil {
		t.Fatal(err)
	}
	api.do("POST", "/api/threads/"+created.Id+"/prompt", map[string]string{"text": "again"}, &map[string]bool{})
	w.until("second approval", func() bool {
		return w.find("approval", func(m ThreadMessage) bool { return m.Approval.Resolved == "" }) != nil
	})
	second := w.find("approval", func(m ThreadMessage) bool { return m.Approval.Resolved == "" })
	api.do("POST", "/api/threads/"+created.Id+"/approval", map[string]string{"approvalId": second.Approval.Id, "optionId": "ok"}, &map[string]bool{})
	w.until("second reply", func() bool {
		return w.thread.Status == "idle" && w.find("assistant", func(m ThreadMessage) bool { return m.Text == "pong: again" }) != nil
	})

	var detail struct {
		Thread   Thread          `json:"thread"`
		Messages []ThreadMessage `json:"messages"`
	}
	api.do("GET", "/api/threads/"+created.Id, nil, &detail)
	if len(detail.Messages) < 8 || detail.Messages[0].Role != "user" {
		t.Errorf("history has %d messages", len(detail.Messages))
	}
	for i := 1; i < len(detail.Messages); i++ {
		if detail.Messages[i].Seq <= detail.Messages[i-1].Seq {
			t.Errorf("seq not increasing at %d", i)
		}
	}

	var patched Thread
	api.do("PATCH", "/api/threads/"+created.Id, map[string]any{"title": "Renamed", "read": true}, &patched)
	if patched.Title != "Renamed" || patched.LastReadAt < patched.UpdatedAt {
		t.Errorf("patched = %+v", patched)
	}
	var list []Thread
	api.do("GET", "/api/threads", nil, &list)
	if len(list) != 1 || list[0].Id != created.Id {
		t.Errorf("list = %+v", list)
	}
	api.do("DELETE", "/api/threads/"+created.Id, nil, &map[string]bool{})
	if code := api.do("GET", "/api/threads/"+created.Id, nil, nil); code != http.StatusNotFound {
		t.Errorf("deleted thread GET = %d", code)
	}
}

func TestDesktopTunnel(t *testing.T) {
	srv, base := startHub(t)
	deviceId := connectAgent(t, srv, base)
	token, _ := srv.store.CreateApiToken("desktop-test")
	api := apiClient{t: t, base: base, token: token}

	var probe protocol.DesktopProbeResult
	api.do("GET", "/api/devices/"+deviceId+"/desktop", nil, &probe)
	if !probe.Available && probe.Reason == "" {
		t.Errorf("unavailable desktop without a reason: %+v", probe)
	}

	// A local echo server stands in for VNC.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func() { defer conn.Close(); io.Copy(conn, conn) }()
		}
	}()
	port := ln.Addr().(*net.TCPAddr).Port
	ws := api.dial(fmt.Sprintf("/api/ws/desktop?device=%s&port=%d", deviceId, port), "binary")
	if ws.Subprotocol() != "binary" {
		t.Errorf("subprotocol = %q, want binary", ws.Subprotocol())
	}
	payload := []byte("RFB 003.008\n")
	if err := ws.WriteMessage(websocket.BinaryMessage, payload); err != nil {
		t.Fatal(err)
	}
	var got []byte
	for len(got) < len(payload) {
		ws.SetReadDeadline(time.Now().Add(5 * time.Second))
		_, data, err := ws.ReadMessage()
		if err != nil {
			t.Fatalf("reading echo: %v (got %q)", err, got)
		}
		got = append(got, data...)
	}
	if !bytes.Equal(got, payload) {
		t.Errorf("echo = %q", got)
	}

	// A closed port ends the socket with the dial error.
	ln2, _ := net.Listen("tcp", "127.0.0.1:0")
	closed := ln2.Addr().(*net.TCPAddr).Port
	ln2.Close()
	ws2 := api.dial(fmt.Sprintf("/api/ws/desktop?device=%s&port=%d", deviceId, closed))
	ws2.SetReadDeadline(time.Now().Add(10 * time.Second))
	if _, _, err := ws2.ReadMessage(); !websocket.IsCloseError(err, websocket.CloseNormalClosure) {
		t.Errorf("closed port: %v, want a close frame", err)
	}
}

func TestMcpAndAutomationsAPI(t *testing.T) {
	srv, base := startHub(t)
	deviceId := connectAgent(t, srv, base)
	token, _ := srv.store.CreateApiToken("registry-test")
	api := apiClient{t: t, base: base, token: token}

	var created protocol.McpServer
	api.do("POST", "/api/mcp-servers", map[string]any{
		"name": "files", "transport": "stdio", "command": "mcp-files", "args": []string{"--root", "/"}, "env": map[string]string{"A": "1"},
	}, &created)
	if created.Id == "" || !created.Enabled || len(created.Args) != 2 {
		t.Errorf("created = %+v", created)
	}
	if code := api.do("POST", "/api/mcp-servers", map[string]any{"name": "x", "transport": "http", "url": "ftp://no"}, nil); code != http.StatusBadRequest {
		t.Errorf("bad url: %d", code)
	}
	var builtin protocol.McpServer
	api.do("PATCH", "/api/mcp-servers/builtin", map[string]any{"enabled": true}, &builtin)
	if !builtin.Builtin || !builtin.Enabled || !strings.HasSuffix(builtin.Url, "/mcp") {
		t.Errorf("builtin = %+v", builtin)
	}
	var list []protocol.McpServer
	api.do("GET", "/api/mcp-servers", nil, &list)
	if len(list) != 2 || list[0].Id != "builtin" || list[1].Id != created.Id {
		t.Errorf("list = %+v", list)
	}
	agentSide := srv.agentMcpServers()
	if len(agentSide) != 2 || agentSide[0].Headers["Authorization"] == "" {
		t.Errorf("servers for agents = %+v", agentSide)
	}
	var patched protocol.McpServer
	api.do("PATCH", "/api/mcp-servers/"+created.Id, map[string]any{"enabled": false}, &patched)
	if patched.Enabled || patched.Command != "mcp-files" {
		t.Errorf("patched = %+v", patched)
	}
	if code := api.do("DELETE", "/api/mcp-servers/builtin", nil, nil); code != http.StatusBadRequest {
		t.Errorf("delete builtin: %d", code)
	}
	api.do("DELETE", "/api/mcp-servers/"+created.Id, nil, &map[string]bool{})

	if code := api.do("POST", "/api/automations", map[string]any{
		"name": "bad", "prompt": "x", "deviceId": deviceId, "agent": "claude", "schedule": "nope",
	}, nil); code != http.StatusBadRequest {
		t.Errorf("bad schedule: %d", code)
	}
	var auto Automation
	api.do("POST", "/api/automations", map[string]any{
		"name": "Nightly", "prompt": "say hi", "deviceId": deviceId, "agent": "acp", "command": "overseer-test-missing-agent", "cwd": t.TempDir(),
		"schedule": "0 3 * * *", "enabled": false, "model": "opus", "effort": "high", "fast": true,
	}, &auto)
	if auto.Id == "" || auto.Enabled || auto.NextRunAt <= time.Now().Unix() || auto.Access != "edits" {
		t.Errorf("automation = %+v", auto)
	}
	if auto.Model != "opus" || auto.Effort != "high" || !auto.Fast {
		t.Errorf("automation lost its model options: %+v", auto)
	}
	var run Thread
	api.do("POST", "/api/automations/"+auto.Id+"/run", nil, &run)
	if run.AutomationId != auto.Id || run.Title != "Nightly" {
		t.Errorf("run thread = %+v", run)
	}
	if run.Model != "opus" || run.Effort != "high" || !run.Fast {
		t.Errorf("run didn't carry the automation's model options: model=%q effort=%q fast=%v", run.Model, run.Effort, run.Fast)
	}
	var autos []Automation
	api.do("GET", "/api/automations", nil, &autos)
	if len(autos) != 1 || autos[0].LastThreadId != run.Id || autos[0].LastRunAt == 0 {
		t.Errorf("automations = %+v", autos)
	}

	// Scheduler: an enabled, overdue automation fires once.
	api.do("PATCH", "/api/automations/"+auto.Id, map[string]any{"enabled": true}, &auto)
	srv.store.RecordAutomationRun(auto.Id, 0, "", time.Now().Add(-time.Minute).Unix())
	srv.runDueAutomations(time.Now())
	a2, _ := srv.store.AutomationById(auto.Id)
	if a2.LastThreadId == "" || a2.LastThreadId == run.Id || a2.NextRunAt <= time.Now().Unix() {
		t.Errorf("scheduled run not recorded: %+v", a2)
	}
	api.do("DELETE", "/api/automations/"+auto.Id, nil, &map[string]bool{})
}
