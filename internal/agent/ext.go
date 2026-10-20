package agent

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// Skills & plugins (extensions.*, skills.*): what extends each coding agent
// on this machine, read through the agents' own CLIs (no prompt is ever
// sent) and their files, plus a few safe changes. See "Skills & plugins" in
// docs/agent-sessions-api.md and docs/research/skills-plugins.md.
//
// Every item has a stable key. Item, toggle, uninstall and share requests
// name an item by key and are resolved against a fresh inventory, so a
// request can only reach files and settings the inventory itself reported.

const (
	extAgentBudget = 6 * time.Second  // one agent's inventory
	extSnapshotTTL = 2 * time.Minute  // device-side inventory reuse for key lookups
	extCLITimeout  = 90 * time.Second // installs clone repositories
	extMaxContent  = 64 * 1024        // item detail file content
)

// extCollectors are agents read through their CLI as well as their files.
var extCollectors = map[string]func(context.Context, extEnv, string) ([]protocol.ExtItem, error){
	"claude": collectClaude,
	"codex":  collectCodex,
	"devin":  collectDevin,
}

// extAgentOrder sorts agents in results.
var extAgentOrder = []string{"claude", "codex", "devin", "opencode", "gemini", "cursor", "copilot", "goose", "amp", "kimi", "qwen"}

// extDefaultDetect is used when the hub sends no catalog.
var extDefaultDetect = append(append([]protocol.AgentDetectSpec{}, builtinDetect...),
	protocol.AgentDetectSpec{Id: "devin", Bins: []string{"devin"}},
	protocol.AgentDetectSpec{Id: "amp", Bins: []string{"amp"}},
	protocol.AgentDetectSpec{Id: "kimi", Bins: []string{"kimi"}},
	protocol.AgentDetectSpec{Id: "qwen", Bins: []string{"qwen"}})

// handleExtensions decodes and serves one extensions.* / skills.* request.
func handleExtensions(typ string, data json.RawMessage) (any, error) {
	decode := func(v any) error {
		if len(data) == 0 {
			return nil
		}
		return json.Unmarshal(data, v)
	}
	switch typ {
	case protocol.TypeExtList:
		var req protocol.ExtListRequest
		if err := decode(&req); err != nil {
			return nil, err
		}
		return listExtensions(req)
	case protocol.TypeExtItem:
		var req protocol.ExtKeyRequest
		if err := decode(&req); err != nil {
			return nil, err
		}
		return extItemDetail(req)
	case protocol.TypeExtToggle:
		var req protocol.ExtToggleRequest
		if err := decode(&req); err != nil {
			return nil, err
		}
		return extToggle(req)
	case protocol.TypeExtUninstall:
		var req protocol.ExtKeyRequest
		if err := decode(&req); err != nil {
			return nil, err
		}
		return extUninstall(req)
	case protocol.TypeExtInstall:
		var req protocol.ExtInstallRequest
		if err := decode(&req); err != nil {
			return nil, err
		}
		return extInstall(req)
	case protocol.TypeExtCatalog:
		var req protocol.ExtCatalogRequest
		if err := decode(&req); err != nil {
			return nil, err
		}
		return extCatalog(req)
	case protocol.TypeSkillCreate:
		var req protocol.SkillCreateRequest
		if err := decode(&req); err != nil {
			return nil, err
		}
		return createSkill(req)
	case protocol.TypeSkillShare:
		var req protocol.SkillShareRequest
		if err := decode(&req); err != nil {
			return nil, err
		}
		return shareSkill(req)
	}
	return nil, fmt.Errorf("unsupported request %q", typ)
}

// --- environment ---

// extEnv locates each agent's files; tests point HOME, CLAUDE_CONFIG_DIR and
// CODEX_HOME at temporary directories.
type extEnv struct {
	home       string
	claudeDir  string // CLAUDE_CONFIG_DIR or ~/.claude
	claudeJSON string // <CLAUDE_CONFIG_DIR>/.claude.json or ~/.claude.json
	codexHome  string // CODEX_HOME or ~/.codex
	devinDir   string // ~/.config/devin (%APPDATA%\devin on Windows)
	cwd        string // project directory, "" for none
}

