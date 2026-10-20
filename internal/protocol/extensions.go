package protocol

// Skills & plugins: what extends each coding agent on a device (skills,
// plugins and marketplaces, commands, subagents, rules, hooks, MCP servers,
// output styles). The device gathers and changes them through each agent's
// own CLI and files; see "Skills & plugins" in docs/agent-sessions-api.md.
// Nothing here carries env values, headers, tokens or credential files.

// Hub -> agent requests (carry Id).
const (
	TypeExtList      = "extensions.list"      // ExtListRequest -> ExtListResult
	TypeExtItem      = "extensions.item"      // ExtKeyRequest -> ExtItemResult
	TypeExtToggle    = "extensions.toggle"    // ExtToggleRequest -> ExtChangeResult
	TypeExtUninstall = "extensions.uninstall" // ExtKeyRequest -> ExtChangeResult
	TypeExtInstall   = "extensions.install"   // ExtInstallRequest -> ExtChangeResult
	TypeExtCatalog   = "extensions.catalog"   // ExtCatalogRequest -> ExtCatalogResult
	TypeSkillCreate  = "skills.create"        // SkillCreateRequest -> ExtChangeResult
	TypeSkillShare   = "skills.share"         // SkillShareRequest -> ExtChangeResult
)

// Extension kinds.
const (
	ExtSkill       = "skill"
	ExtPlugin      = "plugin"
	ExtMarketplace = "marketplace"
	ExtCommand     = "command"
	ExtSubagent    = "subagent"
	ExtRule        = "rule"
	ExtHook        = "hook"
	ExtExtension   = "extension"
	ExtMcpServer   = "mcp_server"
	ExtOutputStyle = "output_style"
)

// Extension scopes.
const (
	ScopeUser    = "user"
	ScopeProject = "project"
	ScopeLocal   = "local"
	ScopePlugin  = "plugin"
	ScopeManaged = "managed"
	ScopeSystem  = "system"
	ScopeBuiltin = "builtin"
	ScopeSynced  = "synced"
	ScopeSession = "session"
)

// ExtItem is one extension of one agent on one device.
type ExtItem struct {
	Key           string         `json:"key"`
	Agent         string         `json:"agent"`
	Kind          string         `json:"kind"`
	Name          string         `json:"name"`
	QualifiedName string         `json:"qualifiedName"`
	DisplayName   string         `json:"displayName,omitempty"`
	Description   string         `json:"description,omitempty"`
	Scope         string         `json:"scope"`
	ProjectPath   string         `json:"projectPath,omitempty"`
	Path          string         `json:"path,omitempty"`
	ParentId      string         `json:"parentId,omitempty"`
	Version       string         `json:"version,omitempty"`
	Enabled       *bool          `json:"enabled"` // null: no on/off concept
	State         string         `json:"state,omitempty"`
	LockedBy      string         `json:"lockedBy,omitempty"`
	Invocation    *ExtInvocation `json:"invocation,omitempty"`
	Source        *ExtSource     `json:"source,omitempty"`
	Mcp           *ExtMcp        `json:"mcp,omitempty"`
	Hook          *ExtHookInfo   `json:"hook,omitempty"`
	SharedWith    []string       `json:"sharedWith,omitempty"`
	Cost          *ExtCost       `json:"cost,omitempty"`
	Usage         *ExtUsage      `json:"usage,omitempty"`
	Errors        []string       `json:"errors,omitempty"`
}

type ExtInvocation struct {
	User         bool   `json:"user"`
	Model        bool   `json:"model"`
	ArgumentHint string `json:"argumentHint,omitempty"`
}

type ExtSource struct {
	Type    string `json:"type"`
	Repo    string `json:"repo,omitempty"`
	Url     string `json:"url,omitempty"`
	Path    string `json:"path,omitempty"`
	Ref     string `json:"ref,omitempty"`
	Package string `json:"package,omitempty"`
}

// ExtMcp describes an MCP server without its env or header values.
type ExtMcp struct {
	Transport  string `json:"transport"`
	Command    string `json:"command,omitempty"`
	Url        string `json:"url,omitempty"`
	AuthStatus string `json:"authStatus,omitempty"`
	ToolCount  *int   `json:"toolCount,omitempty"`
}

