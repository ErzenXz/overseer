package hub

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/ErzenXz/overseer/internal/protocol"
)

func registryFixture(t *testing.T) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", "acp-registry.json"))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func catalogById(list []CatalogAgent) map[string]CatalogAgent {
	out := map[string]CatalogAgent{}
	for _, a := range list {
		out[a.Id] = a
	}
	return out
}

func TestParseRegistryFixture(t *testing.T) {
	agents, err := parseRegistry(registryFixture(t))
	if err != nil {
		t.Fatal(err)
	}
	byId := catalogById(agents)
	for _, skipped := range []string{"claude-acp", "codex-acp", "github-copilot-cli"} {
		if _, ok := byId[skipped]; ok {
			t.Errorf("%s should not be in the parsed registry", skipped)
		}
	}
	want := []struct {
		id, bins, args, install string
	}{
		{"devin", "devin", "acp", ""},
		{"cursor", "cursor-agent", "acp", ""},
		{"goose", "goose", "acp", ""},
		{"opencode", "opencode", "acp", ""},
		{"poolside", "pool", "acp", ""},
		{"amp-acp", "amp-acp", "", ""},
		{"kilo", "kilo", "acp", "npm install -g @kilocode/cli"},
		{"gemini", "gemini", "--acp", "npm install -g @google/gemini-cli"},
		{"copilot", "copilot", "--acp", "npm install -g @github/copilot"},
		{"qwen-code", "qwen", "--acp --experimental-skills", "npm install -g @qwen-code/qwen-code"},
		{"factory-droid", "droid", "exec --output-format acp-daemon", "npm install -g droid"},
		{"fast-agent", "fast-agent-acp", "-x", "uv tool install fast-agent-acp"},
	}
	for _, w := range want {
		a, ok := byId[w.id]
		if !ok {
			t.Errorf("%s missing", w.id)
			continue
		}
		if got := strings.Join(a.Bins, ","); got != w.bins {
			t.Errorf("%s bins = %q, want %q", w.id, got, w.bins)
		}
		if got := strings.Join(a.Args, " "); got != w.args || a.Args == nil {
			t.Errorf("%s args = %q, want %q", w.id, got, w.args)
		}
		if a.Install != w.install {
			t.Errorf("%s install = %q, want %q", w.id, a.Install, w.install)
		}
		if a.Protocol != "acp" || a.Source != "registry" {
			t.Errorf("%s protocol/source = %s/%s", w.id, a.Protocol, a.Source)
		}
	}
	devin := byId["devin"]
	if devin.Name != "Devin" || devin.Vendor != "Cognition" || devin.Website != "https://docs.devin.ai/cli" ||
		!strings.HasSuffix(devin.Icon, "/devin.svg") || devin.Login != "devin auth login" || devin.Description == "" {
		t.Errorf("devin = %+v", devin)
	}
	for i := 1; i < len(agents); i++ {
		if strings.ToLower(agents[i-1].Name) > strings.ToLower(agents[i].Name) {
			t.Errorf("not sorted by name at %d: %s > %s", i, agents[i-1].Name, agents[i].Name)
		}
	}
}

func TestParseRegistryRejectsBadInput(t *testing.T) {
	for _, bad := range []string{``, `{`, `{"agents": []}`, `[]`,
		`{"agents": [{"id": "Bad Id", "distribution": {"npx": {"package": "x"}}}]}`} {
		if _, err := parseRegistry([]byte(bad)); err == nil {
			t.Errorf("parseRegistry(%q) should fail", bad)
		}
	}
	// Malformed entries are skipped, good ones kept.
	agents, err := parseRegistry([]byte(`{"agents": [
		{"id": "ok", "name": "OK", "authors": ["A"], "distribution": {"npx": {"package": "ok-cli@1.0.0", "args": ["--acp"]}}},
		{"id": "authors-string", "authors": "A", "distribution": {"npx": {"package": "x"}}},
		{"id": "evil-args", "distribution": {"npx": {"package": "x", "args": ["a\nb"]}}},
		{"id": "no-dist"},
		{"id": "bad-bin", "distribution": {"binary": {"linux-x86_64": {"cmd": "./$(rm -rf)"}}}},
		{"id": "acp", "distribution": {"npx": {"package": "x"}}},
		{"id": "custom-x", "distribution": {"npx": {"package": "x"}}},
		{"id": "ok", "name": "Duplicate", "distribution": {"npx": {"package": "y"}}},
		{"id": "js-icon", "icon": "javascript:alert(1)", "distribution": {"uvx": {"package": "tool>=2"}}}
	]}`))
	if err != nil {
		t.Fatal(err)
	}
	byId := catalogById(agents)
	if len(agents) != 2 || byId["ok"].Name != "OK" || byId["ok"].Vendor != "A" || byId["ok"].Bins[0] != "ok-cli" {
		t.Errorf("agents = %+v", agents)
	}
	if j := byId["js-icon"]; j.Icon != "" || j.Name != "js-icon" || j.Bins[0] != "tool" || j.Install != "uv tool install tool" {
		t.Errorf("js-icon = %+v", j)
	}
}

