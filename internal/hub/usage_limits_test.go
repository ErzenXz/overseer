package hub

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// fakeLimitsDevice is a device that speaks the agent WebSocket protocol and
// answers usage.limits with answer (nil answer = never reply).
type fakeLimitsDevice struct {
	t      *testing.T
	id     string
	ws     *websocket.Conn
	wmu    sync.Mutex
	asked  atomic.Int32
	mu     sync.Mutex
	agents [][]string // the agents of each request
	answer func(req protocol.UsageLimitsRequest) (protocol.UsageLimitsResult, string)
}

func connectFakeLimitsDevice(t *testing.T, srv *Server, base, hostname string,
	answer func(protocol.UsageLimitsRequest) (protocol.UsageLimitsResult, string)) *fakeLimitsDevice {
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

	url := strings.Replace(base, "http://", "ws://", 1) + "/api/ws/agent"
	ws, _, err := websocket.DefaultDialer.Dial(url, http.Header{"Authorization": {"Bearer " + er.DeviceToken}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ws.Close() })
	d := &fakeLimitsDevice{t: t, id: er.DeviceId, ws: ws, answer: answer}
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
			if m.Type != protocol.TypeUsageLimits {
				if m.Id != 0 {
					d.send(protocol.Msg{Type: protocol.TypeResult, Id: m.Id, Error: "unsupported request " + m.Type})
				}
				continue
			}
			var req protocol.UsageLimitsRequest
			json.Unmarshal(m.Data, &req)
			d.asked.Add(1)
			d.mu.Lock()
			d.agents = append(d.agents, req.Agents)
			answer := d.answer
			d.mu.Unlock()
			if answer == nil {
				continue
			}
			res, errText := answer(req)
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

func (d *fakeLimitsDevice) send(m protocol.Msg) {
	d.wmu.Lock()
	defer d.wmu.Unlock()
	if err := d.ws.WriteJSON(m); err != nil {
		d.t.Logf("fake device send: %v", err)
	}
}

func (d *fakeLimitsDevice) lastAgents() []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.agents[len(d.agents)-1]
}

// standardAnswer: Claude on a Max plan, Codex signed in with an API key.
func standardAnswer(req protocol.UsageLimitsRequest) (protocol.UsageLimitsResult, string) {
	now := time.Now().Unix()
	res := protocol.UsageLimitsResult{Accounts: []protocol.PlanLimits{}}
	for _, agent := range req.Agents {
		switch agent {
		case "claude":
			res.Accounts = append(res.Accounts, protocol.PlanLimits{Agent: "claude", Plan: "Max", Account: "you@example.com",
				Status: protocol.LimitsOK, FetchedAt: now, Source: protocol.LimitsLive, Windows: []protocol.LimitWindow{
					{Id: "five_hour", Label: "5-hour", UsedPercent: 10, ResetsAt: now + 3600, WindowMinutes: 300},
					{Id: "seven_day", Label: "Weekly", UsedPercent: 50, ResetsAt: now + 86400, WindowMinutes: 10080},
				}})
		case "codex":
			res.Accounts = append(res.Accounts, protocol.PlanLimits{Agent: "codex", Status: protocol.LimitsOK, FetchedAt: now,
				Source: protocol.LimitsLive, Windows: []protocol.LimitWindow{}, Error: protocol.LimitsErrAPIKey})
		}
	}
	return res, ""
}

// noAgentCLIs hides claude and codex from the hub's embedded device agent,
// so tests never start the real CLIs installed on the machine.
func noAgentCLIs(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("PATH", t.TempDir())
}

func getLimits(t *testing.T, api apiClient, query string) []protocol.PlanLimits {
	t.Helper()
	var res protocol.UsageLimitsResult
	api.do("GET", "/api/usage/limits"+query, nil, &res)
	if res.Accounts == nil {
		t.Fatalf("accounts must be an array")
	}
	return res.Accounts
}