func newExtEnv(cwd string) extEnv {
	home, _ := os.UserHomeDir()
	e := extEnv{home: home, cwd: cwd}
	e.claudeDir = filepath.Join(home, ".claude")
	e.claudeJSON = filepath.Join(home, ".claude.json")
	if d := os.Getenv("CLAUDE_CONFIG_DIR"); d != "" && filepath.IsAbs(d) {
		e.claudeDir = d
		e.claudeJSON = filepath.Join(d, ".claude.json")
	}
	e.codexHome = filepath.Join(home, ".codex")
	if d := os.Getenv("CODEX_HOME"); d != "" && filepath.IsAbs(d) {
		e.codexHome = d
	}
	e.devinDir = filepath.Join(home, ".config", "devin")
	if runtime.GOOS == "windows" {
		if d := os.Getenv("APPDATA"); d != "" {
			e.devinDir = filepath.Join(d, "devin")
		}
	} else if d := os.Getenv("XDG_CONFIG_HOME"); d != "" && filepath.IsAbs(d) {
		e.devinDir = filepath.Join(d, "devin")
	}
	return e
}

// checkCwd validates a request's project directory.
func checkCwd(cwd string) (string, error) {
	if cwd == "" {
		return "", nil
	}
	if !filepath.IsAbs(cwd) {
		return "", fmt.Errorf("cwd must be an absolute path")
	}
	cwd = filepath.Clean(cwd)
	if fi, err := os.Stat(cwd); err != nil || !fi.IsDir() {
		return "", fmt.Errorf("cwd is not a directory on this machine")
	}
	return cwd, nil
}

// --- keys ---

// extKey builds an item key: agent:kind:scope:qualifiedName[:projectPath],
// each part query-escaped so it can be split back unambiguously.
func extKey(agent, kind, scope, qname, project string) string {
	parts := []string{agent, kind, scope, qname}
	if project != "" {
		parts = append(parts, project)
	}
	for i, p := range parts {
		parts[i] = url.QueryEscape(p)
	}
	return strings.Join(parts, ":")
}

type extKeyParts struct {
	agent, kind, scope, qname, project string
}

func parseExtKey(key string) (extKeyParts, error) {
	raw := strings.Split(key, ":")
	if len(key) > 8192 || len(raw) < 4 || len(raw) > 5 {
		return extKeyParts{}, fmt.Errorf("unknown item key")
	}
	var p [5]string
	for i, s := range raw {
		v, err := url.QueryUnescape(s)
		if err != nil {
			return extKeyParts{}, fmt.Errorf("unknown item key")
		}
		p[i] = v
	}
	if p[0] == "" || p[1] == "" || p[2] == "" || p[3] == "" {
		return extKeyParts{}, fmt.Errorf("unknown item key")
	}
	if p[4] != "" && !filepath.IsAbs(p[4]) {
		return extKeyParts{}, fmt.Errorf("unknown item key")
	}
	return extKeyParts{agent: p[0], kind: p[1], scope: p[2], qname: p[3], project: p[4]}, nil
}

// finishItem fills the key and normalises an item built by a collector.
func finishItem(it *protocol.ExtItem) {
	if it.QualifiedName == "" {
		it.QualifiedName = it.Name
	}
	if it.Name == "" {
		it.Name = it.QualifiedName
	}
	if it.Scope != protocol.ScopeProject && it.Scope != protocol.ScopeLocal {
		it.ProjectPath = ""
	}
	it.Key = extKey(it.Agent, it.Kind, it.Scope, it.QualifiedName, it.ProjectPath)
	it.Description = clipText(it.Description, 2000)
	it.DisplayName = clipText(it.DisplayName, 200)
	if it.Hook != nil {
		it.Hook.Command = scrubCommand(it.Hook.Command)
	}
	if it.Mcp != nil {
		it.Mcp.Command = scrubCommand(it.Mcp.Command)
		it.Mcp.Url = scrubURL(it.Mcp.Url)
	}
	if it.Source != nil {
		it.Source.Url = scrubURL(it.Source.Url)
	}
	for i, e := range it.Errors {
		it.Errors[i] = scrubCommand(clipText(e, 500))
	}
}

func clipText(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return truncateUTF8(s, n) + "…"
}

func boolPtr(b bool) *bool { return &b }

func intPtr(n int) *int { return &n }

// --- redaction ---