func TestBinDerivation(t *testing.T) {
	for in, want := range map[string]string{
		"./bin/devin":                                                "devin",
		`./bin\devin.exe`:                                            "devin",
		`./dist-package\cursor-agent.cmd`:                            "cursor-agent",
		`./goose-package\goose.exe`:                                  "goose",
		"harn.exe":                                                   "harn",
		"./pool-darwin-arm64":                                        "pool",
		"./pool-windows-amd64.exe":                                   "pool",
		"./sigit-win-arm64.exe":                                      "sigit",
		"./Applications/junie.app/Contents/MacOS/junie":              "junie",
		"./coco-1.0.73+180523.e6179a031de9-darwin-arm64/cortex":      "cortex",
		`./coco-1.0.73+180523.e6179a031de9-windows-amd64/cortex.exe`: "cortex",
		"./agy_acp_server.par":                                       "agy_acp_server",
		"./$(evil)":                                                  "",
		"":                                                           "",
	} {
		if got := binName(in); got != want {
			t.Errorf("binName(%q) = %q, want %q", in, got, want)
		}
	}
	// A Windows-only binary distribution still yields the bare name.
	bins, args := binaryBins(map[string]registryDist{"windows-x86_64": {Cmd: `./bin\devin.exe`, Args: []string{"acp"}}})
	if strings.Join(bins, ",") != "devin" || strings.Join(args, ",") != "acp" {
		t.Errorf("windows-only = %v %v", bins, args)
	}
	// Args come from the first platform in the preferred order.
	_, args = binaryBins(map[string]registryDist{
		"linux-x86_64":   {Cmd: "./x", Args: []string{"--uid="}},
		"darwin-aarch64": {Cmd: "./x"},
	})
	if len(args) != 0 {
		t.Errorf("args = %v, want darwin's (none)", args)
	}
	for spec, want := range map[string]string{
		"@qwen-code/qwen-code@0.25.3": "qwen",
		"@google/gemini-cli@0.64.0":   "gemini",
		"@xai-official/grok@1.0.64":   "grok",
		"@qoder-ai/qodercli@0.2.14":   "qodercli",
		"cline@3.0.73":                "cline",
		"@kilocode/cli@7.8.15":        "kilo",
		"@minimax-ai/code@0.2.7":      "mcode",
		"dirac-cli@0.5.22":            "dirac",
		"pi-acp@0.0.34":               "pi-acp",
		"plain":                       "plain",
	} {
		if got := npxBin(spec); len(got) != 1 || got[0] != want {
			t.Errorf("npxBin(%q) = %v, want %s", spec, got, want)
		}
	}
	for spec, want := range map[string]string{"fast-agent-acp==0.10.1": "fast-agent-acp", "minion-code@0.1.44": "minion-code", "x[extra]>=1": "x"} {
		if got := uvxBin(spec); len(got) != 1 || got[0] != want {
			t.Errorf("uvxBin(%q) = %v, want %s", spec, got, want)
		}
	}
}

func testCatalog(t *testing.T) *agentCatalog {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, agentRegistryFile), registryFixture(t), 0o600); err != nil {
		t.Fatal(err)
	}
	return newAgentCatalog(testStore(t), dir, "test")
}

