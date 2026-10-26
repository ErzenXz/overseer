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
    name: string           // bash | read | edit | write | grep | glob | webfetch | websearch | mcp | todo | agent | other
    title: string
    status: 'running' | 'completed' | 'error'
    input?: string         // command line, path, query … (display string)
    output?: string        // truncated to 64 KiB by the agent
    files?: { path: string; additions?: number; deletions?: number; diff?: string }[]
    agent?: {              // a subagent run (name 'agent'); status is the run's state
      type?: string        // "Explore", "general-purpose", a Codex role
      name?: string        // nickname, when the agent has one (Codex)
      task?: string        // one-line description
      prompt?: string      // the brief, clipped
      result?: string      // the subagent's final report
      model?: string
      tools?: number       // tool calls so far
      tokens?: number
      durationMs?: number  // as reported by the agent
      background?: boolean // runs past the call that started it
    }
  }
  parentId?: string        // a subagent's own step: id of the tool message that runs it
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
- `thread.event` `{threadId, event: {id, role, text?, append?: boolean, tool?, plan?, approval?, turn?, durationMs?, parentId?}}`
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
- Subagents: Claude's `Task` / `Agent` tool and Codex's spawned agents become one
  `tool` message (`name: "agent"`, `tool.agent` filled in as events arrive, `status` =
  the run). Their own tool calls are ordinary `tool` messages whose creating event
  carries `parentId` (Claude: `parent_tool_use_id`; Codex: events of the child thread);
  a subagent's text and reasoning are not stored, its final report is `agent.result`.
  Claude `task_started` / `task_progress` / `task_notification` system events update the
  running totals and end a background run. Codex reads `collabAgentToolCall`
  (`spawnAgent`, `wait`, …), `subAgentActivity` and the child's `thread/started`
  (nickname, role). Older agents and hubs never send these fields; clients ignore them.
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

## Plan usage limits

Subscription agents (Claude Code on Pro/Max, Codex on ChatGPT plans) have
rolling usage limits: a short window (Claude "5-hour", Codex "primary") and a
long one (weekly; Claude also reports a separate weekly Opus limit on some
plans). Overseer shows them in Settings → Usage & Limits and in the composer's
context popover. Values come only from each CLI's own reporting on the machine;
credentials never leave the device.

```
GET /api/usage/limits[?refresh=1][&all=1]
  → { "accounts": [ PlanLimits ] }

PlanLimits = {
  "deviceId": "...", "deviceName": "erzen-dev",
  "agent": "claude" | "codex" | ...,
  "plan": "Max 20x" | "Pro" | "Plus" | "Team" | "",   // when the CLI reports it
  "account": "you@example.com" | "",                    // when the CLI reports it
  "windows": [
    { "id": "five_hour" | "seven_day" | "seven_day_opus" | "primary" | "secondary" | string,
      "label": "5-hour" | "Weekly" | "Weekly (Opus)" | ...,
      "usedPercent": 0-100,            // may exceed 100 when over the limit
      "resetsAt": 1792500000,          // unix seconds, omitted when unknown
      "windowMinutes": 300 }           // omitted when unknown
  ],
  "status": "ok" | "warning" | "limited",   // limited = currently blocked
  "fetchedAt": 1792496000,                  // unix seconds of the reading
  "source": "live" | "session",             // asked the CLI now / seen in a session event
  "error": "not signed in" | ...            // set instead of windows when unavailable
}
```

- One entry per (device, agent) where the agent is installed and signed in
  with a subscription. API-key-only setups (and 3P providers such as Bedrock)
  report `error: "api key (no plan limits)"`, signed-out CLIs
  `error: "not signed in"`; both are omitted unless `?all=1`. Other errors
  (`"timed out"`, a CLI too old to report limits, ...) are listed. `windows`
  is always an array (`[]` with an error). Sorted by device name, then agent.
- The hub caches readings for 5 minutes per (device, agent) and only asks a
  device about its stale agents; `?refresh=1` re-asks every online device
  (bounded: 4 s per device, devices in parallel; concurrent requests share one
  read per device). A device that fails to answer is not asked again until
  the 5 minutes pass. A failed read keeps the previous reading (numbers, or a
  definite api-key / not-signed-in answer) instead of replacing it with the
  error. Offline devices keep listing their last reading for 24 h after its
  `fetchedAt`.
- `status`: `limited` when a window is at or above 100 %, or the CLI says
  usage is blocked (Claude `locked_reason` / `rate_limit_event` status
  `rejected`; Codex `rateLimitReachedType` set or `ordinaryUsageAllowed:
  false`); `warning` at or above 80 % (or Claude `allowed_warning`).
