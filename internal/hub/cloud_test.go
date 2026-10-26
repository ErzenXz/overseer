package hub

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"
)

const canaryToken = "canary-provider-token-0123456789abcdef"

// fakeCloud is a stand-in for a provider's REST API: it records every call
// and keeps the servers and firewalls it was asked to create.
type fakeCloud struct {
	t   *testing.T
	srv *httptest.Server

	mu          sync.Mutex
	calls       []string
	bodies      map[string]map[string]any // "METHOD path" -> last JSON body
	servers     map[string]string         // id -> status
	firewalls   map[string]bool
	failCreate  string // when set, POST /servers (or /droplets) fails with this message
	nextID      int
	tokenSeen   map[string]bool
	rejectToken bool
}

func newFakeCloud(t *testing.T, kind string) *fakeCloud {
	f := &fakeCloud{t: t, bodies: map[string]map[string]any{}, servers: map[string]string{}, firewalls: map[string]bool{}, tokenSeen: map[string]bool{}, nextID: 100}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.tokenSeen[strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")] = true
		key := r.Method + " " + r.URL.Path
		f.calls = append(f.calls, key)
		var body map[string]any
		if r.Body != nil {
			b, _ := io.ReadAll(r.Body)
			if len(b) > 0 {
				json.Unmarshal(b, &body)
				f.bodies[key] = body
			}
		}
		if f.rejectToken {
			f.write(w, kind, 401, "", "Unable to authenticate you")
			return
		}
		if kind == "hetzner" {
			f.hetzner(w, r, key)
		} else {
			f.digitalocean(w, r, key)
		}
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeCloud) write(w http.ResponseWriter, kind string, status int, body, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if body != "" {
		io.WriteString(w, body)
		return
	}
	if kind == "hetzner" {
		fmt.Fprintf(w, `{"error":{"code":"x","message":%q}}`, msg)
	} else {
		fmt.Fprintf(w, `{"id":"x","message":%q}`, msg)
	}
}

func (f *fakeCloud) id() string { f.nextID++; return fmt.Sprint(f.nextID) }

func (f *fakeCloud) hetzner(w http.ResponseWriter, r *http.Request, key string) {
	p := r.URL.Path
	switch {
	case key == "GET /locations":
		f.write(w, "hetzner", 200, `{"locations":[{"name":"nbg1","city":"Nuremberg","country":"DE"},{"name":"fsn1","city":"Falkenstein","country":"DE"},{"name":"ash","city":"Ashburn, VA","country":"US"}]}`, "")
	case key == "GET /server_types":
		f.write(w, "hetzner", 200, `{"server_types":[
			{"name":"cx22","cores":2,"memory":4,"disk":40,"cpu_type":"shared","architecture":"x86","deprecated":false,"prices":[{"location":"fsn1","price_monthly":{"gross":"4.5900"}},{"location":"nbg1","price_monthly":{"gross":"4.5900"}}]},
			{"name":"cx32","cores":4,"memory":8,"disk":80,"cpu_type":"shared","architecture":"x86","deprecated":false,"prices":[{"location":"fsn1","price_monthly":{"gross":"7.5900"}}]},
			{"name":"cpx11","cores":2,"memory":2,"disk":40,"cpu_type":"shared","architecture":"x86","deprecated":false,"prices":[{"location":"ash","price_monthly":{"gross":"5.0000"}}]},
			{"name":"cpx21","cores":3,"memory":4,"disk":80,"cpu_type":"shared","architecture":"x86","deprecated":false,"prices":[{"location":"ash","price_monthly":{"gross":"9.9000"}}]},
			{"name":"cax11","cores":2,"memory":4,"disk":40,"cpu_type":"shared","architecture":"arm","deprecated":false,"prices":[{"location":"fsn1","price_monthly":{"gross":"3.7900"}}]},
			{"name":"ccx13","cores":2,"memory":8,"disk":80,"cpu_type":"dedicated","architecture":"x86","deprecated":false,"prices":[{"location":"fsn1","price_monthly":{"gross":"12.9900"}}]},
			{"name":"cx11","cores":1,"memory":2,"disk":20,"cpu_type":"shared","architecture":"x86","deprecated":true,"prices":[{"location":"fsn1","price_monthly":{"gross":"3.0000"}}]}
		]}`, "")
	case key == "POST /firewalls":
		id := f.id()
		f.firewalls[id] = true
		f.write(w, "hetzner", 201, fmt.Sprintf(`{"firewall":{"id":%s}}`, id), "")
	case key == "POST /servers":
		if f.failCreate != "" {
			f.write(w, "hetzner", 422, "", f.failCreate)
			return
		}
		id := f.id()
		f.servers[id] = "initializing"
		f.write(w, "hetzner", 201, fmt.Sprintf(`{"server":{"id":%s,"status":"initializing","public_net":{"ipv4":{"ip":"203.0.113.9"}}},"root_password":null}`, id), "")
	case strings.HasPrefix(p, "/servers/") && r.Method == "GET":
		id := strings.TrimPrefix(p, "/servers/")
		st, ok := f.servers[id]
		if !ok {
			f.write(w, "hetzner", 404, "", "server not found")
			return
		}
		f.write(w, "hetzner", 200, fmt.Sprintf(`{"server":{"id":%s,"status":%q,"public_net":{"ipv4":{"ip":"203.0.113.9"}}}}`, id, st), "")
	case strings.HasPrefix(p, "/servers/") && r.Method == "DELETE":
		id := strings.TrimPrefix(p, "/servers/")
		if _, ok := f.servers[id]; !ok {
			f.write(w, "hetzner", 404, "", "server not found")
			return
		}
		delete(f.servers, id)
		f.write(w, "hetzner", 200, `{"action":{"id":1}}`, "")
	case strings.HasPrefix(p, "/firewalls/") && r.Method == "DELETE":
		delete(f.firewalls, strings.TrimPrefix(p, "/firewalls/"))
		w.WriteHeader(204)
	default:
		f.write(w, "hetzner", 404, "", "unexpected "+key)
	}
}

func (f *fakeCloud) digitalocean(w http.ResponseWriter, r *http.Request, key string) {
	p := r.URL.Path
	switch {
	case key == "GET /account":
		f.write(w, "do", 200, `{"account":{"status":"active"}}`, "")
	case key == "GET /regions":
		f.write(w, "do", 200, `{"regions":[{"slug":"nyc3","name":"New York 3","available":true},{"slug":"fra1","name":"Frankfurt 1","available":true},{"slug":"nyc1","name":"New York 1","available":false}]}`, "")
	case key == "GET /sizes":
		f.write(w, "do", 200, `{"sizes":[
			{"slug":"s-1vcpu-1gb","memory":1024,"vcpus":1,"disk":25,"price_monthly":6,"regions":["nyc3","fra1"],"available":true},
			{"slug":"s-1vcpu-2gb","memory":2048,"vcpus":1,"disk":50,"price_monthly":12,"regions":["nyc3","fra1"],"available":true},
			{"slug":"s-2vcpu-2gb","memory":2048,"vcpus":2,"disk":60,"price_monthly":18,"regions":["nyc3","fra1"],"available":true},
			{"slug":"s-2vcpu-4gb","memory":4096,"vcpus":2,"disk":80,"price_monthly":24,"regions":["nyc3","fra1"],"available":true},
			{"slug":"s-2vcpu-4gb-intel","memory":4096,"vcpus":2,"disk":120,"price_monthly":28,"regions":["nyc3"],"available":true},
			{"slug":"c-4","memory":8192,"vcpus":4,"disk":50,"price_monthly":84,"regions":["nyc3"],"available":true}
		]}`, "")
	case key == "POST /firewalls":
		id := fmt.Sprintf("fw-%s", f.id())
		f.firewalls[id] = true
		f.write(w, "do", 202, fmt.Sprintf(`{"firewall":{"id":%q}}`, id), "")
	case key == "POST /droplets":
		if f.failCreate != "" {
			f.write(w, "do", 422, "", f.failCreate)
			return
		}
		id := f.id()
		f.servers[id] = "new"
		f.write(w, "do", 202, fmt.Sprintf(`{"droplet":{"id":%s,"status":"new","networks":{"v4":[]}}}`, id), "")
	case strings.HasPrefix(p, "/droplets/") && r.Method == "GET":
		id := strings.TrimPrefix(p, "/droplets/")
		st, ok := f.servers[id]
		if !ok {
			f.write(w, "do", 404, "", "The resource you requested could not be found.")
			return
		}
		f.write(w, "do", 200, fmt.Sprintf(`{"droplet":{"id":%s,"status":%q,"networks":{"v4":[{"ip_address":"10.0.0.2","type":"private"},{"ip_address":"198.51.100.7","type":"public"}]}}}`, id, st), "")
	case strings.HasPrefix(p, "/droplets/") && r.Method == "DELETE":
		id := strings.TrimPrefix(p, "/droplets/")
		if _, ok := f.servers[id]; !ok {
			f.write(w, "do", 404, "", "not found")
			return
		}
		delete(f.servers, id)
		w.WriteHeader(204)
	case strings.HasPrefix(p, "/firewalls/") && r.Method == "DELETE":
		delete(f.firewalls, strings.TrimPrefix(p, "/firewalls/"))
		w.WriteHeader(204)
	default:
		f.write(w, "do", 404, "", "unexpected "+key)
	}
}

func (f *fakeCloud) setStatus(id, status string) {
	f.mu.Lock()
	f.servers[id] = status
	f.mu.Unlock()
}

func (f *fakeCloud) only(kind string) (string, string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for id, st := range f.servers {
		return id, st
	}
	f.t.Fatalf("no %s server was created", kind)
	return "", ""
}

// cloudHarness is a hub plus an owner API token and a way to call it.
type cloudHarness struct {
	t     *testing.T
	srv   *Server
	token string
}

func newCloudHarness(t *testing.T) *cloudHarness {
	srv := newTestServer(t, "v1.0.0")
	tok, err := srv.store.CreateApiToken("test")
	if err != nil {
		t.Fatal(err)
	}
	// A linux agent binary for the new server to download.
	oldPoll, oldWait := cloudPollInterval, cloudDeleteWait
	cloudPollInterval, cloudDeleteWait = time.Hour, time.Millisecond
	t.Cleanup(func() { cloudPollInterval, cloudDeleteWait = oldPoll, oldWait })
	return &cloudHarness{t: t, srv: srv, token: tok}
}

func (h *cloudHarness) do(method, path string, body any) (int, map[string]any, string) {
	h.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, rd)
	req.Host = "hub.example.com"
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("Authorization", "Bearer "+h.token)
	w := httptest.NewRecorder()
	h.srv.mux.ServeHTTP(w, req)
	var out map[string]any
	json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out, w.Body.String()
}

