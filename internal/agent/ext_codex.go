package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// --- Codex inventory ---
//
// A short-lived `codex app-server` (docs/research/skills-plugins.md §2.3):
// skills/list, plugin/list (local marketplaces), hooks/list,
// mcpServerStatus/list (toolsAndAuthOnly) and config/read, of which only
// mcp_servers command/url/enabled and the origin layers are used.

// codexAppServer starts and initialises an app-server in cwd (a scratch
// folder when empty). stop kills it.
func codexAppServer(ctx context.Context, cwd string) (*rpcConn, func(), error) {
	bin, err := lookAgentBinary("codex")
	if err != nil {
		return nil, nil, err
	}
	return codexAppServerAt(ctx, bin, cwd)
}

func codexAppServerAt(ctx context.Context, bin, cwd string) (*rpcConn, func(), error) {
	dir, cleanup := cwd, func() {}
	if dir == "" {
		d, c, err := probeDir()
		if err != nil {
			return nil, nil, err
		}
		dir, cleanup = d, c
	}
	proc, err := startAgentProcess(bin, []string{"app-server"}, dir, agentEnv())
	if err != nil {
		cleanup()
		return nil, nil, err
	}
	stop := func() { stopProbe(proc, cleanup) }
	rpc := newRPCConn(false)
	rpc.proc = proc
	proc.readLines(rpc.handleLine)
	go func() { <-proc.done; rpc.shutdown() }()
	if err := rpc.call(ctx, "initialize", map[string]any{
		"clientInfo":   map[string]string{"name": "overseer", "title": "Overseer", "version": "1"},
		"capabilities": map[string]any{"experimentalApi": true},
	}, nil); err != nil {
		stop()
		if !proc.alive() {
			err = errors.New(oneLine(scrubCommand(proc.exitError())))
		}
		return nil, nil, err
	}
	if err := rpc.notify("initialized", nil); err != nil {
		stop()
		return nil, nil, err
	}
	return rpc, stop, nil
}

// codexReads are the raw app-server answers an inventory is built from.
type codexReads struct {
	skills, plugins, hooks, mcp, config json.RawMessage
}

func collectCodex(ctx context.Context, env extEnv, bin string) ([]protocol.ExtItem, error) {
	rpc, stop, err := codexAppServerAt(ctx, bin, env.cwd)
	if err != nil {
		return nil, err
	}
	defer stop()
	var cwds []string
	if env.cwd != "" {
		cwds = []string{env.cwd}
	}
	var r codexReads
	calls := []struct {
		method string
		params map[string]any
		out    *json.RawMessage
	}{
		{"skills/list", map[string]any{"cwds": cwds}, &r.skills},
		{"plugin/list", map[string]any{"cwds": cwds, "marketplaceKinds": []string{"local"}}, &r.plugins},
		{"hooks/list", map[string]any{"cwds": cwds}, &r.hooks},
		// Not mcpServerStatus/list: it starts every MCP server to count its
		// tools, and opening a page must not launch the user's servers. MCP
		// items come from config/read (command/url/enabled) instead.
		{"config/read", map[string]any{"cwd": nilIfEmpty(env.cwd), "includeLayers": false}, &r.config},
	}
	errs := make([]error, len(calls))
	var wg sync.WaitGroup
	for i, c := range calls {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if cwds == nil {
				delete(c.params, "cwds")
			}
			errs[i] = rpc.call(ctx, c.method, c.params, c.out)
		}()
	}
	wg.Wait()
	items := codexItemsFrom(env, r)
	var msgs []string
	for i, e := range errs {
		if e != nil {
			msgs = append(msgs, calls[i].method+": "+extErrorText(e))
		}
	}
	if len(msgs) > 0 {
		return items, errors.New(strings.Join(msgs, "; "))
	}
	return items, nil
}

func nilIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

type codexInterface struct {
	DisplayName      string `json:"displayName"`
	ShortDescription string `json:"shortDescription"`
	Category         string `json:"category"`
}

type codexPluginSummary struct {
	Id           string          `json:"id"`
	Name         string          `json:"name"`
	Version      string          `json:"version"`
	LocalVersion string          `json:"localVersion"`
	Installed    bool            `json:"installed"`
	Enabled      bool            `json:"enabled"`
	InstallPol   string          `json:"installPolicy"`
	Availability string          `json:"availability"`
	Disabled     string          `json:"disabledReason"`
	Interface    *codexInterface `json:"interface"`
	Source       struct {
		Type    string `json:"type"`
		Path    string `json:"path"`
		Url     string `json:"url"`
		RefName string `json:"refName"`
		Package string `json:"package"`
	} `json:"source"`
}

