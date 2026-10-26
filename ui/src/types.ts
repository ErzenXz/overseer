export interface Stats {
  cpuPercent: number
  cpuCores: number
  load1: number
  load5: number
  load15: number
  memUsed: number
  memTotal: number
  swapUsed: number
  swapTotal: number
  diskUsed: number
  diskTotal: number
  netRxBytes: number
  netTxBytes: number
  processCount: number
  uptimeSec: number
  // Metrics the agent could not collect in this snapshot (newer agents only).
  unavailable?: ('cpu' | 'load' | 'memory' | 'swap' | 'disk' | 'uptime' | 'network' | 'processes')[]
}

export interface Device {
  id: string
  name: string
  hostname: string
  os: string
  arch: string
  isHub: boolean
  createdAt: number
  lastSeen: number
  online: boolean
  tmux: boolean
  agentVersion?: string
  platform?: string
  platformVersion?: string
  kernelVersion?: string
  stats?: Stats
}

export interface Project {
  id: string
  name: string
  deviceId: string
  path: string
  createdAt: number
  updatedAt: number
}

export interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
  truncated?: boolean
}

export interface SetupTool {
  id: 'node' | 'codex' | 'claude' | 'gemini' | 'tailscale'
  name: string
  description: string
  installed: boolean
  version?: string
  auth: 'missing' | 'ready' | 'connected' | 'not-required' | 'unknown'
  installCommand: string
  authCommand?: string
  note?: string
  docsUrl: string
}

export interface SetupOverview {
  os: string
  arch: string
  tools: SetupTool[]
  bundleCommand: string
}

export interface Session {
  name: string
  kind: string
  status: 'working' | 'idle' | 'exited'
  createdAt: number
  lastActivity: number
  attached: boolean
  ephemeral: boolean
}

export interface FleetSession extends Session {
  deviceId: string
  deviceName: string
}

export interface Preset {
  id: number
  name: string
  command: string
  kind: string
}

export interface ApiTokenInfo {
  id: number
  name: string
  createdAt: number
}

export interface UpdateStatus {
  currentVersion: string
  latestVersion?: string
  rollbackVersion?: string
  updateAvailable: boolean
  autoUpdate: boolean
  managed: boolean
  checking: boolean
  applying: boolean
  lastChecked?: number
  error?: string
  fleetTotal: number
  fleetOutdated: number
  service?: {
    supervisor?: 'systemd' | 'launchd'
    unit?: string
    binary?: string
    issues?: { id: string; text: string; fix: string }[]
    snippet?: string
  }
}

// One release's notes, parsed by the hub from CHANGELOG.md. Bullets keep
// inline markdown (bold, code, links).
export interface ReleaseNotes {
  version: string
  date?: string
  intro?: string
  groups: { title: string; items: string[] }[]
}

// GET /api/updates/notes: notes for releases newer than the running one, and
// the running release's own. Both are empty for dev builds or when GitHub
// can't be reached.
export interface UpdateNotes {
  currentVersion: string
  latestVersion?: string
  newer: ReleaseNotes[]
  current: ReleaseNotes | null
}

export interface FsEntry {
  name: string
  dir: boolean
  size: number
  mode: string
  modTime: number
}

export interface FsListing {
  path: string
  entries: FsEntry[]
}

// ---- Where it runs (see docs/agent-sessions-api.md) ----

// One folder as a machine sees it: POST /api/devices/{id}/git-info.
export interface GitPathInfo {
  path: string
  resolved: string
  exists: boolean
  isRepo: boolean
  root?: string
  branch?: string
  detached?: boolean
  remote?: string
  // The same repo on any machine, e.g. "github.com/acme/api".
  remoteKey?: string
  // Changed and untracked files; missing when it could not be read in time.
  dirty?: number
}

export interface GitInfoResult {
  home: string
  paths: GitPathInfo[]
}

// ---- GitHub source for a new session (internal/hub/github.go, gitprepare.go) ----

export interface GitHubRepo {
  nameWithOwner: string
  description?: string
  updatedAt?: string
  isPrivate: boolean
  isFork?: boolean
  defaultBranch?: string
}

export interface GitHubBranch {
  name: string
  isDefault?: boolean
  pr?: { number: number; title: string; draft?: boolean }
}

