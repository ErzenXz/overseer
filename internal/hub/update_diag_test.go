package hub

import (
	"runtime"
	"strings"
	"testing"
)

func TestDiagnoseServiceHandStarted(t *testing.T) {
	t.Setenv("INVOCATION_ID", "")
	t.Setenv("JOURNAL_STREAM", "")
	t.Setenv("XPC_SERVICE_NAME", "")
	info := diagnoseService(false)
	if info.Supervisor != "" || len(info.Issues) != 0 || info.Snippet != "" {
		t.Fatalf("a hub started by hand needs no checklist: %+v", info)
	}
}

func TestDiagnoseServiceUnderSystemd(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("systemd detection is Linux-only")
	}
	t.Setenv("INVOCATION_ID", "abc123")
	info := diagnoseService(false)
	if info.Supervisor != "systemd" {
		t.Fatalf("supervisor = %q, want systemd", info.Supervisor)
	}
	var env bool
	for _, issue := range info.Issues {
		if issue.ID == "env" && strings.Contains(issue.Fix, "OVERSEER_MANAGED=hub") {
			env = true
		}
	}
	if !env {
		t.Fatalf("missing OVERSEER_MANAGED issue: %+v", info.Issues)
	}
	if !strings.Contains(info.Snippet, "Environment=OVERSEER_MANAGED=hub") {
		t.Fatalf("snippet doesn't fix the unit: %q", info.Snippet)
	}
}
