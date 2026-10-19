package protocol

// Agent threads (coding-agent conversations), desktop tunnels and the MCP
// registry. See docs/agent-sessions-api.md for the full contract.

// Message types for threads, agent detection and desktop tunnelling.
const (
	// Hub -> agent requests (carry Id); agent replies with TypeResult.
	TypeThreadStart    = "thread.start"
	TypeThreadPrompt   = "thread.prompt"
	TypeThreadCancel   = "thread.cancel"
	TypeThreadApproval = "thread.approval"
	TypeThreadStop     = "thread.stop"
	TypeAgentsDetect   = "agents.detect"
	TypeDesktopProbe   = "desktop.probe"

	// Agent -> hub notifications (no Id).
	TypeThreadEvent = "thread.event"
	TypeThreadState = "thread.state"

	// TCP tunnelling (carry Channel). Binary frames on the channel carry the
	// raw TCP stream in both directions.
	TypeTcpOpen   = "tcp.open"
	TypeTcpOpened = "tcp.opened"
	TypeTcpClose  = "tcp.close"
)

// McpServer is one MCP server from the hub's registry, handed to every agent.
type McpServer struct {
	Id        string            `json:"id"`
	Name      string            `json:"name"`
	Transport string            `json:"transport"` // "stdio" | "http"
	Command   string            `json:"command,omitempty"`
	Args      []string          `json:"args,omitempty"`
	Env       map[string]string `json:"env,omitempty"`
	Url       string            `json:"url,omitempty"`
	Headers   map[string]string `json:"headers,omitempty"`
	Enabled   bool              `json:"enabled"`
	Builtin   bool              `json:"builtin,omitempty"`
}

// ThreadStart spawns (or re-attaches to) the coding agent behind a thread.
type ThreadStart struct {
	ThreadId   string      `json:"threadId"`
	Agent      string      `json:"agent"`
	Command    string      `json:"command,omitempty"`
	Cwd        string      `json:"cwd"`
	Model      string      `json:"model,omitempty"`
	Access     string      `json:"access"`
	ResumeId   string      `json:"resumeId,omitempty"`
	McpServers []McpServer `json:"mcpServers"`
}

// ThreadStartResult is the reply to thread.start.
type ThreadStartResult struct {
	ResumeId string `json:"resumeId,omitempty"`
}

// ThreadPrompt sends one user turn to a running thread.
type ThreadPrompt struct {
	ThreadId string `json:"threadId"`
	Text     string `json:"text"`
}

// ThreadRef names a thread (thread.cancel, thread.stop).
type ThreadRef struct {
	ThreadId string `json:"threadId"`
}

// ThreadApproval answers a pending approval request.
type ThreadApproval struct {
	ThreadId   string `json:"threadId"`
	ApprovalId string `json:"approvalId"`
	OptionId   string `json:"optionId"`
}

// AgentInfo reports whether one adapter's CLI is installed on a device.
type AgentInfo struct {
	Id        string `json:"id"`
	Installed bool   `json:"installed"`
	Version   string `json:"version,omitempty"`
}

// AgentsDetectResult is the reply to agents.detect.
type AgentsDetectResult struct {
	Agents []AgentInfo `json:"agents"`
}

// DesktopProbeResult is the reply to desktop.probe.
type DesktopProbeResult struct {
	Available bool   `json:"available"`
	Port      int    `json:"port"`
	Reason    string `json:"reason,omitempty"`
}

// ThreadTool describes one tool call inside a thread.
type ThreadTool struct {
	Name   string           `json:"name"`
	Title  string           `json:"title"`
	Status string           `json:"status"` // running | completed | error
	Input  string           `json:"input,omitempty"`
	Output string           `json:"output,omitempty"`
	Files  []ThreadToolFile `json:"files,omitempty"`
}

// ThreadToolFile is one file touched by a tool call.
type ThreadToolFile struct {
	Path      string `json:"path"`
	Additions int    `json:"additions,omitempty"`
	Deletions int    `json:"deletions,omitempty"`
	Diff      string `json:"diff,omitempty"`
}

// PlanEntry is one item of an agent's plan / todo list.
type PlanEntry struct {
	Content string `json:"content"`
	Status  string `json:"status"` // pending | in_progress | completed
}

// ThreadApprovalRequest asks the user to allow or reject an agent action.
type ThreadApprovalRequest struct {
	Id       string           `json:"id"`
	Title    string           `json:"title"`
	Detail   string           `json:"detail,omitempty"`
	Options  []ApprovalOption `json:"options"`
	Resolved string           `json:"resolved,omitempty"`
}

// ApprovalOption is one button on an approval request.
type ApprovalOption struct {
	Id    string `json:"id"`
	Label string `json:"label"`
	Kind  string `json:"kind"` // allow_once | allow_always | reject_once | reject_always
}

// ThreadEvent is one normalised adapter event. Events with the same Id fold
// into one stored message: Append concatenates Text, otherwise non-empty
// fields replace the stored ones.
type ThreadEvent struct {
	Id         string                 `json:"id"`
	Role       string                 `json:"role,omitempty"`
	Text       string                 `json:"text,omitempty"`
	Append     bool                   `json:"append,omitempty"`
	Tool       *ThreadTool            `json:"tool,omitempty"`
	Plan       []PlanEntry            `json:"plan,omitempty"`
	Approval   *ThreadApprovalRequest `json:"approval,omitempty"`
	Turn       string                 `json:"turn,omitempty"`
	DurationMs int64                  `json:"durationMs,omitempty"`
}

// ThreadEventMsg is the payload of a thread.event notification.
type ThreadEventMsg struct {
	ThreadId string      `json:"threadId"`
	Event    ThreadEvent `json:"event"`
}

// Usage is cumulative token usage for a thread.
type Usage struct {
	InputTokens  int64   `json:"inputTokens"`
	OutputTokens int64   `json:"outputTokens"`
	CostUsd      float64 `json:"costUsd,omitempty"`
}

// ThreadState is the payload of a thread.state notification. Empty fields
// mean "unchanged".
type ThreadState struct {
	ThreadId string `json:"threadId"`
	Status   string `json:"status,omitempty"`
	Error    string `json:"error,omitempty"`
	ResumeId string `json:"resumeId,omitempty"`
	Usage    *Usage `json:"usage,omitempty"`
}

// TcpOpen asks the agent to dial a local TCP port and bridge it on Channel.
type TcpOpen struct {
	Host string `json:"host"`
	Port int    `json:"port"`
}