func (h *cloudHarness) pointAt(kind string, f *fakeCloud) {
	oldH, oldD := hetznerBase, doBase
	if kind == "hetzner" {
		hetznerBase = f.srv.URL
	} else {
		doBase = f.srv.URL
	}
	h.t.Cleanup(func() { hetznerBase, doBase = oldH, oldD })
}

func TestCloudConnectMasksAndNeverReturnsToken(t *testing.T) {
	h := newCloudHarness(t)
	f := newFakeCloud(t, "hetzner")
	h.pointAt("hetzner", f)

	code, _, raw := h.do("PUT", "/api/cloud/providers/hetzner", map[string]string{"token": "short"})
	if code != 400 {
		t.Fatalf("short token: %d %s", code, raw)
	}
	f.rejectToken = true
	code, _, raw = h.do("PUT", "/api/cloud/providers/hetzner", map[string]string{"token": canaryToken})
	if code != 400 || !strings.Contains(raw, "Unable to authenticate you") || strings.Contains(raw, canaryToken) {
		t.Fatalf("rejected token: %d %s", code, raw)
	}
	f.rejectToken = false
	code, _, raw = h.do("PUT", "/api/cloud/providers/hetzner", map[string]string{"token": canaryToken})
	if code != 200 || strings.Contains(raw, canaryToken) || !strings.Contains(raw, `"connected":true`) {
		t.Fatalf("connect: %d %s", code, raw)
	}
	_, _, raw = h.do("GET", "/api/cloud", nil)
	if strings.Contains(raw, canaryToken) || !strings.Contains(raw, "…cdef") {
		t.Fatalf("overview leaks or doesn't mask the token: %s", raw)
	}
	if !f.tokenSeen[canaryToken] {
		t.Error("the provider never saw the token")
	}
}

