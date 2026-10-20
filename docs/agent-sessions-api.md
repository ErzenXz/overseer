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

## Agent options (models, thinking, speed, modes)

Agents differ: Claude Code has permission modes (plan, accept edits, bypass…),
Codex has approval policies × sandboxes plus a plan collaboration mode, ACP
agents advertise their own modes and config options. So the UI never assumes
a shared set; it asks the machine what each agent supports.

`GET /api/devices/{id}/agents/{agent}/options[?refresh=1]` → `AgentOptions`

```ts
interface AgentOptions {
  agent: string
  source: 'discovered' | 'builtin'   // builtin = static fallback when discovery failed
  models: { id: string; label: string; description?: string; efforts?: string[]; defaultEffort?: string; default?: boolean }[]
  efforts: { id: string; label: string; description?: string }[]   // thinking levels; [] = not supported
  fast?: { label: string; description: string }                    // present only when the agent has a fast/priority option
  modes: { id: string; label: string; description: string; kind: 'readonly' | 'plan' | 'ask' | 'edits' | 'auto' | 'full' }[]
  defaultMode: string
}
```

- `models[].efforts` narrows `efforts` for that model when the CLI reports it.
- `kind` lets the UI pick icons and map the legacy `access` field; `id` is the
  agent's own value and is passed through untouched.
- The hub caches results per device+agent for 10 minutes; `refresh=1` bypasses.
  Discovery never sends a prompt (no quota use): Claude via the stream-json
  `initialize` control request, Codex via app-server `model/list`, ACP via
  `initialize` + `session/new` (modes, models, configOptions), then the
  probe process is stopped.

Builtin fallbacks (used when discovery fails or the CLI is missing):

| agent | modes (id → kind) | efforts | fast |
|---|---|---|---|
| claude | `default`→ask, `acceptEdits`→edits, `plan`→plan, `auto`→auto, `bypassPermissions`→full | low, medium, high, max | Fast mode (`--settings {"fastMode":true}`) |
| codex | `read-only`→readonly, `plan`→plan, `on-request`→ask, `auto`→auto, `full-access`→full | minimal, low, medium, high | Fast (service tier) |
| ACP | from `session/new` `modes.availableModes`; else a single `default`→ask | from a `thought_level` config option | — |

### Thread fields

`Thread` gains `effort?: string`, `fast?: boolean`, `mode?: string` (the
agent-native mode id). `POST /api/threads` and `PATCH /api/threads/{id}`
accept them. When `mode` is empty the legacy `access` value is mapped as
before; when `mode` is set, `access` is derived from the mode's `kind`
(readonly/plan→ask, ask→edits… see the adapter) for older UIs.

Changing `mode` mid-session applies live where the CLI allows it (Claude
`set_permission_mode` control request, ACP `session/set_mode`, Codex per
turn); `model`, `effort` and `fast` apply from the next turn (restarting and
resuming the agent when the CLI needs it).

### Implementation notes (agent options)

Additive; no shape above changed.

- `GET …/agents/acp/options` also accepts `?command=<command line>` (the
  custom ACP agent's command, required to discover it; without it the
  builtin table is returned). Unknown agent or device → 404. An offline
  device, or a device that fails or times out, → the builtin table with 200
  (a failed request is cached for 1 minute instead of 10).
- `models[].efforts` is `[]` when the CLI reports thinking levels for other
  models but none for this one (e.g. Claude Haiku); it is omitted when the
  CLI reports nothing per model (ACP).
- Claude: the model id `default` is the CLI's own default (no `--model`
  flag). `auto` is kept only when some model reports `supportsAutoMode`.
  Switching live into `bypassPermissions` is refused by the CLI unless it
  was launched in it, so that change restarts the agent instead.
- Codex: model and effort go on every `turn/start` (`model`, `effort`), fast
  as `serviceTierForTurn` (the tier id from `model/list` `serviceTiers`,
  normally `priority`), the mode as `approvalPolicy` + `sandboxPolicy` (+
  `approvalsReviewer: auto_review` for `auto`), and `plan` as
  `collaborationMode {mode: 'plan', settings: {model, reasoning_effort}}`.
  `plan` is dropped from the list when `collaborationMode/list` has no plan
  mode. None of these changes restart Codex.
