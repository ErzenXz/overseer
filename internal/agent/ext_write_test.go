package agent

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ErzenXz/overseer/internal/protocol"
)

func TestSetJSONSetting(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	orig := `{
    "theme": "dark",
    "permissions": {"allow": ["Bash(ls:*)"], "deny": []},
    "big": 12345678901234567890,
    "html": "<b>&</b>",
    "skillOverrides": {"keep": "name-only"}
}
`
	writeFile(t, path, orig)
	os.Chmod(path, 0o600)
	if err := setJSONSetting(path, []string{"skillOverrides", "foo"}, "off"); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(path)
	got := string(b)
	want := `{
    "theme": "dark",
    "permissions": {
        "allow": [
            "Bash(ls:*)"
        ],
        "deny": []
    },
    "big": 12345678901234567890,
    "html": "<b>&</b>",
    "skillOverrides": {
        "keep": "name-only",
        "foo": "off"
    }
}
`
	if got != want {
		t.Errorf("after set:\n%s\nwant\n%s", got, want)
	}
	if fi, _ := os.Stat(path); fi.Mode().Perm() != 0o600 {
		t.Errorf("mode = %v", fi.Mode().Perm())
	}
	// Removing the last override drops the empty object.
	setJSONSetting(path, []string{"skillOverrides", "foo"}, nil)
	setJSONSetting(path, []string{"skillOverrides", "keep"}, nil)
	b, _ = os.ReadFile(path)
	if strings.Contains(string(b), "skillOverrides") || !strings.Contains(string(b), `"theme": "dark"`) {
		t.Errorf("after removal:\n%s", b)
	}
	// A new file; a missing file and nil is a no-op.
	fresh := filepath.Join(dir, "sub", "settings.local.json")
	if err := setJSONSetting(fresh, []string{"skillOverrides", "x"}, "off"); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(fresh); string(b) != "{\n  \"skillOverrides\": {\n    \"x\": \"off\"\n  }\n}\n" {
		t.Errorf("fresh = %q", b)
	}
	if err := setJSONSetting(filepath.Join(dir, "none.json"), []string{"a", "b"}, nil); err != nil {
		t.Error(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "none.json")); err == nil {
		t.Error("removing from a missing file created it")
	}
	// Invalid JSON, a non-object root, and a non-object parent are left alone.
	for _, bad := range []string{`{"a": 1,}`, `[1]`, `{"skillOverrides": "nope"}`, `{"a":1} {"b":2}`} {
		p := filepath.Join(dir, "bad.json")
		writeFile(t, p, bad)
		if err := setJSONSetting(p, []string{"skillOverrides", "x"}, "off"); err == nil {
			t.Errorf("%s: accepted", bad)
		}
		if b, _ := os.ReadFile(p); string(b) != bad {
			t.Errorf("%s: changed to %s", bad, b)
		}
	}
}

func listFixture(t *testing.T, f extFixture) []protocol.ExtItem {
	t.Helper()
	res, err := listExtensions(protocol.ExtListRequest{Cwd: f.project})
	if err != nil {
		t.Fatal(err)
	}
	return res.Items
}