func TestHetznerOptionsAreCuratedWithPrices(t *testing.T) {
	h := newCloudHarness(t)
	f := newFakeCloud(t, "hetzner")
	h.pointAt("hetzner", f)
	h.srv.store.SetCloudToken("hetzner", canaryToken)

	code, out, raw := h.do("GET", "/api/cloud/providers/hetzner/options", nil)
	if code != 200 {
		t.Fatalf("%d %s", code, raw)
	}
	if out["defaultSize"] != "cx22" || out["defaultRegion"] != "fsn1" || out["currency"] != "EUR" || out["live"] != true {
		t.Errorf("defaults wrong: %s", raw)
	}
	var opts cloudOptions
	json.Unmarshal([]byte(raw), &opts)
	ids := map[string]bool{}
	for _, s := range opts.Sizes {
		ids[s.Id] = true
	}
	for _, want := range []string{"cx22", "cx32", "cpx21"} {
		if !ids[want] {
			t.Errorf("missing size %s in %s", want, raw)
		}
	}
	for _, bad := range []string{"cax11", "ccx13", "cx11", "cpx11"} {
		if ids[bad] {
			t.Errorf("size %s should be filtered out", bad)
		}
	}
	if p := opts.Sizes[0].Prices["fsn1"]; p != 4.59 {
		t.Errorf("cx22 price = %v", p)
	}
}

