package hub

import (
	"net/http"
	"strings"
	"sync"
)

// setupTool is intentionally built on the hub from a fixed catalogue. The UI
// never supplies install commands, so setup buttons cannot turn a tool id into
// an arbitrary remote command by accident.
type setupTool struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Description    string `json:"description"`
	Installed      bool   `json:"installed"`
	Version        string `json:"version,omitempty"`
	Auth           string `json:"auth"`
	InstallCommand string `json:"installCommand"`
	AuthCommand    string `json:"authCommand,omitempty"`
	Note           string `json:"note,omitempty"`
	DocsURL        string `json:"docsUrl"`
}

type setupOverview struct {
	OS            string      `json:"os"`
	Arch          string      `json:"arch"`
	Tools         []setupTool `json:"tools"`
	BundleCommand string      `json:"bundleCommand"`
}

type toolSpec struct {
	id, name, description, binary, versionArgs, authProbe string
	installUnix, installWindows, authUnix, authWindows    string
	note, docsURL                                         string
}

var setupSpecs = []toolSpec{
	{
		id: "node", name: "Node.js", binary: "node", versionArgs: "--version",
		description:    "Shared runtime used by Claude Code and Gemini CLI.",
		installUnix:    `if command -v brew >/dev/null 2>&1; then brew install node; elif command -v apt-get >/dev/null 2>&1; then sudo apt-get update && sudo apt-get install -y nodejs npm; elif command -v dnf >/dev/null 2>&1; then sudo dnf install -y nodejs npm; elif command -v yum >/dev/null 2>&1; then sudo yum install -y nodejs npm; else echo "Install Node.js LTS from https://nodejs.org"; exit 1; fi`,
		installWindows: `winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements; $env:PATH = [Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [Environment]::GetEnvironmentVariable("PATH", "User")`,
		note:           "Only needed for npm-based agents. Codex uses its native installer.", docsURL: "https://nodejs.org/en/download",
	},
	{
		id: "codex", name: "Codex", binary: "codex", versionArgs: "--version", authProbe: "codex",
		description:    "OpenAI's coding agent for terminal-first repository work.",
		installUnix:    `curl -fsSL https://chatgpt.com/codex/install.sh | sh`,
		installWindows: `irm https://chatgpt.com/codex/install.ps1 | iex`,
		authUnix:       `codex login --device-auth`, authWindows: `codex login --device-auth`,
		note: "Device-code login works well on remote and headless machines.", docsURL: "https://github.com/openai/codex",
	},
	{
		id: "claude", name: "Claude Code", binary: "claude", versionArgs: "--version", authProbe: "claude",
		description:    "Anthropic's agentic coding CLI with interactive project workflows.",
		installUnix:    `curl -fsSL https://claude.ai/install.sh | bash`,
		installWindows: `if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "Install Node.js first" }; if (-not (Get-Command git -ErrorAction SilentlyContinue)) { winget install --id Git.Git --exact --accept-package-agreements --accept-source-agreements }; $prefix = Join-Path $env:LOCALAPPDATA "Overseer\tools"; npm install --prefix $prefix @anthropic-ai/claude-code@latest`,
		authUnix:       `claude`, authWindows: `claude`,
		note: "Native Windows also needs Git for Windows; WSL remains fully supported.", docsURL: "https://docs.anthropic.com/en/docs/claude-code/getting-started",
	},
	{
		id: "gemini", name: "Gemini CLI", binary: "gemini", versionArgs: "--version", authProbe: "gemini",
		description:    "Google's open-source coding agent with Google account login.",
		installUnix:    `command -v npm >/dev/null 2>&1 || { echo "Install Node.js first"; exit 1; }; mkdir -p "$HOME/.overseer/tools"; npm install --prefix "$HOME/.overseer/tools" @google/gemini-cli@latest`,
		installWindows: `if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "Install Node.js first" }; $prefix = Join-Path $env:LOCALAPPDATA "Overseer\tools"; npm install --prefix $prefix @google/gemini-cli@latest`,
		authUnix:       `gemini`, authWindows: `gemini`,
		note: "Choose Sign in with Google when the setup terminal opens.", docsURL: "https://github.com/google-gemini/gemini-cli",
	},
	{
		id: "tailscale", name: "Tailscale", binary: "tailscale", versionArgs: "version", authProbe: "tailscale",
		description:    "Private encrypted access to Overseer without opening a public port.",
		installUnix:    `if [ "$(uname -s)" = "Darwin" ]; then command -v brew >/dev/null 2>&1 || { echo "Install Homebrew first: https://brew.sh"; exit 1; }; brew install --cask tailscale; open -a Tailscale; else curl -fsSL https://tailscale.com/install.sh | sh; sudo tailscale up; fi`,
		installWindows: `winget install --id Tailscale.Tailscale --exact --accept-package-agreements --accept-source-agreements`,
		authUnix:       `if [ "$(uname -s)" = "Darwin" ]; then open -a Tailscale; TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale; "$TS" up && "$TS" serve --bg 4200; else sudo tailscale up && sudo tailscale serve --bg 4200; fi`,
		authWindows:    `$ts = "$env:ProgramFiles\Tailscale\tailscale.exe"; & $ts up; if ($LASTEXITCODE -eq 0) { & $ts serve --bg 4200 }`,
		note:           "Creates a private HTTPS address inside your tailnet. No router or firewall changes required.", docsURL: "https://tailscale.com/docs/features/tailscale-serve",
	},
}

