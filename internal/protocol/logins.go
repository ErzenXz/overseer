package protocol

// Shared agent sign-ins: a person signed in to Claude Code or Codex on one
// machine reuses that sign-in on their other machines. Only the vendors'
// documented headless paths are used: a Claude Code OAuth token from
// `claude setup-token` (read from CLAUDE_CODE_OAUTH_TOKEN), and a copy of
// Codex's auth.json. The secret travels only hub -> device in
// TypeLoginApply; TypeLoginRead is how the hub captures a Codex sign-in from
// the machine that has it.

const (
	// Hub -> agent request (carries Id); the reply is LoginReadResult.
	// Codex only.
	TypeLoginRead = "login.read"
	// Hub -> agent request (carries Id); the reply is LoginApplyResult.
	TypeLoginApply = "login.apply"
	// Hub -> agent request (carries Id); the reply is LoginRemoveResult.
	TypeLoginRemove = "login.remove"
)

// LoginReadRequest asks for an agent's sign-in file.
type LoginReadRequest struct {
	Agent string `json:"agent"`
}

// LoginReadResult is the sign-in file's content, as is.
type LoginReadResult struct {
	Secret string `json:"secret"`
}

// LoginApplyRequest puts a sign-in on the machine: Codex's auth.json, or the
// Claude Code OAuth token.
type LoginApplyRequest struct {
	Agent  string `json:"agent"`
	Secret string `json:"secret"`
	// Replaces is the sha256 of what Overseer last wrote there, if anything.
	// When the file still holds exactly that, the backup of the person's own
	// sign-in made back then is kept rather than overwritten.
	Replaces string `json:"replaces,omitempty"`
}

// LoginApplyResult is the sha256 (hex) of what was written.
type LoginApplyResult struct {
	Sha256 string `json:"sha256"`
}

// LoginRemoveRequest takes a shared sign-in off the machine. For Codex the
// file is only removed while it is still exactly what Overseer wrote.
type LoginRemoveRequest struct {
	Agent  string `json:"agent"`
	Sha256 string `json:"sha256,omitempty"`
}

// LoginRemoveResult says whether anything was removed, and why not.
type LoginRemoveResult struct {
	Removed bool   `json:"removed"`
	Note    string `json:"note,omitempty"`
}
