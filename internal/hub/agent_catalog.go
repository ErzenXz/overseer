package hub

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// The agent catalog: every coding agent the hub can start, built from the
// built-in adapters, the official ACP registry (fetched daily, cached in the
// data dir) and the user's custom ACP agents. Devices report which catalog
// agents they have; starting a thread resolves an ACP agent's id to the
// command line the device runs.

// agentRegistryURL is the ACP registry; empty disables fetching (tests).
var agentRegistryURL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json"

const (
	agentRegistryFile    = "agent-registry.json"
	agentRegistryEvery   = 24 * time.Hour
	agentRegistryRetry   = time.Hour
	agentRegistryTimeout = 20 * time.Second
	agentRegistryMaxSize = 2 << 20
	deviceAgentsTTL      = 30 * time.Second
	maxCustomAgentName   = 80
	maxCustomCommand     = 4096
)

// CatalogAgent is one entry of GET /api/agents/catalog.
type CatalogAgent struct {
	Id          string   `json:"id"`
	Name        string   `json:"name"`
	Vendor      string   `json:"vendor,omitempty"`
	Description string   `json:"description,omitempty"`
	Icon        string   `json:"icon,omitempty"`
	Website     string   `json:"website,omitempty"`
	Protocol    string   `json:"protocol"` // native | acp
	Source      string   `json:"source"`   // builtin | registry | custom
	Bins        []string `json:"bins"`
	Args        []string `json:"args"`
	Install     string   `json:"install"`
	Login       string   `json:"login"`

	command string // custom agents: the stored command line
}

// builtinAgents keep their ids; the device has its own launch rules for
// them (native adapters, gemini's flag fallbacks).
var builtinAgents = []CatalogAgent{
	{Id: "claude", Name: "Claude Code", Vendor: "Anthropic", Description: "Anthropic's agentic coding CLI", Protocol: "native",
		Bins: []string{"claude"}, Install: "npm install -g @anthropic-ai/claude-code", Login: "claude"},
	{Id: "codex", Name: "Codex", Vendor: "OpenAI", Description: "OpenAI's coding agent CLI", Protocol: "native",
		Bins: []string{"codex"}, Install: "npm install -g @openai/codex", Login: "codex login"},
	{Id: "gemini", Name: "Gemini CLI", Vendor: "Google", Protocol: "acp", Bins: []string{"gemini"}, Args: []string{"--acp"},
		Install: "npm install -g @google/gemini-cli", Login: "gemini"},
	{Id: "opencode", Name: "OpenCode", Vendor: "SST", Protocol: "acp", Bins: []string{"opencode"}, Args: []string{"acp"},
		Install: "npm install -g opencode-ai", Login: "opencode auth login"},
	{Id: "goose", Name: "Goose", Vendor: "Block", Protocol: "acp", Bins: []string{"goose"}, Args: []string{"acp"},
		Install: "curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash", Login: "goose configure"},
	{Id: "copilot", Name: "Copilot CLI", Vendor: "GitHub", Protocol: "acp", Bins: []string{"copilot"}, Args: []string{"--acp"},
		Install: "npm install -g @github/copilot", Login: "copilot"},
	{Id: "cursor", Name: "Cursor Agent", Vendor: "Cursor", Protocol: "acp", Bins: []string{"cursor-agent"}, Args: []string{"acp"},
		Install: "curl https://cursor.com/install -fsS | bash", Login: "cursor-agent login"},
}

// Registry ids that are built-in agents under another id, and registry
// adapters Overseer replaces with its native ones.
var (
	registryAliases = map[string]string{"github-copilot-cli": "copilot"}
	registrySkip    = map[string]bool{"claude-acp": true, "codex-acp": true}
)

// npxBins overrides the executable for npm packages whose command is not
// the package's last path segment (checked against each package's npm "bin";
// identity entries document known ones).
var npxBins = map[string]string{
	"@google/gemini-cli":   "gemini",
	"@github/copilot":      "copilot",
	"@qwen-code/qwen-code": "qwen",
	"@augmentcode/auggie":  "auggie",
	"@xai-official/grok":   "grok",
	"droid":                "droid",
	"@qoder-ai/qodercli":   "qodercli",
	"cline":                "cline",
	"@minimax-ai/code":     "mcode",
	"dirac-cli":            "dirac",
	"@kilocode/cli":        "kilo",
}

// registryLogins are sign-in commands for registry agents, where known.
var registryLogins = map[string]string{"devin": "devin auth login"}

// binaryPlatforms is the order binary distributions are read in: bins and
// args come from the first platform present.
var binaryPlatforms = []string{"darwin-aarch64", "darwin-x86_64", "linux-x86_64", "linux-aarch64", "windows-x86_64", "windows-aarch64"}

