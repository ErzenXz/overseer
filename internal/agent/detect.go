package agent

import (
	"bytes"
	"context"
	"os/exec"
	"regexp"
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
