package hub

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// fakeLoginDevice speaks the agent protocol: it reports agents from its
// detections, keeps a Codex auth.json, and records the login.* requests.
type fakeLoginDevice struct {
	t   *testing.T
	id  string
	ws  *websocket.Conn
	wmu sync.Mutex

	mu       sync.Mutex
	agents   []protocol.AgentInfo
	authJSON string // "" = Codex keeps it in the keychain
	got      []protocol.Msg
}

func connectFakeLoginDevice(t *testing.T, srv *Server, base, hostname string, agents []protocol.AgentInfo) *fakeLoginDevice {
	t.Helper()
	enrollToken, err := srv.store.CreateEnrollToken(time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]string{"token": enrollToken, "hostname": hostname, "os": "linux", "arch": "amd64"})
	resp, err := http.Post(base+"/api/enroll", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	var er struct {
		DeviceId    string `json:"deviceId"`
		DeviceToken string `json:"deviceToken"`
	}
	json.NewDecoder(resp.Body).Decode(&er)
	resp.Body.Close()
	ws, _, err := websocket.DefaultDialer.Dial(strings.Replace(base, "http://", "ws://", 1)+"/api/ws/agent",
		http.Header{"Authorization": {"Bearer " + er.DeviceToken}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ws.Close() })
	d := &fakeLoginDevice{t: t, id: er.DeviceId, ws: ws, agents: agents}
	hello, _ := protocol.NewMsg(protocol.TypeHello, 0, 0, protocol.Hello{Hostname: hostname, OS: "linux", Arch: "amd64", Version: "test"})
	d.send(hello)
	var welcome protocol.Msg
	if err := ws.ReadJSON(&welcome); err != nil || welcome.Type != protocol.TypeWelcome {
		t.Fatalf("welcome: %+v %v", welcome, err)
	}
	go func() {
		for {
			var m protocol.Msg
			if err := ws.ReadJSON(&m); err != nil {
				return
			}
			if m.Id == 0 {
				continue
			}
			d.mu.Lock()
			d.got = append(d.got, m)
			d.mu.Unlock()
			res, errText := d.answer(m)
			reply, _ := protocol.NewMsg(protocol.TypeResult, m.Id, 0, res)
			reply.Error = errText
			d.send(reply)
		}
	}()
	deadline := time.Now().Add(5 * time.Second)
	for srv.registry.get(d.id) == nil {
		if time.Now().After(deadline) {
			t.Fatal("fake device never registered")
		}
		time.Sleep(10 * time.Millisecond)
	}
	return d
}

func (d *fakeLoginDevice) answer(m protocol.Msg) (any, string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	switch m.Type {
	case protocol.TypeAgentsDetect:
		return protocol.AgentsDetectResult{Agents: d.agents}, ""
	case protocol.TypeLoginRead:
		if d.authJSON == "" {
			return nil, "Codex on this machine keeps its sign-in in the system keychain, or isn't signed in."
		}
		return protocol.LoginReadResult{Secret: d.authJSON}, ""
	case protocol.TypeLoginApply:
		var req protocol.LoginApplyRequest
		json.Unmarshal(m.Data, &req)
		// Signed in from now on.
		for i := range d.agents {
			if d.agents[i].Id == req.Agent {
				d.agents[i].Auth = "ok"
			}
		}
		return protocol.LoginApplyResult{Sha256: hashToken(req.Secret)}, ""
	case protocol.TypeLoginRemove:
		return protocol.LoginRemoveResult{Removed: true}, ""
	}
	return nil, "unsupported request " + m.Type
}

func (d *fakeLoginDevice) send(m protocol.Msg) {
	d.wmu.Lock()
	defer d.wmu.Unlock()
	d.ws.WriteJSON(m)
}

func (d *fakeLoginDevice) requests(typ string) []protocol.Msg {
	d.mu.Lock()
	defer d.mu.Unlock()
	var out []protocol.Msg
	for _, m := range d.got {
		if m.Type == typ {
			out = append(out, m)
		}
	}
	return out
}

func claudeInfo(auth string) []protocol.AgentInfo {
	return []protocol.AgentInfo{{Id: "claude", Installed: true, Version: "2.0.0", Auth: auth}}
}

var testClaudeToken = "sk-ant-oat01-" + strings.Repeat("Ab3", 30)