func TestUsageLimitsEndpoint(t *testing.T) {
	noAgentCLIs(t)
	srv, base := startHub(t)
	token, _ := srv.store.CreateApiToken("limits-test")
	api := apiClient{t: t, base: base, token: token}

	// No devices: an empty list.
	if got := getLimits(t, api, ""); len(got) != 0 {
		t.Fatalf("no devices: %+v", got)
	}

	dev := connectFakeLimitsDevice(t, srv, base, "studio", standardAnswer)
	got := getLimits(t, api, "")
	if len(got) != 1 || got[0].Agent != "claude" || got[0].DeviceId != dev.id || got[0].DeviceName != "studio" ||
		len(got[0].Windows) != 2 || got[0].Source != protocol.LimitsLive || got[0].Plan != "Max" {
		t.Fatalf("first read = %+v", got)
	}
	if dev.asked.Load() != 1 || strings.Join(dev.lastAgents(), ",") != "claude,codex" {
		t.Fatalf("asked %d times, agents %v", dev.asked.Load(), dev.lastAgents())
	}
	// ?all=1 shows the API-key entry.
	if all := getLimits(t, api, "?all=1"); len(all) != 2 || all[1].Agent != "codex" || all[1].Error != protocol.LimitsErrAPIKey {
		t.Fatalf("all = %+v", all)
	}
	// Cached for five minutes.
	if dev.asked.Load() != 1 {
		t.Fatalf("cached read asked the device (%d)", dev.asked.Load())
	}
	// refresh re-asks.
	getLimits(t, api, "?refresh=1")
	if dev.asked.Load() != 2 {
		t.Fatalf("refresh did not ask the device (%d)", dev.asked.Load())
	}
	// Only stale agents are asked once the TTL passes for one of them.
	srv.usageLimits.mu.Lock()
	srv.usageLimits.devices[dev.id]["codex"].checked = time.Now().Add(-usageLimitsTTL)
	srv.usageLimits.mu.Unlock()
	getLimits(t, api, "")
	if dev.asked.Load() != 3 || strings.Join(dev.lastAgents(), ",") != "codex" {
		t.Fatalf("stale agents: asked %d, agents %v", dev.asked.Load(), dev.lastAgents())
	}

	// A session event updates the cache at once and is pushed to browsers.
	events := api.dial("/api/ws/events")
	now := time.Now().Unix()
	update, _ := protocol.NewMsg(protocol.TypeUsageLimitsUpdate, 0, 0, protocol.PlanLimits{Agent: "claude", Status: protocol.LimitsWarning,
		FetchedAt: now, Source: protocol.LimitsFromSession, Windows: []protocol.LimitWindow{
			{Id: "five_hour", Label: "5-hour", UsedPercent: 85, ResetsAt: now + 1800, WindowMinutes: 300}}})
	dev.send(update)
	events.SetReadDeadline(time.Now().Add(5 * time.Second))
	for {
		var e map[string]any
		if err := events.ReadJSON(&e); err != nil {
			t.Fatalf("no usage.limits event: %v", err)
		}
		if e["type"] == "usage.limits" {
			if e["deviceId"] != dev.id || e["agent"] != "claude" {
				t.Fatalf("event = %v", e)
			}
			break
		}
	}
	got = getLimits(t, api, "")
	if len(got) != 1 || got[0].Source != protocol.LimitsFromSession || got[0].Status != protocol.LimitsWarning ||
		len(got[0].Windows) != 2 || got[0].Windows[0].UsedPercent != 85 || got[0].Windows[1].UsedPercent != 50 ||
		got[0].Plan != "Max" || got[0].Account != "you@example.com" {
		t.Fatalf("after session event = %+v", got)
	}
	if dev.asked.Load() != 3 {
		t.Fatalf("session event caused a device read (%d)", dev.asked.Load())
	}
	// Unknown agents in events are ignored.
	bogus, _ := protocol.NewMsg(protocol.TypeUsageLimitsUpdate, 0, 0, protocol.PlanLimits{Agent: "gemini", FetchedAt: now})
	dev.send(bogus)

	// A failed read keeps the last good reading.
	dev.mu.Lock()
	dev.answer = func(req protocol.UsageLimitsRequest) (protocol.UsageLimitsResult, string) {
		res := protocol.UsageLimitsResult{}
		for _, a := range req.Agents {
			res.Accounts = append(res.Accounts, protocol.PlanLimits{Agent: a, FetchedAt: time.Now().Unix(), Error: "timed out"})
		}
		return res, ""
	}
	dev.mu.Unlock()
	got = getLimits(t, api, "?refresh=1&all=1")
	if len(got) != 2 || got[0].Error != "" || len(got[0].Windows) != 2 || got[1].Error != protocol.LimitsErrAPIKey {
		t.Fatalf("failed read replaced the reading: %+v", got)
	}

	// Offline: cached readings are still listed without asking anyone.
	asked := dev.asked.Load()
	dev.ws.Close()
	deadline := time.Now().Add(5 * time.Second)
	for srv.registry.get(dev.id) != nil {
		if time.Now().After(deadline) {
			t.Fatal("device still online")
		}
		time.Sleep(10 * time.Millisecond)
	}
	got = getLimits(t, api, "?refresh=1")
	if len(got) != 1 || got[0].DeviceId != dev.id || dev.asked.Load() != asked {
		t.Fatalf("offline = %+v", got)
	}
	// ...until the reading is a day old.
	srv.usageLimits.mu.Lock()
	srv.usageLimits.devices[dev.id]["claude"].limits.FetchedAt = time.Now().Add(-usageLimitsKeep).Unix()
	srv.usageLimits.mu.Unlock()
	if got := getLimits(t, api, ""); len(got) != 0 {
		t.Fatalf("day-old offline reading still listed: %+v", got)
	}
}