func TestExtToggles(t *testing.T) {
	f := newExtFixture(t)
	items := listFixture(t, f)
	on, off := true, false

	// Claude user skill: ~/.claude/settings.json, other keys kept.
	vd := mustItem(t, items, "claude", protocol.ExtSkill, "vercel-doctor")
	res, err := extToggle(protocol.ExtToggleRequest{Key: vd.Key, Enabled: &off})
	if err != nil || res.Item == nil || *res.Item.Enabled || res.Note == "" {
		t.Fatalf("toggle = %+v, %v", res, err)
	}
	settings := readJSONFile(filepath.Join(f.claude, "settings.json"))
	if jObj(settings, "skillOverrides")["vercel-doctor"] != "off" || jStr(settings, "theme") != "dark" || jObj(settings, "env")["ANTHROPIC_API_KEY"] != "SECRET-SETTINGS-ENV" {
		t.Errorf("settings = %v", settings)
	}
	if _, err := extToggle(protocol.ExtToggleRequest{Key: vd.Key, Enabled: &on}); err != nil {
		t.Fatal(err)
	}
	if _, ok := jObj(readJSONFile(filepath.Join(f.claude, "settings.json")), "skillOverrides")["vercel-doctor"]; ok {
		t.Error("turning on should remove the override")
	}
	// Claude project skill: the project's settings.local.json.
	ps := mustItem(t, items, "claude", protocol.ExtSkill, "pskill")
	if _, err := extToggle(protocol.ExtToggleRequest{Key: ps.Key, Enabled: &off}); err != nil {
		t.Fatal(err)
	}
	if jObj(readJSONFile(filepath.Join(f.project, ".claude", "settings.local.json")), "skillOverrides")["pskill"] != "off" {
		t.Error("project override not written")
	}
	// Turning it on while another layer says off writes "on".
	writeFile(t, filepath.Join(f.claude, "settings.json"), `{"skillOverrides":{"pskill":"off"}}`)
	if _, err := extToggle(protocol.ExtToggleRequest{Key: ps.Key, Enabled: &on}); err != nil {
		t.Fatal(err)
	}
	if v := jObj(readJSONFile(filepath.Join(f.project, ".claude", "settings.local.json")), "skillOverrides")["pskill"]; v != "on" {
		t.Errorf("override = %v", v)
	}

	// Read-only and locked items are refused.
	for _, q := range [][3]string{
		{"claude", protocol.ExtSkill, "vercel:nextjs"},
		{"claude", protocol.ExtSkill, "anthropic-skills:pdf"},
		{"claude", protocol.ExtPlugin, "cowork-plugin-management@synced"},
		{"claude", protocol.ExtSubagent, "Explore"},
		{"claude", protocol.ExtHook, ""},
		{"codex", protocol.ExtSkill, "imagegen"},
		{"devin", protocol.ExtSkill, "devin-cli"},
		{"claude", protocol.ExtMcpServer, "local-db"},
	} {
		var it *protocol.ExtItem
		if q[2] == "" {
			for i := range items {
				if items[i].Agent == q[0] && items[i].Kind == q[1] {
					it = &items[i]
					break
				}
			}
		} else {
			it = findItem(items, q[0], q[1], q[2])
		}
		if it == nil {
			t.Fatalf("missing %v", q)
		}
		if _, err := extToggle(protocol.ExtToggleRequest{Key: it.Key, Enabled: &off}); err == nil {
			t.Errorf("%v: toggle accepted", q)
		}
	}
	if _, err := extToggle(protocol.ExtToggleRequest{Key: vd.Key}); err == nil {
		t.Error("toggle without enabled accepted")
	}

	// Claude plugin, Codex skill / plugin / MCP, Devin MCP go through the CLIs.
	items = listFixture(t, f)
	for _, q := range [][3]string{
		{"claude", protocol.ExtPlugin, "ghost@claude-plugins-official"},
		{"codex", protocol.ExtSkill, "repo-skill"},
		{"codex", protocol.ExtPlugin, "pdf@openai-primary-runtime"},
		{"codex", protocol.ExtMcpServer, "node_repl"},
		{"devin", protocol.ExtMcpServer, "devin-srv"},
	} {
		it := mustItem(t, items, q[0], q[1], q[2])
		res, err := extToggle(protocol.ExtToggleRequest{Key: it.Key, Enabled: &on})
		if err != nil || res.Item == nil || !*res.Item.Enabled || res.Note == "" {
			t.Errorf("%v: %+v %v", q, res, err)
		}
	}
	log := f.calls(t)
	for _, want := range []string{
		"claude args plugin enable ghost@claude-plugins-official -s project --json",
		`"method":"skills/config/write","params":{"enabled":true,"path":"` + filepath.Join(f.project, ".agents", "skills", "repo-skill", "SKILL.md") + `"}`,
		`"keyPath":"plugins.\"pdf@openai-primary-runtime\".enabled"`,
		`"keyPath":"mcp_servers.\"node_repl\".enabled"`,
		"devin args mcp enable -s project devin-srv",
	} {
		if !strings.Contains(log, want) {
			t.Errorf("log missing %s", want)
		}
	}
}