type ExtHookInfo struct {
	Event       string `json:"event"`
	Matcher     string `json:"matcher,omitempty"`
	HandlerType string `json:"handlerType"`
	Command     string `json:"command,omitempty"`
	Trust       string `json:"trust,omitempty"`
}

type ExtCost struct {
	AlwaysOnTokens int `json:"alwaysOnTokens,omitempty"`
	OnInvokeTokens int `json:"onInvokeTokens,omitempty"`
}

type ExtUsage struct {
	Count      int    `json:"count,omitempty"`
	LastUsedAt string `json:"lastUsedAt,omitempty"`
}

// ExtAgentStatus says how one agent's inventory went.
type ExtAgentStatus struct {
	Agent   string `json:"agent"`
	Ok      bool   `json:"ok"`
	Version string `json:"version,omitempty"`
	Error   string `json:"error,omitempty"`
}

// ExtListRequest asks for a device's inventory. Cwd (absolute) adds the
// project's items. Detect lists the catalog agents to look for (empty: the
// device's built-in list).
type ExtListRequest struct {
	Cwd    string            `json:"cwd,omitempty"`
	Detect []AgentDetectSpec `json:"detect,omitempty"`
}

// ExtListResult is the reply to extensions.list and the body of
// GET /api/devices/{id}/extensions.
type ExtListResult struct {
	Items     []ExtItem        `json:"items"`
	Agents    []ExtAgentStatus `json:"agents"`
	FetchedAt int64            `json:"fetchedAt"`
}

// ExtKeyRequest names one inventory item.
type ExtKeyRequest struct {
	Key string `json:"key"`
}

// ExtItemResult is one item with its defining file (≤ 64 KB) for files the
// inventory reported.
type ExtItemResult struct {
	Item        ExtItem        `json:"item"`
	Content     string         `json:"content,omitempty"`
	Frontmatter map[string]any `json:"frontmatter,omitempty"`
}

type ExtToggleRequest struct {
	Key     string `json:"key"`
	Enabled *bool  `json:"enabled"`
}

type ExtInstallRequest struct {
	Agent         string `json:"agent"`
	Id            string `json:"id"`
	Scope         string `json:"scope"`
	Cwd           string `json:"cwd,omitempty"`
	AcceptCommand string `json:"acceptCommand,omitempty"`
}

// ExtApproval is a marketplace-declared command the user must see and accept
// before an install runs it.
type ExtApproval struct {
	Command string `json:"command"`
	Sha     string `json:"sha"`
}

// ExtChangeResult answers the write requests: toggle ({item, note}),
// uninstall ({ok, note}), install ({item?, note?, needsApproval?}) and the
// skills requests ({item}).
type ExtChangeResult struct {
	Ok            bool         `json:"ok,omitempty"`
	Item          *ExtItem     `json:"item,omitempty"`
	Note          string       `json:"note,omitempty"`
	NeedsApproval *ExtApproval `json:"needsApproval,omitempty"`
}

type ExtCatalogRequest struct {
	Agent string `json:"agent"`
	Q     string `json:"q,omitempty"`
}

type ExtCatalogEntry struct {
	Id           string     `json:"id"`
	Name         string     `json:"name"`
	Description  string     `json:"description,omitempty"`
	Category     string     `json:"category,omitempty"`
	Marketplace  string     `json:"marketplace,omitempty"`
	InstallCount int        `json:"installCount,omitempty"`
	Installed    bool       `json:"installed"`
	HasSkills    *bool      `json:"hasSkills,omitempty"`
	HasMcp       *bool      `json:"hasMcp,omitempty"`
	HasHooks     *bool      `json:"hasHooks,omitempty"`
	Source       *ExtSource `json:"source,omitempty"`
}

type ExtCatalogResult struct {
	Entries []ExtCatalogEntry `json:"entries"`
}

type SkillCreateRequest struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Body        string   `json:"body,omitempty"`
	Scope       string   `json:"scope"`
	Cwd         string   `json:"cwd,omitempty"`
	Agents      []string `json:"agents"`
}

type SkillShareRequest struct {
	Key    string   `json:"key"`
	Agents []string `json:"agents"`
}
