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
  type: 'device.online' | 'device.offline' | 'device.stats' | 'sessions.changed'
  deviceId?: string
  stats?: Stats
}
