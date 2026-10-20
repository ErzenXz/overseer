package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// --- Claude Code inventory ---
//
// Sources (docs/research/skills-plugins.md §1):
//   - a short-lived headless `claude` answering control requests without a
//     prompt (initialize, get_skills_dialog, get_hooks_listing,
//     get_memory_dialog), with hooks off, no MCP servers and nothing saved;
//   - `claude plugin list --json` and `claude plugin marketplace list --json`;
//   - settings files (skillOverrides, enabledMcpjsonServers, hooks fallback),
//     .mcp.json and only the mcpServers / projects / usage keys of
//     ~/.claude.json (never oauthAccount or anything else in it).

var claudeExtSubtypes = []string{"initialize", "get_skills_dialog", "get_hooks_listing", "get_memory_dialog"}

func collectClaude(ctx context.Context, env extEnv, bin string) ([]protocol.ExtItem, error) {
	var (
		wg              sync.WaitGroup
		ctrl            map[string]jsonObj
		ctrlErr         error
		plugins, mkts   []byte
		pluginsErr, mkE error
	)
	wg.Add(3)
	go func() {
		defer wg.Done()
		ctrl, ctrlErr = claudeControl(ctx, bin, env.cwd, claudeExtSubtypes)
	}()
	go func() {
		defer wg.Done()
		plugins, pluginsErr = runCLI(ctx, bin, []string{"plugin", "list", "--json"}, env.cwd)
	}()
	go func() {
		defer wg.Done()
		mkts, mkE = runCLI(ctx, bin, []string{"plugin", "marketplace", "list", "--json"}, env.cwd)
	}()
	wg.Wait()
	items := claudeItemsFrom(env, ctrl, plugins, mkts)
	var errs []string
	if ctrlErr != nil {
		errs = append(errs, "skills and hooks: "+extErrorText(ctrlErr))
	}
	if pluginsErr != nil {
		errs = append(errs, "plugins: "+extErrorText(pluginsErr))
	}
	if mkE != nil {
		errs = append(errs, "marketplaces: "+extErrorText(mkE))
	}
	if len(errs) > 0 {
		return items, errors.New(strings.Join(errs, "; "))
	}
	return items, nil
}

// claudeControl asks a headless Claude Code the given control requests and
// returns the successful responses by subtype. No prompt is sent.
func claudeControl(ctx context.Context, bin, cwd string, subtypes []string) (map[string]jsonObj, error) {
	dir := cwd
	cleanup := func() {}
	if dir == "" {
		d, c, err := probeDir()
		if err != nil {
			return nil, err
		}
		dir, cleanup = d, c
	}
	proc, err := startAgentProcess(bin, claudeUsageArgs, dir, agentEnv())
	if err != nil {
		cleanup()
		return nil, err
	}
	defer stopProbe(proc, cleanup)
	type resp struct {
		id string
		r  jsonObj
	}
	ch := make(chan resp, len(subtypes))
	proc.readLines(func(line []byte) {
		m := decodeObj(line)
		if jStr(m, "type") != "control_response" {
			return
		}
		r := jObj(m, "response")
		select {
		case ch <- resp{jStr(r, "request_id"), r}:
		default:
		}
	})
	for _, s := range subtypes {
		if err := proc.writeJSON(map[string]any{"type": "control_request", "request_id": "ext-" + s,
			"request": map[string]any{"subtype": s}}); err != nil {
			return nil, err
		}
	}
	out := map[string]jsonObj{}
	pending := len(subtypes)
	for pending > 0 {
		select {
		case r := <-ch:
			id := strings.TrimPrefix(r.id, "ext-")
			if !containsStr(subtypes, id) {
				continue
			}
			pending--
			if jStr(r.r, "subtype") == "success" {
				out[id] = jObj(r.r, "response")
			}
		case <-proc.done:
			if len(out) > 0 {
				return out, nil
			}
			return nil, errors.New(oneLine(scrubCommand(proc.exitError())))
		case <-ctx.Done():
			if len(out) > 0 {
				return out, nil
			}
			return nil, ctx.Err()
		}
	}
	return out, nil
}

// claudeSettingsFile is one settings layer Overseer reads (and may write
// skillOverrides to).
type claudeSettingsFile struct {
	scope, path string
}

func claudeSettingsFiles(env extEnv) []claudeSettingsFile {
	out := []claudeSettingsFile{{protocol.ScopeUser, filepath.Join(env.claudeDir, "settings.json")}}
	if env.cwd != "" {
		out = append(out,
			claudeSettingsFile{protocol.ScopeProject, filepath.Join(env.cwd, ".claude", "settings.json")},
			claudeSettingsFile{protocol.ScopeLocal, filepath.Join(env.cwd, ".claude", "settings.local.json")})
	}
	return out
}

