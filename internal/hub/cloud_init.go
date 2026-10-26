package hub

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// cloudInitSpec is everything the first-boot script needs. It holds no
// provider API token: the only secrets are a single-use enrollment token, a
// progress token that can only report install stages, and (optionally) a
// Tailscale auth key the user should have made one-off or ephemeral.
type cloudInitSpec struct {
	Hostname      string
	HubURL        string // how the new server reaches the hub
	EnrollToken   string
	ProgressToken string
	SSHKey        string
	TailscaleKey  string
	Tools         []string // claude, codex, gemini
}

const cloudUser = "overseer"

// shQuote single-quotes s for a POSIX shell.
func shQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

// yamlString renders s as a YAML double-quoted scalar (JSON strings are valid
// YAML), so no value can break out of its line.
func yamlString(s string) string {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.Encode(s)
	return strings.TrimRight(buf.String(), "\n")
}

var cloudToolPackages = map[string]string{
	"claude": "@anthropic-ai/claude-code",
	"codex":  "@openai/codex",
	"gemini": "@google/gemini-cli",
}

// cloudBootstrapScript is the first-boot script, written to disk by
// cloud-init and run once as root. It reports progress to the hub, and on any
// failure tells the hub which step broke.
const cloudBootstrapScript = `#!/bin/bash
# Overseer cloud machine setup. Runs once, as root, from cloud-init.
set -Eeuo pipefail
HUB=%s
ENROLL=%s
PING=%s
TSKEY=%s
AGENT_USER=%s
LOG=/var/log/overseer-bootstrap.log
STEP="starting"
exec > >(tee -a "$LOG") 2>&1
export DEBIAN_FRONTEND=noninteractive

report() { # stage message
  curl -fsS -m 10 -X POST "$HUB/api/cloud/progress" -H 'Content-Type: application/json' \
    -d "{\"token\":\"$PING\",\"stage\":\"$1\",\"message\":\"$2\"}" >/dev/null 2>&1 || true
}
step() { STEP="$1"; echo "==> $1"; }
trap 'report failed "Failed while ${STEP}. Log: ${LOG}"' ERR

if [ -n "$TSKEY" ]; then
  step "joining your Tailscale network"
  curl -fsSL https://tailscale.com/install.sh | sh
  tailscale up --authkey="$TSKEY" --hostname="$(hostname)" --ssh=false
  for _ in $(seq 1 30); do tailscale ip -4 >/dev/null 2>&1 && break; sleep 2; done
  TSKEY=""
fi

report installing "Installing tools"

step "installing Node.js"
curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
apt-get install -y nodejs

step "installing the GitHub CLI"
install -d -m 755 /etc/apt/keyrings
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list
apt-get update -y
apt-get install -y gh
%s
step "downloading the Overseer agent"
case "$(uname -m)" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) STEP="checking the CPU type ($(uname -m) is not supported)"; false ;;
esac
AGENT_HOME="$(getent passwd "$AGENT_USER" | cut -d: -f6)"
install -d -m 700 -o "$AGENT_USER" -g "$AGENT_USER" "$AGENT_HOME/.overseer" "$AGENT_HOME/.overseer/bin"
BIN="$AGENT_HOME/.overseer/bin/overseer"
TMP="$(mktemp "$AGENT_HOME/.overseer/bin/.overseer-download.XXXXXX")"
curl -fsSL --retry 5 --retry-delay 3 "$HUB/api/agent-binary?os=linux&arch=$ARCH" -o "$TMP"
WANT="$(curl -fsSL --retry 3 "$HUB/api/agent-binary/sha256?os=linux&arch=$ARCH")"
GOT="$(sha256sum "$TMP" | awk '{print $1}')"
[ "$GOT" = "$WANT" ] || { STEP="verifying the agent download (checksum mismatch)"; false; }
chown "$AGENT_USER:$AGENT_USER" "$TMP"
chmod 755 "$TMP"
sudo -u "$AGENT_USER" -H "$TMP" version >/dev/null
mv -f "$TMP" "$BIN"

step "connecting to the hub"
sudo -u "$AGENT_USER" -H "$BIN" agent enroll --hub "$HUB" --token "$ENROLL"
ENROLL=""

step "starting the agent service"
HOME="$AGENT_HOME" SUDO_USER="$AGENT_USER" "$BIN" agent install-service

echo "==> done"
rm -f "$0" /var/lib/cloud/instance/user-data.txt* 2>/dev/null || true
`

func cloudToolsBlock(tools []string) string {
	var b strings.Builder
	for _, id := range tools {
		pkg, ok := cloudToolPackages[id]
		if !ok {
			continue
		}
		// An agent CLI failing to install should not stop the machine joining.
		fmt.Fprintf(&b, "\nstep %s\nnpm install -g %s || echo \"warning: could not install %s\"\n",
			shQuote("installing "+id), shQuote(pkg), id)
	}
	return b.String()
}

// renderCloudInit builds the #cloud-config user-data for a new server.
func renderCloudInit(spec cloudInitSpec) (string, error) {
	if spec.Hostname == "" || spec.HubURL == "" || spec.EnrollToken == "" || spec.ProgressToken == "" {
		return "", errors.New("cloud-init needs a host name, hub address and tokens")
	}
	for _, v := range []string{spec.EnrollToken, spec.ProgressToken} {
		if !isSimpleToken(v) {
			return "", errors.New("invalid token")
		}
	}
	script := fmt.Sprintf(cloudBootstrapScript, shQuote(spec.HubURL), shQuote(spec.EnrollToken), shQuote(spec.ProgressToken),
		shQuote(spec.TailscaleKey), shQuote(cloudUser), cloudToolsBlock(spec.Tools))

	var b strings.Builder
	b.WriteString("#cloud-config\n")
	fmt.Fprintf(&b, "hostname: %s\n", yamlString(spec.Hostname))
	b.WriteString("preserve_hostname: false\nmanage_etc_hosts: true\nssh_pwauth: false\ndisable_root: true\n")
	b.WriteString("users:\n")
	fmt.Fprintf(&b, "  - name: %s\n    gecos: Overseer\n    shell: /bin/bash\n    groups: [sudo]\n    sudo: \"ALL=(ALL) NOPASSWD:ALL\"\n    lock_passwd: true\n", cloudUser)
	if spec.SSHKey != "" {
		fmt.Fprintf(&b, "    ssh_authorized_keys:\n      - %s\n", yamlString(spec.SSHKey))
	}
	b.WriteString("package_update: true\npackages:\n")
	for _, p := range []string{"git", "tmux", "curl", "ca-certificates", "gnupg", "unzip", "jq"} {
		fmt.Fprintf(&b, "  - %s\n", p)
	}
	b.WriteString("write_files:\n  - path: /usr/local/sbin/overseer-bootstrap\n    owner: root:root\n    permissions: \"0700\"\n    content: |\n")
	for _, line := range strings.Split(strings.TrimRight(script, "\n"), "\n") {
		if line == "" {
			b.WriteString("\n")
			continue
		}
		b.WriteString("      " + line + "\n")
	}
	b.WriteString("runcmd:\n  - [ /usr/local/sbin/overseer-bootstrap ]\n")
	return b.String(), nil
}
