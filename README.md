<div align="center">

# 👁️ Overseer

**Control all your machines from one browser tab.**

Public site: **[liveagent-lime.vercel.app](https://liveagent-lime.vercel.app)**

Install one hub, paste one command on every other device, and run terminals and
coding agents across your whole fleet — from your desk or your phone.

</div>

---

Overseer is a small, self-hosted tool for people who run more than one machine:
a desktop, a laptop, a homelab box, a cloud VM. You install the **hub** on one
of them, then join every other device with a single pasted command. From then
on you drive them all from one web UI: live terminals, coding agents (Claude
Code, Codex, or any CLI), a fleet dashboard, and a file browser.

It's also built so your **agents can drive the fleet**: point Claude Code or
Codex at Overseer's MCP server and it becomes a "senior" that launches and
supervises worker agents on every machine.

The **Code** workspace embeds [fx](https://github.com/vercel-labs/fx) through
its official `libfx` WebAssembly SDK. Add a project, bind it to a directory on
one connected machine, and work in a Codex-style browser view. fx runs in the
authenticated browser control plane while its typed terminal actions are
routed to that project's machine, so one fx login can work across the fleet
without copying provider credentials onto every node.

## Why it's easy

- **One paste to join a device.** No SSH keys, no port forwarding, no config
  files. Devices dial *out* to the hub over a single WebSocket, so it works
  behind NAT and firewalls untouched.
- **One binary.** The hub, the device agent, the CLI, and the MCP server are
  all the same static `overseer` binary. The web UI is baked into it.
- **Sessions survive.** Terminals run in tmux on each device — close your
  laptop, reopen on your phone, your agent is still running right where it was.

## Quick start

### 1. Run the hub

On a fresh Linux VM with systemd:

```sh
curl -fsSL https://liveagent-lime.vercel.app/install.sh | sh
```

On macOS (Intel or Apple Silicon):

```sh
curl -fsSL https://liveagent-lime.vercel.app/install-macos.sh | sh
```

On Windows 10/11 or Windows Server 2016+ (x64 or ARM64), from PowerShell:

```powershell
irm https://liveagent-lime.vercel.app/install.ps1 | iex
```

The macOS and Windows installers run the hub in the signed-in user's background
session and start it again at login. The Linux installer uses systemd and is the
recommended option for an always-on server. All three installers select the
matching `amd64` or `arm64` release automatically, verify its checksum, and
fall back to a source build when a release has not been published yet. Source
fallbacks use temporary Go 1.25 and Node 20 toolchains when the host does not
already have compatible versions; they do not replace system toolchains.

Set `OVERSEER_INSTALL_SOURCE=binary` to require a published release or
`OVERSEER_INSTALL_SOURCE=source` to force a source build. `OVERSEER_REF` selects
the branch or commit for source installs, while a non-`latest`
`OVERSEER_VERSION` selects the same release tag for both binary and source
paths.

That installs `tmux` when missing, installs the `overseer` binary, creates an
`overseer` service user, starts the hub as `overseer-hub.service`, and listens
on `:4200`.

To uninstall the service and binary while keeping hub data:

```sh
curl -fsSL https://liveagent-lime.vercel.app/install.sh | sh -s -- uninstall
```

Add `OVERSEER_PURGE=1` to also remove `/var/lib/overseer` and the service user.
On macOS, pipe `sh -s -- uninstall`; on Windows, download the script and run it
with `-Action uninstall`. Both preserve hub data unless `OVERSEER_PURGE=1` is
set, matching the Linux safety model.

For HTTPS with Let's Encrypt, point DNS at the VM, open ports 80/443, then run:

```sh
curl -fsSL https://liveagent-lime.vercel.app/install.sh \
  | env OVERSEER_TLS_DOMAIN=overseer.example.com OVERSEER_TLS_EMAIL=you@example.com sh
```

For local development from source:

```sh
git clone https://github.com/ErzenXz/overseer
cd overseer
make            # builds the UI + the ./overseer binary (needs Go 1.25 + Node 20)
./overseer serve
```

Open `http://localhost:4200`, set an admin password, and you're in. The hub
machine shows up as your first device automatically.

The Vercel deployment is the public static product site. The authenticated hub
remains a durable install on Linux, macOS, or Windows because it owns the local
SQLite database and the persistent device/terminal connections.

> **Prebuilt binaries:** once a release is tagged, grab one from the
> [releases page](https://github.com/ErzenXz/overseer/releases) instead of
> building — download `overseer_<os>_<arch>`, `chmod +x`, and `./overseer serve`.

### 2. Add a device

Click **Add device** in the UI, choose the target platform, and paste the
command it gives you on any other Linux, macOS, or Windows machine:

```sh
curl -fsSL http://YOUR-HUB:4200/install/TOKEN.sh | sh
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm http://YOUR-HUB:4200/install/TOKEN.ps1 | iex"
```

It downloads the agent, enrolls the device, installs a background service, and
connects. The device pops up on your dashboard within seconds. If the joining
device runs the same OS/arch as your hub, the binary comes straight from the
hub (works on air-gapped LANs); otherwise the hub redirects the installer to
the matching GitHub release build. For fully offline cross-platform setups,
drop a cross-compiled `overseer_<os>_<arch>` into
`~/.overseer/binaries/` on the hub and it's served from there.

Linux agents install with systemd, macOS agents install as a launchd user
agent, and Windows agents install as a user logon Scheduled Task. Persistent
terminal sessions use `tmux`, so Linux/macOS devices with `tmux` installed get
reattachable sessions. Windows uses the native ConPTY API for fully interactive
PowerShell and coding-agent terminals; those sessions are live but not yet
reattachable after a disconnect.

### 3. Launch an agent

Open a device, hit **Launch agent**, pick Claude Code / Codex / a shell, choose
a working directory, go. Watch it — and every other agent across your fleet —
on the **Agents** page.

Or open **Code**, add a project, choose the machine and absolute working
directory, then sign in from the embedded fx terminal. The fx login, prompt
history, and saved sessions stay in that browser profile; commands execute on
the selected project machine through the authenticated hub. Embedded fx needs
Chrome or Edge 137+ with WebAssembly JSPI support.

### 4. Prepare coding tools and private access

Open **Setup** in the web UI, choose any online machine, and Overseer will show
which tools are installed and signed in. You can install or repair Codex,
Claude Code, and Gemini CLI together, then open each provider's official login
flow in a managed terminal. Credentials remain in each provider's protected
local storage; Overseer never saves copied login tokens in its database.

The same page can install and connect Tailscale on Linux, macOS, and Windows,
then configure Tailscale Serve to give the hub a private HTTPS address. This is
the recommended way to reach a hub remotely: the web port stays private to your
tailnet, so there is no router port-forwarding or public HTTP exposure.

## Let an agent run your fleet

Create an API token in **Settings**, then on any machine with the `overseer`
binary:

```sh
overseer fleet login --hub http://YOUR-HUB:4200 --token YOUR_API_TOKEN
claude mcp add overseer -- overseer mcp     # for Claude Code
```

Now your agent has these tools: `list_devices`, `list_sessions`,
`create_session`, `send_input`, `read_output`, `run_command`, `kill_session`,
`list_files`, `read_file`, `write_file`. Ask it things like *"launch claude in
~/projects/api on the homelab box and have it fix the failing tests, then report
back."*

The same operations are available as a CLI:

```sh
overseer fleet devices
overseer fleet new homelab build --cwd ~/app --cmd "claude"
overseer fleet read homelab build
overseer fleet run homelab -- git status
```

### Use it from ChatGPT, Claude, or any MCP client (remote MCP)

The hub also serves the MCP tools over HTTP at `/mcp`, so any client that
supports **remote MCP connectors** — ChatGPT, Claude, Cursor — can drive your
fleet directly. With `list_files` / `read_file` / `write_file` / `run_command`,
that client becomes a full coding agent on your machines.

1. Expose the hub over HTTPS (see below — `--tls-domain`, or a TLS proxy).
2. Create an API token in **Settings**.
3. In your client, add a connector pointing at `https://your-domain/mcp` and
   supply the API token as a Bearer credential.

> ⚠️ **This is a remote shell.** `run_command` and `write_file` execute
> arbitrary commands and write files on your devices. The endpoint refuses
> requests without a valid API token and must only be exposed over HTTPS —
> anyone who gets the token owns the box, so treat it like an SSH key. Rotate it
> in Settings if it leaks. There is no separate "read-only" mode yet.

## Keeping devices up to date

Open **Settings → Software updates** to see the installed release, the newest
stable release, fleet rollout progress, and the version available for rollback.
Installed hubs check every six hours and apply stable updates automatically by
default. The setting can be disabled, or you can check and install immediately.

Every release download is matched against `checksums.txt` and the staged binary
must report the expected version before Overseer touches the running binary.
Replacement is atomic on Linux/macOS; Windows uses a detached swap helper after
the running `.exe` exits. The previous verified binary is retained beside the
new one, so **Restore previous version** can roll the hub back with one click.
Release CI also publishes signed GitHub build provenance for the raw binaries.

Managed device agents follow the hub's stable version automatically. Failed
downloads leave the current agent running and retry later, while successful
updates restart through systemd, launchd, or the named Windows Scheduled Task.
A foreground `overseer agent run` used for debugging is never replaced.

For a standalone binary, the equivalent commands are:

```sh
overseer update --check
overseer update
overseer rollback
```

Automatic replacement requires an installation made by the Linux, macOS, or
Windows background-service installer. Source/debug runs still show whether a
new release exists without silently changing themselves.

## Accessing it from anywhere

Overseer binds to `0.0.0.0:4200` over plain HTTP — perfect on a trusted LAN.
To reach it from the internet, **do not expose plain HTTP directly.** Three
options:

- **Built-in Let's Encrypt (easiest for a public domain):** point a domain's
  DNS at the machine, open ports 80 and 443, and run:

  ```sh
  overseer serve --tls-domain overseer.example.com --tls-email you@example.com
  ```

  The hub obtains and auto-renews a real TLS certificate (ACME) — you just give
  it the domain and an email, and it handles verification and renewal. This is
  required if you want to connect a remote MCP client like ChatGPT.
- **[Tailscale](https://tailscale.com):** put the hub and your phone/laptop on
  the same tailnet and browse to the hub's Tailscale IP. Encrypted, zero config,
  no open ports — great when you don't have a domain.
- **A TLS reverse proxy** (Caddy, nginx, Traefik) in front of the single hub
  port, if you already run one.

## How it works

```
     Browser ─── HTTPS + WebSocket ───►  ┌─────────┐
     (or phone)                          │   Hub   │  ← web UI, API, SQLite
                                         └────┬────┘
                          one outbound WS per device
                    ┌───────────────┬─────────┴───────┐
                 ┌──┴──┐         ┌───┴──┐          ┌────┴───┐
                 │agent│         │agent │          │ agent  │   ← tmux, PTYs,
                 │ mac │         │linux │          │  VM    │     stats, files
                 └─────┘         └──────┘          └────────┘
```

Everything — terminal streams, stats, file transfers, control — is multiplexed
over each device's single outbound WebSocket. Design details live in
[`docs/superpowers/specs`](docs/superpowers/specs/).

## Development

```sh
# Terminal 1: hub API (Go)
go run ./cmd/overseer serve

# Terminal 2: UI with hot reload (proxies /api to :4200)
cd ui && npm install && npm run dev

make test        # go vet + unit + integration tests (some need tmux)
make cross       # cross-compile darwin/linux/windows × amd64/arm64 into dist/
```

Project layout: `cmd/overseer` (entrypoint + subcommands), `internal/protocol`
(wire format), `internal/hub` (server), `internal/agent` (device side),
`internal/fleet` (API client), `internal/mcp` (MCP server), `ui` (React app).

## Status & roadmap

v1 is here: one-paste join, tmux terminals, smart agent sessions, fleet
dashboard, file browser, CLI + MCP, and a responsive UI that works from a phone
browser. Not yet: multi-user/teams, a native mobile app, fully persistent
Windows terminals, built-in tunneling. Contributions welcome.

### Cutting a release

Tag a commit and CI does the rest (cross-compiles, builds the UI, uploads
binaries + checksums to a GitHub release):

```sh
git tag v0.1.0 && git push origin v0.1.0
```

## License

MIT — see [LICENSE](LICENSE).