func (s *Server) handleSetupStatus(w http.ResponseWriter, r *http.Request) {
	c := s.deviceConn(w, r)
	if c == nil {
		return
	}
	osName := c.hello.OS
	tools := make([]setupTool, len(setupSpecs))
	var wg sync.WaitGroup
	for i, spec := range setupSpecs {
		wg.Add(1)
		go func(i int, spec toolSpec) {
			defer wg.Done()
			tools[i] = s.probeSetupTool(c, osName, spec)
		}(i, spec)
	}
	wg.Wait()

	var installs []string
	for _, tool := range tools {
		if (tool.ID == "node" && !tool.Installed) || tool.ID == "codex" || tool.ID == "claude" || tool.ID == "gemini" {
			installs = append(installs, tool.InstallCommand)
		}
	}
	separator := " && "
	if osName == "windows" {
		separator = "; "
	}
	writeJSON(w, setupOverview{OS: osName, Arch: c.hello.Arch, Tools: tools, BundleCommand: strings.Join(installs, separator)})
}

func (s *Server) probeSetupTool(c *agentConn, osName string, spec toolSpec) setupTool {
	tool := setupTool{
		ID: spec.id, Name: spec.name, Description: spec.description, Auth: "not-required",
		InstallCommand: spec.installUnix, AuthCommand: spec.authUnix, Note: spec.note, DocsURL: spec.docsURL,
	}
	var command string
	if osName == "windows" {
		tool.InstallCommand, tool.AuthCommand = spec.installWindows, spec.authWindows
		if spec.id == "tailscale" {
			command = `$binary = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"; if (Test-Path $binary) { Write-Output "installed"; & $binary version 2>$null | Select-Object -First 1 } else { Write-Output "missing" }`
		} else {
			command = `$cmd = Get-Command ` + spec.binary + ` -ErrorAction SilentlyContinue; if ($cmd) { Write-Output "installed"; & ` + spec.binary + ` ` + spec.versionArgs + ` 2>$null | Select-Object -First 1 } else { Write-Output "missing" }`
		}
	} else {
		if spec.id == "tailscale" {
			command = `if command -v tailscale >/dev/null 2>&1; then printf 'installed\n'; tailscale version 2>/dev/null | head -n 1; elif [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]; then printf 'installed\n'; /Applications/Tailscale.app/Contents/MacOS/Tailscale version 2>/dev/null | head -n 1; else printf 'missing\n'; fi`
		} else {
			command = `if command -v ` + spec.binary + ` >/dev/null 2>&1; then printf 'installed\n'; ` + spec.binary + ` ` + spec.versionArgs + ` 2>/dev/null | head -n 1; else printf 'missing\n'; fi`
		}
	}
	res, err := s.execOnDevice(c, command, "", 15)
	if err != nil {
		tool.Auth = "unknown"
		return tool
	}
	lines := strings.Split(strings.TrimSpace(res.Stdout), "\n")
	tool.Installed = len(lines) > 0 && strings.TrimSpace(lines[0]) == "installed"
	if tool.Installed && len(lines) > 1 {
		tool.Version = strings.TrimSpace(lines[1])
	}
	if spec.authProbe != "" {
		if !tool.Installed {
			tool.Auth = "missing"
		} else {
			tool.Auth = "ready"
			var authCommand string
			switch spec.authProbe {
			case "codex":
				authCommand = "codex login status"
			case "claude":
				authCommand = "claude auth status"
			case "tailscale":
				if osName == "windows" {
					authCommand = `& "$env:ProgramFiles\Tailscale\tailscale.exe" status`
				} else if osName == "darwin" {
					authCommand = `if command -v tailscale >/dev/null 2>&1; then tailscale status; else /Applications/Tailscale.app/Contents/MacOS/Tailscale status; fi`
				} else {
					authCommand = "tailscale status"
				}
			default:
				return tool
			}
			// Auth status commands are hints for the dashboard, not a reason to
			// hold up the whole setup page if a provider CLI is slow to respond.
			authRes, authErr := s.execOnDevice(c, authCommand, "", 4)
			if authErr == nil && authRes.ExitCode == 0 {
				tool.Auth = "connected"
			}
		}
	}
	return tool
}
