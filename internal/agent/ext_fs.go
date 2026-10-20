package agent

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// --- per-agent file layouts ---

// Bases a layout path is relative to.
const (
	baseHome    = "home"
	baseClaude  = "claude"  // CLAUDE_CONFIG_DIR or ~/.claude
	baseCodex   = "codex"   // CODEX_HOME or ~/.codex
	baseDevin   = "devin"   // ~/.config/devin
	baseProject = "project" // the request's cwd
)

// Scan modes.
const (
	modeSkills = iota // <dir>/<name>/SKILL.md
	modeMd            // <dir>/*.md
	modeMdTree        // <dir>/**/*.md (names joined with ":")
	modeToml          // <dir>/**/*.toml (Gemini/Qwen commands)
	modeFile          // one file
)

type layoutDir struct {
	kind  string
	scope string
	base  string
	rel   string
	mode  int
}

func ld(kind, scope, base, rel string, mode int) layoutDir {
	return layoutDir{kind: kind, scope: scope, base: base, rel: rel, mode: mode}
}

// skillRoots lists, per agent, the folders of SKILL.md folders it reads
// (docs/research/skills-plugins.md §0, §6 and the cross-agent comparison).
var skillRoots = map[string][]layoutDir{
	"claude": {ld(protocol.ExtSkill, protocol.ScopeUser, baseClaude, "skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeProject, baseProject, ".claude/skills", modeSkills)},
	"codex": {ld(protocol.ExtSkill, protocol.ScopeUser, baseHome, ".agents/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeUser, baseCodex, "skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeProject, baseProject, ".agents/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeProject, baseProject, ".codex/skills", modeSkills)},
	"devin": {ld(protocol.ExtSkill, protocol.ScopeUser, baseDevin, "skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeUser, baseHome, ".config/cognition/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeUser, baseHome, ".agents/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeUser, baseHome, ".claude/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeProject, baseProject, ".devin/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeProject, baseProject, ".cognition/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeProject, baseProject, ".agents/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeProject, baseProject, ".windsurf/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeProject, baseProject, ".claude/skills", modeSkills)},
	"opencode": {ld(protocol.ExtSkill, protocol.ScopeUser, baseHome, ".config/opencode/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeUser, baseHome, ".claude/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeUser, baseHome, ".agents/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeProject, baseProject, ".opencode/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeProject, baseProject, ".claude/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeProject, baseProject, ".agents/skills", modeSkills)},
	"gemini": {ld(protocol.ExtSkill, protocol.ScopeUser, baseHome, ".gemini/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeUser, baseHome, ".agents/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeProject, baseProject, ".gemini/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeProject, baseProject, ".agents/skills", modeSkills)},
	"cursor": {ld(protocol.ExtSkill, protocol.ScopeUser, baseHome, ".cursor/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeUser, baseHome, ".agents/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeUser, baseHome, ".claude/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeUser, baseHome, ".codex/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeProject, baseProject, ".cursor/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeProject, baseProject, ".agents/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeProject, baseProject, ".claude/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeProject, baseProject, ".codex/skills", modeSkills)},
	"copilot": {ld(protocol.ExtSkill, protocol.ScopeUser, baseHome, ".copilot/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeUser, baseHome, ".agents/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeProject, baseProject, ".github/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeProject, baseProject, ".agents/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeProject, baseProject, ".claude/skills", modeSkills)},
	"goose": {ld(protocol.ExtSkill, protocol.ScopeUser, baseHome, ".agents/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeProject, baseProject, ".agents/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeProject, baseProject, ".goose/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeProject, baseProject, ".claude/skills", modeSkills)},
	"amp": {ld(protocol.ExtSkill, protocol.ScopeUser, baseHome, ".config/agents/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeUser, baseHome, ".agents/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeUser, baseHome, ".config/amp/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeProject, baseProject, ".agents/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeProject, baseProject, ".claude/skills", modeSkills)},
	"kimi": {ld(protocol.ExtSkill, protocol.ScopeUser, baseHome, ".kimi-code/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeUser, baseHome, ".agents/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeProject, baseProject, ".kimi-code/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeProject, baseProject, ".agents/skills", modeSkills)},
	"qwen": {ld(protocol.ExtSkill, protocol.ScopeUser, baseHome, ".qwen/skills", modeSkills),
		ld(protocol.ExtSkill, protocol.ScopeProject, baseProject, ".qwen/skills", modeSkills)},
}

// otherFiles lists commands, subagents, rules and output styles per agent.
var otherFiles = map[string][]layoutDir{
	"claude": {
		ld(protocol.ExtCommand, protocol.ScopeUser, baseClaude, "commands", modeMdTree),
		ld(protocol.ExtCommand, protocol.ScopeProject, baseProject, ".claude/commands", modeMdTree),
		ld(protocol.ExtSubagent, protocol.ScopeUser, baseClaude, "agents", modeMd),
		ld(protocol.ExtSubagent, protocol.ScopeProject, baseProject, ".claude/agents", modeMd),
		ld(protocol.ExtOutputStyle, protocol.ScopeUser, baseClaude, "output-styles", modeMd),
		ld(protocol.ExtOutputStyle, protocol.ScopeProject, baseProject, ".claude/output-styles", modeMd),
		ld(protocol.ExtRule, protocol.ScopeUser, baseClaude, "CLAUDE.md", modeFile),
		ld(protocol.ExtRule, protocol.ScopeUser, baseClaude, "rules", modeMd),
		ld(protocol.ExtRule, protocol.ScopeProject, baseProject, "CLAUDE.md", modeFile),
		ld(protocol.ExtRule, protocol.ScopeProject, baseProject, ".claude/CLAUDE.md", modeFile),
		ld(protocol.ExtRule, protocol.ScopeLocal, baseProject, "CLAUDE.local.md", modeFile),
		ld(protocol.ExtRule, protocol.ScopeProject, baseProject, ".claude/rules", modeMd)},
	"codex": {
		ld(protocol.ExtSubagent, protocol.ScopeUser, baseCodex, "agents", modeMd),
		ld(protocol.ExtSubagent, protocol.ScopeProject, baseProject, ".codex/agents", modeMd),
		ld(protocol.ExtRule, protocol.ScopeUser, baseCodex, "AGENTS.md", modeFile),
		ld(protocol.ExtRule, protocol.ScopeUser, baseCodex, "AGENTS.override.md", modeFile),
		ld(protocol.ExtRule, protocol.ScopeProject, baseProject, "AGENTS.md", modeFile),
		ld(protocol.ExtRule, protocol.ScopeProject, baseProject, "AGENTS.override.md", modeFile)},
	"devin": {
		ld(protocol.ExtSubagent, protocol.ScopeUser, baseDevin, "agents", modeMd),
		ld(protocol.ExtSubagent, protocol.ScopeProject, baseProject, ".devin/agents", modeMd),
		ld(protocol.ExtSubagent, protocol.ScopeProject, baseProject, ".agents/agents", modeMd),
		ld(protocol.ExtRule, protocol.ScopeUser, baseDevin, "AGENTS.md", modeFile),
		ld(protocol.ExtRule, protocol.ScopeUser, baseHome, ".devin/rules", modeMd),
		ld(protocol.ExtRule, protocol.ScopeUser, baseHome, ".devin/global_rules.md", modeFile),
		ld(protocol.ExtRule, protocol.ScopeProject, baseProject, "AGENTS.md", modeFile),
		ld(protocol.ExtRule, protocol.ScopeLocal, baseProject, "AGENTS.local.md", modeFile),
		ld(protocol.ExtRule, protocol.ScopeProject, baseProject, ".devin/rules", modeMd)},
	"opencode": {
		ld(protocol.ExtCommand, protocol.ScopeUser, baseHome, ".config/opencode/command", modeMdTree),
		ld(protocol.ExtCommand, protocol.ScopeUser, baseHome, ".config/opencode/commands", modeMdTree),
		ld(protocol.ExtCommand, protocol.ScopeProject, baseProject, ".opencode/command", modeMdTree),
		ld(protocol.ExtCommand, protocol.ScopeProject, baseProject, ".opencode/commands", modeMdTree),
		ld(protocol.ExtSubagent, protocol.ScopeUser, baseHome, ".config/opencode/agent", modeMd),
		ld(protocol.ExtSubagent, protocol.ScopeUser, baseHome, ".config/opencode/agents", modeMd),
		ld(protocol.ExtSubagent, protocol.ScopeProject, baseProject, ".opencode/agent", modeMd),
		ld(protocol.ExtSubagent, protocol.ScopeProject, baseProject, ".opencode/agents", modeMd),
		ld(protocol.ExtRule, protocol.ScopeUser, baseHome, ".config/opencode/AGENTS.md", modeFile),
		ld(protocol.ExtRule, protocol.ScopeProject, baseProject, "AGENTS.md", modeFile)},
	"gemini": {
		ld(protocol.ExtCommand, protocol.ScopeUser, baseHome, ".gemini/commands", modeToml),
		ld(protocol.ExtCommand, protocol.ScopeProject, baseProject, ".gemini/commands", modeToml),
		ld(protocol.ExtSubagent, protocol.ScopeUser, baseHome, ".gemini/agents", modeMd),
		ld(protocol.ExtSubagent, protocol.ScopeProject, baseProject, ".gemini/agents", modeMd),
		ld(protocol.ExtRule, protocol.ScopeUser, baseHome, ".gemini/GEMINI.md", modeFile),
		ld(protocol.ExtRule, protocol.ScopeProject, baseProject, "GEMINI.md", modeFile)},
	"cursor": {
		ld(protocol.ExtSubagent, protocol.ScopeUser, baseHome, ".cursor/agents", modeMd),
		ld(protocol.ExtSubagent, protocol.ScopeProject, baseProject, ".cursor/agents", modeMd),
		ld(protocol.ExtRule, protocol.ScopeProject, baseProject, ".cursor/rules", modeMd),
		ld(protocol.ExtRule, protocol.ScopeProject, baseProject, "AGENTS.md", modeFile)},
	"copilot": {
		ld(protocol.ExtSubagent, protocol.ScopeUser, baseHome, ".copilot/agents", modeMd),
		ld(protocol.ExtSubagent, protocol.ScopeProject, baseProject, ".github/agents", modeMd),
		ld(protocol.ExtRule, protocol.ScopeUser, baseHome, ".copilot/copilot-instructions.md", modeFile),
		ld(protocol.ExtRule, protocol.ScopeProject, baseProject, ".github/copilot-instructions.md", modeFile),
		ld(protocol.ExtRule, protocol.ScopeProject, baseProject, "AGENTS.md", modeFile)},
	"goose": {
		ld(protocol.ExtRule, protocol.ScopeProject, baseProject, "AGENTS.md", modeFile),
		ld(protocol.ExtRule, protocol.ScopeProject, baseProject, ".goosehints", modeFile)},
	"amp": {
		ld(protocol.ExtRule, protocol.ScopeUser, baseHome, ".config/amp/AGENTS.md", modeFile),
		ld(protocol.ExtRule, protocol.ScopeProject, baseProject, "AGENTS.md", modeFile)},
	"kimi": {
		ld(protocol.ExtSubagent, protocol.ScopeUser, baseHome, ".kimi-code/agents", modeMd),
		ld(protocol.ExtSubagent, protocol.ScopeProject, baseProject, ".kimi-code/agents", modeMd),
		ld(protocol.ExtRule, protocol.ScopeUser, baseHome, ".kimi-code/AGENTS.md", modeFile),
		ld(protocol.ExtRule, protocol.ScopeProject, baseProject, "AGENTS.md", modeFile)},
	"qwen": {
		ld(protocol.ExtCommand, protocol.ScopeUser, baseHome, ".qwen/commands", modeToml),
		ld(protocol.ExtCommand, protocol.ScopeProject, baseProject, ".qwen/commands", modeToml),
		ld(protocol.ExtSubagent, protocol.ScopeUser, baseHome, ".qwen/agents", modeMd),
		ld(protocol.ExtSubagent, protocol.ScopeProject, baseProject, ".qwen/agents", modeMd),
		ld(protocol.ExtRule, protocol.ScopeUser, baseHome, ".qwen/QWEN.md", modeFile),
		ld(protocol.ExtRule, protocol.ScopeProject, baseProject, "QWEN.md", modeFile)},
}

// linkRoots are where an agent that does not read .agents/skills gets a
// link to a shared skill.
var linkRoots = map[string][2]layoutDir{
	"claude": {skillRoots["claude"][0], skillRoots["claude"][1]},
	"qwen":   {skillRoots["qwen"][0], skillRoots["qwen"][1]},
}

// agentsSkillRoot is the shared .agents/skills root for a scope.
func agentsSkillRoot(env extEnv, scope string) string {
	if scope == protocol.ScopeProject {
		if env.cwd == "" {
			return ""
		}
		return filepath.Join(env.cwd, ".agents", "skills")
	}
	return filepath.Join(env.home, ".agents", "skills")
}

// readsAgentsSkills reports whether an agent reads .agents/skills itself.
func readsAgentsSkills(agent string) bool {
	for _, d := range skillRoots[agent] {
		if d.rel == ".agents/skills" {
			return true
		}
	}
	return false
}

func (env extEnv) dir(d layoutDir) string {
	var base string
	switch d.base {
	case baseHome:
		base = env.home
	case baseClaude:
		base = env.claudeDir
	case baseCodex:
		base = env.codexHome
	case baseDevin:
		base = env.devinDir
	case baseProject:
		base = env.cwd
	}
	if base == "" {
		return ""
	}
	return filepath.Join(base, filepath.FromSlash(d.rel))
}

// allSkillRoots are every agent's skill folders (absolute), the only places
// skills are created, linked, shared from or moved to the trash.
func allSkillRoots(env extEnv) []string {
	var out []string
	seen := map[string]bool{}
	for _, dirs := range skillRoots {
		for _, d := range dirs {
			if p := env.dir(d); p != "" && !seen[p] {
				seen[p] = true
				out = append(out, p)
			}
		}
	}
	return out
}

// --- scanning ---

// fsEntry is one file an agent reads.
type fsEntry struct {
	agent, kind, scope string
	path               string // defining file (SKILL.md for skills)
	real               string // real path of the skill folder or file
	name, qname        string
	fm                 map[string]any
	enabled            *bool
	project            string
}

const (
	maxScanEntries = 400 // per folder
	maxScanDepth   = 3
	frontmatterMax = 16 * 1024
)

// scanAgentFiles lists the skills, commands, subagents, rules and output
// styles an agent reads from disk (user and, with a cwd, project).
func scanAgentFiles(env extEnv, agent string) []fsEntry {
	var out []fsEntry
	dirs := append(append([]layoutDir{}, skillRoots[agent]...), otherFiles[agent]...)
	var overrides map[string]string
	if agent == "claude" {
		overrides = claudeSkillOverrides(env)
	}
	for _, d := range dirs {
		root := env.dir(d)
		if root == "" {
			continue
		}
		mk := func(path, real, name string, fm map[string]any) fsEntry {
			e := fsEntry{agent: agent, kind: d.kind, scope: d.scope, path: path, real: real, name: name, qname: name, fm: fm}
			if d.base == baseProject {
				e.project = env.cwd
			}
			if d.kind == protocol.ExtRule {
				e.name = filepath.Base(path)
				e.qname = displayPath(env, path, d.scope)
			}
			if overrides != nil && d.kind == protocol.ExtSkill {
				v := overrides[name]
				e.enabled = boolPtr(v != "off")
			}
			return e
		}
		switch d.mode {
		case modeSkills:
			entries, err := os.ReadDir(root)
			if err != nil {
				continue
			}
			for i, de := range entries {
				if i >= maxScanEntries {
					break
				}
				if strings.HasPrefix(de.Name(), ".") {
					continue
				}
				dir := filepath.Join(root, de.Name())
				file := filepath.Join(dir, "SKILL.md")
				if fi, err := os.Stat(file); err != nil || !fi.Mode().IsRegular() {
					continue
				}
				fm := readFrontmatter(file)
				name := de.Name()
				if n, ok := fm["name"].(string); ok && strings.TrimSpace(n) != "" {
					name = strings.TrimSpace(n)
				}
				out = append(out, mk(file, realPath(dir), name, fm))
			}
		case modeMd, modeMdTree, modeToml:
			ext := ".md"
			if d.mode == modeToml {
				ext = ".toml"
			}
			depth := 1
			if d.mode != modeMd {
				depth = maxScanDepth
			}
			n := 0
			walkFiles(root, depth, func(path, rel string) bool {
				lower := strings.ToLower(rel)
				if !strings.HasSuffix(lower, ext) && !(ext == ".md" && strings.HasSuffix(lower, ".mdc")) {
					return true
				}
				n++
				if n > maxScanEntries {
					return false
				}
				name := strings.TrimSuffix(strings.TrimSuffix(filepath.ToSlash(rel), filepath.Ext(rel)), ".agent")
				name = strings.ReplaceAll(name, "/", ":")
				var fm map[string]any
				if ext == ".md" {
					fm = readFrontmatter(path)
					if n, ok := fm["name"].(string); ok && d.kind != protocol.ExtCommand && d.kind != protocol.ExtRule && strings.TrimSpace(n) != "" {
						name = strings.TrimSpace(n)
					}
				}
				out = append(out, mk(path, realPath(path), name, fm))
				return true
			})
		case modeFile:
			if fi, err := os.Stat(root); err == nil && fi.Mode().IsRegular() {
				out = append(out, mk(root, realPath(root), filepath.Base(root), nil))
			}
		}
	}
	return out
}

// walkFiles visits regular files under root (following a symlinked root,
// not symlinked folders inside it) up to depth levels.
func walkFiles(root string, depth int, visit func(path, rel string) bool) {
	var walk func(dir, rel string, level int) bool
	walk = func(dir, rel string, level int) bool {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return true
		}
		for _, de := range entries {
			if strings.HasPrefix(de.Name(), ".") {
				continue
			}
			p := filepath.Join(dir, de.Name())
			r := filepath.Join(rel, de.Name())
			if de.IsDir() {
				if level+1 < depth && !walk(p, r, level+1) {
					return false
				}
				continue
			}
			if fi, err := os.Stat(p); err == nil && fi.Mode().IsRegular() {
				if !visit(p, r) {
					return false
				}
			}
		}
		return true
	}
	walk(root, "", 0)
}

// displayPath names a rule file: relative to the project (parent folders
// included, as Claude loads them), else with ~.
func displayPath(env extEnv, p, scope string) string {
	if env.cwd != "" && (scope == protocol.ScopeProject || scope == protocol.ScopeLocal) {
		if rel, err := filepath.Rel(env.cwd, p); err == nil {
			rel = filepath.ToSlash(rel)
			up := 0
			for strings.HasPrefix(rel, "../") {
				rel, up = rel[3:], up+1
			}
			if up == 0 || (up <= 8 && !strings.Contains(rel, "/")) {
				return strings.Repeat("../", up) + rel
			}
		}
	}
	if env.home != "" {
		if rel, err := filepath.Rel(env.home, p); err == nil && !strings.HasPrefix(rel, "..") {
			return "~/" + filepath.ToSlash(rel)
		}
	}
	return filepath.ToSlash(p)
}

// item turns a file entry into an ExtItem.
func (e fsEntry) item(env extEnv) protocol.ExtItem {
	it := protocol.ExtItem{Agent: e.agent, Kind: e.kind, Name: e.name, QualifiedName: e.qname, Scope: e.scope,
		ProjectPath: e.project, Path: e.path, Enabled: e.enabled}
	if e.fm != nil {
		if d, ok := e.fm["description"].(string); ok {
			it.Description = d
		}
		if e.kind == protocol.ExtSkill || e.kind == protocol.ExtCommand {
			it.Invocation = invocationFrom(e.fm)
		}
	}
	return it
}

// invocationFrom reads who may invoke a skill: Claude user-invocable /
// disable-model-invocation, Devin triggers, OpenCode metadata.
func invocationFrom(fm map[string]any) *protocol.ExtInvocation {
	inv := &protocol.ExtInvocation{User: true, Model: true}
	if b, ok := fm["user-invocable"].(bool); ok {
		inv.User = b
	}
	if b, ok := fm["disable-model-invocation"].(bool); ok && b {
		inv.Model = false
	}
	if t, ok := fm["triggers"].([]any); ok {
		inv.User, inv.Model = false, false
		for _, x := range t {
			switch x {
			case "user":
				inv.User = true
			case "model":
				inv.Model = true
			}
		}
	}
	if md, ok := fm["metadata"].(map[string]any); ok {
		if v, ok := md["opencode/autoinvoke"]; ok && (v == false || v == "false") {
			inv.Model = false
		}
	}
	if s, ok := fm["argument-hint"].(string); ok {
		inv.ArgumentHint = clipText(s, 200)
	}
	return inv
}

// readFrontmatter reads the YAML frontmatter at the start of a file.
func readFrontmatter(path string) map[string]any {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	buf := make([]byte, frontmatterMax)
	n, _ := io.ReadFull(f, buf)
	fm, _, _ := parseFrontmatter(buf[:n])
	return fm
}

// --- frontmatter ---

// parseFrontmatter splits a markdown file into its YAML frontmatter (a
// lenient subset: maps, lists, scalars, quoted and block strings) and body.
func parseFrontmatter(data []byte) (map[string]any, string, bool) {
	data = bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))
	text := strings.ReplaceAll(string(data), "\r\n", "\n")
	if !strings.HasPrefix(text, "---\n") {
		return nil, text, false
	}
	rest := text[4:]
	end := -1
	for i := 0; i <= len(rest); {
		j := strings.IndexByte(rest[i:], '\n')
		line := rest[i:]
		if j >= 0 {
			line = rest[i : i+j]
		}
		if t := strings.TrimRight(line, " \t"); t == "---" || t == "..." {
			end = i
			break
		}
		if j < 0 {
			break
		}
		i += j + 1
	}
	if end < 0 {
		return nil, text, false
	}
	block := rest[:end]
	body := rest[end:]
	if k := strings.IndexByte(body, '\n'); k >= 0 {
		body = body[k+1:]
	} else {
		body = ""
	}
	lines := strings.Split(block, "\n")
	p := &yamlParser{lines: lines}
	v := p.parseBlock(0)
	m, _ := v.(map[string]any)
	if m == nil {
		m = map[string]any{}
	}
	return m, body, true
}

type yamlParser struct {
	lines []string
	i     int
}

func indentOf(s string) int {
	return len(s) - len(strings.TrimLeft(s, " "))
}

// next skips blank and comment lines and returns the next line's index.
func (p *yamlParser) next() int {
	for p.i < len(p.lines) {
		t := strings.TrimSpace(p.lines[p.i])
		if t == "" || strings.HasPrefix(t, "#") {
			p.i++
			continue
		}
		return p.i
	}
	return -1
}

// parseBlock parses a map or list whose lines are indented at least min.
func (p *yamlParser) parseBlock(min int) any {
	i := p.next()
	if i < 0 || indentOf(p.lines[i]) < min {
		return nil
	}
	indent := indentOf(p.lines[i])
	if t := strings.TrimSpace(p.lines[i]); t == "-" || strings.HasPrefix(t, "- ") {
		var list []any
		for {
			i = p.next()
			if i < 0 || indentOf(p.lines[i]) != indent {
				break
			}
			t := strings.TrimSpace(p.lines[i])
			if t != "-" && !strings.HasPrefix(t, "- ") {
				break
			}
			p.i++
			item := strings.TrimSpace(strings.TrimPrefix(t, "-"))
			if item == "" {
				list = append(list, p.parseBlock(indent+1))
				continue
			}
			if k, v, ok := splitKey(item); ok {
				// "- key: value" starts an inline map item.
				m := map[string]any{k: p.value(v, indent+2)}
				if more, ok := p.parseBlock(indent + 2).(map[string]any); ok {
					for mk, mv := range more {
						m[mk] = mv
					}
				}
				list = append(list, m)
				continue
			}
			list = append(list, scalar(item))
		}
		return list
	}
	m := map[string]any{}
	for {
		i = p.next()
		if i < 0 || indentOf(p.lines[i]) != indent {
			break
		}
		k, v, ok := splitKey(strings.TrimSpace(p.lines[i]))
		p.i++
		if !ok {
			continue // lenient: skip what we cannot read
		}
		m[k] = p.value(v, indent+1)
	}
	return m
}

// value parses the value after "key:".
func (p *yamlParser) value(v string, childMin int) any {
	v = strings.TrimSpace(v)
	switch {
	case v == "":
		return p.parseBlock(childMin)
	case v == "|" || v == ">" || v == "|-" || v == ">-" || v == "|+" || v == ">+":
		var parts []string
		blockIndent := -1
		for p.i < len(p.lines) {
			line := p.lines[p.i]
			if strings.TrimSpace(line) == "" {
				parts = append(parts, "")
				p.i++
				continue
			}
			ind := indentOf(line)
			if ind < childMin {
				break
			}
			if blockIndent < 0 {
				blockIndent = ind
			}
			if ind < blockIndent {
				break
			}
			parts = append(parts, line[blockIndent:])
			p.i++
		}
		for len(parts) > 0 && parts[len(parts)-1] == "" {
			parts = parts[:len(parts)-1]
		}
		if v[0] == '>' {
			return strings.Join(parts, " ")
		}
		return strings.Join(parts, "\n")
	case v[0] == '[' && strings.HasSuffix(v, "]"):
		inner := strings.TrimSpace(v[1 : len(v)-1])
		list := []any{}
		if inner == "" {
			return list
		}
		for _, part := range splitFlow(inner) {
			list = append(list, scalar(strings.TrimSpace(part)))
		}
		return list
	}
	return scalar(v)
}

// splitKey splits "key: value" (the key may be quoted).
func splitKey(s string) (string, string, bool) {
	if s == "" || s[0] == '-' && (len(s) == 1 || s[1] == ' ') {
		return "", "", false
	}
	if s[0] == '"' || s[0] == '\'' {
		q := s[0]
		end := strings.IndexByte(s[1:], q)
		if end < 0 {
			return "", "", false
		}
		key := s[1 : 1+end]
		rest := strings.TrimSpace(s[2+end:])
		if !strings.HasPrefix(rest, ":") {
			return "", "", false
		}
		return key, rest[1:], true
	}
	for i := 0; i < len(s); i++ {
		if s[i] == ':' && (i+1 == len(s) || s[i+1] == ' ' || s[i+1] == '\t') {
			key := strings.TrimSpace(s[:i])
			if key == "" || strings.ContainsAny(key, "{}[]") {
				return "", "", false
			}
			return key, s[i+1:], true
		}
	}
	return "", "", false
}

// splitFlow splits a flow list on commas outside quotes.
func splitFlow(s string) []string {
	var out []string
	var q byte
	start := 0
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case q != 0:
			if c == q {
				q = 0
			}
		case c == '"' || c == '\'':
			q = c
		case c == ',':
			out = append(out, s[start:i])
			start = i + 1
		}
	}
	return append(out, s[start:])
}

// scalar reads a plain or quoted scalar.
func scalar(s string) any {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if s[0] == '"' {
		if u, err := strconv.Unquote(s); err == nil {
			return u
		}
		if end := strings.LastIndexByte(s, '"'); end > 0 {
			return s[1:end]
		}
		return strings.Trim(s, `"`)
	}
	if s[0] == '\'' {
		if end := strings.LastIndexByte(s, '\''); end > 0 {
			return strings.ReplaceAll(s[1:end], "''", "'")
		}
		return strings.Trim(s, "'")
	}
	if i := strings.Index(s, " #"); i >= 0 {
		s = strings.TrimSpace(s[:i])
	}
	switch strings.ToLower(s) {
	case "true", "yes":
		return true
	case "false", "no":
		return false
	case "null", "~":
		return nil
	}
	if n, err := strconv.ParseInt(s, 10, 64); err == nil {
		return n
	}
	if f, err := strconv.ParseFloat(s, 64); err == nil && !strings.ContainsAny(s, "xXeE") {
		return f
	}
	return s
}