// readJSONFile decodes a small JSON settings file (nil when absent or bad).
func readJSONFile(path string) jsonObj {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	var m jsonObj
	if json.NewDecoder(&limitReader{f: f, n: 8 << 20}).Decode(&m) != nil {
		return nil
	}
	return m
}

type limitReader struct {
	f *os.File
	n int64
}

func (l *limitReader) Read(p []byte) (int, error) {
	if l.n <= 0 {
		return 0, errors.New("file too large")
	}
	if int64(len(p)) > l.n {
		p = p[:l.n]
	}
	n, err := l.f.Read(p)
	l.n -= int64(n)
	return n, err
}

// claudeSkillOverrides merges skillOverrides across user, project and local
// settings (later scopes win).
func claudeSkillOverrides(env extEnv) map[string]string {
	out := map[string]string{}
	for _, f := range claudeSettingsFiles(env) {
		for k, v := range jObj(readJSONFile(f.path), "skillOverrides") {
			if s, ok := v.(string); ok {
				out[k] = s
			}
		}
	}
	return out
}

// claudeJSONSubset is all Overseer ever decodes from ~/.claude.json.
type claudeJSONSubset struct {
	McpServers map[string]mcpConfig        `json:"mcpServers"`
	Projects   map[string]json.RawMessage  `json:"projects"`
	SkillUsage map[string]claudeUsageEntry `json:"skillUsage"`
	PluginUse  map[string]claudeUsageEntry `json:"pluginUsage"`
}

type claudeProjectSubset struct {
	McpServers             map[string]mcpConfig `json:"mcpServers"`
	EnabledMcpjsonServers  []string             `json:"enabledMcpjsonServers"`
	DisabledMcpjsonServers []string             `json:"disabledMcpjsonServers"`
}

type claudeUsageEntry struct {
	UsageCount int     `json:"usageCount"`
	LastUsedAt float64 `json:"lastUsedAt"`
}

func (u claudeUsageEntry) usage() *protocol.ExtUsage {
	if u.UsageCount == 0 && u.LastUsedAt == 0 {
		return nil
	}
	return &protocol.ExtUsage{Count: u.UsageCount, LastUsedAt: msTime(u.LastUsedAt)}
}

// mcpConfig is the part of an MCP server entry that may be shown: never
// env, headers or args.
type mcpConfig struct {
	Type      string `json:"type"`
	Transport string `json:"transport"`
	Command   string `json:"command"`
	Url       string `json:"url"`
	Disabled  bool   `json:"disabled"`
}

func (c mcpConfig) info() *protocol.ExtMcp {
	t := c.Type
	if t == "" {
		t = c.Transport
	}
	if t == "" {
		if c.Url != "" {
			t = "http"
		} else {
			t = "stdio"
		}
	}
	return &protocol.ExtMcp{Transport: t, Command: c.Command, Url: c.Url}
}

func readClaudeJSON(env extEnv) claudeJSONSubset {
	var s claudeJSONSubset
	f, err := os.Open(env.claudeJSON)
	if err != nil {
		return s
	}
	defer f.Close()
	json.NewDecoder(&limitReader{f: f, n: 32 << 20}).Decode(&s)
	return s
}

func (s claudeJSONSubset) project(cwd string) claudeProjectSubset {
	var p claudeProjectSubset
	if cwd == "" {
		return p
	}
	raw, ok := s.Projects[cwd]
	if !ok {
		raw = s.Projects[filepath.ToSlash(cwd)]
	}
	json.Unmarshal(raw, &p)
	return p
}

// claudeSourceScope maps get_skills_dialog sources onto scopes.
func claudeSourceScope(source string) string {
	switch source {
	case "user", "userSettings":
		return protocol.ScopeUser
	case "project", "projectSettings":
		return protocol.ScopeProject
	case "local", "localSettings":
		return protocol.ScopeLocal
	case "plugin", "pluginHook":
		return protocol.ScopePlugin
	case "claude.ai sync", "synced":
		return protocol.ScopeSynced
	case "managed", "policySettings", "policy":
		return protocol.ScopeManaged
	case "flagSettings", "session", "cliArg":
		return protocol.ScopeSession
	}
	return protocol.ScopeBuiltin
}

// claudePlugin is one installed plugin from `claude plugin list --json`.
type claudePlugin struct {
	id, name, mkt, scope, installPath, projectPath string
	enabled                                        bool
	raw                                            jsonObj
}

func parseClaudePlugins(out []byte) []claudePlugin {
	var list []jsonObj
	if json.Unmarshal(out, &list) != nil {
		// Some versions print {installed:[…]}.
		list = nil
		for _, x := range jArr(decodeObj(out), "installed") {
			if m, ok := x.(map[string]any); ok {
				list = append(list, m)
			}
		}
	}
	var ps []claudePlugin
	for _, m := range list {
		id := jStr(m, "id", "pluginId")
		if id == "" {
			continue
		}
		name, mkt := id, ""
		if i := strings.LastIndexByte(id, '@'); i > 0 {
			name, mkt = id[:i], id[i+1:]
		}
		ps = append(ps, claudePlugin{id: id, name: name, mkt: mkt, scope: jStr(m, "scope"), installPath: jStr(m, "installPath"),
			projectPath: jStr(m, "projectPath"), enabled: jBool(m, "enabled"), raw: m})
	}
	return ps
}