func TestDigitalOceanOptionsAreBasicDroplets(t *testing.T) {
	h := newCloudHarness(t)
	f := newFakeCloud(t, "do")
	h.pointAt("do", f)
	h.srv.store.SetCloudToken("digitalocean", canaryToken)

	_, _, raw := h.do("GET", "/api/cloud/providers/digitalocean/options", nil)
	var opts cloudOptions
	json.Unmarshal([]byte(raw), &opts)
	if opts.DefaultSize != "s-2vcpu-4gb" || opts.DefaultRegion != "nyc3" || opts.Currency != "USD" {
		t.Errorf("defaults wrong: %s", raw)
	}
	for _, s := range opts.Sizes {
		if s.Id == "c-4" || s.Id == "s-2vcpu-4gb-intel" || s.Id == "s-1vcpu-1gb" {
			t.Errorf("size %s should not be offered", s.Id)
		}
	}
	for _, r := range opts.Regions {
		if r.Id == "nyc1" {
			t.Error("unavailable region offered")
		}
	}
}

func createBody(provider, region, size string) map[string]any {
	return map[string]any{
		"provider": provider, "name": "Build box", "region": region, "size": size,
		"sshKey": "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl me@laptop",
		"tools":  map[string]bool{"claude": true, "gemini": true},
	}
}

// joinDevice enrolls a device the way the install script would.
func joinDevice(t *testing.T, h *cloudHarness, hostname string) string {
	t.Helper()
	tok, err := h.srv.store.CreateEnrollToken(time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]string{"token": tok, "hostname": hostname, "os": "linux", "arch": "amd64"})
	req := httptest.NewRequest("POST", "/api/enroll", bytes.NewReader(body))
	w := httptest.NewRecorder()
	h.srv.mux.ServeHTTP(w, req)
	var out map[string]string
	json.Unmarshal(w.Body.Bytes(), &out)
	if out["deviceId"] == "" {
		t.Fatalf("enroll: %s", w.Body.String())
	}
	return out["deviceId"]
}