func TestCatalogMergesBuiltinsAndRegistry(t *testing.T) {
	c := testCatalog(t)
	list := c.list()
	seen := map[string]bool{}
	for _, a := range list {
		if seen[a.Id] {
			t.Errorf("duplicate id %s", a.Id)
		}
		seen[a.Id] = true
		if a.Bins == nil || a.Args == nil {
			t.Errorf("%s has nil bins/args", a.Id)
		}
	}
	for i, b := range builtinAgents {
		if list[i].Id != b.Id || list[i].Source != "builtin" {
			t.Errorf("list[%d] = %s/%s, want builtin %s", i, list[i].Id, list[i].Source, b.Id)
		}
	}
	byId := catalogById(list)
	// Registry duplicates only update name/icon/description.
	cp := byId["copilot"]
	if cp.Name != "Copilot" || cp.Icon == "" || cp.Description == "" || strings.Join(cp.Bins, ",") != "copilot" ||
		cp.Install != "npm install -g @github/copilot" || cp.Vendor != "GitHub" {
		t.Errorf("copilot = %+v", cp)
	}
	if cur := byId["cursor"]; cur.Login != "cursor-agent login" || cur.Bins[0] != "cursor-agent" || cur.Icon == "" {
		t.Errorf("cursor = %+v", cur)
	}
	if byId["claude"].Protocol != "native" || byId["claude"].Icon != "" {
		t.Errorf("claude = %+v", byId["claude"])
	}
	if _, ok := byId["claude-acp"]; ok {
		t.Error("claude-acp must be skipped")
	}
	for id, want := range map[string]string{
		"devin": "devin acp", "factory-droid": "droid exec --output-format acp-daemon", "amp-acp": "amp-acp",
		"claude": "", "gemini": "", "copilot": "", "nope": "",
	} {
		if got := c.launchCommand(id); got != want {
			t.Errorf("launchCommand(%s) = %q, want %q", id, got, want)
		}
	}
	if !c.valid("devin") || !c.valid("acp") || !c.valid("cursor") || c.valid("claude-acp") || c.valid("nope") {
		t.Error("valid() wrong")
	}
	specs := c.detectSpecs(list)
	if len(specs) != len(list) || specs[0].Id != "claude" || specs[0].Bins[0] != "claude" {
		t.Errorf("specs = %+v", specs)
	}
}

func TestJoinCommandLineRoundTrip(t *testing.T) {
	for _, words := range [][]string{
		{"devin", "acp"}, {"agy", "--uid="}, {"a b", "it's", `back\slash`, `"q"`, ""}, {"x", "$HOME", "a;b"},
	} {
		got, err := protocol.SplitCommandLine(protocol.JoinCommandLine(words))
		if err != nil || strings.Join(got, "\x00") != strings.Join(words, "\x00") {
			t.Errorf("round trip %q → %q (%v)", words, got, err)
		}
	}
}

func TestRegistryOfflineCacheAndRefresh(t *testing.T) {
	fixture := registryFixture(t)
	// A hub with only a cached copy (no network: TestMain clears the URL)
	// has the registry agents from the start.
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, agentRegistryFile), fixture, 0o600); err != nil {
		t.Fatal(err)
	}
	srv, err := NewServer(Options{Addr: "127.0.0.1:0", DataDir: dir, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := srv.agents.lookup("devin"); !ok {
		t.Fatal("cached registry not loaded")
	}

	// refresh: a good download is cached; bad or oversized ones change nothing.
	body := []byte(`{"agents": [{"id": "only", "name": "Only", "distribution": {"npx": {"package": "only"}}}]}`)
	status := http.StatusOK
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(status)
		w.Write(body)
	}))
	defer ts.Close()
	empty := t.TempDir()
	c := newAgentCatalog(testStore(t), empty, "test")
	c.url = ts.URL
	if _, ok := c.lookup("devin"); ok {
		t.Fatal("no cache: registry agents should be absent")
	}
	if err := c.refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, ok := c.lookup("only"); !ok {
		t.Fatal("refreshed agent missing")
	}
	cached, err := os.ReadFile(filepath.Join(empty, agentRegistryFile))
	if err != nil || string(cached) != string(body) {
		t.Fatalf("cache = %q, %v", cached, err)
	}
	for _, bad := range []struct {
		status int
		body   []byte
	}{
		{http.StatusInternalServerError, fixture},
		{http.StatusOK, []byte("not json")},
		{http.StatusOK, append(append([]byte(`{"agents": [], "pad": "`), make([]byte, agentRegistryMaxSize)...), `"}`...)},
	} {
		status, body = bad.status, bad.body
		if err := c.refresh(context.Background()); err == nil {
			t.Errorf("refresh with status %d / %d bytes should fail", bad.status, len(bad.body))
		}
	}
	if _, ok := c.lookup("only"); !ok {
		t.Error("a failed refresh dropped the registry")
	}
	if again, _ := os.ReadFile(filepath.Join(empty, agentRegistryFile)); string(again) != string(cached) {
		t.Error("a failed refresh overwrote the cache")
	}
	// A new catalog on the same dir loads that cache.
	if _, ok := newAgentCatalog(testStore(t), empty, "test").lookup("only"); !ok {
		t.Error("cache not reloaded")
	}
}

