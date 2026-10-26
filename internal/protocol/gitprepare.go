package protocol

// Get a GitHub repo and branch ready on a machine: "start a session in
// owner/name on branch x". The agent finds an existing clone or makes one,
// and never disturbs a checkout somebody is working in.

// TypeGitPrepare is a hub -> agent request (carries Id); the reply is
// GitPrepareResult.
const TypeGitPrepare = "git.prepare"

// TypeGitPrepareCancel is a hub -> agent message (no reply) that stops the
// prepare started with the same Key. Half-made clones are removed.
const TypeGitPrepareCancel = "git.prepare.cancel"

// Prepare outcomes (GitPrepareResult.Action).
const (
	PrepareReuse    = "reuse"    // a checkout already on that branch is used as is
	PrepareWorktree = "worktree" // the branch gets its own worktree next to an existing clone
	PrepareClone    = "clone"    // no clone here yet: a new one, on that branch
)

// GitPrepareRequest asks for owner/name on one branch.
type GitPrepareRequest struct {
	Repo   string `json:"repo"`   // GitHub "owner/name"
	Branch string `json:"branch"` // branch to work on
	// Known are folders on this machine the caller already knows hold a clone
	// of the repo (its "recent folders"); the agent also looks in the usual
	// code folders under home.
	Known []string `json:"known,omitempty"`
	// Dir is the exact folder for a new clone. Empty picks one under the
	// user's usual code folder. It is never used for an existing clone.
	Dir string `json:"dir,omitempty"`
	// Plan only reports what would happen. Nothing is fetched or created.
	Plan bool `json:"plan,omitempty"`
	// Key names this prepare so TypeGitPrepareCancel can stop it.
	Key string `json:"key,omitempty"`
	// CreateFrom makes Branch a new branch off this one when GitHub has no
	// branch of that name (the issue autopilot's "overseer/issue-12-…"). A
	// Branch that already exists is used as it is.
	CreateFrom string `json:"createFrom,omitempty"`
}

// GitPrepareResult is where the session should run.
type GitPrepareResult struct {
	Action string `json:"action"`         // PrepareReuse, PrepareWorktree or PrepareClone
	Path   string `json:"path"`           // absolute folder to run in
	Branch string `json:"branch"`         // branch checked out there
	Home   string `json:"home,omitempty"` // for "~" paths in the UI
	// Source is the clone the worktree hangs off (PrepareWorktree only).
	Source string `json:"source,omitempty"`
	// Note says something worth knowing, in plain words (e.g. the local
	// branch was behind and could not be fast-forwarded).
	Note string `json:"note,omitempty"`
}
