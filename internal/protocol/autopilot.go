package protocol

// Issue autopilot and before/after screenshots: the three requests the hub
// sends a machine for them. Everything the machine is asked to run is a list
// of arguments (never a shell line), so text from a GitHub issue can never be
// read as a command.

const (
	// TypeAutopilotGh runs the GitHub CLI with the given arguments and stdin
	// (hub -> agent request; the reply is GhRunResult).
	TypeAutopilotGh = "autopilot.gh"
	// TypeAutopilotFinish commits what is in a worktree, pushes its branch and
	// opens a pull request (hub -> agent request; the reply is
	// AutopilotFinishResult).
	TypeAutopilotFinish = "autopilot.finish"
	// TypeScreenshot takes a screenshot of a page on this machine with the
	// installed Chrome, Chromium or Edge (hub -> agent request; the reply is
	// ScreenshotResult).
	TypeScreenshot = "screenshot.capture"
)

// GhRun is one `gh` invocation. Args excludes "gh" itself.
type GhRun struct {
	Args       []string `json:"args"`
	Stdin      string   `json:"stdin,omitempty"`
	Cwd        string   `json:"cwd,omitempty"`
	TimeoutSec int      `json:"timeoutSec,omitempty"` // default 60, at most 300
}

// GhRunResult is what gh printed. Missing means gh is not installed here.
type GhRunResult struct {
	ExitCode int    `json:"exitCode"`
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
	Missing  bool   `json:"missing,omitempty"`
}

// AutopilotFinish asks the machine to turn the work in Cwd into a pull
// request. Title and Body are plain text for GitHub.
type AutopilotFinish struct {
	Cwd           string `json:"cwd"`
	Repo          string `json:"repo"`   // GitHub "owner/name"
	Branch        string `json:"branch"` // must be what Cwd has checked out
	Base          string `json:"base"`   // branch the pull request targets
	Title         string `json:"title"`
	Body          string `json:"body"`
	CommitMessage string `json:"commitMessage"`
}

// AutopilotFinishResult says what happened. Error is a sentence for a person;
// the other fields describe how far it got.
type AutopilotFinishResult struct {
	Committed bool   `json:"committed,omitempty"` // the machine made a commit for uncommitted work
	NoChanges bool   `json:"noChanges,omitempty"` // nothing differs from Base: no pull request
	Pushed    bool   `json:"pushed,omitempty"`
	PRUrl     string `json:"prUrl,omitempty"`
	PRNumber  int    `json:"prNumber,omitempty"`
	Existing  bool   `json:"existing,omitempty"` // the pull request was already open
	Error     string `json:"error,omitempty"`
}

// ScreenshotRequest asks for one page of a local dev server. Url must be
// http://localhost, 127.0.0.1 or [::1] with a port.
type ScreenshotRequest struct {
	Url    string `json:"url"`
	Width  int    `json:"width,omitempty"`  // default 1440
	Height int    `json:"height,omitempty"` // default 900
	Mobile bool   `json:"mobile,omitempty"` // phone user agent
	WaitMs int    `json:"waitMs,omitempty"` // how long the page may keep loading (default 5000)
}

// Screenshot outcomes (ScreenshotResult.Status).
const (
	ShotOK        = "ok"
	ShotNoBrowser = "no-browser" // no Chrome, Chromium or Edge on this machine
	ShotError     = "error"
)

// ScreenshotResult is the picture, or why there is none.
type ScreenshotResult struct {
	Status  string `json:"status"`
	Message string `json:"message,omitempty"`
	Mime    string `json:"mime,omitempty"` // image/png or image/jpeg
	Data    []byte `json:"data,omitempty"`
	Width   int    `json:"width,omitempty"`
	Height  int    `json:"height,omitempty"`
	Browser string `json:"browser,omitempty"` // which one took it
}
