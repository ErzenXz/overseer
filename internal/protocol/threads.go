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
	TypeThreadCompact  = "thread.compact"
	TypeThreadUndo     = "thread.undo"
	TypeThreadAnswer   = "thread.answer"
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
	Command    string      `json:"command,omitempty"` // ACP launch command for "acp" and catalog ACP agents
	Cwd        string      `json:"cwd"`
	Model      string      `json:"model,omitempty"`
	Access     string      `json:"access"`
	Effort     string      `json:"effort,omitempty"` // thinking level id (agent-native)
	Fast       bool        `json:"fast,omitempty"`   // fast / priority tier
	Mode       string      `json:"mode,omitempty"`   // agent-native mode id; wins over Access
	ResumeId   string      `json:"resumeId,omitempty"`
	McpServers []McpServer `json:"mcpServers"`
	// Fork starts a copy of the ResumeId session instead of resuming it.
	// ForkAt (a hub user message id) keeps only the turns through that
	// prompt, where the CLI can (Codex); otherwise the device starts a
	// fresh session and reports ForkFallback.
	Fork   bool   `json:"fork,omitempty"`
	ForkAt string `json:"forkAt,omitempty"`
}

// ThreadStartResult is the reply to thread.start.
type ThreadStartResult struct {
	ResumeId string `json:"resumeId,omitempty"`
	// ForkFallback: a fork was asked for but the agent started a fresh
	// session (the hub then sends the transcript with the first prompt).
	ForkFallback bool `json:"forkFallback,omitempty"`
}

// ThreadPrompt sends one user turn to a running thread. When a turn is
// already running, agents that can steer add it to that turn.
type ThreadPrompt struct {
	ThreadId  string   `json:"threadId"`
	Text      string   `json:"text"`
	MessageId string   `json:"messageId,omitempty"` // hub id of the user message
	Images    []string `json:"images,omitempty"`    // image file paths on the device
}

// ThreadAnswer replies to a pending question.
type ThreadAnswer struct {
	ThreadId   string   `json:"threadId"`
	QuestionId string   `json:"questionId"`
	Answers    []string `json:"answers"`
	Text       string   `json:"text,omitempty"`
}

// ThreadCapabilities says which native features a thread's agent supports.
type ThreadCapabilities struct {
	Fork     bool `json:"fork"`
	Compact  bool `json:"compact"`
	Undo     bool `json:"undo"`
	Steer    bool `json:"steer"`
	Images   bool `json:"images"`
	Commands bool `json:"commands"`
	Review   bool `json:"review"`
}

// AgentCommand is one of the agent's own slash commands.
type AgentCommand struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Hint        string `json:"hint,omitempty"`
}

// ErrNotSupported prefixes device errors for features an agent lacks; the
// hub turns them into 409s.
const ErrNotSupported = "not supported by"

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

// AgentsDetect is the agents.detect request: the hub's catalog as the
// executables that mean "installed". Empty (older hubs) means the device's
// built-in list.
type AgentsDetect struct {
	Agents []AgentDetectSpec `json:"agents,omitempty"`
}

// AgentDetectSpec names one catalog agent and the executables to look for.
type AgentDetectSpec struct {
	Id   string   `json:"id"`
	Bins []string `json:"bins"`
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
	Question   *ThreadQuestion        `json:"question,omitempty"`
}

// ThreadQuestion asks the user to pick options and/or type an answer.
type ThreadQuestion struct {
	Id        string           `json:"id"`
	Text      string           `json:"text"`
	Options   []QuestionOption `json:"options"`
	Multiple  bool             `json:"multiple,omitempty"`
	AllowText bool             `json:"allowText,omitempty"`
	Answered  []string         `json:"answered,omitempty"`
}

// QuestionOption is one choice of a question.
type QuestionOption struct {
	Id          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
}

// ThreadEventMsg is the payload of a thread.event notification.
type ThreadEventMsg struct {
	ThreadId string      `json:"threadId"`
	Event    ThreadEvent `json:"event"`
}

// Usage is cumulative token usage for a thread.
type Usage struct {
	InputTokens   int64   `json:"inputTokens"`
	OutputTokens  int64   `json:"outputTokens"`
	CostUsd       float64 `json:"costUsd,omitempty"`
	ContextTokens int64   `json:"contextTokens,omitempty"` // latest context fill
	ContextWindow int64   `json:"contextWindow,omitempty"`
}

// ThreadState is the payload of a thread.state notification. Empty fields
// mean "unchanged".
type ThreadState struct {
	ThreadId string `json:"threadId"`
	Status   string `json:"status,omitempty"`
	Error    string `json:"error,omitempty"`
	ResumeId string `json:"resumeId,omitempty"`
	Usage    *Usage `json:"usage,omitempty"`
	// Capabilities and Commands describe the running agent (sent after
	// start and whenever the agent's command list changes).
	Capabilities *ThreadCapabilities `json:"capabilities,omitempty"`
	Commands     []AgentCommand      `json:"commands,omitempty"`
}

// TcpOpen asks the agent to dial a local TCP port and bridge it on Channel.
type TcpOpen struct {
	Host string `json:"host"`
	Port int    `json:"port"`
}
