package agent

import (
	"encoding/xml"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

const systemdUnit = `[Unit]
Description=Overseer device agent
After=network-online.target
Wants=network-online.target

[Service]
ExecStart="%s" agent run
Environment=OVERSEER_MANAGED=agent
Environment="PATH=%s"
Restart=always
RestartSec=3
User=%s

[Install]
WantedBy=default.target
`

const launchdLabel = "sh.overseer.agent"

const launchdPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>` + launchdLabel + `</string>
	<key>ProgramArguments</key>
	<array>
		<string>%s</string>
		<string>agent</string>
		<string>run</string>
	</array>
	<key>EnvironmentVariables</key>
	<dict>
		<key>OVERSEER_MANAGED</key><string>agent</string>
		<key>PATH</key><string>%s</string>
	</dict>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><true/>
	<key>ProcessType</key><string>Background</string>
	<key>StandardOutPath</key><string>%s</string>
	<key>StandardErrorPath</key><string>%s</string>
</dict>
</plist>
`

const windowsTask = "OverseerAgent"

// servicePath is the PATH recorded in the service definition. Installs run
// from the user's own shell, so its PATH already finds Claude Code, Codex,
// Node and friends; service managers would otherwise start the agent with a
// bare system PATH. Relative and empty entries are dropped: a service must
// never resolve commands from whatever directory it happens to run in.
func servicePath() string {
	seen := map[string]bool{}
	var keep []string
	home, _ := os.UserHomeDir()
	entries := append(managedPathEntries(runtime.GOOS, home, os.Getenv("LOCALAPPDATA")), filepath.SplitList(os.Getenv("PATH"))...)
	if runtime.GOOS != "windows" {
		entries = append(entries, "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin")
	}
	for _, entry := range entries {
		if entry == "" || !filepath.IsAbs(entry) || seen[entry] {
			continue
		}
		seen[entry] = true
		keep = append(keep, entry)
	}
	return strings.Join(keep, string(os.PathListSeparator))
}

// InstallService registers the agent to run in the background and starts it now.
// Linux: user systemd unit (falls back to system unit when running as root).
// macOS: launchd user agent.
// Windows: hidden scheduled task at sign-in.
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
	case "windows":
		return installWindowsTask(exe)
	default:
		return fmt.Errorf("service install not supported on %s; run `overseer agent run` under your own supervisor", runtime.GOOS)
	}
}

// UninstallService stops and removes whatever InstallService created, and
// forgets the hub credential. The device stays listed on the hub as offline
// until it is removed there.
func UninstallService() error {
	var err error
	switch runtime.GOOS {
	case "linux":
		err = uninstallSystemd()
	case "darwin":
		err = uninstallLaunchd()
	case "windows":
		err = uninstallWindowsTask()
	}
	if path, perr := ConfigPath(); perr == nil {
		if rerr := os.Remove(path); rerr != nil && !os.IsNotExist(rerr) && err == nil {
			err = rerr
		}
	}
	return err
}

// systemdEscape quotes a value for a double-quoted systemd setting.
func systemdEscape(v string) string {
	return strings.NewReplacer(`\`, `\\`, `"`, `\"`, "%", "%%", "\n", "").Replace(v)
}

func xmlEscape(v string) string {
	var b strings.Builder
	_ = xml.EscapeText(&b, []byte(v))
	return b.String()
}

func systemdUnitFor(exe, user string) string {
	unit := fmt.Sprintf(systemdUnit, systemdEscape(exe), systemdEscape(servicePath()), user)
	if user == "" {
		// User units must not set User=.
		unit = removeLine(unit, "User=")
	}
	return unit
}

