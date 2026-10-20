package agent

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// fakePath makes a PATH holding only the given shell scripts.
func fakePath(t *testing.T, scripts map[string]string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fake executables")
	}
	dir := t.TempDir()
	for name, body := range scripts {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("#!/bin/sh\n"+body+"\n"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	os.WriteFile(filepath.Join(dir, "not-executable"), []byte("x"), 0o644)
	t.Setenv("PATH", dir)
}

func TestDetectAgentListFakePath(t *testing.T) {
	fakePath(t, map[string]string{
		"devin":        `echo "devin 3000.11.3 (9c803229faa4)"`,
		"cursor-agent": `echo "2025.10.1-abc" >&2`,
		"slow":         `exec /bin/sleep 10`,
		"qwen":         `echo no version here`,
	})
	start := time.Now()
	got := detectAgentList([]protocol.AgentDetectSpec{
		{Id: "devin", Bins: []string{"devin"}},
		{Id: "cursor", Bins: []string{"missing", "cursor-agent"}},
		{Id: "slow", Bins: []string{"slow"}},
		{Id: "qwen-code", Bins: []string{"qwen"}},
		{Id: "absent", Bins: []string{"absent", "not-executable"}},
		{Id: "devin", Bins: []string{"absent"}}, // duplicate ids keep the first
		{Id: "acp", Bins: []string{"devin"}},    // the device adds acp itself
		{Id: "", Bins: []string{"devin"}},
		{Id: "nobins"},
	})
	if took := time.Since(start); took > versionTimeout+2*time.Second {
		t.Errorf("detection took %v; --version must be bounded", took)
	}
	var parts []string
	for _, a := range got {
		parts = append(parts, a.Id+":"+map[bool]string{true: "y", false: "n"}[a.Installed]+":"+a.Version)
	}
	want := "devin:y:3000.11.3 cursor:y:2025.10.1-abc slow:y: qwen-code:y: absent:n: nobins:n:"
	if strings.Join(parts, " ") != want {
		t.Errorf("got  %s\nwant %s", strings.Join(parts, " "), want)
	}
}

func TestDetectAgentsBuiltinFallback(t *testing.T) {
	fakePath(t, map[string]string{"claude": `echo "2.1.4 (Claude Code)"`})
	a := &Agent{}
	res := a.detectAgents(protocol.AgentsDetect{}) // older hub: no list
	if len(res.Agents) != len(builtinDetect)+1 || res.Agents[len(res.Agents)-1].Id != "acp" || !res.Agents[len(res.Agents)-1].Installed {
		t.Fatalf("agents = %+v", res.Agents)
	}
	if c := res.Agents[0]; c.Id != "claude" || !c.Installed || c.Version != "2.1.4" {
		t.Errorf("claude = %+v", c)
	}
	if res.Agents[1].Installed {
		t.Errorf("codex should be missing: %+v", res.Agents[1])
	}
	res = a.detectAgents(protocol.AgentsDetect{Agents: []protocol.AgentDetectSpec{{Id: "devin", Bins: []string{"devin"}}}})
	if len(res.Agents) != 2 || res.Agents[0].Id != "devin" || res.Agents[1].Id != "acp" {
		t.Errorf("catalog request = %+v", res.Agents)
	}
}

func TestACPLaunch(t *testing.T) {
	for _, tc := range []struct {
		agent, command, bin, args, err string
	}{
		{"gemini", "ignored", "gemini", "--acp|--experimental-acp", ""},
		{"cursor", "", "cursor-agent", "acp", ""},
		{"devin", "devin acp", "devin", "acp", ""},
		{"custom-mine", "'/opt/my agent/bin' --acp", "/opt/my agent/bin", "--acp", ""},
		{"acp", "x", "x", "", ""},
		{"acp", "", "", "", "command required"},
		{"devin", "", "", "", "unknown agent"},
		{"claude", "claude", "", "", "not an ACP agent"},
		{"devin", `bad "quote`, "", "", "unterminated"},
	} {
		bin, cands, err := acpLaunch(tc.agent, tc.command)
		if tc.err != "" {
			if err == nil || !strings.Contains(err.Error(), tc.err) {
				t.Errorf("%s %q: err = %v, want %q", tc.agent, tc.command, err, tc.err)
			}
			continue
		}
		var args []string
		for _, c := range cands {
			args = append(args, strings.Join(c, " "))
		}
		if err != nil || bin != tc.bin || strings.Join(args, "|") != tc.args {
			t.Errorf("%s %q = %q %q %v", tc.agent, tc.command, bin, args, err)
		}
	}
	ad, err := newThreadAdapter(protocol.ThreadStart{Agent: "devin", Command: "devin acp", Model: "m"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	acp, ok := ad.(*acpAdapter)
	if !ok || acp.bin != "devin" || len(acp.candidates) != 1 || strings.Join(acp.candidates[0], " ") != "acp" {
		t.Errorf("adapter = %+v", ad)
	}
	if _, err := newThreadAdapter(protocol.ThreadStart{Agent: "devin"}, nil); err == nil {
		t.Error("catalog agent without a command should fail")
	}
}