func TestHetznerCloudMachineLifecycle(t *testing.T) {
	h := newCloudHarness(t)
	f := newFakeCloud(t, "hetzner")
	h.pointAt("hetzner", f)
	h.srv.store.SetCloudToken("hetzner", canaryToken)

	// Errors name the provider's own message and leave nothing behind.
	f.failCreate = "server type cx22 is not available in this location"
	code, _, raw := h.do("POST", "/api/cloud/machines", createBody("hetzner", "fsn1", "cx22"))
	if code != 502 || !strings.Contains(raw, "server type cx22 is not available") || strings.Contains(raw, canaryToken) {
		t.Fatalf("create failure: %d %s", code, raw)
	}
	if len(f.firewalls) != 0 {
		t.Errorf("firewall left behind after a failed create: %v", f.firewalls)
	}
	if list, _ := h.srv.store.ListCloudMachines(); len(list) != 0 {
		t.Errorf("a failed create is still tracked: %v", list)
	}
	f.failCreate = ""

	// Wrong region/size combos are refused before anything is created.
	code, _, _ = h.do("POST", "/api/cloud/machines", createBody("hetzner", "ash", "cx22"))
	if code != 400 {
		t.Errorf("size not offered in region: %d", code)
	}

	code, out, raw := h.do("POST", "/api/cloud/machines", createBody("hetzner", "fsn1", "cx22"))
	if code != 200 {
		t.Fatalf("create: %d %s", code, raw)
	}
	id := out["id"].(string)
	if out["stage"] != "creating" || out["priceMonthly"].(float64) != 4.59 || out["currency"] != "EUR" {
		t.Errorf("view: %s", raw)
	}
	serverID, _ := f.only("hetzner")

	// What the provider was sent.
	f.mu.Lock()
	sent := f.bodies["POST /servers"]
	fw := f.bodies["POST /firewalls"]
	f.mu.Unlock()
	userData, _ := sent["user_data"].(string)
	if sent["image"] != "ubuntu-24.04" || sent["server_type"] != "cx22" || sent["location"] != "fsn1" {
		t.Errorf("server request: %v", sent)
	}
	if strings.Contains(userData, canaryToken) {
		t.Error("the provider API token leaked into cloud-init")
	}
	for _, want := range []string{"#cloud-config", "agent enroll --hub", "https://hub.example.com", "ssh-ed25519 AAAAC3", "@anthropic-ai/claude-code", "@google/gemini-cli"} {
		if !strings.Contains(userData, want) {
			t.Errorf("user_data lacks %q", want)
		}
	}
	if strings.Contains(userData, "@openai/codex") {
		t.Error("codex was not requested")
	}
	rules, _ := fw["rules"].([]any)
	if len(rules) != 1 || rules[0].(map[string]any)["port"] != "22" {
		t.Errorf("firewall should allow only SSH: %v", fw)
	}

	// Provider says running: booting. The install script calls in: installing.
	f.setStatus(serverID, "running")
	_, list := listCloud(t, h)
	if list[0]["stage"] != "booting" || list[0]["ipv4"] != "203.0.113.9" {
		t.Errorf("after running: %v", list[0])
	}
	ping := userDataToken(t, userData, "PING=")
	code, _, raw = h.pingProgress(ping, "installing", "")
	if code != 200 {
		t.Fatalf("ping: %d %s", code, raw)
	}
	if code, _, _ = h.pingProgress("nope", "installing", ""); code != 403 {
		t.Errorf("unknown ping token: %d", code)
	}
	_, list = listCloud(t, h)
	if list[0]["stage"] != "installing" {
		t.Errorf("after ping: %v", list[0])
	}

	// A failure report is shown plainly, and the server stays tracked.
	h.pingProgress(ping, "failed", "Failed while installing Node.js.\nLog: /var/log/x")
	_, list = listCloud(t, h)
	if list[0]["stage"] != "failed" || !strings.Contains(list[0]["error"].(string), "installing Node.js") || strings.Contains(list[0]["error"].(string), "\n") {
		t.Errorf("after failure: %v", list[0])
	}

	// The device joins under the machine's unique host name: that clears the
	// failure, links it, and renames it to the name the user chose.
	var hostname string
	if m, _ := h.srv.store.CloudMachine(id); m != nil {
		hostname = m.Hostname
	}
	deviceID := joinDevice(t, h, hostname)
	_, list = listCloud(t, h)
	if list[0]["stage"] != "joined" || list[0]["deviceId"] != deviceID {
		t.Errorf("after join: %v", list[0])
	}
	if d, _ := h.srv.store.DeviceById(deviceID); d == nil || d.Name != "Build box" {
		t.Errorf("device not renamed: %+v", d)
	}
	// Another device that isn't ours never gets linked.
	joinDevice(t, h, "somebody-elses-laptop")
	_, list = listCloud(t, h)
	if len(list) != 1 || list[0]["deviceId"] != deviceID {
		t.Errorf("unexpected linkage: %v", list)
	}

	// Deleting needs the name typed exactly.
	code, _, _ = h.do("POST", "/api/cloud/machines/"+id+"/delete", map[string]string{"confirmName": "build box"})
	if code != 400 {
		t.Errorf("wrong confirmation accepted: %d", code)
	}
	if len(f.servers) != 1 {
		t.Fatal("server deleted without confirmation")
	}
	code, _, raw = h.do("POST", "/api/cloud/machines/"+id+"/delete", map[string]string{"confirmName": "Build box"})
	if code != 200 {
		t.Fatalf("delete: %d %s", code, raw)
	}
	if len(f.servers) != 0 || len(f.firewalls) != 0 {
		t.Errorf("server/firewall left: %v %v", f.servers, f.firewalls)
	}
	if d, _ := h.srv.store.DeviceById(deviceID); d != nil {
		t.Error("device still listed after deleting its VM")
	}
	if _, list = listCloud(t, h); len(list) != 0 {
		t.Errorf("deleted machine still listed: %v", list)
	}
}

func TestCloudDeleteOnlyTouchesTrackedServers(t *testing.T) {
	h := newCloudHarness(t)
	f := newFakeCloud(t, "hetzner")
	h.pointAt("hetzner", f)
	h.srv.store.SetCloudToken("hetzner", canaryToken)
	f.servers["777"] = "running" // someone else's VM at the same provider

	if code, _, _ := h.do("POST", "/api/cloud/machines/777/delete", map[string]string{"confirmName": "x"}); code != 404 {
		t.Errorf("unknown id: %d", code)
	}
	for _, c := range f.calls {
		if strings.HasPrefix(c, "DELETE") {
			t.Errorf("a delete reached the provider: %s", c)
		}
	}
	// A machine record without a server id (create never finished) deletes
	// locally without touching anything.
	m := &cloudMachine{Id: "abc", Provider: "hetzner", Name: "n", Hostname: "n-1", Region: "fsn1", Size: "cx22", Stage: cloudFailed, CreatedAt: time.Now().Unix()}
	h.srv.store.InsertCloudMachine(m)
	if code, _, raw := h.do("POST", "/api/cloud/machines/abc/delete", map[string]string{"confirmName": "n"}); code != 200 {
		t.Errorf("delete untracked-server record: %d %s", code, raw)
	}
	if _, ok := f.servers["777"]; !ok {
		t.Error("someone else's server was deleted")
	}
}