// Every GitHub answer. status is "ok", or why not: the GitHub CLI is missing
// (no-gh), not signed in (no-auth), the repo is unknown (not-found) or other.
export interface GitHubReply {
  status: 'ok' | 'no-gh' | 'no-auth' | 'not-found' | 'error'
  message?: string
  login?: string
  repos?: GitHubRepo[]
  branch?: string // a branch named in a pasted link
  defaultBranch?: string
  branches?: GitHubBranch[]
  more?: boolean // the repo has more branches than listed
}

export interface GitPrepareResult {
  action: 'reuse' | 'worktree' | 'clone'
  path: string
  branch: string
  home?: string
  source?: string // the clone a worktree hangs off
  note?: string
}

export interface GitPrepareJob {
  key: string
  state: 'running' | 'done' | 'failed'
  result?: GitPrepareResult
  error?: string
}

export interface HubEvent {
  type: 'device.online' | 'device.offline' | 'device.stats' | 'sessions.changed' | 'threads.changed'
  deviceId?: string
  stats?: Stats
}

// ---- Agent threads (see docs/agent-sessions-api.md) ----

export type Access = 'ask' | 'edits' | 'auto' | 'full'
export type ThreadStatus = 'starting' | 'working' | 'waiting' | 'idle' | 'error' | 'stopped'

export interface PullRequestRef {
  url: string
  number: number
  state: 'open' | 'merged' | 'closed' | 'draft'
  checks?: 'passing' | 'failing' | 'pending'
}

export interface Thread {
  id: string
  title: string
  deviceId: string
  deviceName: string
  agent: string
  command?: string
  cwd: string
  model?: string
  access: Access
  effort?: string
  fast?: boolean
  mode?: string
  status: ThreadStatus
  error?: string
  createdAt: number
  updatedAt: number
  lastReadAt: number
  terminal?: string
  pr?: PullRequestRef
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number; contextTokens?: number; contextWindow?: number }
  automationId?: string
  pinned?: boolean
  archived?: boolean
  folder?: string
  parentId?: string
  // Teams: user ids of who started it and who has it now, and the last hand-off.
  createdBy?: string
  assignee?: string
  handoffBy?: string
  handoffNote?: string
  handoffAt?: number
}

export interface ThreadCapabilities {
  fork: boolean
  compact: boolean
  undo: boolean
  steer: boolean
  images: boolean
  commands: boolean
  review: boolean
}

export interface AgentCommand {
  name: string
  description: string
  hint?: string
}

export interface ToolFile {
  path: string
  additions?: number
  deletions?: number
  diff?: string
}

// A subagent run: the tool call itself is the row, its own steps are
// messages whose parentId is that row's id.
export interface ToolAgent {
  type?: string
  name?: string
  task?: string
  prompt?: string
  result?: string
  model?: string
  tools?: number
  tokens?: number
  durationMs?: number
  background?: boolean
}

