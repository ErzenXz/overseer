package agent

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// Fixtures in testdata/ext were captured from the real CLIs on a Mac
// (Claude Code 2.1.285, codex-cli 0.161.0, Devin 3000.11.3) without sending a
// prompt, trimmed, with personal paths replaced by {{HOME}}, {{CLAUDE}},
// {{CODEX}} and {{PROJECT}}. SECRET-* values are planted where secrets live
// in real configs (env, headers, URLs, hook commands, the account) and must
// never reach the hub.

const (
	fakeExtEnv     = "OVERSEER_FAKE_EXT_CLI"
	fakeExtLogEnv  = "OVERSEER_FAKE_EXT_LOG"
	fakeExtDataEnv = "OVERSEER_FAKE_EXT_DATA"
	fakeExtProjEnv = "OVERSEER_FAKE_EXT_PROJECT"
	fakeExtSha     = "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
)

func fakeFixture(name string) []byte {
	b, err := os.ReadFile(filepath.Join(os.Getenv(fakeExtDataEnv), name))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(3)
	}
	r := strings.NewReplacer("{{HOME}}", os.Getenv("HOME"), "{{CLAUDE}}", os.Getenv("CLAUDE_CONFIG_DIR"),
		"{{CODEX}}", os.Getenv("CODEX_HOME"), "{{PROJECT}}", os.Getenv(fakeExtProjEnv))
	return []byte(r.Replace(string(b)))
}

// runFakeExtCLI answers like the claude, codex, devin or opencode named by
// argv[0], for the commands the inventory and the changes use.
func runFakeExtCLI() int {
	name := strings.TrimSuffix(filepath.Base(os.Args[0]), ".exe")
	args := os.Args[1:]
	logf := func(format string, a ...any) {
		if path := os.Getenv(fakeExtLogEnv); path != "" {
			if f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644); err == nil {
				fmt.Fprintf(f, name+" "+format+"\n", a...)
				f.Close()
			}
		}
	}
	logf("args %s", strings.Join(args, " "))
	joined := strings.Join(args, " ")
	has := func(s string) bool { return containsStr(args, s) }
	if has("--version") {
		fmt.Println(map[string]string{"claude": "2.1.999 (Claude Code)", "codex": "codex-cli 0.999.0", "devin": "devin 3000.0.0"}[name] + " 9.9.9")
		return 0
	}
	switch name {
	case "claude":
		switch {
		case strings.HasPrefix(joined, "plugin list --json --available"):
			os.Stdout.Write(fakeFixture("claude_available.json"))
		case strings.HasPrefix(joined, "plugin list --json"):
			os.Stdout.Write(fakeFixture("claude_plugins.json"))
		case strings.HasPrefix(joined, "plugin marketplace list --json"):
			os.Stdout.Write(fakeFixture("claude_marketplaces.json"))
		case len(args) > 2 && args[0] == "plugin" && (args[1] == "enable" || args[1] == "disable" || args[1] == "uninstall"):
			fmt.Printf(`{"command":%q,"outcome":"ok","plugin":%q,"scope":"user","message":"done"}`+"\n", args[1], args[2])
		case len(args) > 2 && args[0] == "plugin" && args[1] == "install":
			if has("-y") || has("--yes") {
				fmt.Println(`{"command":"install","outcome":"failed","message":"-y must never be passed"}`)
				return 1
			}
			if args[2] == "needs-cmd@mkt" && !strings.Contains(joined, "--accept-command "+fakeExtSha) {
				fmt.Printf(`{"command":"install","outcome":"failed","plugin":"needs-cmd@mkt","scope":"user","message":"This plugin runs a command","failureCode":"needs_confirmation","shownCommand":{"kind":"command_source","pluginId":"needs-cmd@mkt","command":["sh","-c","curl -fsSL https://example.com/i.sh | sh"],"catalogRevision":"r1","sha256":%q}}`+"\n", fakeExtSha)
				fmt.Fprintln(os.Stderr, "✘ needs confirmation")
				return 1
			}
			fmt.Printf(`{"command":"install","outcome":"ok","plugin":%q,"pluginId":%q,"scope":"user","message":"installed"}`+"\n", args[2], args[2])
		case has("--input-format"):
			ctrl := decodeObj(fakeFixture("claude_control.json"))
			in := bufio.NewScanner(os.Stdin)
			out := json.NewEncoder(os.Stdout)
			for in.Scan() {
				logf("in %s", in.Text())
				m := decodeObj(in.Bytes())
				sub := jStr(jObj(m, "request"), "subtype")
				resp, ok := ctrl[sub]
				if !ok {
					out.Encode(map[string]any{"type": "control_response", "response": map[string]any{"subtype": "error", "request_id": m["request_id"], "error": "Unsupported control request"}})
					continue
				}
				out.Encode(map[string]any{"type": "control_response", "response": map[string]any{"subtype": "success", "request_id": m["request_id"], "response": resp}})
			}
		default:
			fmt.Fprintln(os.Stderr, "unexpected claude call")
			return 2
		}
	case "codex":
		if len(args) == 0 || args[0] != "app-server" {
			return 2
		}
		reads := decodeObj(fakeFixture("codex_appserver.json"))
		in := bufio.NewScanner(os.Stdin)
		in.Buffer(make([]byte, 0, 64*1024), 8<<20)
		out := json.NewEncoder(os.Stdout)
		for in.Scan() {
			logf("in %s", in.Text())
			m := decodeObj(in.Bytes())
			method := jStr(m, "method")
			if m["id"] == nil {
				continue
			}
			var result any
			switch method {
			case "initialize":
				result = map[string]any{"userAgent": "codex/0.999.0", "codexHome": os.Getenv("CODEX_HOME")}
			case "skills/config/write":
				result = map[string]any{"effectiveEnabled": jObj(m, "params")["enabled"]}
			case "config/value/write":
				result = map[string]any{"status": "ok", "version": "sha256:y", "filePath": filepath.Join(os.Getenv("CODEX_HOME"), "config.toml")}
			case "plugin/install":
				result = map[string]any{"authPolicy": "ON_INSTALL", "appsNeedingAuth": []any{map[string]any{"name": "Linear"}}}
			case "plugin/uninstall":
				result = map[string]any{}
			default:
				r, ok := reads[method]
				if !ok {
					out.Encode(map[string]any{"id": m["id"], "error": map[string]any{"code": -32601, "message": "method not found"}})
					continue
				}
				result = r
			}
			out.Encode(map[string]any{"id": m["id"], "result": result})
		}
	case "devin":
		switch {
		case joined == "skills list --json":
			os.Stdout.Write(fakeFixture("devin_skills.json"))
		case len(args) >= 4 && args[0] == "mcp" && (args[1] == "enable" || args[1] == "disable"):
			fmt.Println("ok")
		default:
			return 2
		}
	}
	return 0
}