func TestCustomAgentsAPI(t *testing.T) {
	srv, base := startHub(t)
	token, _ := srv.store.CreateApiToken("catalog-test")
	api := apiClient{t: t, base: base, token: token}

	for _, bad := range []map[string]string{
		{"name": "", "command": "x"},
		{"name": strings.Repeat("n", 81), "command": "x"},
		{"name": "ok", "command": ""},
		{"name": "ok", "command": `bad "quote`},
		{"name": "ok", "command": "''"},
	} {
		if code := api.do("POST", "/api/agents/custom", bad, nil); code != http.StatusBadRequest {
			t.Errorf("POST %v = %d, want 400", bad, code)
		}
	}
	var a, b CatalogAgent
	api.do("POST", "/api/agents/custom", map[string]string{"name": " My Agent! ", "command": "my-agent --acp 'two words'"}, &a)
	if a.Id != "custom-my-agent" || a.Name != "My Agent!" || a.Source != "custom" || a.Protocol != "acp" ||
		strings.Join(a.Bins, ",") != "my-agent" || strings.Join(a.Args, "|") != "--acp|two words" {
		t.Errorf("created = %+v", a)
	}
	api.do("POST", "/api/agents/custom", map[string]string{"name": "my agent", "command": "/opt/agent"}, &b)
	if b.Id != "custom-my-agent-2" {
		t.Errorf("second id = %s", b.Id)
	}
	var list []CatalogAgent
	api.do("GET", "/api/agents/catalog", nil, &list)
	byId := catalogById(list)
	if _, ok := byId[a.Id]; !ok || list[len(list)-1].Id != b.Id || list[0].Id != "claude" {
		t.Errorf("catalog = %+v", list)
	}
	if got := srv.agents.launchCommand(a.Id); got != "my-agent --acp 'two words'" {
		t.Errorf("launch = %q", got)
	}
	// Persisted: a fresh catalog on the same store has them.
	if _, ok := newAgentCatalog(srv.store, t.TempDir(), "test").lookup(b.Id); !ok {
		t.Error("custom agent not persisted")
	}
	api.do("DELETE", "/api/agents/custom/"+a.Id, nil, &map[string]bool{})
	if code := api.do("DELETE", "/api/agents/custom/"+a.Id, nil, nil); code != http.StatusNotFound {
		t.Errorf("second delete = %d", code)
	}
	if code := api.do("DELETE", "/api/agents/custom/claude", nil, nil); code != http.StatusNotFound {
		t.Errorf("delete builtin = %d", code)
	}
	if srv.agents.valid(a.Id) || !srv.agents.valid(b.Id) {
		t.Error("valid() after delete")
	}
}

func TestThreadInputValidatesCatalogIds(t *testing.T) {
	c := testCatalog(t)
	custom, err := c.addCustom("Mine", "mine --acp")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		agent, command, problem string
	}{
		{"claude", "", ""},
		{"gemini", "", ""},
		{"devin", "ignored --flag", ""},
		{custom.Id, "", ""},
		{"acp", "my-agent --acp", ""},
		{"acp", "", "command is required for a custom ACP agent"},
		{"nope", "", "unknown agent"},
		{"claude-acp", "", "unknown agent"},
		{"custom-missing", "x", "unknown agent"},
	} {
		in := threadInput{DeviceId: "d", Agent: tc.agent, Command: tc.command, Prompt: "hi"}
		if got := in.validate(c); got != tc.problem {
			t.Errorf("%s: problem = %q, want %q", tc.agent, got, tc.problem)
		}
		if tc.problem == "" && tc.agent != "acp" && in.Command != "" {
			t.Errorf("%s: command kept: %q", tc.agent, in.Command)
		}
	}
}

func TestMergeDetected(t *testing.T) {
	list := []CatalogAgent{{Id: "claude"}, {Id: "devin"}, {Id: "custom-x"}}
	// An older device reports only its built-ins (and extras the hub drops).
	got := mergeDetected(list, []protocol.AgentInfo{
		{Id: "acp", Installed: true}, {Id: "claude", Installed: true, Version: "2.1"}, {Id: "goose", Installed: true},
	})
	want := "claude:true:2.1 devin:false: custom-x:false: acp:true:"
	var parts []string
	for _, a := range got {
		parts = append(parts, fmt.Sprintf("%s:%v:%s", a.Id, a.Installed, a.Version))
	}
	if strings.Join(parts, " ") != want {
		t.Errorf("merged = %s, want %s", strings.Join(parts, " "), want)
	}
}