- ACP: modes come from `modes.availableModes` or a `configOptions` entry
  with category `mode` (OpenCode uses the latter); models from
  `models.availableModels` or category `model`; efforts from category
  `thought_level`. Kinds are guessed from the mode id/name. They are applied
  with `session/set_mode` / `session/set_model` or
  `session/set_config_option {configId, value}` accordingly. The probe
  session is removed with `session/delete` (or `session/close`) when the
  agent advertises it. Gemini takes the model as a flag, so a model change
  restarts it.
- When `mode` is set, `access` is derived from the kind: readonly/plan→ask,
  ask/edits→edits, auto→auto, full→full.

Hub ↔ agent additions:
- `agent.options` `{agent, command?}` → `AgentOptions` (never an error; the
  device falls back to builtin itself after a 20 s discovery timeout).
- `thread.start` also carries `effort?`, `fast?`, `mode?`.
- `thread.update` `{threadId, model?, effort?, fast?, mode?, access}` →
  `{restart?: boolean}`: the device applies what it can live; `restart`
  means the hub stops the agent and starts it again (resuming) before the
  next prompt. `thread not running` means the next start picks up the new
  settings.
- Devices now reply to request types they don't know with an error result
  instead of ignoring them.

## Session organisation and native agent features

### Thread fields

`Thread` also has `pinned?: boolean`, `archived?: boolean`, `folder?: string`
(a free-form label the sidebar can group by), `parentId?: string` (set on
forks/child sessions), and `usage.contextTokens?` / `usage.contextWindow?`
(latest context fill, when the agent reports it). `PATCH /api/threads/{id}`
accepts `pinned`, `archived`, `folder` (empty string clears), and `read:
false` to mark a thread unread again (sets `lastReadAt` to 0). `GET
/api/threads` returns archived threads too; the UI filters them.

### Actions

| method + path | body | returns | notes |
|---|---|---|---|
| `POST /api/threads/{id}/fork` | `{messageId?, title?}` | `Thread` (new, `parentId` set) | Native fork where the CLI has one: Codex `thread/fork`, Claude `--resume <id> --fork-session`, ACP `session/fork` if advertised. Otherwise a fresh session whose first prompt carries a compact transcript up to `messageId`. Does not send a new user prompt. |
| `POST /api/threads/{id}/compact` | — | `{ok}` | Codex `thread/compact/start`; Claude sends `/compact`; ACP sends `/compact` when it is in the agent's commands, else 409. |
| `POST /api/threads/{id}/undo` | — | `{ok}` | Drops the last turn: Codex `thread/rollback {numTurns: 1}`; elsewhere 409 `not supported by <agent>`. Removes that turn's messages from the stored transcript. |
| `GET /api/threads/{id}/commands` | — | `{name, description, hint?}[]` | The agent's own slash commands: ACP `available_commands_update`, Claude `slash_commands` from `system/init`, Codex built-ins (`/review`, `/compact`, …) plus `skills/list` when available. Cached from the running session; `[]` if none. |
| `POST /api/threads/{id}/answer` | `{questionId, answers: string[], text?}` | `{ok}` | Replies to a `question` message (below). |
| `GET /api/threads/{id}/capabilities` | — | `{fork, compact, undo, steer, images, commands, review}` booleans | What this thread's agent supports, so the UI only shows working actions. |

### Prompts

`POST /api/threads/{id}/prompt` (and `POST /api/threads`) accept
`images?: {path: string}[]` — files already uploaded to that machine (the
composer uploads to `<cwd>/.overseer/uploads`). Adapters read them on the
device and send them natively (ACP/Claude image blocks, Codex `localImage`).

Sending a prompt while the agent is working **steers** the running turn where
supported (Codex `turn/steer`, Claude streaming input); otherwise it is queued
and sent when the turn ends. Queued prompts appear as `user` messages with
`queued: true` until sent.

### New message role: `question`