func TestCloudServerDeletedOutsideShowsFailed(t *testing.T) {
	h := newCloudHarness(t)
	f := newFakeCloud(t, "hetzner")
	h.pointAt("hetzner", f)
	h.srv.store.SetCloudToken("hetzner", canaryToken)
	_, _, raw := h.do("POST", "/api/cloud/machines", createBody("hetzner", "fsn1", "cx22"))
	if !strings.Contains(raw, `"stage"`) {
		t.Fatal(raw)
	}
	id, _ := f.only("hetzner")
	f.mu.Lock()
	delete(f.servers, id)
	f.mu.Unlock()
	_, list := listCloud(t, h)
	if list[0]["stage"] != "failed" || !strings.Contains(list[0]["error"].(string), "deleted at Hetzner") {
		t.Errorf("%v", list[0])
	}
	// Deleting it still works: the provider's 404 counts as gone.
	if code, _, raw := h.do("POST", "/api/cloud/machines/"+list[0]["id"].(string)+"/delete", map[string]string{"confirmName": "Build box"}); code != 200 {
		t.Errorf("%d %s", code, raw)
	}
}

func TestCloudJoinTimeout(t *testing.T) {
	h := newCloudHarness(t)
	f := newFakeCloud(t, "hetzner")
	h.pointAt("hetzner", f)
	h.srv.store.SetCloudToken("hetzner", canaryToken)
	h.do("POST", "/api/cloud/machines", createBody("hetzner", "fsn1", "cx22"))
	list, _ := h.srv.store.ListCloudMachines()
	list[0].CreatedAt = time.Now().Add(-30 * time.Minute).Unix()
	h.srv.store.db.Exec(`UPDATE cloud_machines SET created_at = ?`, list[0].CreatedAt)
	_, out := listCloud(t, h)
	if out[0]["stage"] != "failed" || !strings.Contains(out[0]["error"].(string), "never contacted the hub") {
		t.Errorf("%v", out[0])
	}
}

func TestDigitalOceanCloudMachineLifecycle(t *testing.T) {
	h := newCloudHarness(t)
	f := newFakeCloud(t, "do")
	h.pointAt("do", f)
	h.srv.store.SetCloudToken("digitalocean", canaryToken)

	body := createBody("digitalocean", "nyc3", "s-2vcpu-4gb")
	body["closeSsh"] = true
	code, out, raw := h.do("POST", "/api/cloud/machines", body)
	if code != 200 {
		t.Fatalf("create: %d %s", code, raw)
	}
	if out["priceMonthly"].(float64) != 24 || out["currency"] != "USD" || out["closeSsh"] != true {
		t.Errorf("view: %s", raw)
	}
	f.mu.Lock()
	drop := f.bodies["POST /droplets"]
	fw := f.bodies["POST /firewalls"]
	f.mu.Unlock()
	if drop["image"] != "ubuntu-24-04-x64" || drop["size"] != "s-2vcpu-4gb" || strings.Contains(drop["user_data"].(string), canaryToken) {
		t.Errorf("droplet request: %v", drop)
	}
	if in, _ := fw["inbound_rules"].([]any); len(in) != 0 {
		t.Errorf("closeSsh should leave no inbound rules: %v", fw["inbound_rules"])
	}
	if out2, _ := fw["outbound_rules"].([]any); len(out2) == 0 {
		t.Error("DigitalOcean firewalls need outbound rules or the server can't reach the hub")
	}
	id, _ := f.only("do")
	f.setStatus(id, "active")
	_, list := listCloud(t, h)
	if list[0]["stage"] != "booting" || list[0]["ipv4"] != "198.51.100.7" {
		t.Errorf("%v", list[0])
	}
	if code, _, raw := h.do("POST", "/api/cloud/machines/"+list[0]["id"].(string)+"/delete", map[string]string{"confirmName": "Build box"}); code != 200 {
		t.Fatalf("%d %s", code, raw)
	}
	if len(f.servers) != 0 || len(f.firewalls) != 0 {
		t.Errorf("left behind: %v %v", f.servers, f.firewalls)
	}
	f.failCreate = "You specified an invalid size for Droplet creation."
	code, _, raw = h.do("POST", "/api/cloud/machines", createBody("digitalocean", "nyc3", "s-2vcpu-4gb"))
	if code != 502 || !strings.Contains(raw, "invalid size") || len(f.firewalls) != 0 {
		t.Errorf("failure: %d %s fw=%v", code, raw, f.firewalls)
	}
}