func (p claudePlugin) itemScope() string {
	switch {
	case p.mkt == "builtin":
		return protocol.ScopeBuiltin
	case p.mkt == "inline":
		return protocol.ScopeSession
	}
	switch p.scope {
	case protocol.ScopeProject, protocol.ScopeLocal, protocol.ScopeManaged, protocol.ScopeSynced:
		return p.scope
	case "policy":
		return protocol.ScopeManaged
	}
	return protocol.ScopeUser
}

// claudeItemsFrom normalises everything the Claude sources returned.
func claudeItemsFrom(env extEnv, ctrl map[string]jsonObj, pluginsOut, mktsOut []byte) []protocol.ExtItem {
	var items []protocol.ExtItem
	cj := readClaudeJSON(env)
	plugins := parseClaudePlugins(pluginsOut)
	pluginByName := map[string]claudePlugin{}
	for _, p := range plugins {
		if old, ok := pluginByName[p.name]; !ok || (!old.enabled && p.enabled) {
			pluginByName[p.name] = p
		}
	}
	init := ctrl["initialize"]
	initNames := map[string]bool{}
	for _, key := range []string{"commands", "agents"} {
		for _, x := range jArr(init, key) {
			if m, ok := x.(map[string]any); ok {
				initNames[jStr(m, "name")] = true
			}
		}
	}

	// Plugins, their MCP servers and the components in their folders.
	for _, p := range plugins {
		scope := p.itemScope()
		it := protocol.ExtItem{Agent: "claude", Kind: protocol.ExtPlugin, Name: p.name, QualifiedName: p.id, Scope: scope,
			ParentId: p.mkt, Version: jStr(p.raw, "version"), Enabled: boolPtr(p.enabled)}
		if scope == protocol.ScopeProject || scope == protocol.ScopeLocal {
			it.ProjectPath = p.projectPath
			if it.ProjectPath == "" {
				it.ProjectPath = env.cwd
			}
		}
		if scope == protocol.ScopeManaged {
			it.LockedBy = "managed"
		}
		if !p.enabled {
			it.State = "off"
		}
		if p.installPath != "" {
			manifest := filepath.Join(p.installPath, ".claude-plugin", "plugin.json")
			if m := readJSONFile(manifest); m != nil {
				it.Path = manifest
				it.Description = jStr(m, "description")
				if it.Version == "" {
					it.Version = jStr(m, "version")
				}
				if repo := jStr(m, "repository", "homepage"); repo != "" {
					it.Source = &protocol.ExtSource{Type: "git", Url: repo}
				}
			}
		}
		for _, e := range jArr(p.raw, "errors") {
			switch v := e.(type) {
			case string:
				it.Errors = append(it.Errors, v)
			case map[string]any:
				if msg := jStr(v, "message", "error"); msg != "" {
					it.Errors = append(it.Errors, msg)
				}
			}
		}
		if len(it.Errors) > 0 {
			it.State = "error"
		}
		it.Usage = cj.PluginUse[p.id].usage()
		items = append(items, it)

		for name, raw := range jObj(p.raw, "mcpServers") {
			var c mcpConfig
			b, _ := json.Marshal(raw)
			json.Unmarshal(b, &c)
			items = append(items, protocol.ExtItem{Agent: "claude", Kind: protocol.ExtMcpServer, Name: name,
				QualifiedName: "plugin:" + p.name + ":" + name, Scope: protocol.ScopePlugin, ParentId: p.id,
				Enabled: boolPtr(p.enabled), LockedBy: "plugin", Mcp: c.info()})
		}
		if p.installPath == "" || scope == protocol.ScopeBuiltin {
			continue
		}
		for _, comp := range []struct{ dir, kind string }{
			{"commands", protocol.ExtCommand}, {"agents", protocol.ExtSubagent}, {"output-styles", protocol.ExtOutputStyle}} {
			walkFiles(filepath.Join(p.installPath, comp.dir), 1, func(path, rel string) bool {
				base := filepath.Base(rel)
				if !strings.HasSuffix(base, ".md") || strings.HasPrefix(base, "_") {
					return true
				}
				n := strings.TrimSuffix(base, ".md")
				q := p.name + ":" + n
				if p.enabled && len(initNames) > 0 && comp.kind != protocol.ExtOutputStyle && !initNames[q] {
					return true // not something Claude loads
				}
				fm := readFrontmatter(path)
				it := protocol.ExtItem{Agent: "claude", Kind: comp.kind, Name: n, QualifiedName: q, Scope: protocol.ScopePlugin,
					ParentId: p.id, Path: path, Enabled: boolPtr(p.enabled), LockedBy: "plugin"}
				if d, ok := fm["description"].(string); ok {
					it.Description = d
				}
				if comp.kind == protocol.ExtCommand {
					it.Invocation = invocationFrom(fm)
				}
				items = append(items, it)
				return true
			})
		}
		// A disabled plugin's skills are not in the dialog: list them off.
		if !p.enabled {
			for _, s := range pluginSkills(p.installPath) {
				items = append(items, protocol.ExtItem{Agent: "claude", Kind: protocol.ExtSkill, Name: s.name,
					QualifiedName: p.name + ":" + s.name, Scope: protocol.ScopePlugin, ParentId: p.id, Path: s.path,
					Description: s.desc, Enabled: boolPtr(false), State: "off", LockedBy: "plugin"})
			}
		}
	}

	// Skills: the dialog knows state, cost and locks; paths come from disk.
	if dialog, ok := ctrl["get_skills_dialog"]; ok {
		for _, x := range jArr(dialog, "skills") {
			s, ok := x.(map[string]any)
			if !ok {
				continue
			}
			full := jStr(s, "name")
			if full == "" {
				continue
			}
			unq := jStr(jObj(s, "handles"), "unqualified_name")
			scope := claudeSourceScope(jStr(s, "source"))
			it := protocol.ExtItem{Agent: "claude", Kind: protocol.ExtSkill, Name: full, QualifiedName: full, Scope: scope,
				DisplayName: jStr(s, "display_name"), Description: jStr(s, "description"), State: jStr(s, "state"),
				LockedBy: jStr(s, "locked_by")}
			if it.State == "" {
				it.State = "on"
			}
			it.Enabled = boolPtr(it.State != "off")
			if t, ok := jNum(s, "tokens"); ok && t > 0 {
				it.Cost = &protocol.ExtCost{AlwaysOnTokens: int(t)}
			}
			if i := strings.IndexByte(full, ':'); i > 0 && (scope == protocol.ScopePlugin || scope == protocol.ScopeSynced) {
				it.Name = full[i+1:]
				if unq == "" {
					unq = it.Name
				}
			}
			if it.DisplayName == it.Name {
				it.DisplayName = ""
			}
			switch scope {
			case protocol.ScopeUser:
				it.Path = findSkillFile(filepath.Join(env.claudeDir, "skills"), full)
			case protocol.ScopeProject:
				it.ProjectPath = env.cwd
				if env.cwd != "" {
					it.Path = findSkillFile(filepath.Join(env.cwd, ".claude", "skills"), full)
				}
			case protocol.ScopePlugin:
				it.LockedBy = "plugin"
				if i := strings.IndexByte(full, ':'); i > 0 {
					if p, ok := pluginByName[full[:i]]; ok {
						it.ParentId = p.id
						it.Path = findSkillFile(filepath.Join(p.installPath, "skills"), it.Name)
					}
				}
			case protocol.ScopeSynced:
				if dirs, _ := filepath.Glob(filepath.Join(env.claudeDir, "skills", "synced", "*")); len(dirs) > 0 {
					for _, d := range dirs {
						if p := findSkillFile(d, unq); p != "" {
							it.Path = p
							break
						}
					}
				}
			}
			use := cj.SkillUsage[full]
			if use.UsageCount == 0 && unq != "" {
				use = cj.SkillUsage[unq]
			}
			it.Usage = use.usage()
			items = append(items, it)
		}
	} else {
		// No dialog (older CLI or the probe failed): the file scan lists
		// user and project skills with skillOverrides; plugin skills come
		// from the plugin folders.
		for _, p := range plugins {
			if !p.enabled || p.installPath == "" {
				continue
			}
			for _, s := range pluginSkills(p.installPath) {
				items = append(items, protocol.ExtItem{Agent: "claude", Kind: protocol.ExtSkill, Name: s.name,
					QualifiedName: p.name + ":" + s.name, Scope: protocol.ScopePlugin, ParentId: p.id, Path: s.path,
					Description: s.desc, Enabled: boolPtr(true), State: "on", LockedBy: "plugin",
					Usage: cj.SkillUsage[p.name+":"+s.name].usage()})
			}
		}
	}
	for i := range items {
		if items[i].Kind == protocol.ExtSkill && items[i].Usage == nil && (items[i].Scope == protocol.ScopeUser || items[i].Scope == protocol.ScopeProject) {
			items[i].Usage = cj.SkillUsage[items[i].QualifiedName].usage()
		}
	}

	// Built-in subagents (no file on disk).
	userAgents := map[string]bool{}
	for _, e := range scanAgentFiles(env, "claude") {
		if e.kind == protocol.ExtSubagent {
			userAgents[e.name] = true
		}
	}
	for _, x := range jArr(init, "agents") {
		m, ok := x.(map[string]any)
		name := jStr(m, "name")
		if !ok || name == "" || strings.Contains(name, ":") || userAgents[name] {
			continue
		}
		items = append(items, protocol.ExtItem{Agent: "claude", Kind: protocol.ExtSubagent, Name: name, Scope: protocol.ScopeBuiltin,
			Description: jStr(m, "description")})
	}

	// Rules and memory files.
	if mem, ok := ctrl["get_memory_dialog"]; ok {
		for _, x := range jArr(mem, "files") {
			m, ok := x.(map[string]any)
			path := jStr(m, "path")
			if !ok || path == "" || !jBool(m, "exists") || !filepath.IsAbs(path) {
				continue
			}
			scope := protocol.ScopeProject
			switch jStr(m, "kind") {
			case "user":
				scope = protocol.ScopeUser
			case "local":
				scope = protocol.ScopeLocal
			case "managed", "policy", "enterprise":
				scope = protocol.ScopeManaged
			}
			it := protocol.ExtItem{Agent: "claude", Kind: protocol.ExtRule, Name: filepath.Base(path),
				QualifiedName: displayPath(env, path, scope), Scope: scope, Path: path}
			if scope == protocol.ScopeProject || scope == protocol.ScopeLocal {
				it.ProjectPath = env.cwd
			}
			items = append(items, it)
		}
	}

	items = append(items, claudeHookItems(env, ctrl, pluginByName)...)
	items = append(items, claudeMcpItems(env, cj)...)

	// Marketplaces.
	var mkts []jsonObj
	json.Unmarshal(mktsOut, &mkts)
	for _, m := range mkts {
		name := jStr(m, "name")
		if name == "" {
			continue
		}
		it := protocol.ExtItem{Agent: "claude", Kind: protocol.ExtMarketplace, Name: name, Scope: protocol.ScopeUser,
			Source: &protocol.ExtSource{Type: jStr(m, "source"), Repo: jStr(m, "repo"), Url: jStr(m, "url"), Path: jStr(m, "path"), Ref: jStr(m, "ref")}}
		if loc := jStr(m, "installLocation"); loc != "" {
			if p := filepath.Join(loc, ".claude-plugin", "marketplace.json"); fileExists(p) {
				it.Path = p
			}
		}
		items = append(items, it)
	}
	return items
}