```ts
// ThreadMessage with role 'question'
question?: {
  id: string
  text: string
  options: { id: string; label: string; description?: string }[]
  multiple?: boolean
  allowText?: boolean      // free-form answer allowed
  answered?: string[]      // chosen option ids / text, once answered
}
```

Produced from Claude `AskUserQuestion` (via `can_use_tool`), Codex
`item/tool/requestUserInput`, and ACP elicitation-style permission requests
that carry questions. Status is `waiting` while unanswered.

### Implementation notes (session features)

Additive; no shape above changed.

- Codex 0.161's app-server has no `thread/rollback`; undo uses
  `thread/revert {threadId, beforeTurnId}` with the latest turn from
  `thread/turns/list`. Undo and compact return 409 while the agent is
  working. After undo the hub re-sends a `snapshot` on the thread socket
  (message events can't express removals).
- Fork copies the kept messages (whole turns through the one containing
  `messageId`; queued prompts are left out) into the new thread, which starts
  `idle` with `folder` and settings inherited. On its first prompt the
  device forks natively when it can: Codex `thread/fork` (cut with
  `thread/revert` at the turn whose user message carries our message id as
  `clientUserMessageId`), Claude `--resume <id> --fork-session` (whole
  session only), ACP `session/fork` when `sessionCapabilities.fork` (whole
  session only). Otherwise, or when the parent never started, the first
  prompt is prefixed with a compact transcript.
- Prompts carry the hub message id; Codex gets it as `clientUserMessageId`.
  Codex prompts `/review [instructions]` and `/compact` map to `review/start`
  (uncommitted changes, or custom instructions) and `thread/compact/start`;
  `/<skill>` becomes Codex's `$<skill>` mention.
- Queue vs steer follows `capabilities.steer` (Claude and Codex steer; ACP
  queues). A queued prompt is sent when the thread goes idle and then moves
  to the end of the transcript (new `seq`), where its turn starts.
- Images: paths may be relative to the thread's cwd; the device only reads
  png/jpeg/gif/webp files under the cwd or home, at most 10 per prompt and
  20 MB each. ACP agents that don't advertise `promptCapabilities.image`
  answer 409.
- Questions: Claude `AskUserQuestion` (one `question` message per entry,
  option ids are the labels, answered via `updatedInput.answers`); Codex
  `item/tool/requestUserInput` (one per question, `answers[id].answers`); ACP
  `elicitation/create` (form mode, advertised as `clientCapabilities.
  elicitation.form`): one question per schema field, enums become options,
  booleans Yes/No, other types free text. `POST …/answer` returns 409 for an
  unknown question or option.
- Context fill: Claude from the latest assistant message's input tokens
  (+cache) and `modelUsage[].contextWindow`; Codex from
  `tokenUsage.last.totalTokens` and `modelContextWindow`; ACP from
  `usage_update {used, size}`.
- Capabilities and commands are reported by the device after start (and
  when an ACP agent updates its commands) and stored with the thread; before
  that the hub answers with per-agent defaults.

Hub ↔ agent additions: `thread.start` also takes `fork?`, `forkAt?` and
replies `forkFallback?`; `thread.prompt` also takes `messageId?`, `images?`
(paths); new requests `thread.compact` / `thread.undo` `{threadId}` and
`thread.answer` `{threadId, questionId, answers, text?}`; `thread.state` may
carry `capabilities` and `commands`. Errors containing `not supported by`
become 409s.

## Live previews (dev servers on any machine)

An agent (or you) starts a dev server on a machine, say Vite on `localhost:5173`
on `erzen-dev`. Overseer shows it live in the browser through the hub, with no
ports opened on the machine. The hub reverse-proxies HTTP and WebSockets (HMR)
over the existing device connection using the loopback-only TCP tunnel
(`tcp.open`), so only `127.0.0.1` / `::1` on the device is reachable.

### Preview origins

Each preview gets its own origin so apps that use absolute paths (`/@vite/client`,
`/_next/...`) and HMR work unchanged:

```
https://{port}-{slug}.{previewDomain}/      e.g. https://5173-erzen-dev.example.com/
```

- `slug` is the device name lowercased, non `[a-z0-9]` runs replaced by `-`,
  trimmed, max 40 chars (`machine` if nothing is left). If two devices share a slug, the later one (by
  `createdAt`) gets `-` plus the first 4 chars of its id. The label
  `{port}-{slug}` is at most 63 chars.
- `previewDomain` comes from, in order: the `--preview-domain` flag, the
  `previewDomain` setting, else derived from the hub's public URL host:
  `overseer.example.com` → `example.com`; `localhost` / `127.0.0.1` →
  `localhost` (browsers resolve `*.localhost` to loopback, so local use needs no
  setup); a bare IP or a two-label host such as `example.com` with no subdomain →
  none (previews unavailable, the UI shows setup help and `overseer forward`).
- Cloudflare Tunnel setup: add a public hostname `*.example.com` → the same
  service as the hub (e.g. `http://localhost:4200`). Universal SSL covers one
  wildcard level, which is why the label is `{port}-{slug}` rather than nested.
  Explicit DNS records keep working; the wildcard only catches the rest.
  With `--tls-domain` the hub only holds a certificate for its own name, so
  HTTPS previews need a front that has the wildcard (a tunnel or proxy).
- The hub's public URL (used for deriving and for the auth redirect) is the
  address the UI was last used from: it is recorded on sign-in and on
  `GET /api/previews/config`.
- The hub routes by `Host`: a request whose host is `{label}.{previewDomain}`
  and whose label parses as `{port}-{slug}` is a preview request; everything else
  is the normal app/API. `{label}.localhost` is always accepted as well, so
  local previews work whatever the configured domain. The hub's own host is
  never treated as a preview. When the hub is reached on an explicit port
  (`:4200`), preview URLs use the same port.

### Auth for preview origins

Preview origins never see the hub session cookie (it is host-only). Instead:

1. `GET https://5173-erzen-dev.example.com/any/path` without a valid
   `overseer_preview` cookie → `302` to
   `https://{hub}/api/previews/auth?return={full preview URL}`.
2. That endpoint requires the hub session (unauthenticated → `302` to
   `/login?next={this path and query}`; after signing in the UI should
   `location.assign(next)` when `next` starts with `/api/previews/auth?`).
   It checks `return` is a preview origin of this hub on the same scheme and
   port the hub was reached on, without user info (else `400`), mints a
   one-time token (random 32 bytes, valid 60 s, bound to that preview host) and
   `302`s to `{return}` with `__overseer_preview={token}` added to the query.
3. The preview host accepts the token once, sets `overseer_preview` (HttpOnly,
   Secure when the request is https, SameSite=Lax, host-only, Path=/, 12 h,
   bound to that host), and `302`s to the same URL without the token.

Preview cookies are revoked on logout (all of them) and checked on every
request, WebSocket upgrades included. Without a valid cookie only a plain
`GET`/`HEAD` is redirected; other methods and WebSocket upgrades get `401`.
WebSocket upgrades must come from a preview origin of this hub (or send no
`Origin`), else `403`. Because preview pages are same-site with the hub,
cookie-authenticated `POST`/`PUT`/`PATCH`/`DELETE` to the hub API are refused
(`403`) when their `Origin` is not the hub itself. Same-site iframes (the Preview panel) get
the Lax cookie because the preview host and the hub share a registrable domain.

### Proxy behaviour

- Upstream is `http://127.0.0.1:{port}` on the device (falls back to `[::1]`
  if the first dial is refused). `Host` is rewritten to `localhost:{port}`,
  `Origin` (if present) to `http://localhost:{port}`, and `Referer` likewise, so
  dev servers' host checks (Vite `allowedHosts`, Next, Django `ALLOWED_HOSTS`)
  pass. `X-Forwarded-Host`, `X-Forwarded-Proto` and `X-Forwarded-For` are set.
- The `overseer_preview` and `overseer_session` cookies and the
  `__overseer_preview` query parameter are stripped before forwarding, as is
  an `Authorization: Bearer` that is a hub API token. The app's own cookies
  and `Authorization` headers pass through.
- Responses: `Location` headers that point at `localhost:{port}`,
  `127.0.0.1:{port}` or `[::1]:{port}` are rewritten to the preview origin.
  `X-Frame-Options` is removed and a CSP `frame-ancestors` directive is dropped,
  so the Preview panel can frame it. Nothing else is changed (no body
  rewriting); responses stream (no buffering, `FlushInterval: -1`).
- WebSocket upgrades are proxied (HMR). Idle connections stay open.
- Upstream unreachable → a small HTML page (`502`) saying nothing is listening
  on that port on that machine yet, which reloads itself every 2 s, so a preview
  opened before the server is up appears as soon as it starts.
- Device offline → the same page with "machine offline" (`503`).

### HTTP

```
GET  /api/previews/config
  → { "domain": "example.com" | "", "source": "flag"|"setting"|"derived"|"none",
      "hubHost": "overseer.example.com", "secure": true }

PUT  /api/previews/config        { "domain": "example.com" }   (""→ derive)
  → same as GET. Validates it is a hostname (or "localhost") and not an IP.

GET  /api/devices/{id}/ports
  → [ PortInfo ]   (live from the device, typically ~1 s, 3 s timeout;
                    503 offline, 502 if the agent is too old)

PortInfo = {
  "port": 5173,
  "address": "127.0.0.1" | "0.0.0.0" | "::" | "::1",
  "pid": 4242,                        // omitted when unknown
  "process": "node",                  // short name, omitted when unknown
  "command": "vite --port 5173",      // trimmed to 200 chars, omitted when unknown
  "cwd": "/home/me/school-site",      // omitted when unknown
  "http": true,                       // answered an HTTP request within 800 ms
  "title": "School website",          // <title> of GET / when http, ≤120 chars
  "previewUrl": "https://5173-erzen-dev.example.com/"   // "" when no domain
}

GET  /api/previews/auth?return=URL   (see Auth above; browser navigation only)
```

Ports list rules (device side): TCP sockets in LISTEN state bound to loopback
or a wildcard address; skip the agent's own process and ports ≤ 1023 except 80;
skip ports whose process is a known system service (`sshd`, `systemd*`,
`cupsd`, `rpcbind`, `mDNSResponder`, `ControlCenter`, `rapportd`, `launchd`,
`Xvnc`/`x11vnc`/`websockify` and the device's VNC port). Linux reads
`/proc/net/tcp{,6}` and maps inodes through `/proc/*/fd`; macOS uses
`lsof -nP -iTCP -sTCP:LISTEN -FpcnTt` (`t` tells IPv4 from IPv6 wildcards); Windows uses `GetExtendedTcpTable`
(through gopsutil) plus the process image name and command line (no `cwd`). HTTP probing runs in
parallel, at most 8 at a time. Results sorted: http first, then by port.

Thread `previewPorts`: none. The UI matches ports to a session by `cwd`
(process cwd inside the thread's folder) when known.

### Forwarding to your own computer (no DNS needed)

```
overseer forward <machine> <port> [--local <port>] [--hub URL]
```

Listens on `127.0.0.1:{local}` (default: the same port, or the next free one)
and tunnels every connection to `localhost:{port}` on that machine through the
hub, using the CLI's saved login (`overseer fleet login`, or `OVERSEER_HUB` /
`OVERSEER_TOKEN`; `--hub` overrides the URL). Prints the local URL and
runs until Ctrl-C. Hub endpoint, authenticated like the other `/api/ws/*`
endpoints (session cookie or `Authorization: Bearer`):

```
WS /api/ws/devices/{id}/tcp/{port}     binary frames both ways = raw TCP bytes
```

Closing either side closes the other. The hub refuses ports outside 1–65535
(`400`) and, before upgrading, answers `503` when the machine is offline and
`502` (with the device's error) when nothing listens.

### Events

`{ "type": "ports.changed", "deviceId": "..." }` may be sent when the device
notices listeners appear or disappear (it re-scans every 3 s only while a client
has asked for that device's ports in the last 30 s). The UI also polls
`GET /api/devices/{id}/ports` every 4 s while a Ports or Preview view is open.