export interface ThreadMessage {
  id: string
  seq: number
  at: number
  updatedAt: number
  role: 'user' | 'assistant' | 'thought' | 'tool' | 'plan' | 'approval' | 'question' | 'error' | 'status'
  queued?: boolean
  question?: {
    id: string
    text: string
    options: { id: string; label: string; description?: string }[]
    multiple?: boolean
    allowText?: boolean
    answered?: string[]
  }
  text: string
  turn?: string
  // Set on a subagent's own steps: the id of its tool message.
  parentId?: string
  tool?: {
    name: string
    title: string
    status: 'running' | 'completed' | 'error'
    input?: string
    output?: string
    files?: ToolFile[]
    agent?: ToolAgent
  }
  plan?: { content: string; status: 'pending' | 'in_progress' | 'completed' }[]
  approval?: {
    id: string
    title: string
    detail?: string
    options: { id: string; label: string; kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' }[]
    resolved?: string
    answeredBy?: string
  }
  durationMs?: number
}

export interface AgentKind {
  id: string
  name: string
  protocol: 'native' | 'acp'
  models?: string[]
}

export interface DeviceAgent {
  id: string
  installed: boolean
  version?: string
  // "ok" or "signed-out" when the agent's CLI can say; absent when unknown.
  auth?: 'ok' | 'signed-out'
  account?: string
}

export interface DesktopSetup {
  supported: boolean
  server?: string
  summary: string
  steps?: string[]
  command?: string
  notes?: string[]
  manual?: string[]
  needsAdmin?: boolean
}

export interface DesktopInfo {
  available: boolean
  port: number
  reason?: string
  os?: string
  user?: string
  setup?: DesktopSetup
}

export interface McpServer {
  id: string
  name: string
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  enabled: boolean
  builtin?: boolean
}

export interface Automation {
  id: string
  name: string
  prompt: string
  deviceId: string
  agent: string
  model?: string
  effort?: string
  fast?: boolean
  mode?: string
  cwd: string
  access: Access
  schedule: string
  enabled: boolean
  createdAt: number
  lastRunAt?: number
  lastThreadId?: string
  nextRunAt?: number
}

export function metricMissing(stats: Stats | undefined, metric: NonNullable<Stats['unavailable']>[number]) {
  return !stats || !!stats.unavailable?.includes(metric)
}

// ---- Per-agent options (docs/agent-sessions-api.md, "Agent options") ----

export type ModeKind = 'readonly' | 'plan' | 'ask' | 'edits' | 'auto' | 'full'

export interface AgentOptions {
  agent: string
  source: 'discovered' | 'builtin'
  models: { id: string; label: string; description?: string; efforts?: string[]; defaultEffort?: string; default?: boolean }[]
  efforts: { id: string; label: string; description?: string }[]
  fast?: { label: string; description: string }
  modes: { id: string; label: string; description: string; kind: ModeKind }[]
  defaultMode: string
}

// Live previews: dev servers listening on a machine, viewed through the hub.
export interface PortInfo {
  port: number
  address: string
  pid?: number
  process?: string
  command?: string
  cwd?: string
  http: boolean
  title?: string
  previewUrl: string
}

export interface PreviewConfig {
  domain: string
  source: 'flag' | 'setting' | 'derived' | 'none'
  hubHost: string
  secure: boolean
}

// Subscription usage limits each agent CLI reports (Claude 5-hour/weekly,
// Codex primary/secondary windows). See "Plan usage limits" in the API doc.
export interface LimitWindow {
  id: string
  label: string
  usedPercent: number
  resetsAt?: number
  windowMinutes?: number
}

export interface PlanLimits {
  deviceId: string
  deviceName: string
  agent: string
  plan?: string
  account?: string
  windows?: LimitWindow[]
  status?: 'ok' | 'warning' | 'limited'
  fetchedAt?: number
  source?: 'live' | 'session'
  error?: string
}

// Skills & plugins: what extends each agent on a machine
// (docs/agent-sessions-api.md, "Skills & plugins").
export type ExtKind = 'skill' | 'plugin' | 'marketplace' | 'command' | 'subagent' | 'rule' | 'hook' | 'extension' | 'mcp_server' | 'output_style'
export type ExtScope = 'user' | 'project' | 'local' | 'plugin' | 'managed' | 'system' | 'builtin' | 'synced' | 'session'

export interface ExtItem {
  key: string
  agent: string
  kind: ExtKind
  name: string
  qualifiedName: string
  displayName?: string
  description?: string
  scope: ExtScope
  projectPath?: string
  path?: string
  parentId?: string
  version?: string
  enabled: boolean | null
  state?: string
  lockedBy?: 'plugin' | 'policy' | 'managed'
  invocation?: { user: boolean; model: boolean; argumentHint?: string }
  source?: { type: string; repo?: string; url?: string; path?: string; ref?: string; package?: string }
  mcp?: { transport: string; command?: string; url?: string; authStatus?: string; toolCount?: number }
  hook?: { event: string; matcher?: string; handlerType: string; command?: string; trust?: string }
  sharedWith?: string[]
  cost?: { alwaysOnTokens?: number; onInvokeTokens?: number }
  usage?: { count?: number; lastUsedAt?: string }
  errors?: string[]
}

export interface ExtInventory {
  items: ExtItem[]
  agents: { agent: string; ok: boolean; version?: string; error?: string }[]
  fetchedAt: number
}

export interface CatalogPlugin {
  id: string
  name: string
  description?: string
  category?: string
  marketplace?: string
  installCount?: number
  installed: boolean
  hasSkills?: boolean
  hasMcp?: boolean
  hasHooks?: boolean
  source?: ExtItem['source']
}
