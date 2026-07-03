package agent

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

const systemdUnit = `[Unit]
Description=Overseer device agent
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=%s agent run
Environment=OVERSEER_MANAGED=1
Restart=always
RestartSec=3
User=%s

[Install]
WantedBy=default.target
`

const launchdPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>sh.overseer.agent</string>
	<key>ProgramArguments</key>
	<array>
		<string>%s</string>
		<string>agent</string>
		<string>run</string>
	</array>
	<key>EnvironmentVariables</key>
	<dict><key>OVERSEER_MANAGED</key><string>1</string></dict>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><true/>
	<key>StandardOutPath</key><string>%s</string>
	<key>StandardErrorPath</key><string>%s</string>
</dict>
</plist>
`

// InstallService registers the agent to run at boot and starts it now.
// Linux: user systemd unit (falls back to system unit when running as root).
// macOS: launchd user agent.
func InstallService() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	exe, _ = filepath.EvalSymlinks(exe)

	switch runtime.GOOS {
	case "linux":
		return installSystemd(exe)
	case "darwin":
		return installLaunchd(exe)
	default:
		return fmt.Errorf("service install not supported on %s; run `overseer agent run` under your own supervisor", runtime.GOOS)
	}
}

func installSystemd(exe string) error {
	if os.Geteuid() == 0 {
		user := os.Getenv("SUDO_USER")
		if user == "" {
			user = "root"
		}
		unit := fmt.Sprintf(systemdUnit, exe, user)
		if err := os.WriteFile("/etc/systemd/system/overseer-agent.service", []byte(unit), 0o644); err != nil {
			return err
		}
		for _, args := range [][]string{{"daemon-reload"}, {"enable", "--now", "overseer-agent"}} {
			if out, err := exec.Command("systemctl", args...).CombinedOutput(); err != nil {
				return fmt.Errorf("systemctl %v: %s", args, out)
			}
		}
		return nil
	}
	// User unit: survives logout only with lingering; enable it best-effort.
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	dir := filepath.Join(home, ".config", "systemd", "user")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	unit := fmt.Sprintf(systemdUnit, exe, "")
	// User units must not set User=.
	unit = removeLine(unit, "User=")
	if err := os.WriteFile(filepath.Join(dir, "overseer-agent.service"), []byte(unit), 0o644); err != nil {
		return err
	}
	for _, args := range [][]string{{"--user", "daemon-reload"}, {"--user", "enable", "--now", "overseer-agent"}} {
		if out, err := exec.Command("systemctl", args...).CombinedOutput(); err != nil {
			return fmt.Errorf("systemctl %v: %s", args, out)
		}
	}
	exec.Command("loginctl", "enable-linger").Run() // best effort
	return nil
}

func installLaunchd(exe string) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	logDir := filepath.Join(home, ".overseer")
	if err := os.MkdirAll(logDir, 0o700); err != nil {
		return err
	}
	logPath := filepath.Join(logDir, "agent.log")
	plist := fmt.Sprintf(launchdPlist, exe, logPath, logPath)
	dir := filepath.Join(home, "Library", "LaunchAgents")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	plistPath := filepath.Join(dir, "sh.overseer.agent.plist")
	if err := os.WriteFile(plistPath, []byte(plist), 0o644); err != nil {
		return err
	}
	exec.Command("launchctl", "unload", plistPath).Run() // reload if present
	if out, err := exec.Command("launchctl", "load", plistPath).CombinedOutput(); err != nil {
		return fmt.Errorf("launchctl load: %s", out)
	}
	return nil
}

func removeLine(s, prefix string) string {
	out := ""
	for _, line := range splitLines(s) {
		if len(line) >= len(prefix) && line[:len(prefix)] == prefix {
			continue
		}
		out += line + "\n"
	}
	return out
}

func splitLines(s string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			lines = append(lines, s[start:i])
			start = i + 1
		}
	}
	if start < len(s) {
		lines = append(lines, s[start:])
	}
	return lines
}