var (
	secretArgRe   = regexp.MustCompile(`(?i)(--?[a-z0-9_-]*(?:token|secret|password|passwd|api[-_]?key|auth|bearer|credential)[a-z0-9_-]*[= ])\s*("[^"]*"|'[^']*'|\S+)`)
	secretEnvRe   = regexp.MustCompile(`(?i)\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|AUTH|CREDENTIAL)[A-Z0-9_]*)=("[^"]*"|'[^']*'|\S+)`)
	secretHdrRe   = regexp.MustCompile(`(?i)\b(authorization|x-api-key|api-key|cookie)\s*:\s*("[^"]*"|'[^']*'|[^"'\n]+)`)
	secretTokRe   = regexp.MustCompile(`(?i)\b(bearer|basic)\s+[a-z0-9._~+/=-]{8,}`)
	secretLitRe   = regexp.MustCompile(`\b(sk-[A-Za-z0-9_-]{8,}|sk_[A-Za-z0-9_]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|xox[abprs]-[A-Za-z0-9-]{8,}|AKIA[A-Z0-9]{12,}|AIza[A-Za-z0-9_-]{20,}|glpat-[A-Za-z0-9_-]{8,})`)
	urlUserinfoRe = regexp.MustCompile(`([a-z][a-z0-9+.-]*://)[^/@\s]+@`)
	urlQueryRe    = regexp.MustCompile(`(https?://[^\s?#'"]+)[?#][^\s'"]*`)
)

// scrubCommand removes values that look like credentials from a command
// line shown in the UI (hook and MCP commands) and clips it.
func scrubCommand(s string) string {
	if s == "" {
		return ""
	}
	s = secretHdrRe.ReplaceAllString(s, "$1: [redacted]")
	s = secretArgRe.ReplaceAllString(s, "$1[redacted]")
	s = secretEnvRe.ReplaceAllString(s, "$1=[redacted]")
	s = secretTokRe.ReplaceAllString(s, "$1 [redacted]")
	s = secretLitRe.ReplaceAllString(s, "[redacted]")
	s = urlUserinfoRe.ReplaceAllString(s, "$1[redacted]@")
	s = urlQueryRe.ReplaceAllString(s, "$1?[redacted]")
	return clipText(s, 500)
}

// scrubURL keeps scheme, host and path: user info, query and fragment can
// carry keys.
func scrubURL(s string) string {
	if s == "" {
		return ""
	}
	u, err := url.Parse(s)
	if err != nil || u.Host == "" {
		return scrubCommand(s)
	}
	u.User, u.RawQuery, u.Fragment, u.RawFragment = nil, "", "", ""
	return clipText(u.String(), 500)
}

// --- running CLIs ---

// runCLI runs a short-lived agent CLI command and returns its stdout.
func runCLI(ctx context.Context, bin string, args []string, cwd string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Env = agentEnv()
	if cwd != "" {
		cmd.Dir = cwd
	}
	cmd.WaitDelay = time.Second
	cmd.Stdin = nil
	var stdout bytes.Buffer
	stderr := &tailBuffer{limit: stderrTail}
	cmd.Stdout, cmd.Stderr = &limitWriter{w: &stdout, n: 32 << 20}, stderr
	err := cmd.Run()
	if ctx.Err() != nil {
		return stdout.Bytes(), ctx.Err()
	}
	if err != nil {
		msg := err.Error()
		if tail := stderr.String(); tail != "" {
			msg = tail
		}
		return stdout.Bytes(), errors.New(oneLine(scrubCommand(msg)))
	}
	return stdout.Bytes(), nil
}

type limitWriter struct {
	w *bytes.Buffer
	n int
}

func (l *limitWriter) Write(p []byte) (int, error) {
	if room := l.n - l.w.Len(); room > 0 {
		if len(p) > room {
			l.w.Write(p[:room])
		} else {
			l.w.Write(p)
		}
	}
	return len(p), nil
}

// lastJSONLine returns the last stdout line that is a JSON object.
func lastJSONLine(out []byte) jsonObj {
	lines := bytes.Split(bytes.TrimSpace(out), []byte("\n"))
	for i := len(lines) - 1; i >= 0; i-- {
		l := bytes.TrimSpace(lines[i])
		if len(l) > 0 && l[0] == '{' {
			var m jsonObj
			if json.Unmarshal(l, &m) == nil {
				return m
			}
		}
	}
	return nil
}

// --- inventory ---

// extInstalled resolves which agents are installed (binary on PATH).
func extInstalled(specs []protocol.AgentDetectSpec) map[string]string {
	specs = append(append([]protocol.AgentDetectSpec{}, specs...), extDefaultDetect...)
	out := map[string]string{}
	seen := map[string]bool{}
	for _, s := range specs {
		if s.Id == "" || s.Id == "acp" || seen[s.Id] {
			continue
		}
		seen[s.Id] = true
		bins := s.Bins
		if len(bins) > maxDetectBins {
			bins = bins[:maxDetectBins]
		}
		if p := findBinary(bins); p != "" {
			out[s.Id] = p
		}
	}
	return out
}