// End to end: the device detects catalog agents from PATH, and a thread on
// a custom agent runs its command through the ACP adapter.
func TestCatalogAgentsEndToEnd(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fake agents")
	}
	t.Setenv(fakeACPEnv, "1")
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	bin := t.TempDir()
	// The device prepends its managed dirs (~/.local/bin, …) to PATH, so the
	// fake uses a name no real install has.
	script := "#!/bin/sh\necho \"overseer-test-agent 3000.11.92 (test)\"\n"
	if err := os.WriteFile(filepath.Join(bin, "overseer-test-agent"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))

	srv, base := startHub(t)
	registry := must(parseRegistry(registryFixture(t)))
	registry = append(registry, CatalogAgent{Id: "test-agent", Name: "Test", Protocol: "acp", Source: "registry",
		Bins: []string{"overseer-test-agent"}, Args: []string{"acp"}})
	srv.agents.setRegistry(registry)
	deviceId := connectAgent(t, srv, base)
	token, _ := srv.store.CreateApiToken("catalog-e2e")
	api := apiClient{t: t, base: base, token: token}

	var custom CatalogAgent
	api.do("POST", "/api/agents/custom", map[string]string{"name": "Fake", "command": fmt.Sprintf("%q", exe)}, &custom)

	var agents []protocol.AgentInfo
	api.do("GET", "/api/devices/"+deviceId+"/agents", nil, &agents)
	byId := map[string]protocol.AgentInfo{}
	for _, a := range agents {
		byId[a.Id] = a
	}
	if len(agents) != len(srv.agents.list())+1 || agents[len(agents)-1].Id != "acp" {
		t.Errorf("got %d entries, want the catalog (%d) + acp", len(agents), len(srv.agents.list()))
	}
	if d := byId["test-agent"]; !d.Installed || d.Version != "3000.11.92" {
		t.Errorf("test-agent = %+v", d)
	}
	if _, ok := byId["devin"]; !ok {
		t.Error("devin not reported")
	}
	if p := byId["poolside"]; p.Installed {
		t.Errorf("poolside = %+v", p)
	}
	if c := byId[custom.Id]; !c.Installed {
		t.Errorf("custom = %+v (its command is an absolute path)", c)
	}
	// Cached: a second call within the TTL does not ask the device again.
	srv.agents.devMu.Lock()
	e := srv.agents.devDetects[deviceId]
	e.agents = []protocol.AgentInfo{{Id: "cached"}}
	srv.agents.devDetects[deviceId] = e
	srv.agents.devMu.Unlock()
	api.do("GET", "/api/devices/"+deviceId+"/agents", nil, &agents)
	if len(agents) != 1 || agents[0].Id != "cached" {
		t.Errorf("not served from cache: %d entries", len(agents))
	}
	api.do("GET", "/api/devices/"+deviceId+"/agents?refresh=1", nil, &agents)
	if len(agents) < 2 {
		t.Errorf("refresh served the cache")
	}

	var o protocol.AgentOptions
	api.do("GET", "/api/devices/"+deviceId+"/agents/"+custom.Id+"/options", nil, &o)
	if o.Source != "discovered" || o.Agent != custom.Id {
		t.Errorf("custom options = %+v", o)
	}
	if code := api.do("GET", "/api/devices/"+deviceId+"/agents/nope/options", nil, nil); code != http.StatusNotFound {
		t.Errorf("unknown agent options = %d", code)
	}

	var created Thread
	api.do("POST", "/api/threads", map[string]any{"deviceId": deviceId, "agent": custom.Id, "cwd": t.TempDir(), "prompt": "ping"}, &created)
	t.Cleanup(func() { exec.Command("tmux", "kill-session", "-t", "thread-"+created.Id[:8]).Run() })
	if created.Agent != custom.Id || created.Command != "" {
		t.Errorf("created = %+v", created)
	}
	w := &threadWatcher{t: t, ws: api.dial("/api/ws/threads/" + created.Id), messages: map[string]ThreadMessage{}}
	w.until("approval", func() bool { return w.find("approval", nil) != nil && w.thread.Status == "waiting" })
	if code := api.do("POST", "/api/threads", map[string]any{"deviceId": deviceId, "agent": "nope", "prompt": "x"}, nil); code != http.StatusBadRequest {
		t.Errorf("unknown agent thread = %d", code)
	}
}

func must[T any](v T, err error) T {
	if err != nil {
		panic(err)
	}
	return v
}
