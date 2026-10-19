# Agent sessions, desktops, automations and MCP — API contract

This is the contract between the hub (Go), the device agent (Go) and the web UI
(`ui/`). The UI codes against exactly these shapes; the dev mock in
`ui/src/mock.ts` implements the same endpoints.

The design follows CodeInk's adapter model: every coding agent is driven over
its own native machine protocol on the device, and each adapter normalises it
into one small event set. The hub folds those events into stored messages and
pushes only what changed to the browser.

## Concepts

- **Thread** — one conversation with one coding agent, running on one machine,
  in one working directory. Shown in the sidebar as a "session".
- **Message** — one folded item of a thread (user text, assistant text, a
  thought, a tool call, a plan, an approval request, an error).
- **Terminal session** — the existing tmux session model. A thread may own a
  shell (`thread.terminal`) that the UI shows in its Shell tab.
- **Desktop** — a VNC server on a machine, tunnelled through the agent
  connection (no inbound ports needed).

## Agents (device side adapters)

| id         | how it is driven                                                                 |
|------------|-----------------------------------------------------------------------------------|
| `claude`   | `claude --print --input-format stream-json --output-format stream-json --verbose --include-partial-messages --permission-prompt-tool stdio --permission-mode <mode> [--model M] [--resume ID]` |
| `codex`    | `codex app-server` (JSON-RPC over stdio: `initialize`, `thread/start`, `turn/start`, …) |
| `gemini`   | ACP: `gemini --acp` (fallback `gemini --experimental-acp`)                         |
| `opencode` | ACP: `opencode acp`                                                              |
| `goose`    | ACP: `goose acp`                                                                 |
| `copilot`  | ACP: `copilot --acp`                                                             |
| `cursor`   | ACP: `cursor-agent acp`                                                          |
| `acp`      | ACP: any custom command line given in `command`                                  |

ACP client details: `initialize {protocolVersion: 1, clientCapabilities: {fs:
{readTextFile: true, writeTextFile: true}, terminal: false}}`, then
`session/new {cwd, mcpServers}`; prompts with `session/prompt`; `session/cancel`
to stop; `session/request_permission` becomes an `approval` message.

`mcpServers` passed to `session/new` (and written as `--mcp-config` for Claude,
`-c mcp_servers.*` for Codex) come from the hub's MCP registry below, so MCP
servers configured once in the UI reach every agent on every machine.

## Access levels

`access`: `ask` (read-only / plan), `edits` (auto-accept edits, ask for
commands), `auto` (agent decides), `full` (no prompts). Mapped per agent:

- claude: ask→`plan`, edits→`acceptEdits`, auto→`auto`, full→`bypassPermissions`
- codex: ask→`read-only`, edits/auto→`on-request`+`workspace-write`, full→`never`+`danger-full-access`
- ACP: permission requests are surfaced to the UI unless `full` (auto-pick `allow_once`).

## Types (JSON)

```ts
type ThreadStatus = 'starting' | 'working' | 'waiting' | 'idle' | 'error' | 'stopped'

interface Thread {
  id: string
  title: string
  deviceId: string
  deviceName: string
  agent: string            // adapter id from the table above
  command?: string         // only for agent "acp"
  cwd: string
  model?: string
  access: 'ask' | 'edits' | 'auto' | 'full'
  status: ThreadStatus
  error?: string
  createdAt: number        // unix seconds
  updatedAt: number
  lastReadAt: number       // unread when updatedAt > lastReadAt
  terminal?: string        // tmux session name used by the Shell tab
  pr?: { url: string; number: number; state: 'open' | 'merged' | 'closed' | 'draft'; checks?: 'passing' | 'failing' | 'pending' }
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number }
  automationId?: string
}

interface ThreadMessage {
  id: string               // stable key; events with the same id fold together
  seq: number              // hub-assigned, increasing per thread
  at: number               // unix ms of first event
  updatedAt: number        // unix ms of last event
  role: 'user' | 'assistant' | 'thought' | 'tool' | 'plan' | 'approval' | 'error' | 'status'
  text: string
  turn?: string            // id of the user message this belongs to
  tool?: {
    name: string           // bash | read | edit | write | grep | glob | webfetch | websearch | mcp | todo | other
    title: string
    status: 'running' | 'completed' | 'error'
    input?: string         // command line, path, query … (display string)
    output?: string        // truncated to 64 KiB by the agent
    files?: { path: string; additions?: number; deletions?: number; diff?: string }[]
  }
  plan?: { content: string; status: 'pending' | 'in_progress' | 'completed' }[]
  approval?: {
    id: string
    title: string
    detail?: string
    options: { id: string; label: string; kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' }[]
    resolved?: string      // chosen option id
  }
  durationMs?: number      // on the final assistant message of a turn: "Worked for 1m 33s"
}
```

