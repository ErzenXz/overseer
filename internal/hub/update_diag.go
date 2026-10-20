package hub

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// serviceIssue is one thing standing between this hub and automatic,
// self-restarting updates, with the change that fixes it.
type serviceIssue struct {
	ID   string `json:"id"`
	Text string `json:"text"`
	Fix  string `json:"fix"`
}

// serviceInfo describes how the hub process is supervised, so Settings can
// tell "started by hand" apart from "a custom service that isn't set up for
// managed updates" and say exactly what to change.
type serviceInfo struct {
	Supervisor string         `json:"supervisor,omitempty"` // systemd, launchd or ""
	Unit       string         `json:"unit,omitempty"`       // systemd unit name, when known
	Binary     string         `json:"binary,omitempty"`     // resolved path of the running binary
	Issues     []serviceIssue `json:"issues,omitempty"`
	Snippet    string         `json:"snippet,omitempty"` // drop-in that fixes the unit, when it applies
}

func diagnoseService(managed bool) serviceInfo {
	info := serviceInfo{Supervisor: supervisor()}
	if info.Supervisor == "systemd" {
		info.Unit = systemdUnit()
	}
	exe, _ := os.Executable()
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	info.Binary = exe

	// A hub nobody supervises can't restart itself after an update; that is
	// the "started by hand" case and needs no checklist.
	if info.Supervisor == "" && !managed {
		return info
	}
	if !managed {
		info.Issues = append(info.Issues, serviceIssue{
			ID:   "env",
			Text: "The service doesn't set OVERSEER_MANAGED, so the hub won't replace itself.",
			Fix:  "Environment=OVERSEER_MANAGED=hub",
		})
	}
	if exe != "" && !dirWritable(filepath.Dir(exe)) {
		info.Issues = append(info.Issues, serviceIssue{
			ID:   "binary",
			Text: "The hub can't write next to its binary (" + exe + "), so it can't stage an update there.",
			Fix:  "Run a copy the service user owns, for example <data dir>/bin/overseer, and point ExecStart (or a symlink in /usr/local/bin) at it.",
		})
	}
	if info.Supervisor == "systemd" && info.Unit != "" {
		if policy := systemdRestartPolicy(info.Unit); policy != "" && policy != "always" {
			info.Issues = append(info.Issues, serviceIssue{
				ID:   "restart",
				Text: "The unit restarts only on " + policy + "; a successful update exits cleanly, so the hub would stay stopped.",
				Fix:  "Restart=always",
			})
		}
	}
	var lines []string
	for _, issue := range info.Issues {
		if strings.HasPrefix(issue.Fix, "Environment=") || strings.HasPrefix(issue.Fix, "Restart=") {
			lines = append(lines, issue.Fix)
		}
	}
	if info.Supervisor == "systemd" && len(lines) > 0 {
		unit := info.Unit
		if unit == "" {
			unit = "<your unit>"
		}
		info.Snippet = "sudo systemctl edit " + unit + "\n\n[Service]\n" + strings.Join(lines, "\n") + "\n\nsudo systemctl restart " + unit
	}
	return info
}

// supervisor reports the init system running this process, from the
// variables it sets for its services.
func supervisor() string {
	switch runtime.GOOS {
	case "linux":
		if os.Getenv("INVOCATION_ID") != "" || os.Getenv("JOURNAL_STREAM") != "" {
			return "systemd"
		}
	case "darwin":
		if name := os.Getenv("XPC_SERVICE_NAME"); name != "" && name != "0" && !strings.HasPrefix(name, "application.") {
			return "launchd"
		}
	}
	return ""
}

// systemdUnit finds this process's unit from its cgroup path.
func systemdUnit() string {
	data, err := os.ReadFile("/proc/self/cgroup")
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		for _, part := range strings.Split(line, "/") {
			if strings.HasSuffix(part, ".service") {
				return part
			}
		}
	}
	return ""
}

func systemdRestartPolicy(unit string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "systemctl", "show", "--property=Restart", "--value", unit).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func dirWritable(dir string) bool {
	f, err := os.CreateTemp(dir, ".overseer-write-check-*")
	if err != nil {
		return false
	}
	name := f.Name()
	f.Close()
	os.Remove(name)
	return true
}