type codexPluginList struct {
	Marketplaces []struct {
		Name      string               `json:"name"`
		Path      string               `json:"path"`
		Interface *codexInterface      `json:"interface"`
		Plugins   []codexPluginSummary `json:"plugins"`
	} `json:"marketplaces"`
}

// codexMcpConfig is the part of [mcp_servers.<name>] that may be shown.
type codexMcpConfig struct {
	Command string `json:"command"`
	Url     string `json:"url"`
	Enabled *bool  `json:"enabled"`
}

type codexConfigSubset struct {
	Config struct {
		McpServers map[string]codexMcpConfig `json:"mcp_servers"`
	} `json:"config"`
	Origins map[string]struct {
		Name struct {
			Type string `json:"type"`
			File string `json:"file"`
		} `json:"name"`
	} `json:"origins"`
}

func codexScope(s string) string {
	switch s {
	case "user":
		return protocol.ScopeUser
	case "repo", "project":
		return protocol.ScopeProject
	case "system":
		return protocol.ScopeSystem
	case "admin", "mdm", "cloudRequirements", "managed", "enterprise":
		return protocol.ScopeManaged
	case "plugin":
		return protocol.ScopePlugin
	case "sessionFlags", "session":
		return protocol.ScopeSession
	}
	return protocol.ScopeBuiltin
}

