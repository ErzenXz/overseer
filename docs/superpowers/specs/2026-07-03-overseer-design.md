# Overseer — Design Spec

**Date:** 2026-07-03
**Status:** Approved by owner (Erzen)
**One-liner:** Open-source fleet control for your machines — install a hub on one Mac/Linux box, join every other device with a single pasted command, then drive terminals, coding agents, and files on all of them from the browser.

## Goals

1. **Dead-simple device joining.** One pasted command; device appears live in the UI within seconds. No inbound ports, no SSH keys, no config files to write by hand.
2. **Great terminal experience.** tmux-backed sessions that survive disconnects, reattachable from any browser (including phone browsers).
3. **Fleet-wide coding agents.** Launch and monitor Claude Code / Codex / any CLI agent on any device; see all running agents in one place.
4. **Agents can drive the fleet.** An MCP server + CLI expose fleet operations, so a "senior" agent on the hub can deploy and supervise "worker" agents on every machine.
5. Open source, easy to contribute to, single-binary install.

## Non-goals (v1)

Multi-user/teams, native mobile apps, per-agent structured chat UIs, built-in internet tunneling (documented via Tailscale/reverse proxy instead), Windows agents (architecture must not preclude them).

## Architecture

**Approach:** hub-and-spoke over outbound WebSockets (chosen over agentless SSH and P2P/WebRTC for NAT-friendliness and zero device-side config).

**One binary, two roles.** A single `overseer` binary:

- `overseer serve` — the **hub**: HTTP server with the React UI embedded (go:embed), REST API, WebSocket endpoints for browsers and device agents, SQLite state. The hub machine automatically registers itself as a device via an embedded in-process agent.
- `overseer agent run` — the **device agent**: dials out to the hub over one persistent WebSocket (auto-reconnect, exponential backoff + jitter, max 30s), multiplexes terminal streams / stats / file ops / exec over it.
- `overseer fleet ...` — CLI for fleet operations against the hub API.
- `overseer mcp` — stdio MCP server exposing fleet tools to coding agents.

**Stack:** Go (gorilla/websocket, creack/pty, modernc.org/sqlite, gopsutil, x/crypto argon2), React + TypeScript + Vite + Tailwind + xterm.js.

## Protocol (agent ↔ hub)

Single WebSocket. Text frames = JSON control messages `{type, id?, channel?, ...}`. Binary frames = `[4-byte big-endian channel id][payload]` for streams (terminal I/O, file transfer).

- Agent connects to `/api/ws/agent` with `Authorization: Bearer <device token>`, sends `hello {hostname, os, arch, version, tmux}`; hub replies `welcome {deviceId}`.
- `stats` pushed every 5s: cpu%, mem used/total, disk used/total, uptime.
- Request/response pairs carry `id`; streams carry `channel` allocated by the hub.
- Messages: `term.open/opened/resize/close/exit`, `sessions.list`, `session.create`, `session.kill`, `exec` (capped output, timeout), `fs.list`, `fs.read` (download stream), `fs.write` (upload stream).

## Terminals & sessions

- Sessions are tmux sessions. Create: `tmux new-session -d -s <name> -c <cwd> [cmd]`; attach: PTY running `tmux attach -t <name>`; agent metadata stored as tmux user option `@overseer_kind`.
- tmux missing → ephemeral plain-PTY fallback sessions (marked non-persistent in UI, with an "install tmux" hint).
- Status heuristic (agent-agnostic, no output parsing): `working` = session activity within last 10s, `idle` = alive but quiet, `exited` = gone.
- Browser terminal: xterm.js over `/api/ws/term?device=&session=`; hub bridges binary frames to the agent channel. Scrollback lives in tmux; reattach replays it.

## Join flow

1. UI **Add device** → POST creates single-use enrollment token (15 min expiry) → shows `curl -fsSL http://HUB:4200/install/<token>.sh | sh`.
2. Script detects OS/arch, downloads the agent binary **from the hub itself** (`/api/agent-binary?os=&arch=`: serves the hub's own executable when platform matches, else from `<data-dir>/binaries/overseer_<os>_<arch>`, else instructs cross-compile/GitHub release), runs `overseer agent enroll --hub URL --token T` (exchanges enrollment token for a permanent per-device secret, writes `~/.overseer/agent.json`), installs a systemd (Linux) or launchd (macOS) service, starts it.
3. Device appears on the dashboard; the Add-device modal live-updates when it joins.
4. Deleting a device revokes its token and disconnects it.

## Hub ↔ browser

REST: setup/login/logout/me; devices CRUD; enroll tokens; per-device sessions CRUD; fs list/download/upload; fleet-wide agent session list; presets CRUD (seeded: Claude Code, Codex, shell); API tokens CRUD; `POST /api/fleet/run` (exec on device). WS `/api/ws/events` pushes device online/offline/stats and session changes.

## Fleet tools for agents (the "senior agent")

MCP tools (stdio server proxying the hub REST API with an API token): `list_devices`, `list_sessions`, `create_session` (device, name, cwd, command), `send_input` (session keystrokes via tmux send-keys), `read_output` (last N lines via tmux capture-pane), `run_command` (sync exec), `kill_session`. The same operations exist as `overseer fleet` subcommands. Worker devices may hold scoped API tokens so agents can coordinate.

## Security

- First-run setup page sets admin password (argon2id). HttpOnly SameSite session cookies; login rate-limited.
- Per-device random 32-byte tokens, stored hashed. Enrollment tokens single-use, 15-min expiry, hashed.
- API tokens for CLI/MCP, hashed, revocable in UI.
- Default bind `0.0.0.0:4200`, plain HTTP with a prominent warning; docs push Tailscale (recommended) or a TLS reverse proxy for internet exposure. Single port keeps that trivial.

## Storage

SQLite via pure-Go driver (keeps cross-compilation CGO-free): `settings`, `devices`, `enroll_tokens`, `presets`, `api_tokens`. tmux is the source of truth for sessions (no session table); hub keeps an in-memory cache per connected device.

## Error handling

Agent reconnects forever with backoff; offline devices grey out with last-seen. Hub restart → agents reconnect, tmux sessions untouched. Agent crash → service auto-restarts, tmux sessions survive. Exec/file ops carry timeouts and size caps.

## Testing

Go unit tests (protocol framing/mux, store, auth); integration test booting hub + agent in-process over loopback and round-tripping enroll → exec → session create/list. CI cross-compiles darwin/linux × amd64/arm64 and builds the UI.

## Repo layout

```
cmd/overseer/            main + subcommands
internal/protocol/       message types + framing
internal/hub/            server, api, auth, store, agent conns, ws bridges, installer
internal/agent/          conn loop, tmux/pty, stats, fs, exec, enroll, service install
internal/fleet/          REST client (CLI + MCP)
internal/mcp/            stdio MCP server
ui/                      React app (embedded into the binary at build time)
```