// extState is the device's memory between requests: recent inventories (for
// key lookups) and the marketplace commands the CLI showed (for installs).
var extState = struct {
	mu        sync.Mutex
	detect    []protocol.AgentDetectSpec
	snapshots map[string]extSnapshot // by cwd
	approvals map[string]extShown    // by agent|plugin|scope
}{snapshots: map[string]extSnapshot{}, approvals: map[string]extShown{}}

type extSnapshot struct {
	at    time.Time
	items map[string]protocol.ExtItem
}

type extShown struct {
	sha string
	at  time.Time
}

func rememberDetect(specs []protocol.AgentDetectSpec) []protocol.AgentDetectSpec {
	extState.mu.Lock()
	defer extState.mu.Unlock()
	if len(specs) > 0 {
		extState.detect = specs
	}
	return extState.detect
}

// listExtensions answers extensions.list.
func listExtensions(req protocol.ExtListRequest) (protocol.ExtListResult, error) {
	cwd, err := checkCwd(req.Cwd)
	if err != nil {
		return protocol.ExtListResult{}, err
	}
	res := inventory(cwd, rememberDetect(req.Detect), "")
	extState.mu.Lock()
	snap := extSnapshot{at: time.Now(), items: map[string]protocol.ExtItem{}}
	for _, it := range res.Items {
		snap.items[it.Key] = it
	}
	for k, s := range extState.snapshots {
		if time.Since(s.at) > extSnapshotTTL {
			delete(extState.snapshots, k)
		}
	}
	extState.snapshots[cwd] = snap
	extState.mu.Unlock()
	return res, nil
}

// inventory gathers every installed agent's items (only one agent's when
// only is set), in parallel with a per-agent budget.
func inventory(cwd string, detect []protocol.AgentDetectSpec, only string) protocol.ExtListResult {
	env := newExtEnv(cwd)
	installed := extInstalled(detect)
	agents := make([]string, 0, len(installed))
	for id := range installed {
		agents = append(agents, id)
	}
	sortAgents(agents)

	type agentResult struct {
		items   []protocol.ExtItem
		err     error
		version string
	}
	results := make(map[string]*agentResult, len(agents))
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, id := range agents {
		if only != "" && id != only {
			continue
		}
		collect := extCollectors[id]
		if collect == nil {
			continue
		}
		bin := installed[id]
		wg.Add(1)
		go func() {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(context.Background(), extAgentBudget)
			defer cancel()
			verCh := make(chan string, 1)
			go func() { verCh <- binaryVersion(bin, versionTimeout) }()
			items, err := collect(ctx, env, bin)
			r := &agentResult{items: items, err: err}
			select {
			case r.version = <-verCh:
			case <-ctx.Done():
			}
			mu.Lock()
			results[id] = r
			mu.Unlock()
		}()
	}
	wg.Wait()

	// Files every installed agent reads, for sharedWith and the scan.
	layouts := map[string][]fsEntry{}
	for _, id := range agents {
		layouts[id] = scanAgentFiles(env, id)
	}

	out := protocol.ExtListResult{Items: []protocol.ExtItem{}, Agents: []protocol.ExtAgentStatus{}, FetchedAt: time.Now().Unix()}
	seenKeys := map[string]int{}
	reported := map[string]bool{} // real paths an item already covers
	add := func(it protocol.ExtItem, fill bool) {
		finishItem(&it)
		if i, ok := seenKeys[it.Key]; ok {
			if fill {
				mergeItem(&out.Items[i], it)
			}
			return
		}
		seenKeys[it.Key] = len(out.Items)
		out.Items = append(out.Items, it)
	}
	for _, id := range agents {
		if only != "" && id != only {
			continue
		}
		r := results[id]
		if extCollectors[id] == nil {
			continue
		}
		for _, it := range r.items {
			add(it, false)
		}
		// Files fill paths and cover kinds the CLI does not list (and
		// everything when the CLI failed). A file the CLI already reported
		// under another name is merged by its real path.
		byReal := map[string]int{}
		for i, it := range out.Items {
			if it.Agent == id {
				if p := itemRealPath(it); p != "" {
					byReal[it.Kind+"\x00"+p] = i
				}
			}
		}
		for _, f := range layouts[id] {
			it := f.item(env)
			if i, ok := byReal[f.kind+"\x00"+f.real]; ok && f.real != "" {
				finishItem(&it)
				mergeItem(&out.Items[i], it)
				continue
			}
			add(it, true)
		}
		st := protocol.ExtAgentStatus{Agent: id, Ok: r.err == nil, Version: r.version}
		if r.err != nil {
			st.Error = extErrorText(r.err)
		}
		out.Agents = append(out.Agents, st)
	}
	for _, it := range out.Items {
		if p := itemRealPath(it); p != "" {
			reported[p] = true
		}
	}
	// Agents read only from disk: items another agent already reports by
	// the same real path show up in its sharedWith instead.
	for _, id := range agents {
		if extCollectors[id] != nil || (only != "" && id != only) {
			continue
		}
		n := 0
		for _, f := range layouts[id] {
			if f.real != "" && reported[f.real] {
				continue
			}
			add(f.item(env), true)
			n++
		}
		if n > 0 {
			out.Agents = append(out.Agents, protocol.ExtAgentStatus{Agent: id, Ok: true})
		}
	}
	// sharedWith: other installed agents that read the same real path.
	readers := map[string][]string{}
	for _, id := range agents {
		seen := map[string]bool{}
		for _, f := range layouts[id] {
			if f.real != "" && !seen[f.real] {
				seen[f.real] = true
				readers[f.real] = append(readers[f.real], id)
			}
		}
	}
	for i := range out.Items {
		it := &out.Items[i]
		p := itemRealPath(*it)
		if p == "" {
			continue
		}
		for _, a := range readers[p] {
			if a != it.Agent && !containsStr(it.SharedWith, a) {
				it.SharedWith = append(it.SharedWith, a)
			}
		}
		sortAgents(it.SharedWith)
	}
	sortItems(out.Items)
	return out
}