func TestCloudCreateBlockedWhenHubUnreachable(t *testing.T) {
	h := newCloudHarness(t)
	f := newFakeCloud(t, "hetzner")
	h.pointAt("hetzner", f)
	h.srv.store.SetCloudToken("hetzner", canaryToken)

	post := func(host string, extra map[string]any) (int, string) {
		b := createBody("hetzner", "fsn1", "cx22")
		for k, v := range extra {
			b[k] = v
		}
		raw, _ := json.Marshal(b)
		req := httptest.NewRequest("POST", "/api/cloud/machines", bytes.NewReader(raw))
		req.Host = host
		req.Header.Set("Authorization", "Bearer "+h.token)
		w := httptest.NewRecorder()
		h.srv.mux.ServeHTTP(w, req)
		return w.Code, w.Body.String()
	}
	code, msg := post("localhost:4317", nil)
	if code != 422 || !strings.Contains(msg, "can't reach") || !strings.Contains(msg, "Tailscale") {
		t.Errorf("localhost: %d %s", code, msg)
	}
	if code, _ = post("192.168.1.20:4317", map[string]any{"tailscaleKey": "tskey-auth-kABCDEFGHIJ1234"}); code != 422 {
		t.Errorf("LAN address with a key but no tailnet address: %d", code)
	}
	if code, msg = post("localhost:4317", map[string]any{"tailscaleKey": "bogus"}); code != 400 {
		t.Errorf("bad key: %d %s", code, msg)
	}
	for _, c := range f.calls {
		if c == "POST /servers" || c == "POST /firewalls" {
			t.Errorf("a server was created for an unreachable hub: %v", f.calls)
		}
	}
	code, msg = post("localhost:4317", map[string]any{"tailscaleKey": "tskey-auth-kABCDEFGHIJ1234", "hubUrl": "http://100.101.102.103:4317"})
	if code != 200 {
		t.Fatalf("tailnet create: %d %s", code, msg)
	}
	f.mu.Lock()
	ud := f.bodies["POST /servers"]["user_data"].(string)
	f.mu.Unlock()
	for _, want := range []string{"tailscale up", "http://100.101.102.103:4317", "tskey-auth-kABCDEFGHIJ1234"} {
		if !strings.Contains(ud, want) {
			t.Errorf("user_data lacks %q", want)
		}
	}
}

func TestCloudDisconnectRefusedWithMachines(t *testing.T) {
	h := newCloudHarness(t)
	h.srv.store.SetCloudToken("hetzner", canaryToken)
	h.srv.store.InsertCloudMachine(&cloudMachine{Id: "m1", Provider: "hetzner", ServerId: "5", Name: "n", Hostname: "n-1", Region: "fsn1", Size: "cx22", Stage: cloudJoined, CreatedAt: time.Now().Unix()})
	if code, _, _ := h.do("DELETE", "/api/cloud/providers/hetzner", nil); code != 409 {
		t.Errorf("disconnect with live machines: %d", code)
	}
	h.srv.store.db.Exec(`UPDATE cloud_machines SET deleted_at = 1`)
	if code, _, _ := h.do("DELETE", "/api/cloud/providers/hetzner", nil); code != 200 {
		t.Errorf("disconnect: %d", code)
	}
	if tok, _ := h.srv.store.CloudToken("hetzner"); tok != "" {
		t.Error("token still stored")
	}
}

func TestClassifyHubURL(t *testing.T) {
	cases := map[string]string{
		"https://hub.example.com":      "public",
		"http://203.0.113.5:4317":      "public",
		"http://localhost:4317":        "local",
		"http://127.0.0.1:4317":        "local",
		"http://192.168.1.10:4317":     "private",
		"http://10.0.0.4":              "private",
		"http://mac-mini.local:4317":   "private",
		"http://mybox:4317":            "private",
		"http://100.88.1.2:4317":       "tailnet",
		"https://hub.tail1234.ts.net":  "tailnet",
		"http://169.254.1.1":           "private",
		"http://[fd7a:115c:a1e0::1]:9": "tailnet",
	}
	for raw, want := range cases {
		r, err := classifyHubURL(raw)
		if err != nil || r.Kind != want {
			t.Errorf("%s: kind %q err %v, want %s", raw, r.Kind, err, want)
		}
	}
	for _, bad := range []string{"", "ftp://x.com", "https://x.com/path", "https://x.com?q=1", "https://u:p@x.com", "https://x.com:99999", "https://ex ample.com", "javascript:alert(1)", "https://x.com'; rm -rf /; '"} {
		if _, err := classifyHubURL(bad); err == nil {
			t.Errorf("%q should be refused", bad)
		}
	}
}

