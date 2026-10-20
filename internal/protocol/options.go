package protocol

import (
	"encoding/json"
	"strings"
)

// Agent options: what models, thinking levels, speed tiers and permission
// modes one coding agent supports on one machine. See "Agent options" in
// docs/agent-sessions-api.md.

const (
	// Hub -> agent requests (carry Id); agent replies with TypeResult.
	TypeAgentOptions = "agent.options"
	TypeThreadUpdate = "thread.update"
)

// Option sources.
const (
	OptionsDiscovered = "discovered"
	OptionsBuiltin    = "builtin"
)

// Mode kinds (agent-independent, for icons and the legacy access field).
const (
	KindReadonly = "readonly"
	KindPlan     = "plan"
	KindAsk      = "ask"
	KindEdits    = "edits"
	KindAuto     = "auto"
	KindFull     = "full"
)

// AgentOptionsRequest asks the device which options an agent supports.
type AgentOptionsRequest struct {
	Agent   string `json:"agent"`
	Command string `json:"command,omitempty"` // "acp" and catalog ACP agents (registry, custom)
}

// AgentOptions is the reply to agent.options and the body of
// GET /api/devices/{id}/agents/{agent}/options.
type AgentOptions struct {
	Agent       string        `json:"agent"`
	Source      string        `json:"source"` // discovered | builtin
	Models      []AgentModel  `json:"models"`
	Efforts     []AgentEffort `json:"efforts"`
	Fast        *AgentFast    `json:"fast,omitempty"`
	Modes       []AgentMode   `json:"modes"`
	DefaultMode string        `json:"defaultMode"`
}

// AgentModel is one selectable model. A nil Efforts means "not reported"
// (use AgentOptions.Efforts); a non-nil empty slice means the model has no
// thinking levels, and is sent as [].
type AgentModel struct {
	Id            string   `json:"id"`
	Label         string   `json:"label"`
	Description   string   `json:"description,omitempty"`
	Efforts       []string `json:"efforts,omitempty"`
	DefaultEffort string   `json:"defaultEffort,omitempty"`
	Default       bool     `json:"default,omitempty"`
}

func (m AgentModel) MarshalJSON() ([]byte, error) {
	type plain AgentModel
	var out struct {
		plain
		Efforts *[]string `json:"efforts,omitempty"`
	}
	out.plain = plain(m)
	if m.Efforts != nil {
		out.Efforts = &m.Efforts
	}
	return json.Marshal(out)
}

// AgentEffort is one thinking / reasoning level.
type AgentEffort struct {
	Id          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
}

// AgentFast describes the agent's fast / priority option.
type AgentFast struct {
	Label       string `json:"label"`
	Description string `json:"description"`
}

// AgentMode is one agent-native permission / collaboration mode.
type AgentMode struct {
	Id          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Kind        string `json:"kind"`
}

// ThreadUpdate pushes changed settings to a running thread. The agent applies
// what it can live and reports whether the process must be restarted (and
// resumed) for the rest to take effect.
type ThreadUpdate struct {
	ThreadId string `json:"threadId"`
	Model    string `json:"model,omitempty"`
	Effort   string `json:"effort,omitempty"`
	Fast     bool   `json:"fast,omitempty"`
	Mode     string `json:"mode,omitempty"`
	Access   string `json:"access"`
}

// ThreadUpdateResult is the reply to thread.update.
type ThreadUpdateResult struct {
	Restart bool `json:"restart,omitempty"`
}

// --- builtin fallbacks ---

var effortLabels = map[string]string{
	"none": "None", "minimal": "Minimal", "low": "Low", "medium": "Medium", "high": "High",
	"xhigh": "Extra high", "max": "Max", "ultra": "Ultra",
}

// effortOrder is the canonical low-to-high order of known effort ids.
var effortOrder = []string{"none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"}

// EffortLabel is a display label for an effort id.
func EffortLabel(id string) string {
	if l := effortLabels[id]; l != "" {
		return l
	}
	if id == "" {
		return ""
	}
	return strings.ToUpper(id[:1]) + id[1:]
}