// extFixture is a temporary machine: HOME with Claude, Codex and Devin
// configs, a project, and fake CLIs on PATH.
type extFixture struct {
	home, claude, codex, project, log string
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func skillMd(name, desc string) string {
	return "---\nname: " + name + "\ndescription: " + desc + "\n---\n\n# " + name + "\n"
}

func resetExtState() {
	extState.mu.Lock()
	extState.detect = nil
	extState.snapshots = map[string]extSnapshot{}
	extState.approvals = map[string]extShown{}
	extState.mu.Unlock()
}

func newExtFixture(t *testing.T, agents ...string) extFixture {
	t.Helper()
	root := t.TempDir()
	root, _ = filepath.EvalSymlinks(root)
	f := extFixture{home: filepath.Join(root, "home"), project: filepath.Join(root, "proj"), log: filepath.Join(root, "calls.log")}
	f.claude = filepath.Join(f.home, ".claude")
	f.codex = filepath.Join(f.home, ".codex")
	t.Setenv("HOME", f.home)
	t.Setenv("USERPROFILE", f.home)
	t.Setenv("CLAUDE_CONFIG_DIR", f.claude)
	t.Setenv("CODEX_HOME", f.codex)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(f.home, ".config"))
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	bin := filepath.Join(root, "bin")
	os.MkdirAll(bin, 0o755)
	if len(agents) == 0 {
		agents = []string{"claude", "codex", "devin", "opencode"}
	}
	for _, name := range agents {
		if err := os.Symlink(exe, filepath.Join(bin, name)); err != nil {
			t.Skipf("symlink: %v", err)
		}
	}
	t.Setenv("PATH", bin)
	t.Setenv(fakeExtEnv, "1")
	t.Setenv(fakeExtLogEnv, f.log)
	data, _ := filepath.Abs(filepath.Join("testdata", "ext"))
	t.Setenv(fakeExtDataEnv, data)
	t.Setenv(fakeExtProjEnv, f.project)
	resetExtState()
	t.Cleanup(resetExtState)
	t.Cleanup(limitProbes.Wait)

	c, p := f.claude, f.project
	writeFile(t, filepath.Join(c, "skills", "vercel-doctor", "SKILL.md"), skillMd("vercel-doctor", "Find ways to cut your Vercel bill.")+"\nversion: 1\n")
	writeFile(t, filepath.Join(c, "skills", "synced", "bucket-1", "pdf", "SKILL.md"), skillMd("pdf", "PDF skill"))
	writeFile(t, filepath.Join(c, "settings.json"), `{
    "theme": "dark",
    "env": {"ANTHROPIC_API_KEY": "SECRET-SETTINGS-ENV"},
    "enabledPlugins": {"vercel@claude-plugins-official": true}
}
`)
	writeFile(t, filepath.Join(c, "CLAUDE.md"), "# me\n")
	writeFile(t, filepath.Join(c, "agents", "reviewer.md"), "---\nname: reviewer\ndescription: Reviews code\n---\nbody\n")
	writeFile(t, filepath.Join(c, "commands", "git", "commit.md"), "---\ndescription: Commit\nargument-hint: \"[msg]\"\n---\nbody\n")
	writeFile(t, filepath.Join(c, ".claude.json"), `{"oauthAccount":{"emailAddress":"SECRET-MAIL","organizationUuid":"SECRET-ORG-ID"},
"mcpServers":{"local-db":{"command":"npx","args":["db","--password","SECRET-ARG2"],"env":{"DB_PASSWORD":"SECRET-CLAUDE-ENV"}}},
"projects":{"`+p+`":{"mcpServers":{"proj-local":{"type":"sse","url":"https://u:SECRET-USERINFO@sse.example.com/s"}},"enabledMcpjsonServers":["approved"]}},
"skillUsage":{"vercel-doctor":{"usageCount":3,"lastUsedAt":1792417784126}},
"pluginUsage":{"vercel@claude-plugins-official":{"usageCount":7,"lastUsedAt":1792417784126}}}`)
	vp := filepath.Join(c, "plugins", "cache", "claude-plugins-official", "vercel", "0.50.0")
	writeFile(t, filepath.Join(vp, ".claude-plugin", "plugin.json"), `{"name":"vercel","version":"0.50.0","description":"Build and deploy web apps and agents","repository":"https://github.com/vercel/vercel-plugin"}`)
	writeFile(t, filepath.Join(vp, "skills", "nextjs", "SKILL.md"), skillMd("nextjs", "Next.js guidance"))
	writeFile(t, filepath.Join(vp, "skills", "ai-sdk", "SKILL.md"), skillMd("ai-sdk", "AI SDK guidance"))
	writeFile(t, filepath.Join(vp, "commands", "deploy.md"), "---\ndescription: Deploy\n---\n")
	writeFile(t, filepath.Join(vp, "commands", "env.md"), "---\ndescription: Not loaded\n---\n")
	writeFile(t, filepath.Join(vp, "commands", "_conventions.md"), "shared\n")
	writeFile(t, filepath.Join(vp, "agents", "ai-architect.md"), "---\nname: ai-architect\ndescription: Architect\n---\n")
	writeFile(t, filepath.Join(vp, "hooks", "hooks.json"), `{}`)
	writeFile(t, filepath.Join(c, "plugins", "cache", "claude-plugins-official", "ghost", "1.0.0", "skills", "ghost-skill", "SKILL.md"), skillMd("ghost-skill", "Ghost"))
	writeFile(t, filepath.Join(c, "plugins", "synced", "bucket-1", "cowork-plugin-management", "skills", "create-cowork-plugin", "SKILL.md"), skillMd("create-cowork-plugin", "Cowork"))
	writeFile(t, filepath.Join(c, "plugins", "marketplaces", "claude-plugins-official", ".claude-plugin", "marketplace.json"), `{"name":"claude-plugins-official","plugins":[]}`)
	writeFile(t, filepath.Join(f.home, ".agents", "skills", "shared-skill", "SKILL.md"), skillMd("shared-skill", "Shared .agents skill"))
	writeFile(t, filepath.Join(f.codex, "AGENTS.md"), "# codex\n")
	writeFile(t, filepath.Join(f.home, ".config", "devin", "mcp_config.json"), `{"mcpServers":{"devin-user":{"url":"https://d.example.com/mcp","headers":{"Authorization":"SECRET-DEVIN-HDR"}}}}`)
	writeFile(t, filepath.Join(p, ".claude", "skills", "pskill", "SKILL.md"), skillMd("pskill", "P skill"))
	writeFile(t, filepath.Join(p, ".agents", "skills", "repo-skill", "SKILL.md"), skillMd("repo-skill", "Repo skill"))
	writeFile(t, filepath.Join(p, "CLAUDE.md"), "# project\n")
	writeFile(t, filepath.Join(p, "AGENTS.md"), "# agents\n")
	writeFile(t, filepath.Join(p, ".mcp.json"), `{"mcpServers":{"approved":{"command":"node","env":{"K":"SECRET-MCPJSON"}},"pending":{"url":"https://p.example.com"}}}`)
	writeFile(t, filepath.Join(p, ".devin", "mcp_config.json"), `{"mcpServers":{"devin-srv":{"command":"uvx","env":{"T":"SECRET-DEVIN"},"disabled":true}}}`)
	return f
}

