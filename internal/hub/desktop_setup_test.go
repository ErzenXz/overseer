package hub

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ErzenXz/overseer/internal/protocol"
)

func TestLinuxX11Plan(t *testing.T) {
	for pm, want := range map[string]string{
		"apt":    "sudo apt-get update && sudo apt-get install -y x11vnc",
		"dnf":    "sudo dnf install -y x11vnc",
		"yum":    "sudo yum install -y x11vnc",
		"pacman": "sudo pacman -S --needed --noconfirm x11vnc",
		"zypper": "sudo zypper --non-interactive install x11vnc",
	} {
		plan := buildDesktopSetup(protocol.DesktopProbeResult{OS: "linux", Session: "x11", PackageManager: pm, Systemd: true, Display: ":1", XAuthority: "/run/user/1000/gdm/Xauthority"}, "linux")
		if !plan.Supported && plan.Command == "" {
			t.Fatalf("%s: no command: %+v", pm, plan)
		}
		for _, need := range []string{want, "x11vnc -storepasswd", "-display :1", "-auth /run/user/1000/gdm/Xauthority", "-localhost", "-rfbauth %h/.vnc/passwd", "systemctl --user enable overseer-vnc.service"} {
			if !strings.Contains(plan.Command, need) {
				t.Errorf("%s: command missing %q:\n%s", pm, need, plan.Command)
			}
		}
		if !plan.NeedsAdmin {
			t.Errorf("%s: install needs sudo", pm)
		}
	}
}

func TestLinuxX11PlanDetails(t *testing.T) {
	// Already installed: no package manager needed, no sudo.
	plan := buildDesktopSetup(protocol.DesktopProbeResult{OS: "linux", Session: "x11", Installed: []string{"x11vnc"}, Systemd: true}, "linux")
	if plan.NeedsAdmin || strings.Contains(plan.Command, "sudo") {
		t.Errorf("installed x11vnc should not need sudo: %s", plan.Command)
	}
	if !strings.Contains(plan.Command, "-display :0 -auth guess") {
		t.Errorf("defaults should be :0 and -auth guess: %s", plan.Command)
	}
	// An unstable Xauthority (SDDM's /tmp file) must not be baked into a service.
	plan = buildDesktopSetup(protocol.DesktopProbeResult{OS: "linux", Session: "x11", PackageManager: "apt", Systemd: true, XAuthority: "/tmp/xauth_abc"}, "linux")
	if strings.Contains(plan.Command, "xauth_abc") {
		t.Errorf("transient Xauthority baked in: %s", plan.Command)
	}
	// No systemd: starts in the background instead.
	plan = buildDesktopSetup(protocol.DesktopProbeResult{OS: "linux", Session: "x11", PackageManager: "apt"}, "linux")
	if strings.Contains(plan.Command, "systemctl") || !strings.Contains(plan.Command, "-bg") {
		t.Errorf("non-systemd plan: %s", plan.Command)
	}
	// Unknown package manager: manual steps, nothing to run.
	plan = buildDesktopSetup(protocol.DesktopProbeResult{OS: "linux", Session: "x11"}, "linux")
	if plan.Supported || plan.Command != "" || len(plan.Manual) == 0 {
		t.Errorf("expected manual steps: %+v", plan)
	}
}

func TestLinuxLoopbackOnly(t *testing.T) {
	for _, info := range []protocol.DesktopProbeResult{
		{OS: "linux", Session: "x11", PackageManager: "apt", Systemd: true},
		{OS: "linux", Session: "x11", PackageManager: "apt"},
		{OS: "linux", Session: "wayland", Desktop: "sway", PackageManager: "pacman", Systemd: true},
		{OS: "linux", Session: "wayland", Desktop: "hyprland", PackageManager: "pacman"},
	} {
		plan := buildDesktopSetup(info, "linux")
		if plan.Command == "" {
			t.Fatalf("no command for %+v", info)
		}
		if !strings.Contains(plan.Command, "-localhost") && !strings.Contains(plan.Command, "127.0.0.1") {
			t.Errorf("not loopback only: %s", plan.Command)
		}
		if strings.Contains(plan.Command, "0.0.0.0") {
			t.Errorf("binds to all interfaces: %s", plan.Command)
		}
	}
}

func TestLinuxWaylandPlans(t *testing.T) {
	plan := buildDesktopSetup(protocol.DesktopProbeResult{OS: "linux", Session: "wayland", Desktop: "sway", PackageManager: "apt", WaylandDisplay: "wayland-1", Systemd: true}, "linux")
	for _, need := range []string{"sudo apt-get update && sudo apt-get install -y wayvnc", "127.0.0.1 5900", "WAYLAND_DISPLAY=wayland-1"} {
		if !strings.Contains(plan.Command, need) {
			t.Errorf("sway: missing %q in %s", need, plan.Command)
		}
	}
	// GNOME and KDE can't run wayvnc: precise steps, no command.
	for _, desktop := range []string{"gnome", "ubuntu:gnome", "kde"} {
		plan = buildDesktopSetup(protocol.DesktopProbeResult{OS: "linux", Session: "wayland", Desktop: desktop, PackageManager: "apt"}, "linux")
		if plan.Supported || plan.Command != "" {
			t.Errorf("%s should not be one-click: %+v", desktop, plan)
		}
		if len(plan.Manual) < 2 || !strings.Contains(plan.Manual[0], "Xorg") && !strings.Contains(plan.Manual[0], "X11") {
			t.Errorf("%s: manual steps should lead with the Xorg session: %v", desktop, plan.Manual)
		}
	}
	plan = buildDesktopSetup(protocol.DesktopProbeResult{OS: "linux", Session: "headless"}, "linux")
	if plan.Supported || plan.Command != "" {
		t.Errorf("headless: %+v", plan)
	}
}

