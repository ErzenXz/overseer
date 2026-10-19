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
  status: ThreadStatus
  error?: string
  createdAt: number
  updatedAt: number
  lastReadAt: number
  terminal?: string
  pr?: PullRequestRef
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number }
  automationId?: string
}

export interface ToolFile {
  path: string
  additions?: number
  deletions?: number
  diff?: string
}

export interface ThreadMessage {
  id: string
  seq: number
  at: number
  updatedAt: number
  role: 'user' | 'assistant' | 'thought' | 'tool' | 'plan' | 'approval' | 'error' | 'status'
  text: string
  turn?: string
  tool?: {
    name: string
    title: string
    status: 'running' | 'completed' | 'error'
    input?: string
    output?: string
    files?: ToolFile[]
  }
  plan?: { content: string; status: 'pending' | 'in_progress' | 'completed' }[]
  approval?: {
    id: string
    title: string
    detail?: string
    options: { id: string; label: string; kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' }[]
    resolved?: string
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
}

export interface DesktopInfo {
  available: boolean
  port: number
  reason?: string
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