func codexItemsFrom(env extEnv, r codexReads) []protocol.ExtItem {
	var items []protocol.ExtItem
	project := func(it *protocol.ExtItem) {
		if it.Scope == protocol.ScopeProject || it.Scope == protocol.ScopeLocal {
			it.ProjectPath = env.cwd
		}
	}

	// Skills.
	var skills struct {
		Data []struct {
			Skills []struct {
				Name             string          `json:"name"`
				Description      string          `json:"description"`
				ShortDescription string          `json:"shortDescription"`
				Interface        *codexInterface `json:"interface"`
				Path             string          `json:"path"`
				Scope            string          `json:"scope"`
				Enabled          bool            `json:"enabled"`
				PluginId         string          `json:"pluginId"`
			} `json:"skills"`
			Errors []struct {
				Path    string `json:"path"`
				Message string `json:"message"`
			} `json:"errors"`
		} `json:"data"`
	}
	json.Unmarshal(r.skills, &skills)
	seen := map[string]bool{}
	for _, d := range skills.Data {
		errsByPath := map[string][]string{}
		for _, e := range d.Errors {
			errsByPath[e.Path] = append(errsByPath[e.Path], e.Message)
		}
		for _, s := range d.Skills {
			if s.Name == "" || seen[s.Path+"\x00"+s.Name] {
				continue
			}
			seen[s.Path+"\x00"+s.Name] = true
			it := protocol.ExtItem{Agent: "codex", Kind: protocol.ExtSkill, Name: s.Name, QualifiedName: s.Name,
				Scope: codexScope(s.Scope), Description: s.Description, Path: s.Path, Enabled: boolPtr(s.Enabled),
				State: map[bool]string{true: "on", false: "off"}[s.Enabled], Errors: errsByPath[s.Path]}
			if s.Interface != nil {
				it.DisplayName = s.Interface.DisplayName
			}
			if s.PluginId != "" {
				it.Scope, it.ParentId = protocol.ScopePlugin, s.PluginId
				if i := strings.IndexByte(s.Name, ':'); i > 0 {
					it.Name = s.Name[i+1:]
				}
			}
			project(&it)
			items = append(items, it)
		}
	}

	// Plugins and marketplaces.
	var plugins codexPluginList
	json.Unmarshal(r.plugins, &plugins)
	for _, m := range plugins.Marketplaces {
		mk := protocol.ExtItem{Agent: "codex", Kind: protocol.ExtMarketplace, Name: m.Name, Scope: protocol.ScopeUser, Path: m.Path}
		if m.Interface != nil {
			mk.DisplayName = m.Interface.DisplayName
		}
		items = append(items, mk)
		for _, p := range m.Plugins {
			if !p.Installed || p.Id == "" {
				continue
			}
			it := protocol.ExtItem{Agent: "codex", Kind: protocol.ExtPlugin, Name: p.Name, QualifiedName: p.Id, Scope: protocol.ScopeUser,
				ParentId: m.Name, Version: firstNonEmpty(p.Version, p.LocalVersion), Enabled: boolPtr(p.Enabled),
				State: map[bool]string{true: "on", false: "off"}[p.Enabled]}
			if p.Interface != nil {
				it.DisplayName, it.Description = p.Interface.DisplayName, p.Interface.ShortDescription
			}
			if p.Availability == "DISABLED_BY_ADMIN" || p.Disabled == "disabled_by_admin" {
				it.State, it.LockedBy = "disabled_by_admin", "policy"
			}
			switch p.Source.Type {
			case "local":
				it.Source = &protocol.ExtSource{Type: "local", Path: p.Source.Path}
				for _, mf := range []string{".codex-plugin", ".claude-plugin", ".cursor-plugin"} {
					if f := filepath.Join(p.Source.Path, mf, "plugin.json"); p.Source.Path != "" && fileExists(f) {
						it.Path = f
						break
					}
				}
			case "git":
				it.Source = &protocol.ExtSource{Type: "git", Url: p.Source.Url, Path: p.Source.Path, Ref: p.Source.RefName}
			case "npm":
				it.Source = &protocol.ExtSource{Type: "npm", Package: p.Source.Package}
			case "remote":
				it.Source = &protocol.ExtSource{Type: "remote"}
			}
			items = append(items, it)
		}
	}

	// Hooks.
	var hooks struct {
		Data []struct {
			Hooks []struct {
				Key         string `json:"key"`
				EventName   string `json:"eventName"`
				HandlerType string `json:"handlerType"`
				Command     string `json:"command"`
				Server      string `json:"server"`
				Tool        string `json:"tool"`
				Matcher     string `json:"matcher"`
				Source      string `json:"source"`
				SourcePath  string `json:"sourcePath"`
				PluginId    string `json:"pluginId"`
				Enabled     bool   `json:"enabled"`
				IsManaged   bool   `json:"isManaged"`
				TrustStatus string `json:"trustStatus"`
			} `json:"hooks"`
		} `json:"data"`
	}
	json.Unmarshal(r.hooks, &hooks)
	seenHook := map[string]bool{}
	for _, d := range hooks.Data {
		for _, h := range d.Hooks {
			q := h.Key
			if q == "" {
				q = h.EventName + "#" + shortHash(h.Source, h.SourcePath, h.Matcher, h.HandlerType, h.Command)
			}
			if seenHook[q] {
				continue
			}
			seenHook[q] = true
			cmd := h.Command
			if cmd == "" && h.Server != "" {
				cmd = h.Server + "/" + h.Tool
			}
			it := protocol.ExtItem{Agent: "codex", Kind: protocol.ExtHook, Name: h.EventName, QualifiedName: q, Scope: codexScope(h.Source),
				Path: h.SourcePath, Enabled: boolPtr(h.Enabled), ParentId: h.PluginId,
				Hook: &protocol.ExtHookInfo{Event: h.EventName, Matcher: h.Matcher, HandlerType: h.HandlerType, Command: cmd, Trust: h.TrustStatus}}
			switch {
			case h.IsManaged:
				it.LockedBy = "managed"
			case h.PluginId != "":
				it.LockedBy = "plugin"
			}
			if h.TrustStatus == "untrusted" || h.TrustStatus == "modified" {
				it.State = "untrusted"
			}
			project(&it)
			items = append(items, it)
		}
	}

	// MCP servers: runtime status plus config (only command/url/enabled).
	var cfg codexConfigSubset
	json.Unmarshal(r.config, &cfg)
	var status struct {
		Data []struct {
			Name       string                     `json:"name"`
			AuthStatus string                     `json:"authStatus"`
			PluginId   string                     `json:"pluginId"`
			Tools      map[string]json.RawMessage `json:"tools"`
			ToolsError any                        `json:"toolsError"`
		} `json:"data"`
	}
	json.Unmarshal(r.mcp, &status)
	listed := map[string]bool{}
	mcpItem := func(name string) protocol.ExtItem {
		c := cfg.Config.McpServers[name]
		it := protocol.ExtItem{Agent: "codex", Kind: protocol.ExtMcpServer, Name: name, Scope: protocol.ScopeUser, Enabled: boolPtr(true)}
		if c.Enabled != nil {
			it.Enabled = boolPtr(*c.Enabled)
		}
		if !*it.Enabled {
			it.State = "off"
		}
		t := "stdio"
		if c.Url != "" {
			t = "http"
		}
		it.Mcp = &protocol.ExtMcp{Transport: t, Command: c.Command, Url: c.Url}
		for _, k := range []string{"command", "url", "enabled"} {
			if o, ok := cfg.Origins["mcp_servers."+name+"."+k]; ok {
				switch o.Name.Type {
				case "project":
					it.Scope = protocol.ScopeProject
				case "system":
					it.Scope = protocol.ScopeSystem
				case "mdm", "managed", "legacyManagedConfigTomlFromFile", "legacyManagedConfigTomlFromMdm":
					it.Scope, it.LockedBy = protocol.ScopeManaged, "managed"
				}
				it.Path = o.Name.File
				break
			}
		}
		project(&it)
		return it
	}
	for _, s := range status.Data {
		if s.Name == "" || listed[s.Name] {
			continue
		}
		listed[s.Name] = true
		it := mcpItem(s.Name)
		it.Mcp.AuthStatus = s.AuthStatus
		if s.Tools != nil {
			it.Mcp.ToolCount = intPtr(len(s.Tools))
		}
		if s.ToolsError != nil {
			it.Errors = append(it.Errors, fmt.Sprint(s.ToolsError))
			it.State = "error"
		}
		if s.AuthStatus == "notLoggedIn" {
			it.State = "needs-auth"
		}
		_, configured := cfg.Config.McpServers[s.Name]
		switch {
		case s.PluginId != "":
			it.Scope, it.ParentId, it.LockedBy, it.ProjectPath = protocol.ScopePlugin, s.PluginId, "plugin", ""
		case !configured:
			it.Scope, it.ProjectPath = protocol.ScopeBuiltin, "" // e.g. codex_apps (ChatGPT apps)
		}
		items = append(items, it)
	}
	names := make([]string, 0, len(cfg.Config.McpServers))
	for name := range cfg.Config.McpServers {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		if !listed[name] {
			items = append(items, mcpItem(name)) // disabled servers are not running
		}
	}
	return items
}

