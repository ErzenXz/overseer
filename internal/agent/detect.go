package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// --- agents.detect ---

// builtinDetect is what a device checks when the hub sends no catalog
// (older hubs).
var builtinDetect = []protocol.AgentDetectSpec{
	{Id: "claude", Bins: []string{"claude"}},
	{Id: "codex", Bins: []string{"codex"}},
	{Id: "gemini", Bins: []string{"gemini"}},
	{Id: "opencode", Bins: []string{"opencode"}},
	{Id: "goose", Bins: []string{"goose"}},
	{Id: "copilot", Bins: []string{"copilot"}},
	{Id: "cursor", Bins: []string{"cursor-agent"}},
}

const (
	maxDetectAgents = 512
	maxDetectBins   = 8
	detectLookups   = 16              // concurrent PATH lookups
	detectVersions  = 8               // concurrent `--version` runs
	versionTimeout  = 2 * time.Second // per `--version` run
	detectBudget    = 6 * time.Second // after this, versions are skipped
	authTimeout     = 3 * time.Second // per sign-in status check
)

var versionRe = regexp.MustCompile(`\d+\.\d+(?:\.\d+)?[0-9A-Za-z.+-]*`)

func (a *Agent) detectAgents(req protocol.AgentsDetect) protocol.AgentsDetectResult {
	specs := req.Agents
	if len(specs) == 0 {
		specs = builtinDetect
	}
	out := detectAgentList(specs)
	// A custom ACP command line can always be attempted.
	out = append(out, protocol.AgentInfo{Id: "acp", Installed: true})
	return protocol.AgentsDetectResult{Agents: out}
}

// detectAgentList reports, per spec, whether any of its executables is in
// PATH and the first one's version. Lookups and version runs are parallel
// but bounded; versions only run for installed agents.
func detectAgentList(specs []protocol.AgentDetectSpec) []protocol.AgentInfo {
	if len(specs) > maxDetectAgents {
		specs = specs[:maxDetectAgents]
	}
	seen := map[string]bool{}
	out := make([]protocol.AgentInfo, 0, len(specs))
	var bins [][]string
	for _, s := range specs {
		if s.Id == "" || s.Id == "acp" || seen[s.Id] {
			continue
		}
		seen[s.Id] = true
		b := s.Bins
		if len(b) > maxDetectBins {
			b = b[:maxDetectBins]
		}
		out = append(out, protocol.AgentInfo{Id: s.Id})
		bins = append(bins, b)
	}
	deadline := time.Now().Add(detectBudget)
	lookups := make(chan struct{}, detectLookups)
	versions := make(chan struct{}, detectVersions)
	var wg sync.WaitGroup
	for i := range out {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			lookups <- struct{}{}
			path := findBinary(bins[i])
			<-lookups
			if path == "" {
				return
			}
			out[i].Installed = true
			versions <- struct{}{}
			defer func() { <-versions }()
			if left := time.Until(deadline); left > 0 {
				out[i].Version = binaryVersion(path, min(versionTimeout, left))
			}
			if left := time.Until(deadline); left > 0 {
				out[i].Auth, out[i].Account = agentAuth(out[i].Id, path, min(authTimeout, left))
			}
		}(i)
	}
	wg.Wait()
	return out
}

// findBinary returns the path of the first of bins found in PATH.
func findBinary(bins []string) string {
	for _, b := range bins {
		if b == "" {
			continue
		}
		if path, err := exec.LookPath(b); err == nil {
			return path
		}
	}
	return ""
}

// binaryVersion runs `<path> --version` and extracts a version number from
// stdout, else stderr.
func binaryVersion(path string, timeout time.Duration) string {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, "--version")
	cmd.Env = agentEnv()
	cmd.WaitDelay = 500 * time.Millisecond // a child holding the pipes must not stall us
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	cmd.Run()
	if v := versionRe.Find(stdout.Bytes()); v != nil {
		return string(v)
	}
	return string(versionRe.Find(stderr.Bytes()))
}

// agentAuth asks an agent's own CLI whether it is signed in. Only agents with
// a reliable status command are checked; anything unclear (a timeout, an old
// CLI without the command) returns "" so the UI never claims "signed out"
// without proof.
func agentAuth(id, path string, timeout time.Duration) (state, account string) {
	var args []string
	switch id {
	case "claude":
		args = []string{"auth", "status"}
	case "codex":
		args = []string{"login", "status"}
	default:
		return "", ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	var stdout bytes.Buffer
	cmd := exec.CommandContext(ctx, path, args...)
	cmd.Stdout = &stdout
	if id == "codex" {
		cmd.Stderr = &stdout // codex prints its status to either
	}
	err := cmd.Run()
	if ctx.Err() != nil {
		return "", ""
	}
	state, account = parseAuthStatus(id, stdout.String(), err == nil)
	if state == "signed-out" && id == "claude" && os.Getenv("ANTHROPIC_API_KEY") != "" {
		return "ok", "API key"
	}
	if state == "signed-out" && id == "codex" && os.Getenv("OPENAI_API_KEY") != "" {
		return "ok", "API key"
	}
	return state, account
}

// parseAuthStatus reads one status command's output. exited0 is whether the
// command succeeded.
func parseAuthStatus(id, out string, exited0 bool) (state, account string) {
	out = strings.TrimSpace(out)
	switch id {
	case "claude":
		var status struct {
			LoggedIn   *bool  `json:"loggedIn"`
			Email      string `json:"email"`
			AuthMethod string `json:"authMethod"`
		}
		if json.Unmarshal([]byte(out), &status) == nil && status.LoggedIn != nil {
			if !*status.LoggedIn {
				return "signed-out", ""
			}
			if status.Email != "" {
				return "ok", status.Email
			}
			return "ok", status.AuthMethod
		}
	case "codex":
		if exited0 {
			if strings.Contains(strings.ToLower(out), "api key") {
				return "ok", "API key"
			}
			if strings.Contains(strings.ToLower(out), "chatgpt") {
				return "ok", "ChatGPT"
			}
			return "ok", ""
		}
		if strings.Contains(strings.ToLower(out), "not logged in") {
			return "signed-out", ""
		}
		return "", ""
	}
	if !exited0 {
		return "signed-out", ""
	}
	return "ok", ""
}