// SortEfforts orders effort ids low to high (unknown ids keep their relative
// order after the known ones) and drops duplicates.
func SortEfforts(ids []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, k := range effortOrder {
		for _, id := range ids {
			if id == k && !seen[id] {
				seen[id] = true
				out = append(out, id)
			}
		}
	}
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

func effortList(ids ...string) []AgentEffort {
	out := make([]AgentEffort, 0, len(ids))
	for _, id := range ids {
		out = append(out, AgentEffort{Id: id, Label: EffortLabel(id)})
	}
	return out
}

// ClaudeModes are Claude Code's permission modes (--permission-mode).
var ClaudeModes = []AgentMode{
	{Id: "default", Label: "Ask permissions", Description: "Asks before editing files or running commands.", Kind: KindAsk},
	{Id: "acceptEdits", Label: "Accept edits", Description: "Edits files without asking; asks before running commands.", Kind: KindEdits},
	{Id: "plan", Label: "Plan", Description: "Read-only: explores the code and proposes a plan without changing anything.", Kind: KindPlan},
	{Id: "auto", Label: "Auto", Description: "A safety classifier approves routine actions and asks about risky ones.", Kind: KindAuto},
	{Id: "bypassPermissions", Label: "Bypass permissions", Description: "Runs everything without asking.", Kind: KindFull},
}

// CodexModes are the Codex approval policy × sandbox presets plus the plan
// collaboration mode.
var CodexModes = []AgentMode{
	{Id: "read-only", Label: "Read only", Description: "Reads files; asks before any edit or command.", Kind: KindReadonly},
	{Id: "plan", Label: "Plan", Description: "Plans the work with you before changing anything.", Kind: KindPlan},
	{Id: "on-request", Label: "Ask", Description: "Works inside the workspace sandbox; asks before going outside it.", Kind: KindAsk},
	{Id: "auto", Label: "Auto", Description: "Works inside the workspace sandbox; an automatic reviewer handles approval requests.", Kind: KindAuto},
	{Id: "full-access", Label: "Full access", Description: "No sandbox and no approval prompts.", Kind: KindFull},
}

// ClaudeFast and CodexFast describe the agents' fast options.
var (
	ClaudeFast = AgentFast{Label: "Fast mode", Description: "Faster output on supported models, at a higher usage cost."}
	CodexFast  = AgentFast{Label: "Fast", Description: "Priority service tier: faster responses, increased usage."}
)

var acpDefaultModes = []AgentMode{
	{Id: "default", Label: "Default", Description: "The agent's default behaviour.", Kind: KindAsk},
}

func copyModes(m []AgentMode) []AgentMode { return append([]AgentMode{}, m...) }

// BuiltinAgentOptions is the static fallback used when discovery fails or
// the CLI is missing.
func BuiltinAgentOptions(agent string) AgentOptions {
	o := AgentOptions{Agent: agent, Source: OptionsBuiltin, Models: []AgentModel{}, Efforts: []AgentEffort{}}
	switch agent {
	case "claude":
		o.Models = []AgentModel{
			{Id: "sonnet", Label: "Sonnet"},
			{Id: "opus", Label: "Opus"},
			{Id: "haiku", Label: "Haiku"},
		}
		o.Efforts = effortList("low", "medium", "high", "max")
		fast := ClaudeFast
		o.Fast = &fast
		o.Modes = copyModes(ClaudeModes)
		o.DefaultMode = "default"
	case "codex":
		o.Efforts = effortList("minimal", "low", "medium", "high")
		fast := CodexFast
		o.Fast = &fast
		o.Modes = copyModes(CodexModes)
		o.DefaultMode = "on-request"
	default:
		o.Modes = copyModes(acpDefaultModes)
		o.DefaultMode = "default"
	}
	return o
}

// EffortsFromIds builds the effort list for ids (sorted, labelled).
func EffortsFromIds(ids []string) []AgentEffort {
	return effortList(SortEfforts(ids)...)
}

// --- mode kinds and the legacy access field ---

// GuessModeKind classifies an agent-native mode id (and optional name) for
// agents that don't say: plan, read-only, full/yolo, auto, edits or ask.
func GuessModeKind(id, name string) string {
	s := strings.ToLower(id + " " + name)
	has := func(words ...string) bool {
		for _, w := range words {
			if strings.Contains(s, w) {
				return true
			}
		}
		return false
	}
	switch {
	case has("plan"):
		return KindPlan
	case has("read-only", "readonly", "read only", "read_only"):
		return KindReadonly
	case has("bypass", "yolo", "full", "danger"):
		return KindFull
	case has("auto"):
		return KindAuto
	case has("edit", "accept", "build", "code", "write", "agent"):
		return KindEdits
	}
	return KindAsk
}

// ModeKind returns the kind of mode for agent, consulting modes (usually the
// discovered options) first, then the builtin tables, then a guess.
func ModeKind(agent, mode string, modes []AgentMode) string {
	for _, m := range modes {
		if m.Id == mode {
			return m.Kind
		}
	}
	var table []AgentMode
	switch agent {
	case "claude":
		table = ClaudeModes
	case "codex":
		table = CodexModes
	}
	for _, m := range table {
		if m.Id == mode {
			return m.Kind
		}
	}
	return GuessModeKind(mode, "")
}

// AccessForKind maps a mode kind onto the legacy access level shown to
// older UIs.
func AccessForKind(kind string) string {
	switch kind {
	case KindReadonly, KindPlan:
		return "ask"
	case KindAuto:
		return "auto"
	case KindFull:
		return "full"
	}
	return "edits"
}