// --- Codex changes ---

const codexNote = "Takes effect in new Codex threads"

// tomlKey quotes a config key path segment for config/value/write.
func tomlKey(s string) string {
	return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s) + `"`
}

func codexToggle(it protocol.ExtItem, enabled bool) (protocol.ExtChangeResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	rpc, stop, err := codexAppServer(ctx, it.ProjectPath)
	if err != nil {
		return protocol.ExtChangeResult{}, err
	}
	defer stop()
	switch it.Kind {
	case protocol.ExtSkill:
		params := map[string]any{"enabled": enabled}
		if it.Path != "" {
			params["path"] = it.Path
		} else {
			params["name"] = it.QualifiedName
		}
		var res struct {
			EffectiveEnabled *bool `json:"effectiveEnabled"`
		}
		if err := rpc.call(ctx, "skills/config/write", params, &res); err != nil {
			return protocol.ExtChangeResult{}, err
		}
		if res.EffectiveEnabled != nil {
			enabled = *res.EffectiveEnabled
		}
	case protocol.ExtPlugin, protocol.ExtMcpServer:
		key := "plugins." + tomlKey(it.QualifiedName) + ".enabled"
		params := map[string]any{"value": enabled, "mergeStrategy": "upsert"}
		if it.Kind == protocol.ExtMcpServer {
			key = "mcp_servers." + tomlKey(it.Name) + ".enabled"
			if it.Scope == protocol.ScopeProject && it.Path != "" {
				params["filePath"] = it.Path
			}
		}
		params["keyPath"] = key
		if err := rpc.call(ctx, "config/value/write", params, nil); err != nil {
			return protocol.ExtChangeResult{}, err
		}
	default:
		return protocol.ExtChangeResult{}, fmt.Errorf("this item can't be turned on or off")
	}
	it.Enabled = boolPtr(enabled)
	it.State = map[bool]string{true: "on", false: "off"}[enabled]
	return protocol.ExtChangeResult{Item: &it, Note: codexNote}, nil
}

// codexFindPlugin looks a plugin up in the local marketplaces.
func codexFindPlugin(ctx context.Context, rpc *rpcConn, id, cwd string) (codexPluginSummary, string, string, error) {
	params := map[string]any{"marketplaceKinds": []string{"local"}}
	if cwd != "" {
		params["cwds"] = []string{cwd}
	}
	var list codexPluginList
	if err := rpc.call(ctx, "plugin/list", params, &list); err != nil {
		return codexPluginSummary{}, "", "", err
	}
	for _, m := range list.Marketplaces {
		for _, p := range m.Plugins {
			if p.Id == id || p.Name+"@"+m.Name == id {
				return p, m.Name, m.Path, nil
			}
		}
	}
	return codexPluginSummary{}, "", "", fmt.Errorf("plugin %s is not in Codex's marketplaces", id)
}