func TestExtInstallApproval(t *testing.T) {
	f := newExtFixture(t, "claude", "codex")
	ask := func(accept string) protocol.ExtChangeResult {
		t.Helper()
		res, err := extInstall(protocol.ExtInstallRequest{Agent: "claude", Id: "needs-cmd@mkt", Scope: "user", AcceptCommand: accept})
		if err != nil {
			t.Fatalf("install(%q): %v", accept, err)
		}
		return res
	}
	// An accept before the CLI showed anything is not passed on.
	res := ask(fakeExtSha)
	if res.NeedsApproval == nil || res.NeedsApproval.Sha != fakeExtSha ||
		res.NeedsApproval.Command != `sh -c "curl -fsSL https://example.com/i.sh | sh"` || res.Item != nil {
		t.Fatalf("first = %+v", res)
	}
	// A different sha is not passed on either.
	if res := ask(strings.Repeat("a", 64)); res.NeedsApproval == nil {
		t.Fatalf("wrong sha = %+v", res)
	}
	log := f.calls(t)
	if strings.Contains(log, "--accept-command") || strings.Contains(log, " -y") {
		t.Fatalf("accepted without approval:\n%s", log)
	}
	// The sha the CLI showed: installed.
	res = ask(fakeExtSha)
	if res.NeedsApproval != nil || res.Item == nil || res.Item.QualifiedName != "needs-cmd@mkt" || res.Note == "" {
		t.Fatalf("approved = %+v", res)
	}
	if log := f.calls(t); !strings.Contains(log, "plugin install needs-cmd@mkt -s user --json --accept-command "+fakeExtSha) {
		t.Errorf("log:\n%s", log)
	}
	// A plain install never shows anything.
	if res, err := extInstall(protocol.ExtInstallRequest{Agent: "claude", Id: "vercel@claude-plugins-official", Scope: "user"}); err != nil || res.Item == nil {
		t.Errorf("plain = %+v %v", res, err)
	}
	// Validation.
	for _, bad := range []protocol.ExtInstallRequest{
		{Agent: "claude", Id: "x; rm -rf /", Scope: "user"},
		{Agent: "claude", Id: "--yes", Scope: "user"},
		{Agent: "claude", Id: "noat", Scope: "user"},
		{Agent: "claude", Id: "a@b", Scope: "project"},
		{Agent: "claude", Id: "a@b", Scope: "user", AcceptCommand: "short"},
		{Agent: "gemini", Id: "a@b", Scope: "user"},
		{Agent: "codex", Id: "a@b", Scope: "project", Cwd: f.project},
	} {
		if _, err := extInstall(bad); err == nil {
			t.Errorf("%+v accepted", bad)
		}
	}
	// Codex: plugin/install from its local marketplace.
	res, err := extInstall(protocol.ExtInstallRequest{Agent: "codex", Id: "linear@openai-curated", Scope: "user"})
	if err != nil || res.Item == nil || !strings.Contains(res.Note, "Linear") {
		t.Fatalf("codex install = %+v %v", res, err)
	}
	if log := f.calls(t); !strings.Contains(log, `"method":"plugin/install","params":{"marketplacePath":"`+filepath.Join(f.codex, ".tmp", "plugins", ".agents", "plugins", "marketplace.json")+`","pluginName":"linear"}`) {
		t.Errorf("codex log:\n%s", log)
	}
}

func TestExtUninstallAndCatalog(t *testing.T) {
	f := newExtFixture(t)
	items := listFixture(t, f)
	for _, q := range [][3]string{{"claude", protocol.ExtPlugin, "vercel@claude-plugins-official"}, {"codex", protocol.ExtPlugin, "pdf@openai-primary-runtime"}} {
		it := mustItem(t, items, q[0], q[1], q[2])
		if res, err := extUninstall(protocol.ExtKeyRequest{Key: it.Key}); err != nil || !res.Ok {
			t.Errorf("%v: %+v %v", q, res, err)
		}
	}
	log := f.calls(t)
	if !strings.Contains(log, "plugin uninstall vercel@claude-plugins-official -s user --json") || !strings.Contains(log, `"method":"plugin/uninstall","params":{"pluginId":"pdf@openai-primary-runtime"}`) {
		t.Errorf("log:\n%s", log)
	}
	if strings.Contains(log, "--prune") || strings.Contains(log, " -y") {
		t.Error("uninstall must not prune or auto-confirm")
	}
	for _, q := range [][3]string{{"claude", protocol.ExtPlugin, "cowork-plugin-management@synced"}, {"codex", protocol.ExtSkill, "imagegen"}, {"claude", protocol.ExtRule, "CLAUDE.md"}} {
		if _, err := extUninstall(protocol.ExtKeyRequest{Key: mustItem(t, items, q[0], q[1], q[2]).Key}); err == nil {
			t.Errorf("%v: uninstall accepted", q)
		}
	}

	cat, err := extCatalog(protocol.ExtCatalogRequest{Agent: "claude"})
	if err != nil || len(cat.Entries) != 4 {
		t.Fatalf("claude catalog = %+v %v", cat, err)
	}
	for _, e := range cat.Entries {
		if e.Id == "agent-sdk-dev@claude-plugins-official" && (e.InstallCount == 0 || e.Installed || e.Source == nil || e.Source.Path != "./plugins/agent-sdk-dev") {
			t.Errorf("entry = %+v", e)
		}
		if e.Id == "vercel@claude-plugins-official" && !e.Installed {
			t.Errorf("vercel is installed: %+v", e)
		}
	}
	if cat, _ := extCatalog(protocol.ExtCatalogRequest{Agent: "claude", Q: "42crunch"}); len(cat.Entries) != 1 {
		t.Errorf("filtered = %+v", cat)
	}
	cat, err = extCatalog(protocol.ExtCatalogRequest{Agent: "codex"})
	installed := map[string]bool{}
	for _, e := range cat.Entries {
		installed[e.Id] = e.Installed
	}
	if err != nil || !installed["pdf@openai-primary-runtime"] || installed["linear@openai-curated"] {
		t.Errorf("codex catalog = %+v %v", cat, err)
	}
	if _, err := extCatalog(protocol.ExtCatalogRequest{Agent: "devin"}); err == nil {
		t.Error("devin catalog accepted")
	}
}