func testJWT(claims string) string {
	enc := base64.RawURLEncoding.EncodeToString
	return enc([]byte(`{"alg":"none"}`)) + "." + enc([]byte(claims)) + ".sig"
}

func TestValidateClaudeToken(t *testing.T) {
	for _, c := range []struct {
		in string
		ok bool
	}{
		{testClaudeToken, true},
		{"  " + testClaudeToken + "\n", true},
		{"", false},
		{"   ", false},
		{"sk-ant-api03-" + strings.Repeat("x", 40), false}, // an API key, not a setup-token
		{"sk-ant-oat01-short", false},
		{"sk-ant-oat01-" + strings.Repeat("x", 600), false},
		{"sk-ant-oat01-" + strings.Repeat("x", 20) + " " + strings.Repeat("x", 20), false},
		{"sk-ant-oat01-" + strings.Repeat("x", 20) + "\n" + strings.Repeat("x", 20), false},
	} {
		got, err := validateClaudeToken(c.in)
		if (err == nil) != c.ok {
			t.Errorf("validateClaudeToken(%.30q): err = %v, want ok=%v", c.in, err, c.ok)
		}
		if err == nil && got != strings.TrimSpace(c.in) {
			t.Errorf("not trimmed: %q", got)
		}
		if err != nil && strings.Contains(err.Error(), c.in) && c.in != "" && strings.TrimSpace(c.in) != "" {
			t.Errorf("the error echoes the token: %v", err)
		}
	}
}

func TestCodexAuthAccount(t *testing.T) {
	for _, c := range []struct {
		name, in, account string
		ok                bool
	}{
		{"email claim", `{"OPENAI_API_KEY":null,"tokens":{"id_token":"` + testJWT(`{"email":"me@example.com","sub":"x"}`) + `","access_token":"a"}}`, "me@example.com", true},
		{"profile claim", `{"tokens":{"id_token":"` + testJWT(`{"https://api.openai.com/profile":{"email":"p@example.com"}}`) + `"}}`, "p@example.com", true},
		{"padded payload", `{"tokens":{"id_token":"x.` + base64.URLEncoding.EncodeToString([]byte(`{"email":"pad@example.com"}`)) + `.y"}}`, "pad@example.com", true},
		{"no email", `{"tokens":{"id_token":"` + testJWT(`{"sub":"x"}`) + `"}}`, "", true},
		{"garbage id token", `{"tokens":{"id_token":"not-a-jwt"}}`, "", true},
		{"api key only", `{"OPENAI_API_KEY":"sk-proj-x"}`, "", true},
		{"signed out", `{"OPENAI_API_KEY":null}`, "", false},
		{"empty key", `{"OPENAI_API_KEY":""}`, "", false},
		{"tokens not an object", `{"tokens":"x"}`, "", false},
		{"not json", `hello`, "", false},
	} {
		account, err := codexAuthAccount(c.in)
		if (err == nil) != c.ok || account != c.account {
			t.Errorf("%s: (%q, %v), want (%q, ok=%v)", c.name, account, err, c.account, c.ok)
		}
	}
}

// sharedEnv is a hub with an owner and the automatic pass made quick.
func sharedEnv(t *testing.T) *teamEnv {
	e := newTeamEnv(t)
	e.srv.sharedLogins.autoDelay = 20 * time.Millisecond
	return e
}

type sharedApplyBody struct {
	Results []sharedLoginResult `json:"results"`
	Items   []sharedLoginItem   `json:"items"`
}