func fileExists(p string) bool {
	fi, err := os.Stat(p)
	return err == nil && fi.Mode().IsRegular()
}

// findSkillFile finds <root>/<name>/SKILL.md, or the SKILL.md whose
// frontmatter name is name.
func findSkillFile(root, name string) string {
	if root == "" || name == "" {
		return ""
	}
	if !strings.ContainsAny(name, `/\`) && name != ".." && name != "." {
		if p := filepath.Join(root, name, "SKILL.md"); fileExists(p) {
			return p
		}
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return ""
	}
	for i, de := range entries {
		if i >= maxScanEntries {
			break
		}
		p := filepath.Join(root, de.Name(), "SKILL.md")
		if !fileExists(p) {
			continue
		}
		if n, _ := readFrontmatter(p)["name"].(string); strings.TrimSpace(n) == name {
			return p
		}
	}
	return ""
}

type pluginSkill struct {
	name, path, desc string
}

// pluginSkills lists <plugin>/skills/*/SKILL.md.
func pluginSkills(installPath string) []pluginSkill {
	var out []pluginSkill
	root := filepath.Join(installPath, "skills")
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	for i, de := range entries {
		if i >= maxScanEntries {
			break
		}
		p := filepath.Join(root, de.Name(), "SKILL.md")
		if !fileExists(p) {
			continue
		}
		fm := readFrontmatter(p)
		name := de.Name()
		if n, ok := fm["name"].(string); ok && strings.TrimSpace(n) != "" {
			name = strings.TrimSpace(n)
		}
		desc, _ := fm["description"].(string)
		out = append(out, pluginSkill{name: name, path: p, desc: desc})
	}
	return out
}

// claudeHookItems lists hooks from get_hooks_listing, else from settings.
func claudeHookItems(env extEnv, ctrl map[string]jsonObj, plugins map[string]claudePlugin) []protocol.ExtItem {
	allOff := false
	files := claudeSettingsFiles(env)
	for _, f := range files {
		if jBool(readJSONFile(f.path), "disableAllHooks") {
			allOff = true
		}
	}
	var items []protocol.ExtItem
	seen := map[string]int{}
	add := func(scope, event, matcher, typ, command, plugin, path string) {
		if event == "" {
			return
		}
		if typ == "" {
			typ = "command"
		}
		q := event + "#" + shortHash(scope, plugin, matcher, typ, command)
		seen[q]++
		if n := seen[q]; n > 1 {
			q = fmt.Sprintf("%s-%d", q, n)
		}
		it := protocol.ExtItem{Agent: "claude", Kind: protocol.ExtHook, Name: event, QualifiedName: q, Scope: scope, Path: path,
			Hook: &protocol.ExtHookInfo{Event: event, Matcher: matcher, HandlerType: typ, Command: command}}
		if scope == protocol.ScopeProject || scope == protocol.ScopeLocal {
			it.ProjectPath = env.cwd
		}
		switch scope {
		case protocol.ScopePlugin:
			it.LockedBy, it.ParentId = "plugin", plugin
			if i := strings.LastIndexByte(plugin, '@'); i > 0 {
				if p, ok := plugins[plugin[:i]]; ok && p.installPath != "" {
					it.Path = filepath.Join(p.installPath, "hooks", "hooks.json")
				}
			}
		case protocol.ScopeManaged:
			it.LockedBy = "managed"
		}
		if allOff {
			it.State = "off"
		}
		items = append(items, it)
	}
	if listing, ok := ctrl["get_hooks_listing"]; ok {
		pathFor := map[string]string{}
		for _, f := range files {
			pathFor[f.scope] = f.path
		}
		for _, x := range jArr(listing, "hooks") {
			h, ok := x.(map[string]any)
			if !ok {
				continue
			}
			scope := claudeSourceScope(jStr(h, "source"))
			cmd := jStr(h, "commandText", "displayText")
			add(scope, jStr(h, "event"), jStr(h, "matcher"), jStr(h, "type"), cmd, jStr(h, "pluginName"), pathFor[scope])
		}
		return items
	}
	for _, f := range files {
		hooks := jObj(readJSONFile(f.path), "hooks")
		for event, v := range hooks {
			groups, _ := v.([]any)
			for _, g := range groups {
				gm, _ := g.(map[string]any)
				for _, hh := range jArr(gm, "hooks") {
					h, _ := hh.(map[string]any)
					add(f.scope, event, jStr(gm, "matcher"), jStr(h, "type"), jStr(h, "command", "prompt"), "", f.path)
				}
			}
		}
	}
	return items
}

// claudeMcpItems lists MCP servers from config files only (listing them
// through the CLI starts every server).
func claudeMcpItems(env extEnv, cj claudeJSONSubset) []protocol.ExtItem {
	var items []protocol.ExtItem
	for name, c := range cj.McpServers {
		items = append(items, protocol.ExtItem{Agent: "claude", Kind: protocol.ExtMcpServer, Name: name, Scope: protocol.ScopeUser,
			Path: env.claudeJSON, Mcp: c.info()})
	}
	if env.cwd == "" {
		return items
	}
	proj := cj.project(env.cwd)
	for name, c := range proj.McpServers {
		items = append(items, protocol.ExtItem{Agent: "claude", Kind: protocol.ExtMcpServer, Name: name, Scope: protocol.ScopeLocal,
			ProjectPath: env.cwd, Path: env.claudeJSON, Mcp: c.info()})
	}
	mcpPath := filepath.Join(env.cwd, ".mcp.json")
	var mcpFile struct {
		McpServers map[string]mcpConfig `json:"mcpServers"`
	}
	if b, err := os.ReadFile(mcpPath); err == nil && len(b) < 4<<20 {
		json.Unmarshal(b, &mcpFile)
	}
	enabled, disabled := map[string]bool{}, map[string]bool{}
	all := false
	for _, s := range proj.EnabledMcpjsonServers {
		enabled[s] = true
	}
	for _, s := range proj.DisabledMcpjsonServers {
		disabled[s] = true
	}
	for _, f := range claudeSettingsFiles(env) {
		m := readJSONFile(f.path)
		for _, x := range jArr(m, "enabledMcpjsonServers") {
			if s, ok := x.(string); ok {
				enabled[s] = true
			}
		}
		for _, x := range jArr(m, "disabledMcpjsonServers") {
			if s, ok := x.(string); ok {
				disabled[s] = true
			}
		}
		if jBool(m, "enableAllProjectMcpServers") {
			all = true
		}
	}
	for name, c := range mcpFile.McpServers {
		it := protocol.ExtItem{Agent: "claude", Kind: protocol.ExtMcpServer, Name: name, Scope: protocol.ScopeProject,
			ProjectPath: env.cwd, Path: mcpPath, Mcp: c.info()}
		switch {
		case disabled[name]:
			it.Enabled, it.State = boolPtr(false), "off"
		case enabled[name] || all:
			it.Enabled, it.State = boolPtr(true), "on"
		default:
			it.Enabled, it.State = boolPtr(false), "untrusted"
		}
		items = append(items, it)
	}
	return items
}

// --- Claude Code changes ---

const claudeRestartNote = "Takes effect in new Claude Code sessions"

// claudePluginCmd runs `claude plugin <verb> … --json` and reads its result
// line. alreadyInGoalState counts as success.
func claudePluginCmd(ctx context.Context, args []string, cwd string) (jsonObj, error) {
	bin, err := lookAgentBinary("claude")
	if err != nil {
		return nil, err
	}
	out, runErr := runCLI(ctx, bin, append([]string{"plugin"}, args...), cwd)
	res := lastJSONLine(out)
	if res == nil {
		if runErr != nil {
			return nil, runErr
		}
		return nil, fmt.Errorf("claude printed no result")
	}
	if jStr(res, "outcome") == "ok" || jBool(res, "alreadyInGoalState") {
		return res, nil
	}
	return res, fmt.Errorf("%s", scrubCommand(firstNonEmpty(jStr(res, "message"), "claude plugin "+args[0]+" failed")))
}

func firstNonEmpty(s ...string) string {
	for _, x := range s {
		if x != "" {
			return x
		}
	}
	return ""
}

func claudeTogglePlugin(it protocol.ExtItem, enabled bool) (protocol.ExtChangeResult, error) {
	verb := "disable"
	if enabled {
		verb = "enable"
	}
	ctx, cancel := context.WithTimeout(context.Background(), extCLITimeout)
	defer cancel()
	if _, err := claudePluginCmd(ctx, []string{verb, it.QualifiedName, "-s", it.Scope, "--json"}, it.ProjectPath); err != nil {
		return protocol.ExtChangeResult{}, err
	}
	it.Enabled = boolPtr(enabled)
	it.State = map[bool]string{true: "on", false: "off"}[enabled]
	return protocol.ExtChangeResult{Item: &it, Note: claudeRestartNote}, nil
}

// claudeToggleSkill writes skillOverrides into the settings file of the
// skill's scope: ~/.claude/settings.json for user skills and the project's
// .claude/settings.local.json (as Claude's /skills menu does) for project
// skills.
func claudeToggleSkill(it protocol.ExtItem, enabled bool) (protocol.ExtChangeResult, error) {
	env := newExtEnv(it.ProjectPath)
	var target string
	var others []string
	for _, f := range claudeSettingsFiles(env) {
		want := protocol.ScopeUser
		if it.Scope == protocol.ScopeProject {
			want = protocol.ScopeLocal
		}
		if f.scope == want {
			target = f.path
		} else {
			others = append(others, f.path)
		}
	}
	if target == "" {
		return protocol.ExtChangeResult{}, fmt.Errorf("no settings file for this skill")
	}
	name := it.QualifiedName
	var value any // nil removes the override (absent means on)
	if !enabled {
		value = "off"
	} else {
		for _, o := range others {
			if v, ok := jObj(readJSONFile(o), "skillOverrides")[name].(string); ok && v != "on" {
				value = "on" // another layer turns it off: say on here
			}
		}
	}
	if err := setJSONSetting(target, []string{"skillOverrides", name}, value); err != nil {
		return protocol.ExtChangeResult{}, err
	}
	it.Enabled = boolPtr(enabled)
	it.State = map[bool]string{true: "on", false: "off"}[enabled]
	return protocol.ExtChangeResult{Item: &it, Note: "Takes effect in new Claude Code sessions (running ones pick it up on /reload-skills)"}, nil
}

func claudeUninstallPlugin(it protocol.ExtItem) (protocol.ExtChangeResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), extCLITimeout)
	defer cancel()
	if _, err := claudePluginCmd(ctx, []string{"uninstall", it.QualifiedName, "-s", it.Scope, "--json"}, it.ProjectPath); err != nil {
		return protocol.ExtChangeResult{}, err
	}
	return protocol.ExtChangeResult{Ok: true, Note: claudeRestartNote}, nil
}

// claudeInstall installs plugin@marketplace. A marketplace-declared command
// is never accepted unless the request repeats the sha the CLI showed for
// it (remembered here) — otherwise the command comes back as needsApproval.
func claudeInstall(req protocol.ExtInstallRequest) (protocol.ExtChangeResult, error) {
	approvalKey := "claude|" + req.Id + "|" + req.Scope + "|" + req.Cwd
	args := []string{"install", req.Id, "-s", req.Scope, "--json"}
	if req.AcceptCommand != "" {
		extState.mu.Lock()
		shown, ok := extState.approvals[approvalKey]
		extState.mu.Unlock()
		if ok && shown.sha == req.AcceptCommand && time.Since(shown.at) < approvalTTL {
			args = append(args, "--accept-command", req.AcceptCommand)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), extCLITimeout)
	defer cancel()
	res, err := claudePluginCmd(ctx, args, req.Cwd)
	if shown := jObj(res, "shownCommand"); err != nil && len(shown) > 0 {
		cmd := commandText(shown["command"])
		sha := jStr(shown, "sha256")
		if cmd != "" && isSha256(sha) {
			extState.mu.Lock()
			extState.approvals[approvalKey] = extShown{sha: sha, at: time.Now()}
			extState.mu.Unlock()
			return protocol.ExtChangeResult{NeedsApproval: &protocol.ExtApproval{Command: clipText(cmd, 4000), Sha: sha}}, nil
		}
	}
	if err != nil {
		return protocol.ExtChangeResult{}, err
	}
	extState.mu.Lock()
	delete(extState.approvals, approvalKey)
	extState.mu.Unlock()
	name, mkt := req.Id, ""
	if i := strings.LastIndexByte(req.Id, '@'); i > 0 {
		name, mkt = req.Id[:i], req.Id[i+1:]
	}
	id := firstNonEmpty(jStr(res, "pluginId"), req.Id)
	it := protocol.ExtItem{Agent: "claude", Kind: protocol.ExtPlugin, Name: name, QualifiedName: id, Scope: req.Scope,
		ParentId: mkt, Enabled: boolPtr(true), State: "on"}
	if req.Scope != protocol.ScopeUser {
		it.ProjectPath = req.Cwd
	}
	finishItem(&it)
	return protocol.ExtChangeResult{Item: &it, Note: claudeRestartNote}, nil
}

// approvalTTL bounds how long a shown marketplace command can be accepted.
const approvalTTL = 30 * time.Minute

func isSha256(s string) bool {
	if len(s) != 64 {
		return false
	}
	for _, c := range s {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F') {
			return false
		}
	}
	return true
}

// commandText renders a shown command (a string or an argv list).
func commandText(v any) string {
	switch c := v.(type) {
	case string:
		return c
	case []any:
		parts := make([]string, 0, len(c))
		for _, x := range c {
			s := fmt.Sprint(x)
			if strings.ContainsAny(s, " \t\"'") {
				s = fmt.Sprintf("%q", s)
			}
			parts = append(parts, s)
		}
		return strings.Join(parts, " ")
	}
	return ""
}

// claudeCatalog lists the plugins the configured marketplaces offer.
func claudeCatalog(q string) (protocol.ExtCatalogResult, error) {
	bin, err := lookAgentBinary("claude")
	if err != nil {
		return protocol.ExtCatalogResult{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	out, err := runCLI(ctx, bin, []string{"plugin", "list", "--json", "--available"}, "")
	if err != nil {
		return protocol.ExtCatalogResult{}, err
	}
	return claudeCatalogFrom(out, q), nil
}

func claudeCatalogFrom(out []byte, q string) protocol.ExtCatalogResult {
	m := decodeObj(out)
	installed := map[string]jsonObj{}
	for _, x := range jArr(m, "installed") {
		if p, ok := x.(map[string]any); ok {
			installed[jStr(p, "id", "pluginId")] = p
		}
	}
	res := protocol.ExtCatalogResult{Entries: []protocol.ExtCatalogEntry{}}
	listed := map[string]bool{}
	for _, x := range jArr(m, "available") {
		p, ok := x.(map[string]any)
		id := jStr(p, "pluginId", "id")
		if !ok || id == "" {
			continue
		}
		listed[id] = true
		e := protocol.ExtCatalogEntry{Id: id, Name: jStr(p, "name"), Description: clipText(jStr(p, "description"), 1000),
			Marketplace: jStr(p, "marketplaceName"), Installed: installed[id] != nil, Category: jStr(p, "category")}
		if n, ok := jNum(p, "installCount"); ok {
			e.InstallCount = int(n)
		}
		switch src := p["source"].(type) {
		case string:
			e.Source = &protocol.ExtSource{Type: "path", Path: src}
		case map[string]any:
			e.Source = &protocol.ExtSource{Type: jStr(src, "source"), Repo: jStr(src, "repo"), Url: scrubURL(jStr(src, "url")),
				Path: jStr(src, "path"), Ref: jStr(src, "ref"), Package: jStr(src, "package")}
		}
		if e.Name == "" {
			e.Name = strings.SplitN(id, "@", 2)[0]
		}
		if !catalogMatch(e, q) {
			continue
		}
		res.Entries = append(res.Entries, e)
	}
	// The CLI leaves installed plugins out of "available".
	for _, p := range parseClaudePlugins(out) {
		if listed[p.id] || p.mkt == "builtin" || p.mkt == "inline" {
			continue
		}
		listed[p.id] = true
		e := protocol.ExtCatalogEntry{Id: p.id, Name: p.name, Marketplace: p.mkt, Installed: true}
		if p.installPath != "" {
			e.Description = clipText(jStr(readJSONFile(filepath.Join(p.installPath, ".claude-plugin", "plugin.json")), "description"), 1000)
		}
		if catalogMatch(e, q) {
			res.Entries = append(res.Entries, e)
		}
	}
	return res
}

func catalogMatch(e protocol.ExtCatalogEntry, q string) bool {
	q = strings.ToLower(strings.TrimSpace(q))
	if q == "" {
		return true
	}
	return strings.Contains(strings.ToLower(e.Id+" "+e.Name+" "+e.Description+" "+e.Category), q)
}