func codexInstall(req protocol.ExtInstallRequest) (protocol.ExtChangeResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), extCLITimeout)
	defer cancel()
	rpc, stop, err := codexAppServer(ctx, req.Cwd)
	if err != nil {
		return protocol.ExtChangeResult{}, err
	}
	defer stop()
	p, mkt, mktPath, err := codexFindPlugin(ctx, rpc, req.Id, req.Cwd)
	if err != nil {
		return protocol.ExtChangeResult{}, err
	}
	params := map[string]any{"pluginName": p.Name}
	if mktPath != "" {
		params["marketplacePath"] = mktPath
	} else {
		params["remoteMarketplaceName"] = mkt
	}
	var res struct {
		AppsNeedingAuth []struct {
			Name string `json:"name"`
		} `json:"appsNeedingAuth"`
	}
	if err := rpc.call(ctx, "plugin/install", params, &res); err != nil {
		return protocol.ExtChangeResult{}, err
	}
	it := protocol.ExtItem{Agent: "codex", Kind: protocol.ExtPlugin, Name: p.Name, QualifiedName: firstNonEmpty(p.Id, p.Name+"@"+mkt),
		Scope: protocol.ScopeUser, ParentId: mkt, Version: firstNonEmpty(p.Version, p.LocalVersion), Enabled: boolPtr(true), State: "on"}
	if p.Interface != nil {
		it.DisplayName, it.Description = p.Interface.DisplayName, p.Interface.ShortDescription
	}
	finishItem(&it)
	note := codexNote
	if len(res.AppsNeedingAuth) > 0 {
		var names []string
		for _, a := range res.AppsNeedingAuth {
			names = append(names, a.Name)
		}
		note += "; sign in to " + strings.Join(names, ", ") + " in Codex to use it"
	}
	return protocol.ExtChangeResult{Item: &it, Note: note}, nil
}

func codexUninstall(it protocol.ExtItem) (protocol.ExtChangeResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), extCLITimeout)
	defer cancel()
	rpc, stop, err := codexAppServer(ctx, "")
	if err != nil {
		return protocol.ExtChangeResult{}, err
	}
	defer stop()
	if err := rpc.call(ctx, "plugin/uninstall", map[string]any{"pluginId": it.QualifiedName}, nil); err != nil {
		return protocol.ExtChangeResult{}, err
	}
	return protocol.ExtChangeResult{Ok: true, Note: codexNote}, nil
}

func codexCatalog(q string) (protocol.ExtCatalogResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	rpc, stop, err := codexAppServer(ctx, "")
	if err != nil {
		return protocol.ExtCatalogResult{}, err
	}
	defer stop()
	var raw json.RawMessage
	if err := rpc.call(ctx, "plugin/list", map[string]any{"marketplaceKinds": []string{"local"}}, &raw); err != nil {
		return protocol.ExtCatalogResult{}, err
	}
	return codexCatalogFrom(raw, q), nil
}

func codexCatalogFrom(raw json.RawMessage, q string) protocol.ExtCatalogResult {
	var list codexPluginList
	json.Unmarshal(raw, &list)
	res := protocol.ExtCatalogResult{Entries: []protocol.ExtCatalogEntry{}}
	for _, m := range list.Marketplaces {
		for _, p := range m.Plugins {
			if p.Id == "" || p.InstallPol == "NOT_AVAILABLE" {
				continue
			}
			e := protocol.ExtCatalogEntry{Id: p.Id, Name: p.Name, Marketplace: m.Name, Installed: p.Installed}
			if p.Interface != nil {
				e.Description, e.Category = clipText(p.Interface.ShortDescription, 1000), p.Interface.Category
				if p.Interface.DisplayName != "" {
					e.Name = p.Interface.DisplayName
				}
			}
			switch p.Source.Type {
			case "git":
				e.Source = &protocol.ExtSource{Type: "git", Url: scrubURL(p.Source.Url), Ref: p.Source.RefName}
			case "npm":
				e.Source = &protocol.ExtSource{Type: "npm", Package: p.Source.Package}
			case "local":
				e.Source = &protocol.ExtSource{Type: "local", Path: p.Source.Path}
			}
			if catalogMatch(e, q) {
				res.Entries = append(res.Entries, e)
			}
		}
	}
	return res
}