func TestSharedLoginsHTTP(t *testing.T) {
	e := sharedEnv(t)
	codexAuth := `{"OPENAI_API_KEY":null,"tokens":{"id_token":"` + testJWT(`{"email":"dev@example.com"}`) +
		`","access_token":"codex-access-secret","refresh_token":"codex-refresh-secret"}}`
	secrets := []string{testClaudeToken, "codex-access-secret", "codex-refresh-secret"}
	var bodies []string
	do := func(method, path string, body any) (int, string) {
		t.Helper()
		st, b := e.do(e.owner, method, path, body)
		bodies = append(bodies, b)
		return st, b
	}

	st, body := do("GET", "/api/shared-logins", nil)
	if st != 200 || strings.TrimSpace(body) != `{"items":[]}` {
		t.Fatalf("empty list: %d %s", st, body)
	}

	// Claude: a pasted token.
	if st, body := do("POST", "/api/shared-logins", map[string]string{"agent": "claude", "token": "sk-ant-api03-nope"}); st != 400 || !strings.Contains(body, "setup-token") {
		t.Fatalf("bad token: %d %s", st, body)
	}
	if st, _ := do("POST", "/api/shared-logins", map[string]string{"agent": "gemini", "token": testClaudeToken}); st != 400 {
		t.Fatalf("other agent: %d", st)
	}
	st, body = do("POST", "/api/shared-logins", map[string]string{"agent": "claude", "token": " " + testClaudeToken + " "})
	if st != 200 {
		t.Fatalf("share claude: %d %s", st, body)
	}
	list := decode[sharedLoginsBody](e, body)
	if len(list.Items) != 1 {
		t.Fatalf("items: %s", body)
	}
	cl := list.Items[0]
	if cl.Agent != "claude" || cl.Name != "Claude Code" || cl.Kind != "oauth-token" || cl.Account != "" || cl.SourceDevice != "" ||
		cl.Auto || cl.CreatedAt == 0 || cl.ExpiresAt != cl.CreatedAt+365*24*3600 || cl.Applied == nil {
		t.Fatalf("claude item: %+v", cl)
	}
	if !strings.Contains(body, `"applied":[]`) {
		t.Fatalf("applied must be [] not null: %s", body)
	}
	if stored, _ := e.srv.store.SharedLogin("claude"); stored == nil || stored.Secret != testClaudeToken {
		t.Fatal("token not stored trimmed")
	}

	// Codex: captured from a signed-in machine.
	laptop := connectFakeLoginDevice(t, e.srv, e.ts.URL, "laptop", []protocol.AgentInfo{{Id: "codex", Installed: true, Auth: "ok"}})
	laptop.mu.Lock()
	laptop.authJSON = codexAuth
	laptop.mu.Unlock()
	keychain := connectFakeLoginDevice(t, e.srv, e.ts.URL, "keychain-box", nil)
	if st, body := do("POST", "/api/shared-logins", map[string]string{"agent": "codex", "deviceId": keychain.id}); st != 400 || !strings.Contains(body, "keychain") {
		t.Fatalf("keychain device: %d %s", st, body)
	}
	if st, _ := do("POST", "/api/shared-logins", map[string]string{"agent": "codex", "deviceId": "nope"}); st != 404 {
		t.Fatalf("unknown device: %d", st)
	}
	st, body = do("POST", "/api/shared-logins", map[string]string{"agent": "codex", "deviceId": laptop.id})
	if st != 200 {
		t.Fatalf("share codex: %d %s", st, body)
	}
	list = decode[sharedLoginsBody](e, body)
	if len(list.Items) != 2 || list.Items[1].Agent != "codex" {
		t.Fatalf("items: %s", body)
	}
	cx := list.Items[1]
	if cx.Kind != "auth-file" || cx.Account != "dev@example.com" || cx.SourceDevice != "laptop" || cx.ExpiresAt != 0 {
		t.Fatalf("codex item: %+v", cx)
	}

	// Apply Claude: one signed out, one signed in, one offline.
	out := connectFakeLoginDevice(t, e.srv, e.ts.URL, "signed-out-box", claudeInfo("signed-out"))
	in := connectFakeLoginDevice(t, e.srv, e.ts.URL, "signed-in-box", claudeInfo("ok"))
	offlineId, _, _ := e.srv.store.CreateDevice("offline-box", "offline-box", "linux", "amd64", false)
	if st, _ := do("POST", "/api/shared-logins/claude/apply", map[string]any{"deviceIds": []string{out.id, "nope"}}); st != 404 {
		t.Fatalf("unknown device: %d", st)
	}
	if len(out.requests(protocol.TypeLoginApply)) != 0 {
		t.Fatal("applied before the request was validated")
	}
	if st, _ := do("POST", "/api/shared-logins/gemini/apply", map[string]any{"deviceIds": []string{out.id}}); st != 400 {
		t.Fatalf("other agent: %d", st)
	}
	if st, _ := do("POST", "/api/shared-logins/claude/apply", map[string]any{"deviceIds": []string{}}); st != 400 {
		t.Fatalf("no devices: %d", st)
	}
	st, body = do("POST", "/api/shared-logins/claude/apply", map[string]any{"deviceIds": []string{out.id, in.id, offlineId}, "replace": false})
	if st != 200 {
		t.Fatalf("apply: %d %s", st, body)
	}
	ab := decode[sharedApplyBody](e, body)
	want := []sharedLoginResult{
		{out.id, "signed-out-box", "ok", ""},
		{in.id, "signed-in-box", "skipped", "Already signed in"},
		{offlineId, "offline-box", "failed", "Offline"},
	}
	if len(ab.Results) != 3 {
		t.Fatalf("results: %s", body)
	}
	for i, w := range want {
		if ab.Results[i] != w {
			t.Errorf("result %d = %+v, want %+v", i, ab.Results[i], w)
		}
	}
	applies := out.requests(protocol.TypeLoginApply)
	if len(applies) != 1 {
		t.Fatalf("signed-out device got %d applies", len(applies))
	}
	var req protocol.LoginApplyRequest
	json.Unmarshal(applies[0].Data, &req)
	if req.Agent != "claude" || req.Secret != testClaudeToken || req.Replaces != "" {
		t.Fatalf("apply request: agent=%s replaces=%q", req.Agent, req.Replaces)
	}
	if len(in.requests(protocol.TypeLoginApply)) != 0 {
		t.Fatal("a signed-in device was overwritten")
	}
	// The detections were refreshed after the apply.
	if n := len(out.requests(protocol.TypeAgentsDetect)); n < 2 {
		t.Fatalf("detections not refreshed: %d", n)
	}
	if a, _ := e.srv.deviceAgents(e.srv.registry.get(out.id), false); a[0].Auth != "ok" {
		t.Fatalf("cached detection still %q", a[0].Auth)
	}
	if len(ab.Items) != 2 || len(ab.Items[0].Applied) != 1 || ab.Items[0].Applied[0].DeviceName != "signed-out-box" ||
		ab.Items[0].Applied[0].State != "ok" || ab.Items[0].Applied[0].AppliedAt == 0 {
		t.Fatalf("items after apply: %+v", ab.Items)
	}

	// Replace overrides a working sign-in, and says what it replaces.
	st, body = do("POST", "/api/shared-logins/claude/apply", map[string]any{"deviceIds": []string{in.id, out.id}, "replace": true})
	ab = decode[sharedApplyBody](e, body)
	if st != 200 || ab.Results[0].State != "ok" || ab.Results[1].State != "ok" {
		t.Fatalf("replace: %d %s", st, body)
	}
	applies = out.requests(protocol.TypeLoginApply)
	json.Unmarshal(applies[len(applies)-1].Data, &req)
	if req.Replaces != hashToken(testClaudeToken) {
		t.Fatalf("second apply replaces %q", req.Replaces)
	}

	// Auto on and off.
	if st, _ := do("PUT", "/api/shared-logins/claude", map[string]any{}); st != 400 {
		t.Fatalf("missing auto: %d", st)
	}
	st, body = do("PUT", "/api/shared-logins/claude", map[string]any{"auto": true})
	if st != 200 || !decode[sharedLoginsBody](e, body).Items[0].Auto {
		t.Fatalf("auto: %d %s", st, body)
	}

	// Delete, taking it off the machines it went to.
	st, body = do("DELETE", "/api/shared-logins/claude?devices=1", nil)
	if st != 200 {
		t.Fatalf("delete: %d %s", st, body)
	}
	if items := decode[sharedLoginsBody](e, body).Items; len(items) != 1 || items[0].Agent != "codex" {
		t.Fatalf("after delete: %s", body)
	}
	for _, d := range []*fakeLoginDevice{out, in} {
		rm := d.requests(protocol.TypeLoginRemove)
		if len(rm) != 1 {
			t.Fatalf("%s got %d removes", d.id, len(rm))
		}
		var r protocol.LoginRemoveRequest
		json.Unmarshal(rm[0].Data, &r)
		if r.Agent != "claude" || r.Sha256 != hashToken(testClaudeToken) {
			t.Fatalf("remove request: %+v", r)
		}
	}
	if len(laptop.requests(protocol.TypeLoginRemove)) != 0 {
		t.Fatal("remove sent to a machine it was never applied to")
	}
	// Without devices=1 the machines are left alone.
	do("DELETE", "/api/shared-logins/codex", nil)
	if len(laptop.requests(protocol.TypeLoginRemove)) != 0 {
		t.Fatal("remove sent without devices=1")
	}
	if st, body := do("GET", "/api/shared-logins", nil); st != 200 || strings.TrimSpace(body) != `{"items":[]}` {
		t.Fatalf("final list: %s", body)
	}

	// The secrets are in no response and no activity log entry.
	entries, _ := e.srv.store.AuditPage(0, 200)
	actions := map[string]bool{}
	for _, en := range entries {
		actions[en.Action] = true
		bodies = append(bodies, en.Target+" "+en.Detail)
	}
	for _, a := range []string{"login.share", "login.share.apply", "login.share.auto", "login.share.delete"} {
		if !actions[a] {
			t.Errorf("no %s in the activity log", a)
		}
	}
	for _, b := range bodies {
		for _, sec := range secrets {
			if strings.Contains(b, sec) {
				t.Fatalf("a secret leaked: %.200s", b)
			}
		}
	}
}

