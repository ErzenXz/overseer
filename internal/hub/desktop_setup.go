package hub

import (
	"fmt"
	"strings"

	"github.com/ErzenXz/overseer/internal/protocol"
)

// desktopSetupPlan is what the Desktop tab offers when no VNC server answers
// on the machine. The hub builds every command from a fixed template and the
// agent's detected facts, so the UI only ever runs text the hub produced.
// Whatever it installs listens on 127.0.0.1 (or is blocked from the network),
// because the tunnel through the agent is the only way in.
type desktopSetupPlan struct {
	Supported  bool     `json:"supported"`            // one click can do it
	Server     string   `json:"server,omitempty"`     // x11vnc | wayvnc | screensharing | tightvnc
	Summary    string   `json:"summary"`              // what will happen, or why it can't be automated
	Steps      []string `json:"steps,omitempty"`      // the commands, one per line, for "show me the commands"
	Command    string   `json:"command,omitempty"`    // the steps joined into one terminal command
	Notes      []string `json:"notes,omitempty"`      // short things to know while it runs
	Manual     []string `json:"manual,omitempty"`     // precise steps when it can't be automated
	NeedsAdmin bool     `json:"needsAdmin,omitempty"` // asks for a sudo or admin password
}

type desktopStatus struct {
	protocol.DesktopProbeResult
	Setup *desktopSetupPlan `json:"setup,omitempty"`
}

// wlrootsDesktops are the Wayland compositors wayvnc can capture. GNOME and
// KDE don't implement the protocols it needs.
var wlrootsDesktops = []string{"sway", "hyprland", "river", "wayfire", "labwc"}

const (
	unitName     = "overseer-vnc.service"
	vncPort      = 5900
	pfAnchorName = "dev.overseer.vnc"
)

// buildDesktopSetup picks the setup for a machine from what its agent reported.
// osName is the OS the agent said hello with, used when the probe is from an
// older agent that doesn't report one.
func buildDesktopSetup(info protocol.DesktopProbeResult, osName string) desktopSetupPlan {
	if info.OS != "" {
		osName = info.OS
	}
	switch osName {
	case "darwin":
		return macDesktopPlan(info)
	case "linux":
		return linuxDesktopPlan(info)
	case "windows":
		return windowsDesktopPlan(info)
	}
	return desktopSetupPlan{Summary: "Remote desktop setup isn’t automated for this system yet. Start a VNC server that listens on 127.0.0.1:5900 and press Check again."}
}

// joinSteps makes the one-line terminal command. Each step must succeed for
// the next to run, so a failed install never leaves a half-configured server.
func joinSteps(steps []string, sep string) string { return strings.Join(steps, sep) }

// --- Linux ---

func hasInstalled(info protocol.DesktopProbeResult, bin string) bool {
	for _, name := range info.Installed {
		if name == bin {
			return true
		}
	}
	return false
}

func packageInstall(pm, pkg string) string {
	switch pm {
	case "apt":
		return "sudo apt-get update && sudo apt-get install -y " + pkg
	case "dnf":
		return "sudo dnf install -y " + pkg
	case "yum":
		return "sudo yum install -y " + pkg
	case "pacman":
		return "sudo pacman -S --needed --noconfirm " + pkg
	case "zypper":
		return "sudo zypper --non-interactive install " + pkg
	}
	return ""
}

func linuxDesktopPlan(info protocol.DesktopProbeResult) desktopSetupPlan {
	switch info.Session {
	case "headless":
		return desktopSetupPlan{
			Summary: "This machine has no graphical session to share. Sign in to its desktop once (or plug in a display), then press Check again.",
			Manual: []string{
				"Remote desktop shows a running desktop. Log in to a graphical session on this machine.",
				"On a server without one, use the Terminals tab instead.",
			},
		}
	case "wayland":
		for _, name := range wlrootsDesktops {
			if strings.Contains(info.Desktop, name) {
				return waylandPlan(info)
			}
		}
		return waylandUnsupportedPlan(info)
	}
	return x11Plan(info) // x11, or an older agent that didn't say
}