func extErrorText(err error) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return "timed out"
	}
	return oneLine(scrubCommand(err.Error()))
}

// mergeItem fills fields a collector left empty from the file scan.
func mergeItem(dst *protocol.ExtItem, src protocol.ExtItem) {
	if dst.Path == "" {
		dst.Path = src.Path
	}
	if dst.Description == "" {
		dst.Description = src.Description
	}
	if dst.DisplayName == "" && src.DisplayName != dst.Name {
		dst.DisplayName = src.DisplayName
	}
	if dst.Invocation == nil {
		dst.Invocation = src.Invocation
	}
	if dst.Enabled == nil && dst.State == "" {
		dst.Enabled = src.Enabled
		dst.State = src.State
	}
}

// itemRealPath is the real path that identifies an item on disk: the skill
// folder for skills, else the defining file.
func itemRealPath(it protocol.ExtItem) string {
	if it.Path == "" {
		return ""
	}
	p := it.Path
	if it.Kind == protocol.ExtSkill && strings.EqualFold(filepath.Base(p), "SKILL.md") {
		p = filepath.Dir(p)
	}
	return realPath(p)
}

func realPath(p string) string {
	r, err := filepath.EvalSymlinks(p)
	if err != nil {
		return ""
	}
	return filepath.Clean(r)
}