func TestSharedLoginsMembersLockedOut(t *testing.T) {
	e := sharedEnv(t)
	e.do(e.owner, "POST", "/api/shared-logins", map[string]string{"agent": "claude", "token": testClaudeToken})
	sam := e.join("Sam", "sams-password-1")
	if st, body := e.do(sam, "GET", "/api/shared-logins", nil); st != 403 || strings.Contains(body, testClaudeToken) {
		t.Fatalf("member list: %d %s", st, body)
	}
	if st, _ := e.do(sam, "POST", "/api/shared-logins", map[string]string{"agent": "claude", "token": testClaudeToken}); st != 403 {
		t.Fatalf("member share: %d", st)
	}
}

func TestSharedLoginAutoApply(t *testing.T) {
	e := sharedEnv(t)
	e.do(e.owner, "POST", "/api/shared-logins", map[string]string{"agent": "claude", "token": testClaudeToken})

	// Auto off: a signed-out machine that connects gets nothing.
	before := connectFakeLoginDevice(t, e.srv, e.ts.URL, "before", claudeInfo("signed-out"))
	time.Sleep(100 * time.Millisecond) // its connect-time pass has looked and found nothing on auto
	if st, _ := e.do(e.owner, "PUT", "/api/shared-logins/claude", map[string]bool{"auto": true}); st != 200 {
		t.Fatal("auto on")
	}

	out := connectFakeLoginDevice(t, e.srv, e.ts.URL, "fresh", claudeInfo("signed-out"))
	in := connectFakeLoginDevice(t, e.srv, e.ts.URL, "working", claudeInfo("ok"))
	unknown := connectFakeLoginDevice(t, e.srv, e.ts.URL, "unknown", claudeInfo(""))
	missing := connectFakeLoginDevice(t, e.srv, e.ts.URL, "no-claude", []protocol.AgentInfo{{Id: "claude"}})

	waitFor(t, "the automatic apply", func() bool { return len(out.requests(protocol.TypeLoginApply)) == 1 })
	for _, d := range []*fakeLoginDevice{in, unknown, missing} {
		waitFor(t, "detections", func() bool { return len(d.requests(protocol.TypeAgentsDetect)) > 0 })
	}
	time.Sleep(100 * time.Millisecond)
	for _, d := range []*fakeLoginDevice{before, in, unknown, missing} {
		if n := len(d.requests(protocol.TypeLoginApply)); n != 0 {
			t.Errorf("%s got %d automatic applies", d.id, n)
		}
	}
	waitFor(t, "the record", func() bool {
		r, _ := e.srv.store.SharedLoginDevice("claude", out.id)
		return r != nil && r.State == "ok" && r.Sha256 == hashToken(testClaudeToken)
	})

	// Only once: another pass (a reconnect) leaves it alone, even signed out again.
	out.mu.Lock()
	out.agents = claudeInfo("signed-out")
	out.mu.Unlock()
	e.srv.agents.devMu.Lock()
	delete(e.srv.agents.devDetects, out.id)
	e.srv.agents.devMu.Unlock()
	e.srv.autoApplySharedLogins(e.srv.registry.get(out.id))
	if n := len(out.requests(protocol.TypeLoginApply)); n != 1 {
		t.Fatalf("applied %d times", n)
	}

	// The automatic apply is in the activity log, without the token.
	entries, _ := e.srv.store.AuditPage(0, 50)
	found := false
	for _, en := range entries {
		if en.Action == "login.share.apply" && en.Actor == "Overseer" && strings.Contains(en.Target, "fresh") {
			found = true
		}
		if strings.Contains(en.Target+en.Detail, testClaudeToken) {
			t.Fatal("token in the activity log")
		}
	}
	if !found {
		t.Fatalf("no automatic entry: %+v", entries)
	}
}