func x11Plan(info protocol.DesktopProbeResult) desktopSetupPlan {
	plan := desktopSetupPlan{Server: "x11vnc", NeedsAdmin: !hasInstalled(info, "x11vnc")}
	if !hasInstalled(info, "x11vnc") && packageInstall(info.PackageManager, "x11vnc") == "" {
		plan.NeedsAdmin = false
		plan.Summary = "Overseer couldn’t find a supported package manager (apt, dnf, pacman or zypper) to install x11vnc."
		plan.Manual = []string{
			"Install x11vnc with your package manager.",
			"Run: x11vnc -storepasswd",
			"Run: x11vnc -display :0 -auth guess -localhost -rfbport 5900 -rfbauth ~/.vnc/passwd -forever -shared",
			"Press Check again.",
		}
		return plan
	}
	display := info.Display
	if display == "" {
		display = ":0"
	}
	auth := "guess"
	if stableXAuthority(info.XAuthority) {
		auth = info.XAuthority
	}
	args := fmt.Sprintf("-display %s -auth %s -localhost -rfbport %d -rfbauth %%h/.vnc/passwd -forever -shared", display, auth, vncPort)

	var steps []string
	if !hasInstalled(info, "x11vnc") {
		steps = append(steps, "command -v x11vnc >/dev/null 2>&1 || { "+packageInstall(info.PackageManager, "x11vnc")+"; }")
	}
	// A VNC password keeps other accounts on the machine out. It is hashed
	// into ~/.vnc/passwd on the machine; Overseer never sees or stores it.
	steps = append(steps, "mkdir -p ~/.vnc && { [ -s ~/.vnc/passwd ] || x11vnc -storepasswd; }")
	if info.Systemd {
		steps = append(steps,
			`export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}" DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}"`,
			"mkdir -p ~/.config/systemd/user && "+unitFile("Overseer remote desktop (x11vnc, localhost only)", "$(command -v x11vnc) "+args, "graphical-session.target", nil),
			"systemctl --user daemon-reload && systemctl --user enable "+unitName+" && systemctl --user restart "+unitName,
			"sleep 2; systemctl --user is-active "+unitName,
		)
		plan.Summary = "Installs x11vnc, asks you to choose a desktop password, and runs it as a background service on this machine. It only listens on localhost and starts again when you sign in."
	} else {
		bg := strings.ReplaceAll(args, "%h", "$HOME") + " -bg -o $HOME/.vnc/x11vnc.log"
		steps = append(steps, "x11vnc "+bg)
		plan.Summary = "Installs x11vnc, asks you to choose a desktop password, and starts it in the background. It only listens on localhost."
		plan.Notes = append(plan.Notes, "There’s no systemd user session here, so it won’t restart after a reboot.")
	}
	plan.Steps = steps
	plan.Command = joinSteps(steps, " && ")
	plan.Notes = append([]string{"Choose a desktop password when asked. You’ll type it again to connect."}, plan.Notes...)
	return plan
}

// stableXAuthority reports whether the Xauthority file survives a reboot, so
// it can be written into a service. Others (SDDM's /tmp/xauth_*) are found
// again by x11vnc's -auth guess on every start.
func stableXAuthority(path string) bool {
	return strings.HasPrefix(path, "/run/user/") || strings.HasSuffix(path, "/.Xauthority")
}

func waylandPlan(info protocol.DesktopProbeResult) desktopSetupPlan {
	plan := desktopSetupPlan{Server: "wayvnc", NeedsAdmin: !hasInstalled(info, "wayvnc")}
	if !hasInstalled(info, "wayvnc") && packageInstall(info.PackageManager, "wayvnc") == "" {
		plan.NeedsAdmin = false
		plan.Summary = "Overseer couldn’t find a supported package manager to install wayvnc."
		plan.Manual = []string{"Install wayvnc with your package manager.", "Run: wayvnc 127.0.0.1 5900", "Press Check again."}
		return plan
	}
	wl := info.WaylandDisplay
	if wl == "" {
		wl = "wayland-1"
	}
	var steps []string
	if !hasInstalled(info, "wayvnc") {
		steps = append(steps, "command -v wayvnc >/dev/null 2>&1 || { "+packageInstall(info.PackageManager, "wayvnc")+"; }")
	}
	if info.Systemd {
		steps = append(steps,
			`export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}" DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}"`,
			"mkdir -p ~/.config/systemd/user && "+unitFile("Overseer remote desktop (wayvnc, localhost only)", fmt.Sprintf("$(command -v wayvnc) 127.0.0.1 %d", vncPort), "graphical-session.target", []string{"Environment=WAYLAND_DISPLAY=" + wl}),
			"systemctl --user daemon-reload && systemctl --user enable "+unitName+" && systemctl --user restart "+unitName,
			"sleep 2; systemctl --user is-active "+unitName,
		)
		plan.Summary = "Installs wayvnc and runs it as a background service on this machine. It only listens on localhost and starts again when you sign in."
	} else {
		steps = append(steps, fmt.Sprintf("WAYLAND_DISPLAY=%s nohup wayvnc 127.0.0.1 %d >$HOME/.wayvnc.log 2>&1 &", wl, vncPort))
		plan.Summary = "Installs wayvnc and starts it in the background. It only listens on localhost."
		plan.Notes = append(plan.Notes, "There’s no systemd user session here, so it won’t restart after a reboot.")
	}
	plan.Steps = steps
	plan.Command = joinSteps(steps, " && ")
	plan.Notes = append(plan.Notes, "wayvnc has no password. Only this machine itself can reach it, and Overseer’s tunnel is the way in.")
	return plan
}