## HTTP

All under `requireAuth`.

| method + path | body | returns |
|---|---|---|
| `GET /api/threads` | — | `Thread[]` sorted by `updatedAt` desc |
| `POST /api/threads` | `{deviceId, agent, command?, cwd, prompt, model?, access?, title?}` | `Thread` (starts the agent, sends `prompt`) |
| `GET /api/threads/{id}` | — | `{thread: Thread, messages: ThreadMessage[]}` |
| `PATCH /api/threads/{id}` | `{title?, access?, model?, read?: true}` | `Thread` |
| `DELETE /api/threads/{id}` | — | `{ok: true}` (stops the agent, deletes history) |
| `POST /api/threads/{id}/prompt` | `{text}` | `{ok: true}` (restarts/resumes the agent if it is not running) |
| `POST /api/threads/{id}/cancel` | — | `{ok: true}` |
| `POST /api/threads/{id}/approval` | `{approvalId, optionId}` | `{ok: true}` |
| `GET /api/agent-kinds` | — | `{id, name, protocol: 'native'|'acp', models?: string[]}[]` |
| `GET /api/devices/{id}/agents` | — | `{id, installed: boolean, version?: string}[]` (which adapters' CLIs exist on that machine) |
| `GET /api/devices/{id}/desktop` | — | `{available: boolean, port: number, reason?: string}` (probes 127.0.0.1:5900–5903 on the device) |
| `GET /api/mcp-servers` | — | `McpServer[]` |
| `POST /api/mcp-servers` | `McpServer` without id | `McpServer` |
| `PATCH /api/mcp-servers/{id}` | partial | `McpServer` |
| `DELETE /api/mcp-servers/{id}` | — | `{ok: true}` |
| `GET /api/automations` | — | `Automation[]` |
| `POST /api/automations` | `Automation` without id/run fields | `Automation` |
| `PATCH /api/automations/{id}` | partial | `Automation` |
| `DELETE /api/automations/{id}` | — | `{ok: true}` |
| `POST /api/automations/{id}/run` | — | `Thread` (runs now) |

```ts
interface McpServer {
  id: string
  name: string
  transport: 'stdio' | 'http'
  command?: string; args?: string[]; env?: Record<string, string>   // stdio
  url?: string; headers?: Record<string, string>                    // http
  enabled: boolean
  builtin?: boolean        // the hub's own /mcp endpoint, always present
}

interface Automation {
  id: string
  name: string
  prompt: string
  deviceId: string
  agent: string
  cwd: string
  access: 'ask' | 'edits' | 'auto' | 'full'
  schedule: string         // 5-field cron, evaluated in the hub's local time zone
  enabled: boolean
  createdAt: number
  lastRunAt?: number
  lastThreadId?: string
  nextRunAt?: number
}
```

## WebSockets

- `GET /api/ws/threads/{id}` — server pushes `{type: 'message', message: ThreadMessage}`
  for every changed message and `{type: 'thread', thread: Thread}` when the
  thread record changes. On connect it first sends `{type: 'snapshot', thread,
  messages}`.
- `GET /api/ws/events` — existing hub events plus `{type: 'threads.changed'}`.
- `GET /api/ws/desktop?device={id}&port={port}` — raw binary bridge to the
  device's VNC TCP port (websockify-compatible: each binary WS frame is a chunk
  of the TCP stream). The UI uses noVNC on top of it.