var (
	catalogIdRe    = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)
	binNameRe      = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$`)
	binExtRe       = regexp.MustCompile(`(?i)\.(exe|cmd|bat|com|ps1|par|sh)$`)
	binPlatformRe  = regexp.MustCompile(`(?i)[-_](darwin|macos|linux|windows|win32|win)([-_](arm64|aarch64|amd64|x64|x86_64|x86))?$`)
	pkgVersionRe   = regexp.MustCompile(`[=<>~!\[ ;]`)
	customSlugTrim = regexp.MustCompile(`[^a-z0-9]+`)
)

// --- registry parsing ---

type registryDist struct {
	Cmd     string   `json:"cmd"`
	Package string   `json:"package"`
	Args    []string `json:"args"`
}

type registryAgent struct {
	Id           string   `json:"id"`
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	Website      string   `json:"website"`
	Icon         string   `json:"icon"`
	Authors      []string `json:"authors"`
	Distribution struct {
		Binary map[string]registryDist `json:"binary"`
		Npx    *registryDist           `json:"npx"`
		Uvx    *registryDist           `json:"uvx"`
	} `json:"distribution"`
}

// parseRegistry turns registry.json into catalog entries (ids already
// aliased onto built-ins). Malformed entries are skipped; a file with no
// usable entry is an error so a bad download never replaces the cache.
func parseRegistry(data []byte) ([]CatalogAgent, error) {
	var file struct {
		Agents []json.RawMessage `json:"agents"`
	}
	if err := json.Unmarshal(data, &file); err != nil {
		return nil, fmt.Errorf("agent registry: %w", err)
	}
	out := []CatalogAgent{}
	seen := map[string]bool{}
	for _, raw := range file.Agents {
		var r registryAgent
		if json.Unmarshal(raw, &r) != nil {
			continue
		}
		a, ok := registryEntry(r)
		if !ok || seen[a.Id] {
			continue
		}
		seen[a.Id] = true
		out = append(out, a)
	}
	if len(out) == 0 {
		return nil, errors.New("agent registry: no usable agents")
	}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := strings.ToLower(out[i].Name), strings.ToLower(out[j].Name)
		if a != b {
			return a < b
		}
		return out[i].Id < out[j].Id
	})
	return out, nil
}

func registryEntry(r registryAgent) (CatalogAgent, bool) {
	id := strings.TrimSpace(r.Id)
	if alias, ok := registryAliases[id]; ok {
		id = alias
	}
	if registrySkip[id] || !catalogIdRe.MatchString(id) || id == "acp" || strings.HasPrefix(id, "custom-") {
		return CatalogAgent{}, false
	}
	a := CatalogAgent{
		Id: id, Name: clip(r.Name, maxCustomAgentName), Description: clip(r.Description, 300),
		Icon: webURL(r.Icon), Website: webURL(r.Website), Protocol: "acp", Source: "registry", Login: registryLogins[id],
	}
	if a.Name == "" {
		a.Name = id
	}
	if len(r.Authors) > 0 {
		a.Vendor = clip(r.Authors[0], maxCustomAgentName)
	}
	d := r.Distribution
	switch {
	case len(d.Binary) > 0:
		a.Bins, a.Args = binaryBins(d.Binary)
	case d.Npx != nil:
		a.Bins, a.Args = npxBin(d.Npx.Package), d.Npx.Args
	case d.Uvx != nil:
		a.Bins, a.Args = uvxBin(d.Uvx.Package), d.Uvx.Args
	}
	switch {
	case d.Npx != nil && packageName(d.Npx.Package) != "":
		a.Install = "npm install -g " + packageName(d.Npx.Package)
	case d.Uvx != nil && packageName(d.Uvx.Package) != "":
		a.Install = "uv tool install " + packageName(d.Uvx.Package)
	}
	a.Args = cleanArgs(a.Args)
	if len(a.Bins) == 0 || a.Args == nil {
		return CatalogAgent{}, false
	}
	return a, true
}

// binaryBins derives the executables from a binary distribution's cmd paths
// (basename without extension or platform suffix) and takes the args of the
// first platform present.
func binaryBins(platforms map[string]registryDist) ([]string, []string) {
	order := append([]string{}, binaryPlatforms...)
	var rest []string
	for p := range platforms {
		if !containsString(binaryPlatforms, p) {
			rest = append(rest, p)
		}
	}
	sort.Strings(rest)
	order = append(order, rest...)
	var bins, args []string
	first := true
	for _, p := range order {
		d, ok := platforms[p]
		if !ok {
			continue
		}
		if first {
			args, first = d.Args, false
		}
		if b := binName(d.Cmd); b != "" && !containsString(bins, b) {
			bins = append(bins, b)
		}
	}
	return bins, args
}

// binName is the executable name in a registry cmd path: "./bin\devin.exe"
// → "devin", "./pool-darwin-arm64" → "pool".
func binName(cmd string) string {
	cmd = strings.TrimSpace(cmd)
	if i := strings.LastIndexAny(cmd, `/\`); i >= 0 {
		cmd = cmd[i+1:]
	}
	cmd = binExtRe.ReplaceAllString(cmd, "")
	if b := binPlatformRe.ReplaceAllString(cmd, ""); b != "" {
		cmd = b
	}
	if !binNameRe.MatchString(cmd) {
		return ""
	}
	return cmd
}

// packageName drops the version from an npm or PyPI spec:
// "@qwen-code/qwen-code@0.25.3" → "@qwen-code/qwen-code", "x==1.0" → "x".
func packageName(spec string) string {
	spec = strings.TrimSpace(spec)
	if i := pkgVersionRe.FindStringIndex(spec); i != nil {
		spec = spec[:i[0]]
	}
	if i := strings.LastIndexByte(spec, '@'); i > 0 {
		spec = spec[:i]
	}
	return spec
}

func npxBin(spec string) []string {
	pkg := packageName(spec)
	if b, ok := npxBins[pkg]; ok {
		return []string{b}
	}
	if b := binName(pkg[strings.LastIndexByte(pkg, '/')+1:]); b != "" {
		return []string{b}
	}
	return nil
}

func uvxBin(spec string) []string {
	if b := binName(packageName(spec)); b != "" {
		return []string{b}
	}
	return nil
}

// cleanArgs returns args as a non-nil slice, or nil if any is unusable.
func cleanArgs(args []string) []string {
	if len(args) > 16 {
		return nil
	}
	out := []string{}
	for _, a := range args {
		if len(a) > 256 || strings.ContainsAny(a, "\x00\n\r") {
			return nil
		}
		out = append(out, a)
	}
	return out
}

func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return strings.TrimSpace(string([]rune(s)[:n]))
}

func webURL(u string) string {
	u = strings.TrimSpace(u)
	if (strings.HasPrefix(u, "https://") || strings.HasPrefix(u, "http://")) && len(u) <= 512 && !strings.ContainsAny(u, " \"'<>") {
		return u
	}
	return ""
}

func containsString(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

// --- the catalog ---

type agentCatalog struct {
	store     *Store
	cachePath string
	url       string
	version   string

	mu       sync.RWMutex
	registry []CatalogAgent
	custom   []CatalogAgent
	gen      atomic.Uint64 // bumped on every change (device-agents cache key)

	devMu      sync.Mutex
	devDetects map[string]deviceDetect
}

type deviceDetect struct {
	gen     uint64
	expires time.Time
	agents  []protocol.AgentInfo
}

// newAgentCatalog loads the custom agents and the cached registry (so the
// catalog is complete offline); run fetches the registry.
func newAgentCatalog(store *Store, dataDir, version string) *agentCatalog {
	c := &agentCatalog{store: store, cachePath: filepath.Join(dataDir, agentRegistryFile), url: agentRegistryURL,
		version: version, devDetects: map[string]deviceDetect{}}
	if err := c.loadCustom(); err != nil {
		log.Printf("agent catalog: custom agents: %v", err)
	}
	if err := c.loadCache(); err != nil && !errors.Is(err, os.ErrNotExist) {
		log.Printf("agent catalog: cached registry: %v", err)
	}
	return c
}

func (c *agentCatalog) loadCustom() error {
	rows, err := c.store.ListCustomAgents()
	if err != nil {
		return err
	}
	custom := make([]CatalogAgent, 0, len(rows))
	for _, r := range rows {
		if a, err := customEntry(r); err == nil {
			custom = append(custom, a)
		}
	}
	c.mu.Lock()
	c.custom = custom
	c.mu.Unlock()
	c.gen.Add(1)
	return nil
}

func (c *agentCatalog) loadCache() error {
	data, err := os.ReadFile(c.cachePath)
	if err != nil {
		return err
	}
	agents, err := parseRegistry(data)
	if err != nil {
		return err
	}
	c.setRegistry(agents)
	return nil
}

func (c *agentCatalog) setRegistry(agents []CatalogAgent) {
	c.mu.Lock()
	c.registry = agents
	c.mu.Unlock()
	c.gen.Add(1)
}

// run fetches the registry now and every 24 h (hourly after a failure).
func (c *agentCatalog) run(ctx context.Context) {
	if c.url == "" {
		return
	}
	for {
		wait := agentRegistryEvery
		if err := c.refresh(ctx); err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Printf("agent catalog: %v", err)
			wait = agentRegistryRetry
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
	}
}

// refresh downloads the registry, and on success caches it and swaps it in.
func (c *agentCatalog) refresh(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, agentRegistryTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "overseer/"+c.version)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("fetching agent registry: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("fetching agent registry: %s", resp.Status)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, agentRegistryMaxSize+1))
	if err != nil {
		return fmt.Errorf("fetching agent registry: %w", err)
	}
	if len(data) > agentRegistryMaxSize {
		return errors.New("agent registry is larger than 2 MB")
	}
	agents, err := parseRegistry(data)
	if err != nil {
		return err
	}
	if err := writeFileAtomic(c.cachePath, data); err != nil {
		log.Printf("agent catalog: caching registry: %v", err)
	}
	c.setRegistry(agents)
	return nil
}

func writeFileAtomic(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".*")
	if err != nil {
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmp.Name())
		return err
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		os.Remove(tmp.Name())
		return err
	}
	return nil
}

// list is the whole catalog: built-ins (with registry name/icon/description),
// the remaining registry agents by name, then custom agents.
func (c *agentCatalog) list() []CatalogAgent {
	c.mu.RLock()
	defer c.mu.RUnlock()
	byId := make(map[string]CatalogAgent, len(c.registry))
	for _, r := range c.registry {
		byId[r.Id] = r
	}
	out := make([]CatalogAgent, 0, len(builtinAgents)+len(c.registry)+len(c.custom))
	for _, b := range builtinAgents {
		b.Source = "builtin"
		if b.Args == nil {
			b.Args = []string{}
		}
		if r, ok := byId[b.Id]; ok {
			b.Name = r.Name
			b.Icon = r.Icon
			if r.Description != "" {
				b.Description = r.Description
			}
			delete(byId, b.Id)
		}
		out = append(out, b)
	}
	for _, r := range c.registry {
		if _, ok := byId[r.Id]; ok {
			out = append(out, r)
		}
	}
	return append(out, c.custom...)
}

func (c *agentCatalog) lookup(id string) (CatalogAgent, bool) {
	for _, a := range c.list() {
		if a.Id == id {
			return a, true
		}
	}
	return CatalogAgent{}, false
}

// valid reports whether a thread may use agent id ("acp" needs a command).
func (c *agentCatalog) valid(id string) bool {
	if id == "acp" {
		return true
	}
	_, ok := c.lookup(id)
	return ok
}

// launchCommand is the command line sent with thread.start / agent.options
// for registry and custom agents; built-ins (and unknown ids) get "", the
// device launches those itself.
func (c *agentCatalog) launchCommand(id string) string {
	a, ok := c.lookup(id)
	if !ok {
		return ""
	}
	switch a.Source {
	case "custom":
		return a.command
	case "registry":
		return protocol.JoinCommandLine(append([]string{a.Bins[0]}, a.Args...))
	}
	return ""
}

func (c *agentCatalog) detectSpecs(list []CatalogAgent) []protocol.AgentDetectSpec {
	out := make([]protocol.AgentDetectSpec, 0, len(list))
	for _, a := range list {
		out = append(out, protocol.AgentDetectSpec{Id: a.Id, Bins: a.Bins})
	}
	return out
}

// --- custom agents ---

func customEntry(r customAgentRow) (CatalogAgent, error) {
	words, err := protocol.SplitCommandLine(r.Command)
	if err != nil {
		return CatalogAgent{}, err
	}
	if len(words) == 0 {
		return CatalogAgent{}, errors.New("command is required")
	}
	return CatalogAgent{
		Id: r.Id, Name: r.Name, Description: r.Command, Protocol: "acp", Source: "custom",
		Bins: words[:1], Args: append([]string{}, words[1:]...), command: r.Command,
	}, nil
}

// validCustomAgent normalises a create request and returns a problem, if any.
func validCustomAgent(name, command string) (string, string, string) {
	name, command = strings.TrimSpace(name), strings.TrimSpace(command)
	switch n := utf8.RuneCountInString(name); {
	case n == 0 || n > maxCustomAgentName:
		return "", "", "name must be 1-80 characters"
	case strings.ContainsAny(name, "\x00\n\r"):
		return "", "", "name is invalid"
	case command == "":
		return "", "", "command is required"
	case len(command) > maxCustomCommand || strings.ContainsRune(command, 0):
		return "", "", "command is invalid"
	}
	words, err := protocol.SplitCommandLine(command)
	if err != nil {
		return "", "", "command: " + err.Error()
	}
	if len(words) == 0 || words[0] == "" {
		return "", "", "command is required"
	}
	return name, command, ""
}

// customSlug is the id suffix for a custom agent name.
func customSlug(name string) string {
	slug := strings.Trim(customSlugTrim.ReplaceAllString(strings.ToLower(name), "-"), "-")
	if len(slug) > 40 {
		slug = strings.TrimRight(slug[:40], "-")
	}
	if slug == "" {
		slug = "agent"
	}
	return slug
}

// addCustom stores a custom agent under a free "custom-<slug>" id.
func (c *agentCatalog) addCustom(name, command string) (CatalogAgent, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	base := "custom-" + customSlug(name)
	id := base
	for n := 2; ; n++ {
		taken := false
		for _, a := range c.custom {
			taken = taken || a.Id == id
		}
		if !taken {
			break
		}
		id = fmt.Sprintf("%s-%d", base, n)
	}
	row, err := c.store.CreateCustomAgent(id, name, command)
	if err != nil {
		return CatalogAgent{}, err
	}
	a, err := customEntry(row)
	if err != nil {
		return CatalogAgent{}, err
	}
	c.custom = append(c.custom, a)
	c.gen.Add(1)
	return a, nil
}

func (c *agentCatalog) deleteCustom(id string) (bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	found, err := c.store.DeleteCustomAgent(id)
	if err != nil || !found {
		return found, err
	}
	kept := c.custom[:0:0]
	for _, a := range c.custom {
		if a.Id != id {
			kept = append(kept, a)
		}
	}
	c.custom = kept
	c.gen.Add(1)
	return true, nil
}

// --- device detection ---

// deviceAgents asks a device which catalog agents it has (cached briefly:
// the composer asks on every open) and returns one entry per catalog agent
// plus "acp".
func (s *Server) deviceAgents(c *agentConn, refresh bool) ([]protocol.AgentInfo, error) {
	cat := s.agents
	gen := cat.gen.Load()
	if !refresh {
		cat.devMu.Lock()
		e, ok := cat.devDetects[c.deviceId]
		cat.devMu.Unlock()
		if ok && e.gen == gen && time.Now().Before(e.expires) {
			return e.agents, nil
		}
	}
	list := cat.list()
	ctx, cancel := contextWithTimeout(20 * time.Second)
	defer cancel()
	var res protocol.AgentsDetectResult
	if err := c.requestInto(ctx, protocol.TypeAgentsDetect, protocol.AgentsDetect{Agents: cat.detectSpecs(list)}, &res); err != nil {
		return nil, err
	}
	agents := mergeDetected(list, res.Agents)
	cat.devMu.Lock()
	now := time.Now()
	for id, e := range cat.devDetects {
		if now.After(e.expires) {
			delete(cat.devDetects, id)
		}
	}
	cat.devDetects[c.deviceId] = deviceDetect{gen: gen, expires: now.Add(deviceAgentsTTL), agents: agents}
	cat.devMu.Unlock()
	return agents, nil
}

// mergeDetected orders a device's report by the catalog, fills agents an
// older device did not report as not installed, and ends with "acp".
func mergeDetected(list []CatalogAgent, got []protocol.AgentInfo) []protocol.AgentInfo {
	byId := make(map[string]protocol.AgentInfo, len(got))
	for _, a := range got {
		byId[a.Id] = a
	}
	out := make([]protocol.AgentInfo, 0, len(list)+1)
	for _, a := range list {
		info, ok := byId[a.Id]
		if !ok {
			info = protocol.AgentInfo{Id: a.Id}
		}
		out = append(out, info)
	}
	acp, ok := byId["acp"]
	if !ok {
		acp = protocol.AgentInfo{Id: "acp", Installed: true}
	}
	return append(out, acp)
}

// --- HTTP ---

func (s *Server) handleAgentCatalog(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.agents.list())
}

func (s *Server) handleCreateCustomAgent(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name    string `json:"name"`
		Command string `json:"command"`
	}
	if err := readJSON(r, &in); err != nil {
		httpError(w, http.StatusBadRequest, "invalid agent")
		return
	}
	name, command, problem := validCustomAgent(in.Name, in.Command)
	if problem != "" {
		httpError(w, http.StatusBadRequest, problem)
		return
	}
	a, err := s.agents.addCustom(name, command)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, a)
}

func (s *Server) handleDeleteCustomAgent(w http.ResponseWriter, r *http.Request) {
	found, err := s.agents.deleteCustom(r.PathValue("id"))
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !found {
		httpError(w, http.StatusNotFound, "custom agent not found")
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}
