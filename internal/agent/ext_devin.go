package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// --- Devin CLI inventory ---
//
// `devin skills list --json` (the only JSON listing it has) plus its MCP
// config files (docs/research/skills-plugins.md §3). Rules and subagents
// come from the file scan.

func collectDevin(ctx context.Context, env extEnv, bin string) ([]protocol.ExtItem, error) {
	out, err := runCLI(ctx, bin, []string{"skills", "list", "--json"}, env.cwd)
	items := devinItemsFrom(env, out)
	return items, err
}

func devinItemsFrom(env extEnv, skillsOut []byte) []protocol.ExtItem {
	var items []protocol.ExtItem
	var skills []struct {
		Name        string   `json:"name"`
		DisplayName string   `json:"display_name"`
		Description string   `json:"description"`
		Triggers    []string `json:"triggers"`
		Provider    string   `json:"provider"`
		BaseDir     string   `json:"base_dir"`
		Warnings    []any    `json:"warnings"`
		Errors      []any    `json:"errors"`
	}
	json.Unmarshal(skillsOut, &skills)
	for _, s := range skills {
		if s.Name == "" {
			continue
		}
		it := protocol.ExtItem{Agent: "devin", Kind: protocol.ExtSkill, Name: s.Name, DisplayName: s.DisplayName,
			Description: s.Description, Scope: protocol.ScopeUser}
		if it.DisplayName == it.Name {
			it.DisplayName = ""
		}
		inv := &protocol.ExtInvocation{}
		for _, t := range s.Triggers {
			switch t {
			case "user":
				inv.User = true
			case "model":
				inv.Model = true
			}
		}
		it.Invocation = inv
		switch {
		case strings.EqualFold(s.Provider, "builtin"):
			it.Scope = protocol.ScopeBuiltin
		case env.cwd != "" && s.BaseDir != "" && isWithin(env.cwd, s.BaseDir):
			it.Scope, it.ProjectPath = protocol.ScopeProject, env.cwd
		}
		if s.BaseDir != "" && filepath.IsAbs(s.BaseDir) && it.Scope != protocol.ScopeBuiltin {
			if p := filepath.Join(s.BaseDir, "SKILL.md"); fileExists(p) {
				it.Path = p
			}
		}
		for _, e := range append(s.Errors, s.Warnings...) {
			if m, ok := e.(map[string]any); ok {
				e = jStr(m, "message")
			}
			if str := fmt.Sprint(e); str != "" {
				it.Errors = append(it.Errors, str)
			}
		}
		items = append(items, it)
	}
	for _, f := range devinMcpFiles(env) {
		var cfg struct {
			McpServers map[string]mcpConfig `json:"mcpServers"`
		}
		b, err := os.ReadFile(f.path)
		if err != nil || len(b) > 4<<20 || json.Unmarshal(b, &cfg) != nil {
			continue
		}
		for name, c := range cfg.McpServers {
			it := protocol.ExtItem{Agent: "devin", Kind: protocol.ExtMcpServer, Name: name, Scope: f.scope, Path: f.path,
				Enabled: boolPtr(!c.Disabled), Mcp: c.info()}
			if c.Disabled {
				it.State = "off"
			}
			if f.scope != protocol.ScopeUser {
				it.ProjectPath = env.cwd
			}
			items = append(items, it)
		}
	}
	return items
}

type devinMcpFile struct {
	scope, path string
}

func devinMcpFiles(env extEnv) []devinMcpFile {
	out := []devinMcpFile{{protocol.ScopeUser, filepath.Join(env.devinDir, "mcp_config.json")}}
	if env.cwd != "" {
		out = append(out,
			devinMcpFile{protocol.ScopeProject, filepath.Join(env.cwd, ".devin", "mcp_config.json")},
			devinMcpFile{protocol.ScopeLocal, filepath.Join(env.cwd, ".devin", "mcp_config.local.json")})
	}
	return out
}

// isWithin reports whether p is dir or inside it.
func isWithin(dir, p string) bool {
	rel, err := filepath.Rel(dir, p)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

// devinToggleMcp runs `devin mcp enable|disable -s <scope> <name>`.
func devinToggleMcp(it protocol.ExtItem, enabled bool) (protocol.ExtChangeResult, error) {
	bin, err := lookAgentBinary("devin")
	if err != nil {
		return protocol.ExtChangeResult{}, err
	}
	verb := "disable"
	if enabled {
		verb = "enable"
	}
	ctx, cancel := context.WithTimeout(context.Background(), extCLITimeout)
	defer cancel()
	cwd := it.ProjectPath
	if it.Scope == protocol.ScopeUser {
		cwd = ""
	}
	if _, err := runCLI(ctx, bin, []string{"mcp", verb, "-s", it.Scope, it.Name}, cwd); err != nil {
		return protocol.ExtChangeResult{}, err
	}
	it.Enabled = boolPtr(enabled)
	it.State = map[bool]string{true: "", false: "off"}[enabled]
	return protocol.ExtChangeResult{Item: &it, Note: "Takes effect in new Devin sessions"}, nil
}