// A device that never answers costs at most usageLimitsWait, and the other
// devices' readings still come back; one too old to know usage.limits gives
// nothing.
func TestUsageLimitsSlowAndOldDevices(t *testing.T) {
	noAgentCLIs(t)
	srv, base := startHub(t)
	token, _ := srv.store.CreateApiToken("limits-test")
	api := apiClient{t: t, base: base, token: token}

	good := connectFakeLimitsDevice(t, srv, base, "good", standardAnswer)
	slow := connectFakeLimitsDevice(t, srv, base, "slow", nil)
	old := connectFakeLimitsDevice(t, srv, base, "old", func(protocol.UsageLimitsRequest) (protocol.UsageLimitsResult, string) {
		return protocol.UsageLimitsResult{}, `unsupported request "usage.limits"`
	})

	start := time.Now()
	got := getLimits(t, api, "")
	took := time.Since(start)
	if took < usageLimitsWait-500*time.Millisecond || took > usageLimitsWait+2*time.Second {
		t.Errorf("read took %v, want about %v", took, usageLimitsWait)
	}
	if len(got) != 1 || got[0].DeviceId != good.id {
		t.Fatalf("got %+v", got)
	}
	// Failed devices are not asked again until the TTL passes.
	start = time.Now()
	getLimits(t, api, "")
	if time.Since(start) > time.Second || slow.asked.Load() != 1 || old.asked.Load() != 1 {
		t.Errorf("second read took %v; slow asked %d, old asked %d", time.Since(start), slow.asked.Load(), old.asked.Load())
	}
}

// Concurrent requests share one device read.
func TestUsageLimitsSingleRead(t *testing.T) {
	noAgentCLIs(t)
	srv, base := startHub(t)
	token, _ := srv.store.CreateApiToken("limits-test")
	api := apiClient{t: t, base: base, token: token}
	dev := connectFakeLimitsDevice(t, srv, base, "studio", func(req protocol.UsageLimitsRequest) (protocol.UsageLimitsResult, string) {
		time.Sleep(300 * time.Millisecond)
		return standardAnswer(req)
	})
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if got := getLimits(t, api, ""); len(got) != 1 {
				t.Errorf("got %+v", got)
			}
		}()
	}
	wg.Wait()
	if dev.asked.Load() != 1 {
		t.Errorf("device asked %d times", dev.asked.Load())
	}
}

func TestMergeLimits(t *testing.T) {
	prev := protocol.PlanLimits{Agent: "codex", Plan: "Pro", Account: "a@b", Status: protocol.LimitsOK, Windows: []protocol.LimitWindow{
		{Id: "primary", Label: "5-hour", UsedPercent: 10, ResetsAt: 100, WindowMinutes: 300},
		{Id: "secondary", Label: "Weekly", UsedPercent: 30, ResetsAt: 200, WindowMinutes: 10080},
	}}
	next := protocol.PlanLimits{Agent: "codex", Source: protocol.LimitsFromSession, Windows: []protocol.LimitWindow{
		{Id: "secondary", UsedPercent: 100}}}
	m := protocol.MergeLimits(prev, next)
	if m.Plan != "Pro" || m.Account != "a@b" || m.Status != protocol.LimitsLimited || len(m.Windows) != 2 ||
		m.Windows[1] != (protocol.LimitWindow{Id: "secondary", Label: "Weekly", UsedPercent: 100, ResetsAt: 200, WindowMinutes: 10080}) {
		t.Errorf("merged = %+v", m)
	}
	// A rejection without numbers keeps the windows and marks limited.
	m = protocol.MergeLimits(prev, protocol.PlanLimits{Agent: "codex", Status: protocol.LimitsLimited, Windows: []protocol.LimitWindow{}})
	if m.Status != protocol.LimitsLimited || len(m.Windows) != 2 {
		t.Errorf("rejected = %+v", m)
	}
	// Nothing before: the update stands alone.
	if m := protocol.MergeLimits(protocol.PlanLimits{}, next); len(m.Windows) != 1 || m.Plan != "" {
		t.Errorf("first = %+v", m)
	}
}
