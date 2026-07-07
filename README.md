<div align="center">

# 👁️ Overseer

**Control all your machines from one browser tab.**

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

```sh
git clone https://github.com/overseer-sh/overseer
cd overseer
make            # builds the UI + the ./overseer binary (needs Go 1.24 + Node 20)
./overseer serve
```

Open `http://localhost:4200`, set an admin password, and you're in. The hub
machine shows up as your first device automatically.

> **Prebuilt binaries:** once a release is tagged, grab one from the
> [releases page](https://github.com/ErzenXz/overseer/releases) instead of
> building — download `overseer_<os>_<arch>`, `chmod +x`, and `./overseer serve`.

### 2. Add a device

Click **Add device** in the UI and paste the command it gives you on any other
Linux or macOS machine:

```sh
curl -fsSL http://YOUR-HUB:4200/install/TOKEN.sh | sh
```

It downloads the agent, enrolls the device, installs a background service, and
connects. The device pops up on your dashboard within seconds. If the joining
device runs the same OS/arch as your hub, the binary comes straight from the
hub (works on air-gapped LANs); otherwise the hub redirects the installer to
the matching GitHub release build. For fully offline cross-platform setups,
drop a cross-compiled `overseer_<os>_<arch>` into
`~/.overseer/binaries/` on the hub and it's served from there.

### 3. Launch an agent

Open a device, hit **Launch agent**, pick Claude Code / Codex / a shell, choose
a working directory, go. Watch it — and every other agent across your fleet —
on the **Agents** page.

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

Agents self-update. When a device agent connects and finds the hub running a
newer tagged release, it downloads the matching build, atomically replaces its
own binary, and restarts via its service manager — no per-device babysitting.
Self-update only runs for the installed background service (it keys off
`OVERSEER_MANAGED=1`, set in the systemd unit / launchd plist), so a foreground
`overseer agent run` you're debugging is never swapped out from under you.
Upgrade your whole fleet by upgrading the hub and tagging a release.

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
make cross       # cross-compile darwin/linux × amd64/arm64 into dist/
```

Project layout: `cmd/overseer` (entrypoint + subcommands), `internal/protocol`
(wire format), `internal/hub` (server), `internal/agent` (device side),
`internal/fleet` (API client), `internal/mcp` (MCP server), `ui` (React app).

## Status & roadmap

v1 is here: one-paste join, tmux terminals, smart agent sessions, fleet
dashboard, file browser, CLI + MCP, and a responsive UI that works from a phone
browser. Not yet: multi-user/teams, a native mobile app, Windows agents,
built-in tunneling. Contributions welcome.

### Cutting a release

Tag a commit and CI does the rest (cross-compiles, builds the UI, uploads
binaries + checksums to a GitHub release):

```sh
git tag v0.1.0 && git push origin v0.1.0
```

## License

MIT — see [LICENSE](LICENSE).