func TestCreateSkill(t *testing.T) {
	f := newExtFixture(t, "claude", "codex")
	listFixture(t, f) // remembers which agents are installed
	res, err := createSkill(protocol.SkillCreateRequest{Name: "release-notes", Description: `Write release notes: "short" & <clear>`,
		Scope: "user", Agents: []string{"claude", "codex"}})
	if err != nil {
		t.Fatal(err)
	}
	canon := filepath.Join(f.home, ".agents", "skills", "release-notes")
	data, _ := os.ReadFile(filepath.Join(canon, "SKILL.md"))
	fm, body, ok := parseFrontmatter(data)
	if !ok || fm["name"] != "release-notes" || fm["description"] != `Write release notes: "short" & <clear>` || !strings.Contains(body, "# release-notes") {
		t.Errorf("SKILL.md = %s", data)
	}
	link := filepath.Join(f.claude, "skills", "release-notes")
	if target, err := os.Readlink(link); err != nil || target != filepath.Join("..", "..", ".agents", "skills", "release-notes") {
		t.Errorf("link = %q %v", target, err)
	}
	if res.Item == nil || res.Item.Agent != "claude" || res.Item.Path != filepath.Join(link, "SKILL.md") || strings.Join(res.Item.SharedWith, ",") != "codex" {
		t.Errorf("item = %+v", res.Item)
	}
	// It shows up for both agents, shared.
	items := listFixture(t, f)
	if it := mustItem(t, items, "claude", protocol.ExtSkill, "release-notes"); res.Item.Key != it.Key {
		t.Errorf("created key %s, inventory key %s", res.Item.Key, it.Key)
	}

	// Never overwrite; a name another agent already has is refused before
	// anything is written.
	if _, err := createSkill(protocol.SkillCreateRequest{Name: "release-notes", Description: "x", Scope: "user", Agents: []string{"codex"}}); err == nil {
		t.Error("overwrote a skill")
	}
	writeFile(t, filepath.Join(f.claude, "skills", "taken", "SKILL.md"), skillMd("taken", "Mine"))
	if _, err := createSkill(protocol.SkillCreateRequest{Name: "taken", Description: "x", Scope: "user", Agents: []string{"claude"}}); err == nil {
		t.Error("created over claude's taken")
	}
	if _, err := os.Stat(filepath.Join(f.home, ".agents", "skills", "taken")); err == nil {
		t.Error("wrote the canonical copy before refusing")
	}
	// Project scope, Codex only: no link needed.
	res, err = createSkill(protocol.SkillCreateRequest{Name: "proj-only", Description: "Project skill", Body: "Do the thing.\r\n", Scope: "project", Cwd: f.project, Agents: []string{"codex"}})
	if err != nil || res.Item.Agent != "codex" || res.Item.ProjectPath != f.project {
		t.Fatalf("project = %+v %v", res.Item, err)
	}
	if _, err := os.Lstat(filepath.Join(f.project, ".claude", "skills", "proj-only")); err == nil {
		t.Error("linked for an agent that wasn't chosen")
	}
	if b, _ := os.ReadFile(filepath.Join(f.project, ".agents", "skills", "proj-only", "SKILL.md")); !strings.HasSuffix(string(b), "\n\nDo the thing.\n") {
		t.Errorf("body = %q", b)
	}
	// Validation.
	long := strings.Repeat("a", 65)
	for _, bad := range []protocol.SkillCreateRequest{
		{Name: "Bad", Description: "x", Scope: "user", Agents: []string{"claude"}},
		{Name: "-a", Description: "x", Scope: "user", Agents: []string{"claude"}},
		{Name: "a--b", Description: "x", Scope: "user", Agents: []string{"claude"}},
		{Name: "../x", Description: "x", Scope: "user", Agents: []string{"claude"}},
		{Name: long, Description: "x", Scope: "user", Agents: []string{"claude"}},
		{Name: "ok", Description: "", Scope: "user", Agents: []string{"claude"}},
		{Name: "ok", Description: strings.Repeat("d", 1025), Scope: "user", Agents: []string{"claude"}},
		{Name: "ok", Description: "x", Scope: "user"},
		{Name: "ok", Description: "x", Scope: "user", Agents: []string{"nope"}},
		{Name: "ok", Description: "x", Scope: "project", Agents: []string{"claude"}},
		{Name: "ok", Description: "x", Scope: "managed", Agents: []string{"claude"}},
	} {
		if _, err := createSkill(bad); err == nil {
			t.Errorf("%+v accepted", bad)
		}
	}
	// A project whose .agents is a symlink out of the project is refused.
	outside := t.TempDir()
	evil := filepath.Join(t.TempDir(), "evilproj")
	os.MkdirAll(evil, 0o755)
	os.Symlink(outside, filepath.Join(evil, ".agents"))
	if _, err := createSkill(protocol.SkillCreateRequest{Name: "escape", Description: "x", Scope: "project", Cwd: evil, Agents: []string{"codex"}}); err == nil {
		t.Error("wrote through a symlink out of the project")
	}
	if _, err := os.Stat(filepath.Join(outside, "skills", "escape")); err == nil {
		t.Error("skill written outside the project")
	}
}