func installSystemd(exe string) error {
	if os.Geteuid() == 0 {
		user := os.Getenv("SUDO_USER")
		if user == "" {
			user = "root"
		}
		if err := os.WriteFile("/etc/systemd/system/overseer-agent.service", []byte(systemdUnitFor(exe, user)), 0o644); err != nil {
			return err
		}
		for _, args := range [][]string{{"daemon-reload"}, {"enable", "overseer-agent"}, {"restart", "overseer-agent"}} {
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
	if err := os.WriteFile(filepath.Join(dir, "overseer-agent.service"), []byte(systemdUnitFor(exe, "")), 0o644); err != nil {
		return err
	}
	// restart (not just enable --now) so a reinstall picks up the new binary.
	for _, args := range [][]string{{"--user", "daemon-reload"}, {"--user", "enable", "overseer-agent"}, {"--user", "restart", "overseer-agent"}} {
		if out, err := exec.Command("systemctl", args...).CombinedOutput(); err != nil {
			return fmt.Errorf("systemctl %v: %s", args, out)
		}
	}
	exec.Command("loginctl", "enable-linger").Run() // best effort
	return nil
}

func uninstallSystemd() error {
	if os.Geteuid() == 0 {
		exec.Command("systemctl", "disable", "--now", "overseer-agent").Run()
		err := os.Remove("/etc/systemd/system/overseer-agent.service")
		exec.Command("systemctl", "daemon-reload").Run()
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	exec.Command("systemctl", "--user", "disable", "--now", "overseer-agent").Run()
	err = os.Remove(filepath.Join(home, ".config", "systemd", "user", "overseer-agent.service"))
	exec.Command("systemctl", "--user", "daemon-reload").Run()
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func launchdPaths() (plist, logPath string, err error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", "", err
	}
	return filepath.Join(home, "Library", "LaunchAgents", launchdLabel+".plist"), filepath.Join(home, ".overseer", "agent.log"), nil
}

func installLaunchd(exe string) error {
	plistPath, logPath, err := launchdPaths()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(logPath), 0o700); err != nil {
		return err
	}
	plist := fmt.Sprintf(launchdPlist, xmlEscape(exe), xmlEscape(servicePath()), xmlEscape(logPath), xmlEscape(logPath))
	if err := os.MkdirAll(filepath.Dir(plistPath), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(plistPath, []byte(plist), 0o644); err != nil {
		return err
	}
	domain := fmt.Sprintf("gui/%d", os.Getuid())
	// bootout/bootstrap is the supported interface; load/unload remains as a
	// fallback for sessions where the gui domain isn't available (e.g. SSH).
	exec.Command("launchctl", "bootout", domain+"/"+launchdLabel).Run()
	exec.Command("launchctl", "unload", plistPath).Run()
	if out, err := exec.Command("launchctl", "bootstrap", domain, plistPath).CombinedOutput(); err != nil {
		if out2, err2 := exec.Command("launchctl", "load", plistPath).CombinedOutput(); err2 != nil {
			return fmt.Errorf("launchctl bootstrap: %s; load: %s", strings.TrimSpace(string(out)), strings.TrimSpace(string(out2)))
		}
	}
	return nil
}

func uninstallLaunchd() error {
	plistPath, _, err := launchdPaths()
	if err != nil {
		return err
	}
	exec.Command("launchctl", "bootout", fmt.Sprintf("gui/%d/%s", os.Getuid(), launchdLabel)).Run()
	exec.Command("launchctl", "unload", plistPath).Run()
	if err := os.Remove(plistPath); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// windowsRunner is the PowerShell script the scheduled task starts. It runs
// hidden (no console window on the desktop) and supplies the metadata the
// safe updater needs to restart the same task after a swap.
func windowsRunner(exe string) string {
	quote := func(v string) string { return "'" + strings.ReplaceAll(v, "'", "''") + "'" }
	return "$env:OVERSEER_MANAGED = 'agent'\r\n" +
		"$env:OVERSEER_WINDOWS_TASK = '" + windowsTask + "'\r\n" +
		"$env:PATH = " + quote(servicePath()) + "\r\n" +
		"& " + quote(exe) + " agent run\r\n"
}

func installWindowsTask(exe string) error {
	dir := filepath.Dir(exe)
	runner := filepath.Join(dir, "overseer-agent.ps1")
	if err := os.WriteFile(runner, []byte(windowsRunner(exe)), 0o600); err != nil {
		return err
	}
	os.Remove(filepath.Join(dir, "overseer-agent.cmd")) // runner used by older versions
	action := fmt.Sprintf(`powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "%s"`, runner)
	exec.Command("schtasks.exe", "/End", "/TN", windowsTask).Run()
	for _, args := range [][]string{
		{"/Create", "/TN", windowsTask, "/SC", "ONLOGON", "/TR", action, "/F"},
		{"/Run", "/TN", windowsTask},
	} {
		if out, err := exec.Command("schtasks.exe", args...).CombinedOutput(); err != nil {
			return fmt.Errorf("schtasks %v: %s", args, out)
		}
	}
	return nil
}

func uninstallWindowsTask() error {
	exec.Command("schtasks.exe", "/End", "/TN", windowsTask).Run()
	out, err := exec.Command("schtasks.exe", "/Delete", "/TN", windowsTask, "/F").CombinedOutput()
	if exe, eerr := os.Executable(); eerr == nil {
		os.Remove(filepath.Join(filepath.Dir(exe), "overseer-agent.ps1"))
	}
	if err != nil && !strings.Contains(strings.ToLower(string(out)), "cannot find") {
		return fmt.Errorf("schtasks /Delete: %s", out)
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