func TestMacPlan(t *testing.T) {
	// Works from the hello OS alone, for agents that don't report a probe OS.
	plan := buildDesktopSetup(protocol.DesktopProbeResult{User: "erzen"}, "darwin")
	if !plan.Supported || !plan.NeedsAdmin {
		t.Fatalf("mac plan: %+v", plan)
	}
	for _, need := range []string{
		"launchctl enable system/com.apple.screensharing",
		"launchctl bootstrap system /System/Library/LaunchDaemons/com.apple.screensharing.plist",
		"block drop in quick on ! lo0 proto tcp from any to any port 5900",
	} {
		if !strings.Contains(plan.Command, need) {
			t.Errorf("missing %q in %s", need, plan.Command)
		}
	}
	// The firewall rule must be in place before Screen Sharing is enabled.
	if strings.Index(plan.Command, "port 5900") > strings.Index(plan.Command, "launchctl enable") {
		t.Errorf("firewall rule must come before enabling Screen Sharing")
	}
	if !strings.Contains(strings.Join(plan.Notes, " "), "erzen") {
		t.Errorf("notes should name the account: %v", plan.Notes)
	}
}

func TestWindowsPlan(t *testing.T) {
	plan := buildDesktopSetup(protocol.DesktopProbeResult{OS: "windows", Winget: true}, "windows")
	for _, need := range []string{"winget install --id GlavSoft.TightVNC", "SET_LOOPBACKONLY=1 VALUE_OF_LOOPBACKONLY=1", "ADDLOCAL=Server", "Start-Service tvnserver", "-AsSecureString"} {
		if !strings.Contains(plan.Command, need) {
			t.Errorf("missing %q in %s", need, plan.Command)
		}
	}
	if strings.Contains(plan.Command, "VALUE_OF_PASSWORD=hunter") || !strings.Contains(plan.Command, "VALUE_OF_PASSWORD=$plain") {
		t.Errorf("password must come from the prompt: %s", plan.Command)
	}
	if plan = buildDesktopSetup(protocol.DesktopProbeResult{OS: "windows"}, "windows"); plan.Supported || len(plan.Manual) == 0 {
		t.Errorf("no winget: %+v", plan)
	}
	if plan = buildDesktopSetup(protocol.DesktopProbeResult{OS: "windows", Installed: []string{"tvnserver"}}, "windows"); plan.Command != "Start-Service tvnserver; Get-Service tvnserver" {
		t.Errorf("installed: %+v", plan)
	}
}

func TestUnknownOSPlan(t *testing.T) {
	plan := buildDesktopSetup(protocol.DesktopProbeResult{}, "freebsd")
	if plan.Supported || plan.Summary == "" {
		t.Errorf("%+v", plan)
	}
}

// Every generated Unix command must at least parse in the shells people use.
// -n only checks syntax; nothing is executed.
func TestUnixCommandsParse(t *testing.T) {
	infos := []protocol.DesktopProbeResult{
		{OS: "linux", Session: "x11", PackageManager: "apt", Systemd: true, Display: ":0", XAuthority: "/run/user/1000/gdm/Xauthority"},
		{OS: "linux", Session: "x11", PackageManager: "dnf"},
		{OS: "linux", Session: "wayland", Desktop: "sway", PackageManager: "pacman", Systemd: true, WaylandDisplay: "wayland-1"},
		{OS: "linux", Session: "wayland", Desktop: "river", PackageManager: "zypper"},
		{OS: "darwin", User: "erzen"},
	}
	for _, shell := range []string{"sh", "bash", "zsh"} {
		path, err := exec.LookPath(shell)
		if err != nil {
			continue
		}
		for _, info := range infos {
			plan := buildDesktopSetup(info, info.OS)
			if plan.Command == "" {
				t.Fatalf("no command for %+v", info)
			}
			if out, err := exec.Command(path, "-n", "-c", plan.Command).CombinedOutput(); err != nil {
				t.Errorf("%s -n failed for %s/%s: %v\n%s\n%s", shell, info.OS, info.Session, err, out, plan.Command)
			}
			for _, step := range plan.Steps {
				if strings.Contains(step, "\n") {
					t.Errorf("step has a newline: %q", step)
				}
			}
		}
	}
}

// The unit-writing step is safe to run for real in a scratch HOME.
func TestSystemdUnitContents(t *testing.T) {
	plan := buildDesktopSetup(protocol.DesktopProbeResult{OS: "linux", Session: "x11", PackageManager: "apt", Systemd: true, Display: ":0"}, "linux")
	var step string
	for _, s := range plan.Steps {
		if strings.Contains(s, "[Unit]") {
			step = s
		}
	}
	if step == "" {
		t.Fatal("no unit step")
	}
	home := t.TempDir()
	cmd := exec.Command("sh", "-c", step)
	cmd.Env = []string{"HOME=" + home, "PATH=/usr/bin:/bin"}
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("%v: %s", err, out)
	}
	data, err := os.ReadFile(filepath.Join(home, ".config/systemd/user", unitName))
	if err != nil {
		t.Fatal(err)
	}
	got := string(data)
	for _, need := range []string{"[Unit]\n", "[Service]\nExecStart=", "-display :0 -auth guess -localhost -rfbport 5900 -rfbauth %h/.vnc/passwd -forever -shared\n", "Restart=always\n", "[Install]\nWantedBy=default.target\n"} {
		if !strings.Contains(got, need) {
			t.Errorf("unit missing %q:\n%s", need, got)
		}
	}
}