- Rate-limit events seen during sessions (Codex `account/rateLimits/updated`,
  Claude's rate-limit messages in stream-json) update the cache immediately and
  are pushed as `{ "type": "usage.limits", "deviceId", "agent" }` on
  `/api/ws/events`. The cache already holds the new numbers, so clients
  re-read **without** `?refresh=1` (which would start CLI probes on every
  device). Session readings are partial: they are merged into the cached
  reading by window id (other windows, plan and account are kept).
- Thread `usage` gains nothing new; the composer reads limits for the thread's
  `(deviceId, agent)` from this endpoint.

Window ids and labels:

- Claude: `five_hour` "5-hour" (300 min), `seven_day` "Weekly",
  `seven_day_opus` "Weekly (Opus)", `seven_day_sonnet` "Weekly (Sonnet)",
  `seven_day_oauth_apps` "Weekly (apps)" (10080 min each, only those the
  account has), plus per-model weekly buckets the CLI lists under
  `model_scoped` as `seven_day_<name>` "Weekly (<Name>)". `plan` is the CLI's
  subscription name without "Claude " (e.g. "Team", "Max").
- Codex: `primary` / `secondary` as the CLI reports them; the label comes from
  `windowDurationMins` ("5-hour", "Weekly", "Daily", "N-day", ...), because
  the slots are not fixed (a Pro account reports a single weekly window as
  `primary`). Extra metered buckets (`rateLimitsByLimitId` other than `codex`)
  use ids `<limitId>.primary` / `<limitId>.secondary` and labels like
  "5-hour (<limitName>)". `plan` from `planType` ("Plus", "Pro", "Team",
  "Business", ...).

### Device side

```
hub → device  usage.limits         { "agents": ["claude","codex"] }   // omitted = all
              → { "accounts": [ PlanLimits ] }   // not installed = left out; no deviceId/deviceName
device → hub  usage.limits.update  PlanLimits (source "session", only the windows the event carried)
```

The device reads limits without sending a prompt (no model usage), both CLIs
in parallel within 3.5 s, and kills the probe process afterwards:

- Claude Code: `claude --print --input-format stream-json --output-format
  stream-json --verbose --settings {"disableAllHooks":true}
  --no-session-persistence --strict-mcp-config --mcp-config {"mcpServers":{}}`
  in an empty temp dir, then the control requests `initialize` (for
  `account.subscriptionType` / `account.email`) and
  `{"subtype":"get_usage","skip_behaviors":true}` (the data behind `/usage`:
  `rate_limits.{five_hour,seven_day,...}.{utilization 0-100, resets_at ISO}`).
  In sessions: `{"type":"rate_limit_event","rate_limit_info":{status,
  rateLimitType, utilization 0-1, resetsAt, unifiedWindows}}`.
- Codex: `codex app-server`, `initialize`, then `account/read` (type, email,
  planType) and `account/rateLimits/read` (`{"excludeResetCreditDetails":true}`).
  In sessions: the `account/rateLimits/updated` notification (a sparse
  `rateLimits` snapshot).
- ACP agents report nothing (the protocol has no limits).

Only the fields above are sent to the hub. Overseer never reads the CLIs'
credential files or calls usage endpoints itself; account ids, credit
balances and organisation names in the CLI answers are dropped on the device.

## Agent catalog (auto-detected agents)

The agents Overseer knows are no longer a fixed list. The hub builds one
catalog from three sources and every machine reports which of them it has:

1. **Built-in**: claude and codex (native adapters), and the ACP agents that
   existed before (gemini, opencode, goose, copilot, cursor) with their ids
   unchanged.
2. **The ACP registry** (`https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json`):
   fetched by the hub at start and every 24 h (hourly retry after a failure;
   20 s timeout, 2 MB cap), cached in the data dir (`agent-registry.json`,
   loaded first) so it works offline. Malformed entries are skipped; a
   download with no usable entry never replaces the cache. Registry entries
   whose id duplicates a built-in agent update its name/icon/description only (registry `github-copilot-cli` → `copilot`,
   `cursor` → `cursor`, `gemini` → `gemini`, `goose`, `opencode`). The
   registry's `claude-acp` and `codex-acp` adapters are skipped: Overseer drives
   those CLIs natively.
3. **Custom agents** the user adds (name + command line), stored on the hub.

Order: built-ins, then registry agents by name, then custom agents by
creation. `acp` is not a catalog entry.

```
GET /api/agents/catalog
  → [ CatalogAgent ]

CatalogAgent = {
  "id": "devin",                       // stable; registry id unless built-in
  "name": "Devin",
  "vendor": "Cognition",               // registry authors[0], when present
  "description": "Devin CLI coding agent by Cognition",
  "icon": "https://…/devin.svg",       // registry icon; built-ins only when the registry lists them
  "website": "https://docs.devin.ai/cli",
  "protocol": "native" | "acp",
  "source": "builtin" | "registry" | "custom",
  "bins": ["devin"],                   // executables that mean "installed"
  "args": ["acp"],                     // ACP launch arguments for bins[0]
  "install": "npm install -g @scope/pkg" | "",   // npx dists → npm -g hint; binary dists → website
  "login": "devin auth login" | ""     // when known
}

POST   /api/agents/custom   { "name": "My agent", "command": "my-agent --acp" }  → CatalogAgent (id "custom-<slug>")
DELETE /api/agents/custom/{id}                                                   → { "ok": true } | 404
```

Custom agents: `name` 1–80 characters; `command` must split into at least
one word with the same quoting rules the device uses (single/double quotes,
backslash escapes), else 400. The slug is the lower-cased name with runs of
other characters as `-` (`-2`, `-3`… when taken). `bins` is the command's
first word, `args` the rest, `description` the command line.

Detection of `bins` (and `args`) comes from the first distribution present,
in the order binary, npx, uvx:
- binary distributions: the basename of the registry `cmd` (`/` or `\`
  separated) without extension or platform suffix (`./bin/devin` → `devin`,
  `./bin\devin.exe` → `devin`, `./dist-package\cursor-agent.cmd` →
  `cursor-agent`, `./pool-darwin-arm64` → `pool`), unique across platforms;
  `args` are those of the first platform in the order darwin-aarch64,
  darwin-x86_64, linux-x86_64, linux-aarch64, windows-x86_64, windows-aarch64.
- npx distributions: the package's last path segment without version
  (`@compass-ai/nova@1.1.59` → `nova`) plus a small override table for
  packages whose command differs (`@google/gemini-cli` → `gemini`,
  `@github/copilot` → `copilot`, `@qwen-code/qwen-code` → `qwen`,
  `@augmentcode/auggie` → `auggie`, `@xai-official/grok` → `grok`,
  `droid` → `droid`, `@qoder-ai/qodercli` → `qodercli`, `cline` → `cline`,
  `@minimax-ai/code` → `mcode`, `dirac-cli` → `dirac`, `@kilocode/cli` →
  `kilo`; checked against each package's npm `bin`).
- uvx distributions: the package name without version.

`install` is `npm install -g <package>` when the agent has an npx
distribution, else `uv tool install <package>` for uvx, else empty (binary
distributions: the UI links `website`). `login` is known for `devin`
(`devin auth login`) and the built-ins.

`GET /api/devices/{id}/agents` (existing) now returns one entry per catalog
agent (`{id, installed, version?}`, in catalog order) plus `acp` last. The
hub sends the catalog's `(id, bins)` list with `agents.detect`
(`{"agents": [{"id", "bins"}]}`); older devices ignore it and report the
built-ins, and the hub fills the rest in as not installed. An agent is
installed when any of its `bins` is in PATH; version is the first found
bin's `<bin> --version` (2 s budget each, at most 8 at once, only for
installed agents). The hub caches the answer per device for 30 s (reset when
the catalog changes; `?refresh=1` skips it).

Starting a thread with a catalog ACP agent: the hub resolves the id to
`command = bins[0] + args` (or the custom command) and sends
`thread.start {agent: id, command}`; the device runs it with the ACP adapter
whenever `agent` isn't a native adapter and `command` is set. Built-in ACP
agents are sent without a command and keep the device's own launch rules
(e.g. gemini's `--acp` / `--experimental-acp` fallback). The command is
resolved at every start, not stored on the thread. Validation (threads and
automations): `agent` must be a catalog id (or `acp` with a command).

Agent options (`/agents/{agent}/options`) work for every ACP catalog agent via
the existing ACP discovery.

## Skills & plugins

One page shows what extends each agent on each machine: skills, plugins and
their marketplaces, slash commands, subagents, rules/memory files, hooks,
MCP servers and output styles. Research behind this (exact CLI commands,
control-protocol and app-server methods, file locations) lives in
`docs/research/skills-plugins.md`.

### Item

```ts
type ExtKind = 'skill' | 'plugin' | 'marketplace' | 'command' | 'subagent' | 'rule' | 'hook' | 'extension' | 'mcp_server' | 'output_style'
type ExtScope = 'user' | 'project' | 'local' | 'plugin' | 'managed' | 'system' | 'builtin' | 'synced' | 'session'

interface ExtItem {
  key: string            // stable, opaque: identifies the item for item/toggle/uninstall/share calls
  agent: string          // catalog id: claude, codex, devin, opencode, gemini, …
  kind: ExtKind
  name: string           // "nextjs"
  qualifiedName: string  // as the agent invokes it: "vercel:nextjs"
  displayName?: string
  description?: string
  scope: ExtScope
  projectPath?: string   // project/local scope
  path?: string          // the file that defines it (SKILL.md, agent .md, manifest, settings file)
  parentId?: string      // plugin id for plugin-provided items; marketplace for plugins
  version?: string
  enabled: boolean | null          // null: no on/off concept
  state?: 'on' | 'off' | 'name-only' | 'user-invocable-only' | 'needs-auth' | 'error' | 'untrusted' | 'disabled_by_admin'
  lockedBy?: 'plugin' | 'policy' | 'managed'   // read-only, with the reason
  invocation?: { user: boolean; model: boolean; argumentHint?: string }
  source?: { type: string; repo?: string; url?: string; path?: string; ref?: string; package?: string }
  mcp?: { transport: string; command?: string; url?: string; authStatus?: string; toolCount?: number }  // never env or header values
  hook?: { event: string; matcher?: string; handlerType: string; command?: string; trust?: string }
  sharedWith?: string[]  // other agents that read the same real path (computed on the device)
  cost?: { alwaysOnTokens?: number; onInvokeTokens?: number }
  usage?: { count?: number; lastUsedAt?: string }
  errors?: string[]
}
```

### HTTP

```
GET  /api/devices/{id}/extensions[?cwd=/project][&refresh=1]
  → { items: ExtItem[], agents: [{ agent, ok, version?, error? }], fetchedAt }
     One entry per installed agent that has anything to report. Hub caches
     60 s per (device, cwd); writes below invalidate it. ~8 s budget.

GET  /api/devices/{id}/extensions/item?key=…
  → { item: ExtItem, content?: string, frontmatter?: Record<string, unknown> }
     content: the defining file (SKILL.md, agent/command .md, rule file),
     ≤ 64 KB, only for files the inventory itself reported.

POST /api/devices/{id}/extensions/toggle     { key, enabled }      → { item, note? }
POST /api/devices/{id}/extensions/uninstall  { key }               → { ok, note? }
POST /api/devices/{id}/extensions/install    { agent, id, scope: 'user'|'project'|'local', cwd?, acceptCommand? }
  → { item?, note?, needsApproval?: { command: string, sha: string } }
     Claude plugins (`plugin@marketplace`) and Codex plugins. A marketplace
     entry that runs a command returns needsApproval first; the UI shows the
     command and repeats the call with acceptCommand: sha after the user agrees.
GET  /api/devices/{id}/extensions/catalog?agent=claude|codex[&q=]
  → { entries: [{ id, name, description?, category?, marketplace?, installCount?, installed: boolean,
                  hasSkills?, hasMcp?, hasHooks?, source? }] }

POST /api/devices/{id}/skills  { name, description, body?, scope: 'user'|'project', cwd?, agents: string[] }
  → { item }   writes <root>/.agents/skills/<name>/SKILL.md (user: ~/.agents/skills)
               and links it into each chosen agent's own skill dir when that
               agent doesn't read .agents/skills (claude: ~/.claude/skills or
               .claude/skills). name: [a-z0-9-]{1,64}; description ≤ 1024.
POST /api/devices/{id}/skills/share  { key, agents: string[] }  → { item }
     Same linking for an existing skill; copies when symlinks fail (Windows).
```

`note` is a short message for the UI such as "Takes effect in new sessions".

### Rules

- Read-only for `managed`, `system`, `builtin`, `synced` and `lockedBy` items;
  plugin-provided Claude skills toggle through their plugin.
- Never return env values, headers, tokens, `auth.json`, credential files or
  `oauthAccount`. MCP items carry transport, command/url and tool count only.
- Never auto-accept marketplace commands (`-y`/`--accept-command`) without the
  UI's `acceptCommand`.
- Removing a user-authored skill moves its folder to a `.trash/` folder next
  to it (`~/.agents/skills/.trash/`, `~/.claude/skills/.trash/`, …), together
  with any links other agents had to it; nothing is deleted. Removing a link
  (Claude's view of a shared skill) keeps the shared copy.
- Don't run `claude mcp list/get` (spawns servers) or anything that sends a
  prompt.

### Implementation notes

- **Device messages.** The hub forwards each call as one request:
  `extensions.list {cwd?, detect}`, `extensions.item {key}`,
  `extensions.toggle {key, enabled}`, `extensions.uninstall {key}`,
  `extensions.install`, `extensions.catalog {agent, q?}`, `skills.create`,
  `skills.share` (bodies as above; `detect` is the hub's agent catalog).
- **Keys** are `agent:kind:scope:qualifiedName[:projectPath]` with each part
  query-escaped; the UI treats them as opaque. The device resolves every
  key against a fresh (≤ 2 min) inventory, re-taking one when needed, so
  item/toggle/uninstall/share only ever reach files and settings the
  inventory reported. Unknown keys answer 404.
- **Sources.** Claude: a headless `claude` with hooks off, no MCP servers and
  no session saved, asked `initialize`, `get_skills_dialog`,
  `get_hooks_listing` and `get_memory_dialog` (no prompt), plus
  `claude plugin list --json`, `claude plugin marketplace list --json` and the
  settings / `.mcp.json` / `~/.claude.json` (`mcpServers`, `projects`,
  `skillUsage`, `pluginUsage` only) files. Codex: a short-lived
  `codex app-server` (`skills/list`, `plugin/list` local marketplaces,
  `hooks/list`, `config/read`; MCP servers come from config only, since
  `mcpServerStatus/list` would start every server to count its tools).
  Devin: `devin skills list --json` and its `mcp_config*.json` files. Every
  installed agent's skill, command, subagent and rule folders are scanned
  (frontmatter only). Agents run in parallel with ~6 s each; a failing
  source sets `agents[].ok: false` with `error` and the other items stay.
- **Sharing and duplicates.** `sharedWith` lists the other installed agents
  that read the same real path (symlinks resolved). Claude, Codex and Devin
  each report their own items; agents that are only scanned on disk
  (OpenCode, Gemini, Cursor, Copilot, Goose, Amp, Kimi, Qwen) add an item
  only when no other agent already reports that real path.
- **Claude MCP servers** come from config files only (user, local
  `projects[cwd]`, project `.mcp.json`, plugins), so claude.ai connectors are
  not listed. A `.mcp.json` server that was never approved is
  `enabled: false, state: 'untrusted'`. Claude's own on/off states for skills
  are `state` (`on`, `off`, `name-only`, `user-invocable-only`); `enabled` is
  false only for `off`.
- **Toggle** works for Claude plugins (`claude plugin enable|disable -s`),
  Claude user skills (`skillOverrides` in `~/.claude/settings.json`) and
  project skills (the project's `.claude/settings.local.json`, as `/skills`
  does), Codex skills (`skills/config/write`), Codex plugins and MCP servers
  (`config/value/write`) and Devin MCP servers (`devin mcp enable|disable
  -s`). Turning a Claude skill on removes its override (or writes `on` when
  another settings layer turns it off). Everything else answers 400.
- **Install approval.** The device passes `--accept-command <sha>` only when
  `acceptCommand` equals the sha the CLI itself showed for the same plugin,
  scope and cwd in the last 30 minutes; otherwise the CLI runs without it and
  any command comes back as `needsApproval` again. `-y` is never passed.
  Codex installs are user scope only and take no `acceptCommand`.
- **Catalog.** Claude: `claude plugin list --json --available` plus the
  installed plugins (the CLI leaves them out of `available`). Codex: the
  local marketplaces of `plugin/list` (the remote ChatGPT app directory is
  left out). `q` filters on id, name, description and category.
- **Skills.** `POST /skills` returns the Claude item when Claude is among
  `agents`, else the first agent's. Share skips agents that already read the
  skill's real path, refuses (409) when a target already has a different
  skill of that name, and refuses folders that resolve outside the known
  skill folders. A project's skill folder must resolve inside the project.
- **Errors.** 400 invalid or refused (read-only, locked, CLI failure), 404
  unknown device or item, 409 name conflict, 502 device too old or
  disconnected, 503 device offline, 504 the device did not answer in time.
  Writes drop the hub's cached inventories for that device (a
  `needsApproval` answer does not).

## Where it runs (folders, branches, safe starts)

### Folder info

`POST /api/devices/{id}/git-info` with `{paths: string[]}` (1 to 32 paths;
`~` is expanded on the device) returns what that machine has at each path:

```json
{"home": "/Users/me", "paths": [{
  "path": "~/code/api", "resolved": "/Users/me/code/api",
  "exists": true, "isRepo": true, "root": "/Users/me/code/api",
  "branch": "main", "detached": false,
  "remote": "https://github.com/acme/api.git", "remoteKey": "github.com/acme/api",
  "dirty": 2
}]}
```

`remoteKey` is `host/owner/repo` for any ssh or https remote URL (credentials
are dropped), so the same repo on two machines compares equal. `dirty` counts
changed and untracked entries and is left out when `git status` was too slow;
`branch` is a short commit when `detached`. No git installed, or not a work
tree, answers `isRepo: false`. The check is bounded: a few `git -C <path>`
calls per path, each under 3 seconds, 8 seconds overall. An offline device
answers 503, an agent that predates this op 502.

Hub ↔ agent: request `git.info` (`protocol.GitInfoRequest`), reply
`protocol.GitInfoResult`.

### Starting a session safely

`POST /api/threads` accepts an optional `clientRequestId` (8 to 64 letters,
digits, `-` or `_`). The hub stores it with the session: a second request with
the same id returns the first session (header `Idempotent-Replayed: true`)
instead of starting another one, even when the two race. The id is only
remembered once the session exists, so a start refused with 503 (device
offline) can be retried with the same id.

`GET /api/sessions/by-request/{key}` → `{found: boolean, thread: Thread | null}`.
`found: false` is a definite "nothing was started" (the lookup waits for a start
that is still in flight with that key). The UI uses it after a lost connection:
found goes to the session, not found shows "Didn't start", and an unreachable
hub shows "Start status unknown". Retry always reuses the same key.

`lastSeen` on a device is written on connect and disconnect, and at most once a
minute while connected, so it stays close to the truth if the hub itself dies.

## Shared session links (replay and live watch)

A session can be shared as a link, `<hub URL>/s/<token>`, that opens with no
login. The token is 32 random bytes (base64url, 43 characters); only its
SHA-256 is stored, so the full link is shown once, when it is created.

**Manage (needs the hub login):**

- `GET /api/shares/info` → `{baseUrl, private, docsUrl}`. `private` is true when
  the hub's own address is only reachable locally (localhost, LAN IP, `.local`,
  Tailscale `100.64/10` or `.ts.net`); the share dialog then explains that only
  people who can reach the hub can open the link.
- `POST /api/shares` `{threadId, mode: "replay"|"live", hideNames?: true,
  expires?: "1d"|"7d"|"never"}` (default `hideNames` true, `expires` `7d`) →
  `{share, token, url, private}`. A replay stores a frozen, already-sanitised
  snapshot; later turns are not in it.
- `GET /api/shares` → every share with its session title, `mode`, `hideNames`,
  `createdAt`, `expiresAt` (0 = never), `views`, `expired`. Shares of deleted
  sessions are dropped.
- `DELETE /api/shares/{id}` revokes at once.

**Public (no auth, no cookies, rate limited per client):**

- `GET /s/{token}` serves the UI bundle with a server-rendered `<title>`,
  `og:*` and `twitter:*` tags (for example "Claude Code fixed flaky auth tests
  in 2m 10s · Overseer"), `noindex`, and `no-referrer`. Revoked, expired and
  unknown tokens answer 404 with "This link has expired".
- `GET /api/public/shares/{token}` → `{mode, hideNames, expiresAt, thread,
  summary, messages}`. `thread` has only title, agent, agentName, model, status,
  error, timestamps and, when names are shown, deviceName and cwd.
  `?peek=1` does not count a view.
- `GET /api/public/shares/{token}/stream` (live links only) is server-sent
  events: `snapshot` (the same body as above), then `message` `{message}` and
  `thread` `{thread}` as the session changes, and `end` `{reason}`. A revoked
  link ends open streams within 10 seconds.

What a public viewer never gets: approvals and questions, queued messages,
image paths, usage and cost, pull request links, ids of the session or machine,
and any other API. Every string goes through best-effort secret redaction (GitHub,
OpenAI/Anthropic and other provider keys, AWS key ids, JWTs, private keys,
bearer tokens, `user:pass@` URLs, and `password=` / `token=` / `api_key` values)
and, when `hideNames` is on, the machine name, hostname and session folder are
replaced ("the machine", relative paths) and home directories become `~`.
Output is capped per message.

## Agent Wrapped (usage stats)

`GET /api/stats?range=week|month|all&tz=Europe/Berlin` summarises what the
agents did. `week` is the last 7 local calendar days (today included), `month`
the last 30, `all` everything since the first session. `start` and `end` (unix
seconds) pick a custom range instead. `tz` is an IANA zone and sets the day
boundaries (default UTC). The numbers come from the threads and thread
messages tables in one pass, so it stays fast on large stores.

Response (all lists are `[]` when empty): `range`, `start`, `end`, `tz`,
`sessions` `{started, finished}`, `turns` (prompts sent), `agentMs` and
`agentHours` (time agents spent working, from turn durations), `prs`
`{opened, merged}` (the thread's PR, or PRs the agent opened with `gh pr
create` / the GitHub MCP tools), `lines` `{added, removed}` and `files`
(successful edits), `approvals` (answered), `tokens` `{input, output}` and
`costUsd` (for sessions active in the range), `agents[]` and `machines[]`
(`id`, `name`, `sessions`, `turns`, `agentMs`, `added`, `removed`, `prs`,
sorted by time worked, so the first is the MVP), `days[]` (`date`, `sessions`,
`turns`, `agentMs`, `lines`), `busiestDay`, `topSession` (most lines changed),
`longestSession` (most time working), `streak` `{current, longest}` (days in a
row with a prompt) and, except for `all`, `previous` (the totals of the period
right before, for "up 28%").

## Agent Arena

One prompt, 2 to 4 agents, each in its own git worktree of the same commit
(`~/.overseer/worktrees/arena/<arenaId>/<n>-<agent>`, branch
`arena/<arenaId>/<agent>`). Uncommitted changes in the folder are not copied.
Contestants are ordinary sessions (sidebar folder "Arena"). The hub measures
each one when it stops (files, lines, optional check command).

- `POST /api/arenas` `{title?, prompt, deviceId, cwd, check?, access?, contestants:[{agent, model?, effort?, fast?, deviceId?, cwd?}]}`
  returns the arena at once; contestants start in parallel. Other machines
  need a clone of the same remote (checked by remote URL).
- `GET /api/arenas`, `GET /api/arenas/{id}`: `status` is `preparing | running | finished`;
  each contestant has `state` (`preparing | running | checking | done | failed`),
  `thread`, `stats` `{files, additions, deletions}` and `check` `{exitCode, output}`.
- `POST /api/arenas/{id}/winner` `{contestant, action: "pr" | "apply" | "keep"}`:
  `pr` pushes the branch and runs `gh pr create` on that machine; `apply` writes
  the changes into the original folder only when it has no uncommitted changes
  (otherwise 409 with `code: "dirty"`); `keep` commits to the branch.
- `GET /api/arenas/{id}/patch?contestant=n`: the changes as a patch file.
- `POST /api/arenas/{id}/cleanup` `{confirm: true, includeWinner?}` removes the
  other worktrees and branches (only under the arena's own folder).
- `POST /api/arenas/{id}/stop`, `DELETE /api/arenas/{id}` (forgets the record only).

Machine side: one hub -> agent request, `arena.op`, with an `action`
(`inspect`, `create`, `stats`, `check`, `commit`, `pr`, `apply`, `patch`, `remove`).

## Teams

A hub can have more than one person. The admin password every hub has becomes
the first `owner` when the hub starts (idempotent; nothing is lost, and people
sign in again because browser sessions live in memory and reset on every
restart). Owners invite `member`s with one-time links.

- `GET /api/me` adds `multiUser` (more than one person: sign-in needs a name)
  and, when signed in, `user` `{id, name, email?, role, ...}`.
- `POST /api/login` `{name?, password}`: with one person the password is
  enough; with more, `name` (case-insensitive) is required. A wrong name, a
  wrong password and a disabled account all answer the same 401.
- `GET /api/users`: everyone, including removed people (`removed: true`, kept
  so old sessions still show their name). Emails are only for owners.
- Owner only: `PATCH /api/users/{id}` `{name?, email?, role?, disabled?}`,
  `DELETE /api/users/{id}`, `GET|POST /api/invites` (`{label?}`; the link is in
  the response once, only its hash is stored, valid 7 days),
  `DELETE /api/invites/{id}`, `GET /api/audit?limit=&before=` (newest first;
  `next` is the `before` for the next page, 0 at the end). The hub always keeps
  one owner who can sign in (409 otherwise).
- Also owner only: API tokens, `PATCH /api/updates`, update install and
  rollback, `PUT /api/previews/config`, adding and removing machines.
  An API token acts as an owner.
- `PATCH /api/me` `{name?, email?}`, `POST /api/me/password` `{current, password}`
  (signs the person out everywhere else).
- Public, rate limited, same-origin only: `GET /api/invites/{token}`,
  `POST /api/invites/{token}/accept` `{name, password, email?}` (joins as a
  member and signs in; a taken name doesn't spend the invite).
- Sessions carry `createdBy`, `assignee`, `handoffBy`, `handoffNote`,
  `handoffAt` (user ids). `POST /api/threads/{id}/assign` `{to, note?}` hands a
  session to a teammate (their copy becomes unread, so it shows in Needs you).
- Approval messages carry `answeredBy` (a name) once someone answers.
- The session websocket (`/api/ws/threads/{id}`) also sends
  `{"type":"presence","users":[{id,name}]}` whenever someone opens or closes
  the session.

## Chat apps (Telegram, Slack, Discord, webhook)

Owner-only settings API, used by Settings → Chat apps. Secrets are write-only: responses carry them masked.

- `GET /api/chat/apps` lists the four integrations (`telegram`, `slack`, `discord`, `webhook`) with status (`off | connecting | connected | error`), masked tokens, linked chat, allowed user ids, events (`approval`, `question`, `finished`, `failed`) and machine filter.
- `PUT /api/chat/apps/{kind}` saves settings. Token fields (`botToken`, `appToken`, `webhookUrl`, `webhookSecret`) are only changed when non-empty; `enabled`, `channel`, `allowedUsers`, `events`, `machines`, `hideAlways` as needed.
- `DELETE /api/chat/apps/{kind}` forgets the tokens and closes open prompts.
- `POST /api/chat/apps/telegram/connect` makes a one-time code (10 minutes) the user sends the bot as `/start <code>`.
- `POST /api/chat/apps/{kind}/test` sends a test message.

The hub dials out (Telegram long polling, Slack Socket Mode, Discord gateway), so no public URL is needed. Only the linked chat or channel, and allowed user ids, can answer. Answers use the same `sendApproval` / `sendAnswer` helpers as `POST /api/threads/{id}/approval` and `/answer`, and are noted in the transcript as "via Telegram" (etc.). Each prompt is claimed once; later presses are refused.

Webhook events are JSON `POST`s (`type`, `at`, `text`, `session`, `machine`, `agent`, `title`/`command`, `question`, `summary`, `error`, `links.open`) with an optional `X-Overseer-Signature: sha256=<hmac>` header.

## Scheduled sessions, guardrails and continue in another agent

### Scheduled sessions

A session saved with everything needed to start it, plus a trigger. The hub starts it through the same path as `POST /api/threads` (same validation, same `clientRequestId` idempotency), so a start that is retried never runs twice. Table: `scheduled_sessions`.

- `GET /api/scheduled[?all=1]` lists waiting, starting and failed ones, soonest first (`all` adds started ones, kept three days).
- `POST /api/scheduled` takes the `POST /api/threads` body (`deviceId`, `agent`, `cwd`, `prompt`, `images: [{path}]`, `model`, `effort`, `fast`, `mode`, `access`, `title`, `clientRequestId`) plus `trigger` and optionally `source: {repo, branch, known?}`. With `source` the machine gets that GitHub branch ready (`git.prepare`) when the session starts, and `cwd` is ignored.
- `trigger` is `{"kind":"time","at":<unix seconds>}` (up to a year ahead, not in the past) or `{"kind":"limit_reset","threshold"?:90}`. The second waits for the agent's plan limit on that machine: among the windows that are used up (else at or above `threshold`), the one that resets last. The row stores the window and the expected reset (`trigger.window`, `trigger.resetsAt`) and `startsAt` is that time plus 30 s. At that time the hub asks the machine again; if the window is still limited it waits for the new reset time. A model-specific window (Claude's `seven_day_opus`) only counts for that model. 400 when no limit is known or it is not high.
- A machine that is offline when a session is due is waited for; the row says so in `note` ("Waiting for X to come online").
- `PATCH /api/scheduled/{id}` changes any of the fields above (a failed row is queued again). `DELETE` cancels. `POST /api/scheduled/{id}/start` starts it now, skipping the trigger and any guardrail, and answers with the row (`threadId` set) or 202 while a checkout is still being prepared.
- Rows: `id`, `status` (`waiting | starting | started | failed`), `reason` (`guardrail` when held), `trigger`, `startsAt`, `note`, `threadId`, `error`, `deviceName`, `deviceOnline`, and the payload fields.
- Events: `schedule.changed`, `schedule.started` (carries `threadId`).

### Guardrails

Per agent that reports plan limits (`claude`, `codex`), stored in the `guardrails` setting. Off by default; they watch the weekly window.

- `GET /api/guardrails` and `PUT /api/guardrails` (a partial map is merged): `{"claude":{"holdEnabled":false,"holdPercent":90,"pauseEnabled":false,"pausePercent":98}}`. Percentages are 1 to 100.
- Hold: when the weekly window is at or above `holdPercent`, `POST /api/threads` answers **202** `{"held":true,"scheduled":{…},"message":"…"}` instead of starting. The request is saved as a scheduled session (`reason: "guardrail"`) that starts when the limit resets, and the same `clientRequestId` finds the same row. Starts from automations and the MCP endpoint are not held.
- Pause: every 15 s the hub stops the running turns (the same cancel as the Stop button; sessions stay) of that agent on a machine whose weekly window is at or above `pausePercent`. A turn is paused once; a status line says why. Send a message to carry on.
- `GET /api/guardrails/notices` lists what a guardrail did or a scheduled start that failed (`kind`: `hold | pause | failed`), until `DELETE /api/guardrails/notices/{id}`. Event: `guardrail.notice`.

### Continue in another agent

- `POST /api/threads/{id}/continue/preview` `{agent?, note?, messageId?}` builds the handoff prompt from the transcript: the original goal, the turns so far (older ones condensed), files changed (the recorded edits plus `git diff --stat` and `git status --short` from the machine when it can be read), the current plan, the last error and what is left. `messageId` limits it to the conversation up to that turn. Reply: `{prompt, title, files, stats}`.
- `POST /api/threads/{id}/continue` `{prompt, agent, model?, effort?, fast?, mode?, title?, deviceId?, cwd?, clientRequestId?}` starts the new session with the (edited) prompt, on the same machine and folder by default, and links the two (table `thread_continuations`; a status line in both transcripts). Answers the new thread, or 202 when a guardrail holds it.
- `GET /api/threads/{id}/continue` returns `{from: {id,title,agent,status} | null, to: [...]}` for the "Continued from / in" chips.

## Issue autopilot and before/after screenshots

**Autopilot.** A repo is opted in explicitly (`POST /api/autopilot/repos` needs `"acknowledge": true`). Every ~2 minutes (jittered) the hub runs `gh issue list --label <label>` on the repo's GitHub machine. A new issue becomes a row in `autopilot_runs` (unique on repo + number, so it never runs twice, restarts included). It runs only if whoever added the label owns the repo or has write access (`trust: "writers"`, default) or is the signed-in GitHub user (`"me"`); anything else is `skipped` and waits for `POST /api/autopilot/runs/{id}/approve`. Issue text is untrusted: the prompt fences it with a random marker and leaves out comments from people without write access. Lifecycle: `queued → preparing → working → finishing → pr_open → merged|closed`, or `failed`/`skipped`. Preparing labels the issue `overseer:working`, optionally comments, makes a worktree on `overseer/issue-<n>-<slug>` (`git.prepare` with `createFrom`) and starts a session (`clientRequestId` `ap-<run>-<attempt>`). Finishing sends `autopilot.finish` to the machine: commit what is left (never `.env`, keys), push (never forced), reuse or open the pull request (`Fixes #n`, optional "Built with Overseer" footer), then swap the label to `overseer:done` (or `overseer:failed` plus a comment). Endpoints: `GET /api/autopilot`, `PATCH|DELETE /api/autopilot/repos/{id}`, `POST /api/autopilot/repos/{id}/poll`, `POST /api/autopilot/runs/{id}/retry|approve|stop`, `GET /api/autopilot/clones?repo=`, `GET /api/autopilot/by-thread/{id}`.

**Screenshots.** When a web server runs inside a session's own folder, the hub asks that machine (`screenshot.capture`, headless Chrome, Chromium or Edge) for a picture when it first appears (before) and when a turn ends (after); phone size is optional. Pictures live in the hub database (4 per session at most, 1.5 MB each). `GET /api/threads/{id}/shots` lists them, `GET /api/shots/img/{id}` serves one to signed-in users, `POST /api/threads/{id}/shots {kind}` takes one by hand, `GET|PUT /api/shots/config` holds the switches. When a pull request exists for the session (autopilot or `/pr`) and the hub has a public https address, a comment with the pictures is added; they are served from `GET /api/shots/pub/{token}.png|jpg` (128-bit token, 180 days). Without a public https address the reason is shown in the UI and nothing is posted.