func (f extFixture) calls(t *testing.T) string {
	limitProbes.Wait()
	b, _ := os.ReadFile(f.log)
	return string(b)
}

func findItem(items []protocol.ExtItem, agent, kind, qname string) *protocol.ExtItem {
	for i := range items {
		if items[i].Agent == agent && items[i].Kind == kind && items[i].QualifiedName == qname {
			return &items[i]
		}
	}
	return nil
}

func mustItem(t *testing.T, items []protocol.ExtItem, agent, kind, qname string) protocol.ExtItem {
	t.Helper()
	it := findItem(items, agent, kind, qname)
	if it == nil {
		var have []string
		for _, x := range items {
			if x.Agent == agent && x.Kind == kind {
				have = append(have, x.QualifiedName)
			}
		}
		t.Fatalf("no %s %s %q; have %q", agent, kind, qname, have)
	}
	return *it
}

func TestExtInventoryWithFakeCLIs(t *testing.T) {
	f := newExtFixture(t)
	res, err := listExtensions(protocol.ExtListRequest{Cwd: f.project})
	if err != nil {
		t.Fatal(err)
	}
	assertNoExtSecrets(t, "inventory", res)
	for _, s := range []string{"SECRET", "npx db", "--password"} {
		b, _ := json.Marshal(res)
		if strings.Contains(string(b), s) {
			t.Errorf("inventory contains %q", s)
		}
	}
	status := map[string]protocol.ExtAgentStatus{}
	for _, a := range res.Agents {
		status[a.Agent] = a
	}
	for _, a := range []string{"claude", "codex", "devin"} {
		if !status[a].Ok || status[a].Version == "" {
			t.Errorf("%s status = %+v", a, status[a])
		}
	}
	if _, ok := status["opencode"]; ok {
		t.Errorf("opencode has nothing of its own to report: %+v", status["opencode"])
	}
	items := res.Items

	// Claude.
	vd := mustItem(t, items, "claude", protocol.ExtSkill, "vercel-doctor")
	if vd.Scope != protocol.ScopeUser || vd.Path != filepath.Join(f.claude, "skills", "vercel-doctor", "SKILL.md") || vd.Enabled == nil || !*vd.Enabled ||
		vd.Cost == nil || vd.Cost.AlwaysOnTokens != 43 || vd.Usage == nil || vd.Usage.Count != 3 || strings.Join(vd.SharedWith, ",") != "devin,opencode" {
		t.Errorf("vercel-doctor = %+v", vd)
	}
	if p := mustItem(t, items, "claude", protocol.ExtSkill, "pskill"); p.Scope != protocol.ScopeProject || p.ProjectPath != f.project || p.Path == "" ||
		strings.Join(p.SharedWith, ",") != "devin,opencode" {
		t.Errorf("pskill = %+v", p)
	}
	nx := mustItem(t, items, "claude", protocol.ExtSkill, "vercel:nextjs")
	if nx.Scope != protocol.ScopePlugin || nx.LockedBy != "plugin" || nx.ParentId != "vercel@claude-plugins-official" || nx.Name != "nextjs" || !strings.HasSuffix(nx.Path, "skills/nextjs/SKILL.md") {
		t.Errorf("vercel:nextjs = %+v", nx)
	}
	if ai := mustItem(t, items, "claude", protocol.ExtSkill, "vercel:ai-sdk"); ai.State != "name-only" || ai.Enabled == nil || !*ai.Enabled {
		t.Errorf("vercel:ai-sdk = %+v", ai)
	}
	if s := mustItem(t, items, "claude", protocol.ExtSkill, "anthropic-skills:pdf"); s.Scope != protocol.ScopeSynced || s.Path == "" {
		t.Errorf("synced skill = %+v", s)
	}
	if g := mustItem(t, items, "claude", protocol.ExtSkill, "ghost:ghost-skill"); g.Enabled == nil || *g.Enabled || g.LockedBy != "plugin" {
		t.Errorf("disabled plugin's skill = %+v", g)
	}
	if p := mustItem(t, items, "claude", protocol.ExtPlugin, "vercel@claude-plugins-official"); p.Scope != protocol.ScopeUser || p.Version != "0.50.0" ||
		p.Description == "" || p.Usage == nil || p.Usage.Count != 7 || p.ParentId != "claude-plugins-official" {
		t.Errorf("vercel plugin = %+v", p)
	}
	if p := mustItem(t, items, "claude", protocol.ExtPlugin, "ghost@claude-plugins-official"); p.Scope != protocol.ScopeProject || p.ProjectPath != f.project || *p.Enabled {
		t.Errorf("ghost plugin = %+v", p)
	}
	if p := mustItem(t, items, "claude", protocol.ExtPlugin, "cowork-plugin-management@synced"); p.Scope != protocol.ScopeSynced {
		t.Errorf("synced plugin = %+v", p)
	}
	mustItem(t, items, "claude", protocol.ExtCommand, "vercel:deploy")
	for _, q := range []string{"vercel:env", "vercel:_conventions"} {
		if findItem(items, "claude", protocol.ExtCommand, q) != nil {
			t.Errorf("%s is not loaded by Claude", q)
		}
	}
	if c := mustItem(t, items, "claude", protocol.ExtCommand, "git:commit"); c.Scope != protocol.ScopeUser || c.Invocation == nil || c.Invocation.ArgumentHint != "[msg]" {
		t.Errorf("user command = %+v", c)
	}
	mustItem(t, items, "claude", protocol.ExtSubagent, "vercel:ai-architect")
	mustItem(t, items, "claude", protocol.ExtSubagent, "reviewer")
	if e := mustItem(t, items, "claude", protocol.ExtSubagent, "Explore"); e.Scope != protocol.ScopeBuiltin || e.Path != "" {
		t.Errorf("Explore = %+v", e)
	}
	if m := mustItem(t, items, "claude", protocol.ExtMcpServer, "plugin:vercel:secret"); m.Mcp == nil || m.Mcp.Url != "https://mcp.example.com/x" {
		t.Errorf("plugin mcp = %+v", m.Mcp)
	}
	if m := mustItem(t, items, "claude", protocol.ExtMcpServer, "local-db"); m.Mcp.Command != "npx" || m.Mcp.Transport != "stdio" || m.Scope != protocol.ScopeUser {
		t.Errorf("user mcp = %+v %+v", m, m.Mcp)
	}
	if m := mustItem(t, items, "claude", protocol.ExtMcpServer, "proj-local"); m.Scope != protocol.ScopeLocal || m.Mcp.Url != "https://sse.example.com/s" || m.Mcp.Transport != "sse" {
		t.Errorf("local mcp = %+v %+v", m, m.Mcp)
	}
	if m := mustItem(t, items, "claude", protocol.ExtMcpServer, "approved"); !*m.Enabled {
		t.Errorf("approved = %+v", m)
	}
	if m := mustItem(t, items, "claude", protocol.ExtMcpServer, "pending"); *m.Enabled || m.State != "untrusted" {
		t.Errorf("pending = %+v", m)
	}
	var userHook *protocol.ExtItem
	hooks := 0
	for i, it := range items {
		if it.Agent == "claude" && it.Kind == protocol.ExtHook {
			hooks++
			if it.Scope == protocol.ScopeUser {
				userHook = &items[i]
			}
		}
	}
	if hooks != 3 || userHook == nil || userHook.Hook.Matcher != "Bash" || strings.Contains(userHook.Hook.Command, "SECRET") ||
		!strings.Contains(userHook.Hook.Command, "curl -s") {
		t.Errorf("hooks = %d, user hook = %+v", hooks, userHook)
	}
	if r := mustItem(t, items, "claude", protocol.ExtRule, "~/.claude/CLAUDE.md"); r.Scope != protocol.ScopeUser {
		t.Errorf("user rule = %+v", r)
	}
	mustItem(t, items, "claude", protocol.ExtRule, "CLAUDE.md")
	mustItem(t, items, "claude", protocol.ExtMarketplace, "claude-plugins-official")

	// Codex.
	if s := mustItem(t, items, "codex", protocol.ExtSkill, "pdf:pdf"); s.Scope != protocol.ScopePlugin || s.ParentId != "pdf@openai-primary-runtime" || s.DisplayName != "PDF" {
		t.Errorf("codex plugin skill = %+v", s)
	}
	if s := mustItem(t, items, "codex", protocol.ExtSkill, "imagegen"); s.Scope != protocol.ScopeSystem {
		t.Errorf("system skill = %+v", s)
	}
	if s := mustItem(t, items, "codex", protocol.ExtSkill, "shared-skill"); strings.Join(s.SharedWith, ",") != "devin,opencode" {
		t.Errorf("shared-skill = %+v", s)
	}
	if s := mustItem(t, items, "codex", protocol.ExtSkill, "repo-skill"); s.Scope != protocol.ScopeProject || *s.Enabled || s.ProjectPath != f.project {
		t.Errorf("repo-skill = %+v", s)
	}
	mustItem(t, items, "codex", protocol.ExtPlugin, "pdf@openai-primary-runtime")
	if findItem(items, "codex", protocol.ExtPlugin, "linear@openai-curated") != nil {
		t.Error("a plugin that is not installed is not an item")
	}
	if h := mustItem(t, items, "codex", protocol.ExtHook, "user:pre_tool_use:0"); h.State != "untrusted" || h.Hook.Trust != "untrusted" || strings.Contains(h.Hook.Command, "SECRET") {
		t.Errorf("codex hook = %+v %+v", h, h.Hook)
	}
	if m := mustItem(t, items, "codex", protocol.ExtMcpServer, "node_repl"); m.Mcp.Command != "/opt/node_repl/bin/node_repl" {
		t.Errorf("node_repl = %+v", m.Mcp)
	}
	if m := mustItem(t, items, "codex", protocol.ExtMcpServer, "remote"); *m.Enabled || m.Mcp.Url != "https://mcp.example.com/mcp" {
		t.Errorf("remote = %+v %+v", m, m.Mcp)
	}
	// Plugin-provided and built-in servers only show up in mcpServerStatus/list,
	// which inventory doesn't call (it would start every server).
	if findItem(items, "codex", protocol.ExtMcpServer, "codex_apps") != nil {
		t.Error("codex_apps comes from the runtime status, which inventory must not read")
	}
	if r := mustItem(t, items, "codex", protocol.ExtRule, "AGENTS.md"); strings.Join(r.SharedWith, ",") != "devin,opencode" {
		t.Errorf("AGENTS.md = %+v", r)
	}

	// Devin.
	if s := mustItem(t, items, "devin", protocol.ExtSkill, "vercel-doctor"); s.Path == "" || strings.Join(s.SharedWith, ",") != "claude,opencode" {
		t.Errorf("devin vercel-doctor = %+v", s)
	}
	if s := mustItem(t, items, "devin", protocol.ExtSkill, "devin-cli"); s.Scope != protocol.ScopeBuiltin || s.Invocation.User || !s.Invocation.Model {
		t.Errorf("devin builtin = %+v", s)
	}
	if m := mustItem(t, items, "devin", protocol.ExtMcpServer, "devin-srv"); m.Scope != protocol.ScopeProject || *m.Enabled {
		t.Errorf("devin-srv = %+v", m)
	}
	mustItem(t, items, "devin", protocol.ExtMcpServer, "devin-user")
	for _, it := range items {
		if it.Agent == "opencode" {
			t.Errorf("opencode duplicates %s %s", it.Kind, it.QualifiedName)
		}
	}

	// Keys are stable and unique.
	again, _ := listExtensions(protocol.ExtListRequest{Cwd: f.project})
	keys := map[string]bool{}
	for i, it := range res.Items {
		if keys[it.Key] {
			t.Errorf("duplicate key %s", it.Key)
		}
		keys[it.Key] = true
		if i < len(again.Items) && again.Items[i].Key != it.Key {
			t.Errorf("key changed: %s -> %s", it.Key, again.Items[i].Key)
		}
	}

	// No prompt, no MCP listing, hooks off for the probe.
	log := f.calls(t)
	for _, want := range []string{`{"disableAllHooks":true}`, "--no-session-persistence", "--strict-mcp-config", `"subtype":"get_skills_dialog"`, "skills/list", "config/read"} {
		if !strings.Contains(log, want) {
			t.Errorf("log missing %s", want)
		}
	}
	for _, never := range []string{`"type":"user"`, "thread/start", "turn/start", "claude args mcp", "mcpServerStatus/list", "plugin install", "config/value/write", "skills/config/write"} {
		if strings.Contains(log, never) {
			t.Errorf("inventory ran %q:\n%s", never, log)
		}
	}
}

