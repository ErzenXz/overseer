package protocol

// Agent Arena: one prompt, several agents, each in its own git worktree of the
// same commit. These are the machine-side steps: make a worktree, measure what
// changed, run the check command, hand the result on (pull request, apply into
// the original folder, patch), and clean up. One request type with an action.

// TypeArena is a hub -> agent request (carries Id); the reply is ArenaResult.
const TypeArena = "arena.op"

// Arena actions (ArenaRequest.Action).
const (
	ArenaInspect = "inspect" // is Repo a git repo, what commit is it on
	ArenaCreate  = "create"  // a worktree + fresh branch at Commit
	ArenaStats   = "stats"   // files and lines changed since Base
	ArenaCheck   = "check"   // run Command in a worktree
	ArenaCommit  = "commit"  // save a worktree's changes as one commit on its branch
	ArenaPR      = "pr"      // commit, push the branch, open a pull request
	ArenaApply   = "apply"   // put a worktree's changes into the clean original folder
	ArenaPatch   = "patch"   // the changes as one patch
	ArenaRemove  = "remove"  // delete a worktree and its branch
)

// ArenaRequest is every arena step; each action reads only the fields it needs.
type ArenaRequest struct {
	Action  string `json:"action"`
	ArenaId string `json:"arenaId,omitempty"`
	// Repo is a folder inside the user's checkout. For create it is the clone
	// the worktree hangs off; for apply the folder that receives the changes.
	Repo   string `json:"repo,omitempty"`
	Commit string `json:"commit,omitempty"` // create: the commit every contestant starts from
	Name   string `json:"name,omitempty"`   // create: folder name, "1-claude"
	Branch string `json:"branch,omitempty"` // arena/<arenaId>/<agent>
	// RemoteKey is the repo the caller means (NormalizeRemote form). A folder
	// that turns out to be a clone of a different repo is refused.
	RemoteKey string `json:"remoteKey,omitempty"`
	// Worktree is an absolute path made by create. It must sit under
	// ~/.overseer/worktrees/arena/<arenaId>/; anything else is refused.
	Worktree   string `json:"worktree,omitempty"`
	Base       string `json:"base,omitempty"`       // the arena's base commit
	BaseBranch string `json:"baseBranch,omitempty"` // branch to open the PR against
	Command    string `json:"command,omitempty"`    // check command
	TimeoutSec int    `json:"timeoutSec,omitempty"`
	Title      string `json:"title,omitempty"`
	Body       string `json:"body,omitempty"`
}

// ArenaFile is one changed file.
type ArenaFile struct {
	Path      string `json:"path"`
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
}

// ArenaResult is the reply to arena.op; only the fields of the action are set.
type ArenaResult struct {
	Home string `json:"home,omitempty"`

	// inspect
	Root      string `json:"root,omitempty"`
	Head      string `json:"head,omitempty"` // full commit id
	Branch    string `json:"branch,omitempty"`
	Dirty     int    `json:"dirty,omitempty"` // uncommitted changes in the folder
	RemoteKey string `json:"remoteKey,omitempty"`

	// create: Path is the worktree, Cwd the folder in it the session runs in
	// (the same sub-folder of the repo the user chose).
	Path string `json:"path,omitempty"`
	Cwd  string `json:"cwd,omitempty"`

	// stats, apply
	Files     int         `json:"files,omitempty"`
	Additions int         `json:"additions,omitempty"`
	Deletions int         `json:"deletions,omitempty"`
	Changed   []ArenaFile `json:"changed,omitempty"`

	// check
	ExitCode   int    `json:"exitCode,omitempty"`
	Output     string `json:"output,omitempty"`
	DurationMs int64  `json:"durationMs,omitempty"`

	// pr
	Url string `json:"url,omitempty"`
	// patch
	Patch string `json:"patch,omitempty"`

	Note string `json:"note,omitempty"`
}