func waylandUnsupportedPlan(info protocol.DesktopProbeResult) desktopSetupPlan {
	name, xorg := "GNOME", "GNOME on Xorg"
	if strings.Contains(info.Desktop, "kde") || strings.Contains(info.Desktop, "plasma") {
		name, xorg = "KDE Plasma", "Plasma (X11)"
	} else if !strings.Contains(info.Desktop, "gnome") && !strings.Contains(info.Desktop, "ubuntu") {
		name, xorg = "This desktop", "an Xorg session"
	}
	plan := desktopSetupPlan{
		Summary: name + " on Wayland can’t be shared to localhost only, so Overseer won’t set it up for you. The easy fix is to sign in with the Xorg session. Then one click works.",
		Manual: []string{
			"Log out. On the sign-in screen, open the gear menu and choose " + xorg + ".",
			"Sign in, come back here and press Check again. Setup is one click on Xorg.",
		},
	}
	if name == "GNOME" {
		plan.Manual = append(plan.Manual, "Or stay on Wayland: run grdctl vnc enable, grdctl vnc set-auth-method password and grdctl vnc set-password. GNOME listens on every network interface, so block port 5900 from outside in your firewall first.")
	} else if name == "KDE Plasma" {
		plan.Manual = append(plan.Manual, "Or stay on Wayland: install krfb, turn on unattended access, and block port 5900 from outside in your firewall. krfb listens on every network interface.")
	}
	return plan
}

// unitFile returns a shell command that writes a systemd user unit to
// ~/.config/systemd/user. execStart may contain $(...) for the shell to
// resolve now, so it is written inside double quotes.
func unitFile(description, execStart, after string, service []string) string {
	lines := []string{"'[Unit]'", "'Description=" + description + "'", "'After=" + after + "'", "''", "'[Service]'", `"ExecStart=` + execStart + `"`}
	for _, l := range service {
		lines = append(lines, "'"+l+"'")
	}
	lines = append(lines, "'Restart=always'", "'RestartSec=3'", "''", "'[Install]'", "'WantedBy=default.target'")
	return "printf '%s\\n' " + strings.Join(lines, " ") + " > ~/.config/systemd/user/" + unitName
}

// --- macOS ---