func TestCloudInitIsValidAndSafe(t *testing.T) {
	spec := cloudInitSpec{
		Hostname: "build-box-ab12", HubURL: "https://hub.example.com", EnrollToken: "abc123", ProgressToken: "def456",
		SSHKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl me@laptop",
		Tools:  []string{"claude", "codex", "gemini"},
	}
	out, err := renderCloudInit(spec)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(out, "#cloud-config\n") || strings.Contains(out, "\t") {
		t.Errorf("not cloud-config or has tabs:\n%s", out[:200])
	}
	if strings.Contains(out, "tailscale up") && spec.TailscaleKey == "" && strings.Contains(out, "TSKEY='tskey") {
		t.Error("no key was given")
	}
	for _, want := range []string{"hostname: \"build-box-ab12\"", "name: overseer", "lock_passwd: true", "ssh_pwauth: false", "- git", "- tmux", "- curl", "gh", "nodesource", "agent enroll --hub \"$HUB\" --token \"$ENROLL\"", "agent install-service", "@openai/codex", "runcmd:"} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q", want)
		}
	}
	// No line of the script block may be less indented than the block.
	inBlock := false
	for _, line := range strings.Split(out, "\n") {
		if strings.HasPrefix(line, "    content: |") {
			inBlock = true
			continue
		}
		if inBlock {
			if strings.HasPrefix(line, "runcmd:") {
				break
			}
			if line != "" && !strings.HasPrefix(line, "      ") {
				t.Fatalf("script line escapes the YAML block: %q", line)
			}
		}
	}
	// The embedded script is valid bash (when bash is around to check it).
	if bash, err := exec.LookPath("bash"); err == nil {
		script := cloudScriptFrom(t, out)
		cmd := exec.Command(bash, "-n")
		cmd.Stdin = strings.NewReader(script)
		if msg, err := cmd.CombinedOutput(); err != nil {
			t.Errorf("bootstrap script has a syntax error: %v\n%s", err, msg)
		}
	}
	// Injection attempts in values are quoted, not interpreted.
	evil := spec
	evil.HubURL = "https://x.com'; touch /tmp/pwned; echo '"
	evil.SSHKey = "ssh-ed25519 AAAA\nruncmd:\n  - rm -rf /"
	out2, err := renderCloudInit(evil)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out2, "\nruncmd:\n  - rm -rf /") {
		t.Error("YAML injection through the SSH key")
	}
	if !strings.Contains(out2, `HUB='https://x.com'\''; touch /tmp/pwned; echo '\'''`) {
		t.Error("hub URL not shell-quoted")
	}
	if _, err := renderCloudInit(cloudInitSpec{Hostname: "h", HubURL: "u", EnrollToken: "a b", ProgressToken: "c"}); err == nil {
		t.Error("a token with a space should be refused")
	}
}

func cloudScriptFrom(t *testing.T, cc string) string {
	t.Helper()
	var b strings.Builder
	in := false
	for _, line := range strings.Split(cc, "\n") {
		if strings.HasPrefix(line, "    content: |") {
			in = true
			continue
		}
		if in {
			if strings.HasPrefix(line, "runcmd:") {
				break
			}
			b.WriteString(strings.TrimPrefix(line, "      ") + "\n")
		}
	}
	return b.String()
}

func userDataToken(t *testing.T, userData, prefix string) string {
	t.Helper()
	script := cloudScriptFrom(t, userData)
	for _, line := range strings.Split(script, "\n") {
		if strings.HasPrefix(line, prefix) {
			return strings.Trim(strings.TrimPrefix(line, prefix), "'")
		}
	}
	t.Fatalf("no %s in script", prefix)
	return ""
}

func (h *cloudHarness) pingProgress(token, stage, msg string) (int, map[string]any, string) {
	b, _ := json.Marshal(map[string]string{"token": token, "stage": stage, "message": msg})
	req := httptest.NewRequest("POST", "/api/cloud/progress", bytes.NewReader(b))
	w := httptest.NewRecorder()
	h.srv.mux.ServeHTTP(w, req) // no credentials: the progress token is the credential
	var out map[string]any
	json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out, w.Body.String()
}

func listCloud(t *testing.T, h *cloudHarness) (int, []map[string]any) {
	t.Helper()
	req := httptest.NewRequest("GET", "/api/cloud/machines", nil)
	req.Header.Set("Authorization", "Bearer "+h.token)
	w := httptest.NewRecorder()
	h.srv.mux.ServeHTTP(w, req)
	var out []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("list: %v %s", err, w.Body.String())
	}
	return w.Code, out
}

func TestCloudRoutesRequireAuth(t *testing.T) {
	h := newCloudHarness(t)
	for _, c := range [][2]string{
		{"GET", "/api/cloud"}, {"PUT", "/api/cloud/providers/hetzner"}, {"GET", "/api/cloud/machines"},
		{"POST", "/api/cloud/machines"}, {"POST", "/api/cloud/machines/x/delete"}, {"GET", "/api/cloud/providers/hetzner/options"},
	} {
		req := httptest.NewRequest(c[0], c[1], strings.NewReader("{}"))
		w := httptest.NewRecorder()
		h.srv.mux.ServeHTTP(w, req)
		if w.Code != 401 {
			t.Errorf("%s %s without credentials: %d", c[0], c[1], w.Code)
		}
	}
}