// A user without a project: only user-level items, and a CLI that fails
// still leaves the file scan's items with the error reported.
func TestExtInventoryPartial(t *testing.T) {
	newExtFixture(t, "claude")
	t.Setenv(fakeExtDataEnv, t.TempDir()) // fixtures missing: the fake CLI fails
	res, err := listExtensions(protocol.ExtListRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Agents) != 1 || res.Agents[0].Ok || res.Agents[0].Error == "" {
		t.Fatalf("agents = %+v", res.Agents)
	}
	if s := mustItem(t, res.Items, "claude", protocol.ExtSkill, "vercel-doctor"); s.Path == "" || s.Enabled == nil || !*s.Enabled {
		t.Errorf("file-scan skill = %+v", s)
	}
	for _, it := range res.Items {
		if it.Scope == protocol.ScopeProject || it.ProjectPath != "" {
			t.Errorf("project item without cwd: %+v", it)
		}
	}
	if _, err := listExtensions(protocol.ExtListRequest{Cwd: "relative/path"}); err == nil {
		t.Error("relative cwd accepted")
	}
}

func TestExtItemDetail(t *testing.T) {
	f := newExtFixture(t)
	res, _ := listExtensions(protocol.ExtListRequest{Cwd: f.project})
	vd := mustItem(t, res.Items, "claude", protocol.ExtSkill, "vercel-doctor")
	d, err := extItemDetail(protocol.ExtKeyRequest{Key: vd.Key})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(d.Content, "# vercel-doctor") || d.Frontmatter["name"] != "vercel-doctor" || d.Item.Key != vd.Key {
		t.Errorf("detail = %+v", d)
	}
	// Plugins and MCP servers have no content (their files can hold secrets).
	for _, q := range [][2]string{{protocol.ExtPlugin, "vercel@claude-plugins-official"}, {protocol.ExtMcpServer, "local-db"}} {
		it := mustItem(t, res.Items, "claude", q[0], q[1])
		d, err := extItemDetail(protocol.ExtKeyRequest{Key: it.Key})
		if err != nil || d.Content != "" {
			t.Errorf("%s: content %q err %v", q[1], d.Content, err)
		}
	}
	// Large files are cut at 64 KB.
	writeFile(t, filepath.Join(f.home, ".agents", "skills", "big", "SKILL.md"), skillMd("big", "Big")+strings.Repeat("é", 40000))
	resetExtState()
	res, _ = listExtensions(protocol.ExtListRequest{})
	big := mustItem(t, res.Items, "codex", protocol.ExtSkill, "big")
	if d, err := extItemDetail(protocol.ExtKeyRequest{Key: big.Key}); err != nil || len(d.Content) > extMaxContent || len(d.Content) < extMaxContent-4 {
		t.Errorf("big content = %d bytes, %v", len(d.Content), err)
	}

	// Only keys the inventory reports resolve: made-up names, traversal and
	// other projects are refused.
	secret := filepath.Join(f.home, "secret.md")
	writeFile(t, secret, "SECRET-FILE\n")
	for _, key := range []string{
		"",
		"nonsense",
		extKey("claude", protocol.ExtSkill, protocol.ScopeUser, "../../secret", ""),
		extKey("claude", protocol.ExtSkill, protocol.ScopeUser, secret, ""),
		extKey("claude", protocol.ExtRule, protocol.ScopeUser, "~/secret.md", ""),
		extKey("claude", protocol.ExtRule, protocol.ScopeProject, "../secret.md", f.project),
		extKey("claude", protocol.ExtSkill, protocol.ScopeProject, "pskill", "relative"),
		extKey("claude", protocol.ExtSkill, protocol.ScopeProject, "pskill", filepath.Join(f.project, "missing")),
		vd.Key + ":extra",
	} {
		d, err := extItemDetail(protocol.ExtKeyRequest{Key: key})
		if err == nil || strings.Contains(d.Content, "SECRET") {
			t.Errorf("key %q resolved: %+v", key, d)
		}
	}
	if _, err := readReportedFile(filepath.Join(f.claude, ".claude.json")); err == nil {
		t.Error("read a JSON file")
	}
}