func macDesktopPlan(info protocol.DesktopProbeResult) desktopSetupPlan {
	anchorFile := "/etc/pf.anchors/" + pfAnchorName
	plistPath := "/Library/LaunchDaemons/" + pfAnchorName + ".plist"
	pf := fmt.Sprintf("/sbin/pfctl -E 2>/dev/null; /sbin/pfctl -a com.apple/%s -f %s", pfAnchorName, anchorFile)
	plist := []string{
		`'<?xml version="1.0" encoding="UTF-8"?>'`,
		`'<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'`,
		`'<plist version="1.0"><dict>'`,
		`'<key>Label</key><string>` + pfAnchorName + `</string>'`,
		`'<key>ProgramArguments</key><array><string>/bin/sh</string><string>-c</string><string>` + pf + `</string></array>'`,
		`'<key>RunAtLoad</key><true/>'`,
		`'</dict></plist>'`,
	}
	steps := []string{
		// Screen Sharing listens on every interface and macOS can't change
		// that, so a firewall rule keeps port 5900 to this Mac. It goes in
		// first and is re-applied at boot, so it is never exposed.
		fmt.Sprintf("printf '%%s\\n' 'block drop in quick on ! lo0 proto tcp from any to any port %d' | sudo tee %s >/dev/null", vncPort, anchorFile),
		"printf '%s\\n' " + strings.Join(plist, " ") + " | sudo tee " + plistPath + " >/dev/null && sudo chown root:wheel " + plistPath + " && sudo chmod 644 " + plistPath,
		"{ sudo launchctl bootout system/" + pfAnchorName + " 2>/dev/null; sudo launchctl bootstrap system " + plistPath + "; }",
		fmt.Sprintf("sudo /sbin/pfctl -a com.apple/%s -sr", pfAnchorName),
		"sudo launchctl enable system/com.apple.screensharing && { sudo launchctl bootstrap system /System/Library/LaunchDaemons/com.apple.screensharing.plist 2>/dev/null || sudo launchctl kickstart -k system/com.apple.screensharing; }",
		fmt.Sprintf("sleep 2; nc -z 127.0.0.1 %d && echo 'Screen Sharing is on and reachable from this Mac only.'", vncPort),
	}
	user := info.User
	signIn := "Sign in with the name and password you use to log in to this Mac."
	if user != "" {
		signIn = "Sign in as " + user + " with the password you use to log in to this Mac."
	}
	return desktopSetupPlan{
		Supported:  true,
		Server:     "screensharing",
		NeedsAdmin: true,
		Summary:    "Turns on macOS Screen Sharing and limits it to this Mac with a firewall rule, so only Overseer’s tunnel can reach it. It asks for your Mac password once, in the terminal.",
		Steps:      steps,
		Command:    joinSteps(steps, " && "),
		Notes: []string{
			signIn,
			"If macOS asks, allow Screen Sharing in System Settings → General → Sharing.",
		},
		Manual: []string{
			"Open System Settings → General → Sharing and switch on Screen Sharing.",
			"Click the (i) next to it and allow your account.",
			"Come back and press Check again.",
		},
	}
}

// --- Windows ---

func windowsDesktopPlan(info protocol.DesktopProbeResult) desktopSetupPlan {
	installed := hasInstalled(info, "tvnserver")
	if installed {
		return desktopSetupPlan{
			Supported:  true,
			Server:     "tightvnc",
			NeedsAdmin: true,
			Summary:    "TightVNC is installed but not running. This starts its service.",
			Steps:      []string{"Start-Service tvnserver; Get-Service tvnserver"},
			Command:    "Start-Service tvnserver; Get-Service tvnserver",
			Notes:      []string{"In TightVNC’s server settings, tick “Only accept loopback connections”, so only Overseer’s tunnel can reach it."},
			Manual:     []string{"Open TightVNC Service – Configuration, tick Only accept loopback connections, then start the TightVNC Server service."},
		}
	}
	manual := []string{
		"Download TightVNC from tightvnc.com and install the Server only.",
		"In its configuration, set a password and tick Only accept loopback connections.",
		"Make sure the TightVNC Server service is running, then press Check again.",
	}
	if !info.Winget {
		return desktopSetupPlan{Summary: "Overseer needs winget (App Installer from the Microsoft Store) to install TightVNC for you.", Manual: manual}
	}
	props := "ADDLOCAL=Server SERVER_REGISTER_AS_SERVICE=1 SERVER_ADD_FIREWALL_EXCEPTION=0 SET_USEVNCAUTHENTICATION=1 VALUE_OF_USEVNCAUTHENTICATION=1 SET_PASSWORD=1 VALUE_OF_PASSWORD=$plain SET_LOOPBACKONLY=1 VALUE_OF_LOOPBACKONLY=1"
	steps := []string{
		`$pw = Read-Host "Choose a desktop password (up to 8 letters or digits)" -AsSecureString; $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw))`,
		`if ($plain -notmatch '^[A-Za-z0-9]{1,8}$') { throw "Use 1 to 8 letters or digits." }`,
		`winget install --id GlavSoft.TightVNC --exact --silent --accept-package-agreements --accept-source-agreements --custom "` + props + `"`,
		`Remove-Variable plain, pw; Start-Service tvnserver; Get-Service tvnserver`,
	}
	return desktopSetupPlan{
		Supported:  true,
		Server:     "tightvnc",
		NeedsAdmin: true,
		Summary:    "Installs TightVNC with winget, sets the password you choose, and runs it as a service that only accepts connections from this machine.",
		Steps:      steps,
		Command:    joinSteps(steps, "; "),
		Notes: []string{
			"Windows will ask for permission to install. TightVNC keeps passwords to 8 characters.",
		},
		Manual: manual,
	}
}
