package hub

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// fakeExtDevice answers extensions.* and skills.* requests through answer
// and records every request.
type fakeExtDevice struct {
	id  string
	ws  *websocket.Conn
	wmu sync.Mutex
	mu  sync.Mutex
	got []protocol.Msg
}

func connectFakeExtDevice(t *testing.T, srv *Server, base string, answer func(m protocol.Msg) (any, string)) *fakeExtDevice {
	t.Helper()
	enrollToken, _ := srv.store.CreateEnrollToken(time.Minute)
	body, _ := json.Marshal(map[string]string{"token": enrollToken, "hostname": "box", "os": "linux", "arch": "amd64"})
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
	d := &fakeExtDevice{id: er.DeviceId, ws: ws}
	hello, _ := protocol.NewMsg(protocol.TypeHello, 0, 0, protocol.Hello{Hostname: "box", OS: "linux", Arch: "amd64", Version: "test"})
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
			res, errText := answer(m)
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

func (d *fakeExtDevice) send(m protocol.Msg) {
	d.wmu.Lock()
	defer d.wmu.Unlock()
	d.ws.WriteJSON(m)
}

// count returns how many requests of typ the device got.
func (d *fakeExtDevice) count(typ string) int {
	d.mu.Lock()
	defer d.mu.Unlock()
	n := 0
	for _, m := range d.got {
		if m.Type == typ {
			n++
		}
	}
	return n
}

func (d *fakeExtDevice) last(typ string) protocol.Msg {
	d.mu.Lock()
	defer d.mu.Unlock()
	for i := len(d.got) - 1; i >= 0; i-- {
		if d.got[i].Type == typ {
			return d.got[i]
		}
	}
	return protocol.Msg{}
}

func extAnswer(m protocol.Msg) (any, string) {
	switch m.Type {
	case protocol.TypeExtList:
		var req protocol.ExtListRequest
		json.Unmarshal(m.Data, &req)
		items := []protocol.ExtItem{{Key: "claude:skill:user:a", Agent: "claude", Kind: "skill", Name: "a", QualifiedName: "a", Scope: "user"}}
		if req.Cwd != "" {
			items = append(items, protocol.ExtItem{Key: "claude:skill:project:p", Agent: "claude", Kind: "skill", Name: "p", QualifiedName: "p",
				Scope: "project", ProjectPath: req.Cwd})
		}
		return protocol.ExtListResult{Items: items, Agents: []protocol.ExtAgentStatus{{Agent: "claude", Ok: true}}, FetchedAt: time.Now().Unix()}, ""
	case protocol.TypeExtItem:
		return protocol.ExtItemResult{Item: protocol.ExtItem{Key: "claude:skill:user:a"}, Content: "---\nname: a\n---\n"}, ""
	case protocol.TypeExtToggle:
		on := true
		return protocol.ExtChangeResult{Item: &protocol.ExtItem{Key: "claude:skill:user:a", Enabled: &on}, Note: "Takes effect in new sessions"}, ""
	case protocol.TypeExtInstall:
		var req protocol.ExtInstallRequest
		json.Unmarshal(m.Data, &req)
		if req.AcceptCommand == "" {
			return protocol.ExtChangeResult{NeedsApproval: &protocol.ExtApproval{Command: "sh -c x", Sha: strings.Repeat("ab", 32)}}, ""
		}
		return protocol.ExtChangeResult{Item: &protocol.ExtItem{Key: "claude:plugin:user:p%40m"}, Note: "ok"}, ""
	case protocol.TypeExtUninstall:
		return protocol.ExtChangeResult{Ok: true}, ""
	case protocol.TypeExtCatalog:
		return protocol.ExtCatalogResult{Entries: []protocol.ExtCatalogEntry{{Id: "p@m", Name: "p", Installed: true}}}, ""
	case protocol.TypeSkillCreate:
		var req protocol.SkillCreateRequest
		json.Unmarshal(m.Data, &req)
		if req.Name == "taken" {
			return nil, "a skill named taken already exists in /home/you/.agents/skills"
		}
		return protocol.ExtChangeResult{Item: &protocol.ExtItem{Key: "claude:skill:user:" + req.Name}}, ""
	case protocol.TypeSkillShare:
		return protocol.ExtChangeResult{Item: &protocol.ExtItem{Key: "claude:skill:user:a", SharedWith: []string{"codex"}}}, ""
	}
	return nil, "unsupported request " + m.Type
}

func TestExtensionsEndpoints(t *testing.T) {
	noAgentCLIs(t)
	srv, base := startHub(t)
	token, _ := srv.store.CreateApiToken("ext-test")
	api := apiClient{t: t, base: base, token: token}
	dev := connectFakeExtDevice(t, srv, base, extAnswer)
	p := "/api/devices/" + dev.id

	// Cached per device+cwd for a minute; the catalog's agents are sent.
	var res protocol.ExtListResult
	api.do("GET", p+"/extensions", nil, &res)
	if len(res.Items) != 1 || res.Agents[0].Agent != "claude" {
		t.Fatalf("list = %+v", res)
	}
	var req protocol.ExtListRequest
	json.Unmarshal(dev.last(protocol.TypeExtList).Data, &req)
	if len(req.Detect) == 0 || req.Cwd != "" {
		t.Errorf("request = %+v", req)
	}
	api.do("GET", p+"/extensions", nil, &res)
	if n := dev.count(protocol.TypeExtList); n != 1 {
		t.Fatalf("cached read asked the device: %d", n)
	}
	api.do("GET", p+"/extensions?cwd=/srv/app", nil, &res)
	if len(res.Items) != 2 || dev.count(protocol.TypeExtList) != 2 {
		t.Fatalf("cwd read = %+v (%d)", res, dev.count(protocol.TypeExtList))
	}
	api.do("GET", p+"/extensions?cwd=/srv/app&refresh=1", nil, &res)
	if dev.count(protocol.TypeExtList) != 3 {
		t.Fatal("refresh did not ask the device")
	}
	api.do("GET", p+"/extensions?cwd=/srv/app", nil, &res)
	if dev.count(protocol.TypeExtList) != 3 {
		t.Fatal("refresh result not cached")
	}
	// The TTL passes.
	srv.extensions.mu.Lock()
	for k, e := range srv.extensions.entries {
		if strings.HasSuffix(k, "\x00") {
			e.at = time.Now().Add(-extListTTL)
			srv.extensions.entries[k] = e
		}
	}
	srv.extensions.mu.Unlock()
	api.do("GET", p+"/extensions", nil, &res)
	if dev.count(protocol.TypeExtList) != 4 {
		t.Fatal("stale entry served")
	}

	// A write invalidates every cwd of the device.
	post := func(path string, body any) protocol.ExtChangeResult {
		var out protocol.ExtChangeResult
		api.do("POST", path, body, &out)
		return out
	}
	var change protocol.ExtChangeResult
	change = post(p+"/extensions/toggle", map[string]any{"key": "claude:skill:user:a", "enabled": false})
	if change.Item == nil || change.Note == "" {
		t.Fatalf("toggle = %+v", change)
	}
	api.do("GET", p+"/extensions", nil, &res)
	api.do("GET", p+"/extensions?cwd=/srv/app", nil, &res)
	if n := dev.count(protocol.TypeExtList); n != 6 {
		t.Fatalf("after toggle the device was asked %d times, want 6", n)
	}

	// Item detail passes the key through.
	var item protocol.ExtItemResult
	api.do("GET", p+"/extensions/item?key=claude%3Askill%3Auser%3Aa", nil, &item)
	var kr protocol.ExtKeyRequest
	json.Unmarshal(dev.last(protocol.TypeExtItem).Data, &kr)
	if item.Content == "" || kr.Key != "claude:skill:user:a" {
		t.Errorf("item = %+v, key %q", item, kr.Key)
	}

	// Install: needsApproval does not invalidate; the approved call does.
	change = post(p+"/extensions/install", map[string]any{"agent": "claude", "id": "p@m", "scope": "user"})
	if change.NeedsApproval == nil || change.NeedsApproval.Sha == "" || change.Item != nil {
		t.Fatalf("install = %+v", change)
	}
	before := dev.count(protocol.TypeExtList)
	api.do("GET", p+"/extensions", nil, &res)
	if dev.count(protocol.TypeExtList) != before {
		t.Error("needsApproval invalidated the cache")
	}
	change = post(p+"/extensions/install", map[string]any{"agent": "claude", "id": "p@m", "scope": "user", "acceptCommand": change.NeedsApproval.Sha})
	if change.Item == nil || change.NeedsApproval != nil {
		t.Fatalf("approved install = %+v", change)
	}
	var ir protocol.ExtInstallRequest
	json.Unmarshal(dev.last(protocol.TypeExtInstall).Data, &ir)
	if ir.AcceptCommand != strings.Repeat("ab", 32) {
		t.Errorf("acceptCommand not passed: %+v", ir)
	}
	api.do("GET", p+"/extensions", nil, &res)
	if dev.count(protocol.TypeExtList) != before+1 {
		t.Error("install did not invalidate the cache")
	}

	change = post(p+"/extensions/uninstall", map[string]any{"key": "claude:plugin:user:p%40m"})
	if !change.Ok {
		t.Errorf("uninstall = %+v", change)
	}
	var cat protocol.ExtCatalogResult
	api.do("GET", p+"/extensions/catalog?agent=claude&q=p", nil, &cat)
	if len(cat.Entries) != 1 || !cat.Entries[0].Installed {
		t.Errorf("catalog = %+v", cat)
	}
	change = post(p+"/skills", map[string]any{"name": "notes", "description": "Notes", "scope": "user", "agents": []string{"claude", "codex"}})
	if change.Item == nil || change.Item.Key != "claude:skill:user:notes" {
		t.Errorf("create = %+v", change)
	}
	change = post(p+"/skills/share", map[string]any{"key": "claude:skill:user:a", "agents": []string{"codex"}})
	if change.Item == nil || len(change.Item.SharedWith) != 1 {
		t.Errorf("share = %+v", change)
	}

	// Conflicts and validation.
	if code := api.do("POST", p+"/skills", map[string]any{"name": "taken", "description": "x", "scope": "user", "agents": []string{"claude"}}, nil); code != http.StatusConflict {
		t.Errorf("conflict = %d", code)
	}
	bad := []struct {
		method, path string
		body         any
	}{
		{"POST", "/extensions/toggle", map[string]any{"key": "k"}},
		{"POST", "/extensions/toggle", map[string]any{"enabled": true}},
		{"POST", "/extensions/uninstall", map[string]any{}},
		{"POST", "/extensions/install", map[string]any{"agent": "gemini", "id": "p@m", "scope": "user"}},
		{"POST", "/extensions/install", map[string]any{"agent": "claude", "id": "p@m; rm -rf ~", "scope": "user"}},
		{"POST", "/extensions/install", map[string]any{"agent": "claude", "id": "--yes", "scope": "user"}},
		{"POST", "/extensions/install", map[string]any{"agent": "claude", "id": "p@m", "scope": "project"}},
		{"POST", "/extensions/install", map[string]any{"agent": "claude", "id": "p@m", "scope": "user", "acceptCommand": "yes"}},
		{"POST", "/skills", map[string]any{"name": "Bad Name", "description": "x", "scope": "user", "agents": []string{"claude"}}},
		{"POST", "/skills", map[string]any{"name": "ok", "description": "", "scope": "user", "agents": []string{"claude"}}},
		{"POST", "/skills", map[string]any{"name": "ok", "description": "x", "scope": "project", "agents": []string{"claude"}}},
		{"POST", "/skills", map[string]any{"name": "ok", "description": "x", "scope": "user", "agents": []string{}}},
		{"POST", "/skills/share", map[string]any{"key": "k", "agents": []string{"../x"}}},
		{"GET", "/extensions/catalog?agent=devin", nil},
		{"GET", "/extensions/item", nil},
	}
	writes := dev.count(protocol.TypeExtInstall) + dev.count(protocol.TypeSkillCreate) + dev.count(protocol.TypeExtToggle)
	for _, b := range bad {
		if code := api.do(b.method, p+b.path, b.body, nil); code != http.StatusBadRequest {
			t.Errorf("%s %s %v = %d, want 400", b.method, b.path, b.body, code)
		}
	}
	if n := dev.count(protocol.TypeExtInstall) + dev.count(protocol.TypeSkillCreate) + dev.count(protocol.TypeExtToggle); n != writes {
		t.Error("an invalid request reached the device")
	}

	// Authentication is required for every route.
	for _, path := range []string{"/extensions", "/extensions/item?key=k", "/extensions/catalog?agent=claude"} {
		resp, _ := http.Get(base + p + path)
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("GET %s without auth = %d", path, resp.StatusCode)
		}
		resp.Body.Close()
	}
	for _, path := range []string{"/extensions/toggle", "/extensions/uninstall", "/extensions/install", "/skills", "/skills/share"} {
		resp, _ := http.Post(base+p+path, "application/json", strings.NewReader(`{"key":"k","enabled":true}`))
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("POST %s without auth = %d", path, resp.StatusCode)
		}
		resp.Body.Close()
	}

	// Unknown and offline devices.
	if code := api.do("GET", "/api/devices/nope/extensions", nil, nil); code != http.StatusNotFound {
		t.Errorf("unknown device = %d", code)
	}
	dev.ws.Close()
	deadline := time.Now().Add(5 * time.Second)
	for srv.registry.get(dev.id) != nil && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if code := api.do("GET", p+"/extensions?refresh=1", nil, nil); code != http.StatusServiceUnavailable {
		t.Errorf("offline device = %d", code)
	}
	if code := api.do("POST", p+"/extensions/toggle", map[string]any{"key": "k", "enabled": true}, nil); code != http.StatusServiceUnavailable {
		t.Errorf("offline toggle = %d", code)
	}
}

// An older device agent that doesn't know the requests gets a clear error,
// and a failed read is not cached.
func TestExtensionsOldDevice(t *testing.T) {
	noAgentCLIs(t)
	srv, base := startHub(t)
	token, _ := srv.store.CreateApiToken("ext-old")
	dev := connectFakeExtDevice(t, srv, base, func(m protocol.Msg) (any, string) {
		return nil, "unsupported request \"" + m.Type + "\""
	})
	for i := 0; i < 2; i++ {
		req, _ := http.NewRequest("GET", base+"/api/devices/"+dev.id+"/extensions", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		var body map[string]string
		json.NewDecoder(resp.Body).Decode(&body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadGateway || !strings.Contains(body["error"], "too old") {
			t.Errorf("old device = %d %v", resp.StatusCode, body)
		}
	}
	if n := dev.count(protocol.TypeExtList); n != 2 {
		t.Errorf("failed read was cached (%d asks)", n)
	}
}