## Hub ↔ agent protocol additions

Requests (hub → agent, reply `result`):
- `thread.start` `{threadId, agent, command?, cwd, model?, access, resumeId?, mcpServers}` → `{resumeId?}`
- `thread.prompt` `{threadId, text}` → `{}` (returns when the turn is accepted, not finished)
- `thread.cancel` `{threadId}`
- `thread.approval` `{threadId, approvalId, optionId}`
- `thread.stop` `{threadId}`
- `agents.detect` `{}` → `{agents: {id, installed, version?}[]}`
- `desktop.probe` `{}` → `{available, port, reason?}`

Notifications (agent → hub, no id):
- `thread.event` `{threadId, event: {id, role, text?, append?: boolean, tool?, plan?, approval?, turn?, durationMs?}}`
  — `append: true` appends `text` to the stored message with the same id;
  otherwise fields are merged/replaced.
- `thread.state` `{threadId, status, error?, resumeId?, usage?}`

Streams:
- `tcp.open` (carries Channel) `{host: '127.0.0.1', port}` → agent replies `tcp.opened` or `tcp.close` with error; binary frames on the channel carry the TCP bytes both ways; either side sends `tcp.close` to end it.

## Implementation notes (hub + agent, additive to the above)

These are clarifications from the Go implementation. Nothing above changed
shape; everything here is optional or extra.

- `Automation` also accepts optional `command?` (required when `agent` is
  `acp`) and `model?`. `enabled` defaults to `true` on create. `nextRunAt` is
  recomputed on every create/PATCH; a run missed while the hub was down fires
  once on the next scheduler tick (every 30 s), then the schedule resumes.
  Cron also accepts month/weekday names (`jan`, `mon-fri`), weekday `7` for
  Sunday, and `@hourly`/`@daily`/`@weekly`/`@monthly`/`@yearly`.
- `{type: 'threads.changed'}` also carries `threadId`. Updates are debounced
  to at most one per 500 ms per thread (trailing edge, so the final state is
  always announced); create and delete are immediate.
- Built-in MCP entry: id `builtin`, `enabled` defaults to `false`, only
  `enabled` is PATCHable, DELETE returns 400. Listings show the URL only. When
  enabled, `thread.start` includes it with an `Authorization: Bearer` header
  for a dedicated API token the hub mints on first use (shown in the tokens
  list as "Built-in MCP (coding agents)"; revoking it makes the hub mint a new
  one).
- `thread.state`: only `threadId` is required; empty fields mean unchanged
  (adapters send `resumeId` and `usage` on their own).
- Events whose first sight has no `role` get one inferred (`tool`, `plan`,
  `approval`, else `status`). New messages without `turn` are stamped with
  the latest user message id. Stored tool output is capped at 64 KiB.
- A turn that produced no assistant text ends with a `status` message
  (`"Done"`, or `"Cancelled"`) carrying `durationMs`.
- Thread status: `stopped` is also what in-flight threads show after a hub
  restart; the next prompt restarts and resumes the agent. Start failures set
  `error` and also append an `error` message. If resuming the stored agent
  session fails, the hub starts a fresh session and appends a `status`
  message saying so. Changing `access` or `model` via PATCH restarts (and
  resumes) the agent before the next prompt.
- `POST /api/threads/{id}/approval` returns 409 for an unknown approval or
  option. `POST /api/threads` returns 503 when the device is offline.
- `GET /api/devices/{id}/agents` always includes `{id: 'acp', installed: true}`.
- When a thread first starts on a device with tmux, the hub creates a tmux
  session `thread-<first 8 chars of id>` in the thread's cwd and sets
  `thread.terminal`; deleting the thread kills it.
- `/api/ws/desktop` defaults `port` to 5900 and ends with a WebSocket close
  frame whose reason is the error text (e.g. connection refused).