func TestFrontmatter(t *testing.T) {
	fm, body, ok := parseFrontmatter([]byte("\xef\xbb\xbf---\r\nname: nextjs\r\ndescription: \"Quoted: with colon\"\r\n" +
		"user-invocable: false\ndisable-model-invocation: true\nallowed-tools: Bash(git:*) Read\n" +
		"triggers: [user, \"model\"]\nmetadata:\n  priority: 5\n  docs: ['https://nextjs.org/docs']\n  pathPatterns:\n    - 'next.config.*'\n    - app/**\n" +
		"when_to_use: |\n  line one\n  line two\nfolded: >\n  a\n  b\n# comment\nversion: 1.0.0\nhooks:\n  - event: PreToolUse\n    command: x\n---\nBody here\n"))
	if !ok || body != "Body here\n" {
		t.Fatalf("ok=%v body=%q", ok, body)
	}
	want := map[string]any{"name": "nextjs", "description": "Quoted: with colon", "user-invocable": false, "disable-model-invocation": true,
		"allowed-tools": "Bash(git:*) Read", "when_to_use": "line one\nline two", "folded": "a b", "version": "1.0.0"}
	for k, v := range want {
		if fm[k] != v {
			t.Errorf("%s = %#v, want %#v", k, fm[k], v)
		}
	}
	md := fm["metadata"].(map[string]any)
	if md["priority"] != int64(5) || fmt.Sprint(md["docs"]) != "[https://nextjs.org/docs]" || fmt.Sprint(md["pathPatterns"]) != "[next.config.* app/**]" {
		t.Errorf("metadata = %#v", md)
	}
	if fmt.Sprint(fm["triggers"]) != "[user model]" || fmt.Sprint(fm["hooks"]) != "[map[command:x event:PreToolUse]]" {
		t.Errorf("triggers=%v hooks=%v", fm["triggers"], fm["hooks"])
	}
	inv := invocationFrom(fm)
	if !inv.User || !inv.Model { // triggers win over the Claude keys
		t.Errorf("invocation = %+v", inv)
	}
	for _, bad := range []string{"no frontmatter", "---\nname: x\n", "---\n: broken\n  - [\n---\n"} {
		fm, _, _ := parseFrontmatter([]byte(bad))
		_ = fm // lenient: never panics
	}
}

func TestScrubbing(t *testing.T) {
	cases := map[string]string{
		"node server.js --api-key sk-ant-abcdefgh123":                                      "node server.js --api-key [redacted]",
		"curl -H 'Authorization: Bearer abcdefghijklmnop' https://x.example.com/a?token=z": "curl -H 'Authorization: [redacted]' https://x.example.com/a?[redacted]",
		"GITHUB_TOKEN=ghp_abcdefghijk1234 run":                                             "GITHUB_TOKEN=[redacted] run",
		"https://user:pass@host.example.com/path":                                          "https://[redacted]@host.example.com/path",
		"plain command --verbose":                                                          "plain command --verbose",
	}
	for in, want := range cases {
		if got := scrubCommand(in); got != want {
			t.Errorf("scrubCommand(%q) = %q, want %q", in, got, want)
		}
	}
	if got := scrubURL("https://u:p@mcp.example.com/mcp?key=1#x"); got != "https://mcp.example.com/mcp" {
		t.Errorf("scrubURL = %q", got)
	}
}
