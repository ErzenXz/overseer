package agent

import (
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// describeDesktop fills in the facts the hub needs to offer a one-click
// remote desktop setup: OS, the account the agent runs as, and on Linux the
// kind of graphical session, package manager and whether systemd is around.
func describeDesktop(res *protocol.DesktopProbeResult) {
	res.OS = runtime.GOOS
	if u, err := user.Current(); err == nil {
		res.User = u.Username
	}
	switch runtime.GOOS {
	case "linux":
		describeLinuxDesktop(res)
	case "windows":
		_, err := exec.LookPath("winget")
		res.Winget = err == nil
		if exec.Command("sc.exe", "query", "tvnserver").Run() == nil {
			res.Installed = append(res.Installed, "tvnserver")
		}
	}
}

func describeLinuxDesktop(res *protocol.DesktopProbeResult) {
	uid := strconv.Itoa(os.Getuid())
	home, _ := os.UserHomeDir()
	runtimeDir := os.Getenv("XDG_RUNTIME_DIR")
	if runtimeDir == "" {
		runtimeDir = "/run/user/" + uid
	}

	// The agent often runs as a service without the desktop's environment, so
	// ask logind about the user's session before falling back to the sockets.
	sess := map[string]string{}
	if id := loginctlValue("show-user", uid, "Display"); id != "" {
		sess = parseKeyValues(loginctlRun("show-session", id, "-p", "Type", "-p", "Display", "-p", "Desktop", "-p", "Active"))
	}
	_, statErr := os.Stat("/tmp/.X11-unix/X0")
	x11Socket := statErr == nil
	waylandName := os.Getenv("WAYLAND_DISPLAY")
	if waylandName == "" {
		waylandName = firstWaylandSocket(runtimeDir)
	}
	res.Session = classifyLinuxSession(os.Getenv("XDG_SESSION_TYPE"), sess["Type"], x11Socket, waylandName)
	res.Desktop = strings.ToLower(firstNonEmpty(os.Getenv("XDG_CURRENT_DESKTOP"), sess["Desktop"], os.Getenv("DESKTOP_SESSION")))
	res.Display = firstNonEmpty(os.Getenv("DISPLAY"), sess["Display"])
	if res.Display == "" && x11Socket {
		res.Display = ":0"
	}
	if res.Session == "wayland" {
		res.WaylandDisplay = waylandName
	}
	res.XAuthority = firstExisting(os.Getenv("XAUTHORITY"), filepath.Join(runtimeDir, "gdm", "Xauthority"), filepath.Join(home, ".Xauthority"))

	res.PackageManager = pickPackageManager(func(name string) bool { _, err := exec.LookPath(name); return err == nil })
	for _, bin := range []string{"x11vnc", "wayvnc"} {
		if _, err := exec.LookPath(bin); err == nil {
			res.Installed = append(res.Installed, bin)
		}
	}
	if _, err := exec.LookPath("systemctl"); err == nil {
		cmd := exec.Command("systemctl", "--user", "show-environment")
		cmd.Env = append(os.Environ(), "XDG_RUNTIME_DIR="+runtimeDir, "DBUS_SESSION_BUS_ADDRESS=unix:path="+runtimeDir+"/bus")
		res.Systemd = cmd.Run() == nil
	}
}

// classifyLinuxSession names the graphical session: x11, wayland or headless.
// The env value wins, then logind's, then whichever display socket exists.
func classifyLinuxSession(envType, logindType string, x11Socket bool, waylandName string) string {
	for _, t := range []string{envType, logindType} {
		switch strings.ToLower(strings.TrimSpace(t)) {
		case "x11":
			return "x11"
		case "wayland":
			return "wayland"
		}
	}
	if waylandName != "" {
		return "wayland"
	}
	if x11Socket {
		return "x11"
	}
	return "headless"
}

// pickPackageManager returns the first supported package manager on the PATH.
func pickPackageManager(has func(string) bool) string {
	for _, c := range []struct{ bin, name string }{
		{"apt-get", "apt"}, {"dnf", "dnf"}, {"yum", "yum"}, {"pacman", "pacman"}, {"zypper", "zypper"},
	} {
		if has(c.bin) {
			return c.name
		}
	}
	return ""
}

// parseKeyValues reads "Key=value" lines, as printed by loginctl show.
func parseKeyValues(out string) map[string]string {
	m := map[string]string{}
	for _, line := range strings.Split(out, "\n") {
		if k, v, ok := strings.Cut(strings.TrimSpace(line), "="); ok {
			m[k] = v
		}
	}
	return m
}

func loginctlRun(args ...string) string {
	out, err := exec.Command("loginctl", args...).Output()
	if err != nil {
		return ""
	}
	return string(out)
}

// loginctlValue runs `loginctl <verb> <target> -p <prop>` and returns the value.
func loginctlValue(verb, target, prop string) string {
	return parseKeyValues(loginctlRun(verb, target, "-p", prop))[prop]
}

func firstWaylandSocket(runtimeDir string) string {
	matches, _ := filepath.Glob(filepath.Join(runtimeDir, "wayland-*"))
	for _, m := range matches {
		if !strings.HasSuffix(m, ".lock") {
			return filepath.Base(m)
		}
	}
	return ""
}

func firstExisting(paths ...string) string {
	for _, p := range paths {
		if p == "" {
			continue
		}
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}