func TestShareAndTrashSkill(t *testing.T) {
	f := newExtFixture(t, "claude", "codex")
	items := listFixture(t, f)
	// A Claude-only project skill shared with Codex: linked into .agents/skills.
	ps := mustItem(t, items, "claude", protocol.ExtSkill, "pskill")
	res, err := shareSkill(protocol.SkillShareRequest{Key: ps.Key, Agents: []string{"codex"}})
	if err != nil || res.Item == nil || strings.Join(res.Item.SharedWith, ",") != "codex" {
		t.Fatalf("share = %+v %v", res, err)
	}
	link := filepath.Join(f.project, ".agents", "skills", "pskill")
	if realPath(link) != realPath(filepath.Join(f.project, ".claude", "skills", "pskill")) {
		t.Error("not linked to the same folder")
	}
	// Sharing again is a no-op.
	if _, err := shareSkill(protocol.SkillShareRequest{Key: ps.Key, Agents: []string{"codex", "claude"}}); err != nil {
		t.Errorf("re-share: %v", err)
	}
	// A different skill with the same name in the target is a conflict.
	items = listFixture(t, f)
	vd := mustItem(t, items, "claude", protocol.ExtSkill, "vercel-doctor")
	writeFile(t, filepath.Join(f.home, ".agents", "skills", "vercel-doctor", "SKILL.md"), skillMd("vercel-doctor", "Another one"))
	if _, err := shareSkill(protocol.SkillShareRequest{Key: vd.Key, Agents: []string{"codex"}}); err == nil || !strings.Contains(err.Error(), "different skill") {
		t.Errorf("conflict: %v", err)
	}
	// A skill folder that is a symlink out of the skill folders is never
	// shared or moved.
	outside := filepath.Join(t.TempDir(), "evil")
	writeFile(t, filepath.Join(outside, "SKILL.md"), skillMd("evil", "Outside"))
	os.Symlink(outside, filepath.Join(f.claude, "skills", "evil"))
	resetExtState()
	items = listFixture(t, f)
	ev := mustItem(t, items, "claude", protocol.ExtSkill, "evil")
	if _, err := shareSkill(protocol.SkillShareRequest{Key: ev.Key, Agents: []string{"codex"}}); err == nil {
		t.Error("shared a folder outside the skill roots")
	}
	if _, err := extUninstall(protocol.ExtKeyRequest{Key: ev.Key}); err == nil {
		t.Error("trashed a folder outside the skill roots")
	}
	if _, err := os.Stat(filepath.Join(outside, "SKILL.md")); err != nil {
		t.Error("outside folder touched")
	}
	if _, err := shareSkill(protocol.SkillShareRequest{Key: mustItem(t, items, "claude", protocol.ExtSkill, "vercel:nextjs").Key, Agents: []string{"codex"}}); err == nil {
		t.Error("shared a plugin skill")
	}

	// Removing the canonical copy moves it (and the link to it) to .trash.
	res, err = createSkill(protocol.SkillCreateRequest{Name: "temp-skill", Description: "Temp", Scope: "user", Agents: []string{"claude", "codex"}})
	if err != nil {
		t.Fatal(err)
	}
	items = listFixture(t, f)
	cx := mustItem(t, items, "codex", protocol.ExtSkill, "temp-skill")
	out, err := extUninstall(protocol.ExtKeyRequest{Key: cx.Key})
	if err != nil || !out.Ok || !strings.Contains(out.Note, ".trash") {
		t.Fatalf("trash = %+v %v", out, err)
	}
	if b, err := os.ReadFile(filepath.Join(f.home, ".agents", "skills", ".trash", "temp-skill", "SKILL.md")); err != nil || !strings.Contains(string(b), "Temp") {
		t.Errorf("trashed copy: %v", err)
	}
	if _, err := os.Lstat(filepath.Join(f.claude, "skills", "temp-skill")); err == nil {
		t.Error("claude's link left behind")
	}
	if _, err := os.Lstat(filepath.Join(f.claude, "skills", ".trash", "temp-skill")); err != nil {
		t.Error("claude's link not in its trash")
	}
	items = listFixture(t, f)
	if findItem(items, "codex", protocol.ExtSkill, "temp-skill") != nil || findItem(items, "claude", protocol.ExtSkill, "temp-skill") != nil {
		t.Error("trashed skill still listed")
	}
	// Removing the link (Claude's view) keeps the canonical copy.
	createSkill(protocol.SkillCreateRequest{Name: "linked", Description: "L", Scope: "user", Agents: []string{"claude"}})
	items = listFixture(t, f)
	cl := mustItem(t, items, "claude", protocol.ExtSkill, "linked")
	if _, err := extUninstall(protocol.ExtKeyRequest{Key: cl.Key}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(f.home, ".agents", "skills", "linked", "SKILL.md")); err != nil {
		t.Error("canonical copy removed with the link")
	}
	// Again with the same name: a second trash entry, nothing overwritten.
	createSkill(protocol.SkillCreateRequest{Name: "temp-skill", Description: "Temp 2", Scope: "user", Agents: []string{"codex"}})
	items = listFixture(t, f)
	if _, err := extUninstall(protocol.ExtKeyRequest{Key: mustItem(t, items, "codex", protocol.ExtSkill, "temp-skill").Key}); err != nil {
		t.Fatal(err)
	}
	entries, _ := os.ReadDir(filepath.Join(f.home, ".agents", "skills", ".trash"))
	if len(entries) != 2 {
		t.Errorf("trash = %v", entries)
	}
}

// Windows (or any place symlinks fail) gets a copy without the skill's own
// symlinks.
func TestCopySkillDir(t *testing.T) {
	src := filepath.Join(t.TempDir(), "s")
	writeFile(t, filepath.Join(src, "SKILL.md"), skillMd("s", "S"))
	writeFile(t, filepath.Join(src, "scripts", "run.sh"), "echo hi\n")
	secret := filepath.Join(t.TempDir(), "secret")
	writeFile(t, secret, "SECRET")
	os.Symlink(secret, filepath.Join(src, "leak"))
	dst := filepath.Join(t.TempDir(), "d")
	if err := copySkillDir(src, dst); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(filepath.Join(dst, "scripts", "run.sh")); string(b) != "echo hi\n" {
		t.Error("file not copied")
	}
	if _, err := os.Lstat(filepath.Join(dst, "leak")); err == nil {
		t.Error("symlink followed or copied")
	}
	b, _ := json.Marshal(protocol.ExtChangeResult{})
	if string(b) != "{}" {
		t.Errorf("empty result = %s", b)
	}
}