func containsStr(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

func agentRank(a string) int {
	for i, x := range extAgentOrder {
		if x == a {
			return i
		}
	}
	return len(extAgentOrder)
}

func sortAgents(list []string) {
	sort.SliceStable(list, func(i, j int) bool {
		if ri, rj := agentRank(list[i]), agentRank(list[j]); ri != rj {
			return ri < rj
		}
		return list[i] < list[j]
	})
}

var kindOrder = []string{protocol.ExtPlugin, protocol.ExtSkill, protocol.ExtCommand, protocol.ExtSubagent, protocol.ExtMcpServer,
	protocol.ExtHook, protocol.ExtRule, protocol.ExtOutputStyle, protocol.ExtExtension, protocol.ExtMarketplace}

var scopeOrder = []string{protocol.ScopeProject, protocol.ScopeLocal, protocol.ScopeUser, protocol.ScopePlugin, protocol.ScopeSynced,
	protocol.ScopeManaged, protocol.ScopeSystem, protocol.ScopeBuiltin, protocol.ScopeSession}

func rank(list []string, s string) int {
	for i, x := range list {
		if x == s {
			return i
		}
	}
	return len(list)
}

func sortItems(items []protocol.ExtItem) {
	sort.SliceStable(items, func(i, j int) bool {
		a, b := items[i], items[j]
		if ra, rb := agentRank(a.Agent), agentRank(b.Agent); ra != rb {
			return ra < rb
		}
		if a.Agent != b.Agent {
			return a.Agent < b.Agent
		}
		if ra, rb := rank(kindOrder, a.Kind), rank(kindOrder, b.Kind); ra != rb {
			return ra < rb
		}
		if ra, rb := rank(scopeOrder, a.Scope), rank(scopeOrder, b.Scope); ra != rb {
			return ra < rb
		}
		return strings.ToLower(a.QualifiedName) < strings.ToLower(b.QualifiedName)
	})
}

// lookupItem resolves a key against a recent inventory, taking a fresh one
// of that agent when needed. Only items the inventory reports resolve.
func lookupItem(key string) (protocol.ExtItem, error) {
	p, err := parseExtKey(key)
	if err != nil {
		return protocol.ExtItem{}, err
	}
	// Any recent inventory will do: user items are in every project's.
	extState.mu.Lock()
	detect := extState.detect
	for _, snap := range extState.snapshots {
		if time.Since(snap.at) < extSnapshotTTL {
			if it, ok := snap.items[key]; ok {
				extState.mu.Unlock()
				return it, nil
			}
		}
	}
	extState.mu.Unlock()
	cwd := ""
	if p.project != "" {
		if cwd, err = checkCwd(p.project); err != nil {
			return protocol.ExtItem{}, fmt.Errorf("unknown item; refresh the list")
		}
	}
	res := inventory(cwd, detect, p.agent)
	for _, it := range res.Items {
		if it.Key == key {
			return it, nil
		}
	}
	return protocol.ExtItem{}, fmt.Errorf("unknown item; refresh the list")
}

// forgetSnapshots drops cached inventories after a change.
func forgetSnapshots() {
	extState.mu.Lock()
	extState.snapshots = map[string]extSnapshot{}
	extState.mu.Unlock()
}

// readOnlyReason says why an item cannot be changed, or "".
func readOnlyReason(it protocol.ExtItem) string {
	switch it.Scope {
	case protocol.ScopeManaged, protocol.ScopeSystem, protocol.ScopeBuiltin, protocol.ScopeSynced, protocol.ScopeSession:
		return fmt.Sprintf("%s items are read-only", it.Scope)
	}
	switch it.LockedBy {
	case "plugin":
		return "provided by a plugin: turn the plugin on or off instead"
	case "policy", "managed":
		return "locked by policy"
	}
	return ""
}

// --- item detail ---

// contentKinds are the kinds whose defining file is shown (markdown only).
var contentKinds = map[string]bool{protocol.ExtSkill: true, protocol.ExtCommand: true, protocol.ExtSubagent: true,
	protocol.ExtRule: true, protocol.ExtOutputStyle: true}

func extItemDetail(req protocol.ExtKeyRequest) (protocol.ExtItemResult, error) {
	it, err := lookupItem(req.Key)
	if err != nil {
		return protocol.ExtItemResult{}, err
	}
	res := protocol.ExtItemResult{Item: it}
	if !contentKinds[it.Kind] || it.Path == "" {
		return res, nil
	}
	data, err := readReportedFile(it.Path)
	if err != nil {
		return res, nil // the item stays visible without its file
	}
	res.Content = string(data)
	if fm, _, ok := parseFrontmatter(data); ok {
		res.Frontmatter = fm
	}
	return res, nil
}

// readReportedFile reads up to extMaxContent bytes of a markdown file the
// inventory reported. Credential-looking files are never read.
func readReportedFile(path string) ([]byte, error) {
	if !filepath.IsAbs(path) {
		return nil, fmt.Errorf("not a file")
	}
	switch strings.ToLower(filepath.Ext(path)) {
	case ".md", ".mdc", ".markdown":
	default:
		return nil, fmt.Errorf("not a markdown file")
	}
	fi, err := os.Stat(path)
	if err != nil || !fi.Mode().IsRegular() {
		return nil, fmt.Errorf("not a file")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	buf := make([]byte, extMaxContent+1)
	n, _ := io.ReadFull(f, buf)
	data := buf[:n]
	if n > extMaxContent {
		data = []byte(truncateUTF8(string(data), extMaxContent))
	}
	return data, nil
}

func shortHash(parts ...string) string {
	h := sha1.New()
	for _, p := range parts {
		h.Write([]byte(p))
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))[:8]
}

func msTime(ms float64) string {
	if ms <= 0 {
		return ""
	}
	return time.UnixMilli(int64(ms)).UTC().Format(time.RFC3339)
}
