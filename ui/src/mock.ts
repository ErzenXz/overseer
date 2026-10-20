// DEV-ONLY MOCK. Remove this file plus the installMockApi() call in main.tsx
// to go back to the real hub. Disable without editing: localStorage
// 'overseer:mock' = 'off' and reload.

import { mockExec, mockThreadStream, setThreadsChangedHandler, threadRoute } from './mockThreads'
import { previewRoute } from './mockPreview'
import type { Device, FleetSession, FsListing, Preset, Project, Session, SetupOverview, Stats, UpdateStatus } from './types'

const STORAGE_KEY = 'overseer:mock'
const AUTH_KEY = 'overseer:mock:auth'

// ?demo=1 / ?demo=0 switches the dev UI between demo data and the real hub.
if (import.meta.env.DEV) {
  const demo = new URLSearchParams(location.search).get('demo')
  if (demo === '1') { localStorage.removeItem(STORAGE_KEY); sessionStorage.setItem(AUTH_KEY, '1') }
  if (demo === '0') localStorage.setItem(STORAGE_KEY, 'off')
}

export const mockEnabled = import.meta.env.DEV && localStorage.getItem(STORAGE_KEY) !== 'off'
export { mockThreadStream }

let changeTimer: number | undefined
setThreadsChangedHandler(() => {
  window.clearTimeout(changeTimer)
  changeTimer = window.setTimeout(() => window.dispatchEvent(new CustomEvent('overseer:mock-event', { detail: { type: 'threads.changed' } })), 120)
})

let authed = sessionStorage.getItem(AUTH_KEY) === '1'

const now = () => Math.floor(Date.now() / 1000)
const GB = 1024 ** 3

const stats = (cpuPercent: number, cpuCores: number, memUsed: number, memTotal: number, diskUsed: number, diskTotal: number, rx: number, tx: number, load1: number, processes: number, uptime: number): Stats => ({
  cpuPercent,
  cpuCores,
  load1,
  load5: load1 * 0.82,
  load15: load1 * 0.64,
  memUsed,
  memTotal,
  swapUsed: 0,
  swapTotal: 0,
  diskUsed,
  diskTotal,
  netRxBytes: rx,
  netTxBytes: tx,
  processCount: processes,
  uptimeSec: uptime,
})

const devices: Device[] = [
  {
    id: 'macbook',
    name: 'MacBook Pro',
    hostname: 'erzen-mbp',
    os: 'darwin',
    arch: 'arm64',
    isHub: true,
    createdAt: now() - 86400 * 42,
    lastSeen: now() - 2,
    online: true,
    tmux: true,
    agentVersion: '1.4.2',
    platform: 'macOS',
    platformVersion: '15.1',
    kernelVersion: 'Darwin 24.1.0',
    stats: stats(18, 12, 9.4 * GB, 36 * GB, 214 * GB, 460 * GB, 18.2 * GB, 4.1 * GB, 1.24, 512, 86400 * 3),
  },
  {
    id: 'studio',
    name: 'Studio',
    hostname: 'studio',
    os: 'linux',
    arch: 'amd64',
    isHub: false,
    createdAt: now() - 86400 * 21,
    lastSeen: now() - 5,
    online: true,
    tmux: true,
    agentVersion: '1.4.2',
    platform: 'Ubuntu',
    platformVersion: '24.04',
    kernelVersion: '6.8.0-45-generic',
    stats: stats(42, 16, 21.6 * GB, 64 * GB, 611 * GB, 1024 * GB, 41.7 * GB, 9.3 * GB, 3.81, 288, 86400 * 11),
  },
  {
    id: 'homelab',
    name: 'Homelab',
    hostname: 'homelab',
    os: 'linux',
    arch: 'arm64',
    isHub: false,
    createdAt: now() - 86400 * 9,
    lastSeen: now() - 12,
    online: true,
    tmux: true,
    agentVersion: '1.4.1',
    platform: 'Debian',
    platformVersion: '12',
    kernelVersion: '6.1.0-26-arm64',
    stats: stats(7, 8, 3.1 * GB, 16 * GB, 88 * GB, 256 * GB, 7.9 * GB, 2.2 * GB, 0.34, 141, 86400 * 5),
  },
  {
    id: 'office',
    name: 'Office PC',
    hostname: 'office-pc',
    os: 'windows',
    arch: 'amd64',
    isHub: false,
    createdAt: now() - 86400 * 4,
    lastSeen: now() - 7200,
    online: false,
    tmux: false,
    agentVersion: '1.3.9',
    platform: 'Windows',
    platformVersion: '11 Pro',
  },
]

let sessions: FleetSession[] = [
  { name: 'claude-1423', kind: 'claude', status: 'working', createdAt: now() - 5400, lastActivity: now() - 38, attached: true, ephemeral: false, deviceId: 'studio', deviceName: 'Studio' },
  { name: 'codex-0912', kind: 'codex', status: 'idle', createdAt: now() - 86400, lastActivity: now() - 640, attached: false, ephemeral: false, deviceId: 'macbook', deviceName: 'MacBook Pro' },
  { name: 'term-1', kind: 'shell', status: 'idle', createdAt: now() - 7200, lastActivity: now() - 120, attached: false, ephemeral: false, deviceId: 'studio', deviceName: 'Studio' },
  { name: 'tests-watch', kind: 'shell', status: 'working', createdAt: now() - 1800, lastActivity: now() - 9, attached: true, ephemeral: false, deviceId: 'homelab', deviceName: 'Homelab' },
  { name: 'gemini-0741', kind: 'gemini', status: 'exited', createdAt: now() - 86400 * 2, lastActivity: now() - 86400, attached: false, ephemeral: false, deviceId: 'macbook', deviceName: 'MacBook Pro' },
  { name: 'deploy', kind: 'shell', status: 'exited', createdAt: now() - 86400 * 3, lastActivity: now() - 86400 * 2, attached: false, ephemeral: false, deviceId: 'homelab', deviceName: 'Homelab' },
]

let projects: Project[] = [
  { id: 'storefront', name: 'Storefront', deviceId: 'studio', path: '/home/erzen/Projects/storefront', createdAt: now() - 86400 * 12, updatedAt: now() - 3600 },
  { id: 'overseer', name: 'Overseer', deviceId: 'macbook', path: '/Users/erzen/Projects/LiveAgent', createdAt: now() - 86400 * 30, updatedAt: now() - 120 },
  { id: 'api-gateway', name: 'API Gateway', deviceId: 'homelab', path: '/srv/api-gateway', createdAt: now() - 86400 * 6, updatedAt: now() - 86400 },
]

let presets: Preset[] = [
  { id: 1, name: 'Claude Code', command: 'claude', kind: 'claude' },
  { id: 2, name: 'Codex', command: 'codex', kind: 'codex' },
  { id: 3, name: 'Gemini', command: 'gemini', kind: 'gemini' },
  { id: 4, name: 'Terminal', command: '', kind: 'shell' },
]

let tokens = [{ id: 1, name: 'senior-agent', createdAt: now() - 86400 * 6 }]
let nextId = 5

const setupTools = (device: Device): SetupOverview => ({
  os: device.os,
  arch: device.arch,
  bundleCommand: 'curl -fsSL https://overseer.sh/agent-pack.sh | sh',
  tools: [
    { id: 'node', name: 'Node.js', description: 'Runtime used by most coding agents and the fx command adapter.', installed: true, version: 'v22.11.0', auth: 'not-required', installCommand: 'nvm install 22', docsUrl: 'https://nodejs.org' },
    { id: 'codex', name: 'Codex', description: 'OpenAI’s terminal coding agent.', installed: true, version: '0.44.0', auth: 'connected', installCommand: 'npm install -g @openai/codex', authCommand: 'codex login', docsUrl: 'https://github.com/openai/codex' },
    { id: 'claude', name: 'Claude Code', description: 'Anthropic’s terminal coding agent.', installed: true, version: '2.0.14', auth: 'connected', installCommand: 'npm install -g @anthropic-ai/claude-code', authCommand: 'claude', docsUrl: 'https://docs.anthropic.com/claude-code' },
    { id: 'gemini', name: 'Gemini CLI', description: 'Google’s terminal coding agent.', installed: false, auth: 'missing', installCommand: 'npm install -g @google/gemini-cli', authCommand: 'gemini', docsUrl: 'https://github.com/google-gemini/gemini-cli' },
    { id: 'tailscale', name: 'Tailscale', description: 'Private network access to this machine from anywhere.', installed: device.os !== 'windows', version: '1.76.6', auth: device.os === 'windows' ? 'missing' : 'connected', installCommand: 'curl -fsSL https://tailscale.com/install.sh | sh', authCommand: 'sudo tailscale up', note: 'Optional. Only needed if you want to reach this device outside your LAN.', docsUrl: 'https://tailscale.com' },
  ],
})

const tree: Record<string, FsListing['entries']> = {
  '/Users/erzen': [
    { name: 'Projects', dir: true, size: 0, mode: 'drwxr-xr-x', modTime: now() - 3600 },
    { name: 'Documents', dir: true, size: 0, mode: 'drwxr-xr-x', modTime: now() - 7200 },
    { name: 'Downloads', dir: true, size: 0, mode: 'drwxr-xr-x', modTime: now() - 300 },
    { name: 'README.md', dir: false, size: 2048, mode: '-rw-r--r--', modTime: now() - 86400 },
    { name: '.zshrc', dir: false, size: 8192, mode: '-rw-r--r--', modTime: now() - 86400 * 4 },
  ],
  '/Users/erzen/Projects': [
    { name: 'LiveAgent', dir: true, size: 0, mode: 'drwxr-xr-x', modTime: now() - 120 },
    { name: 'storefront', dir: true, size: 0, mode: 'drwxr-xr-x', modTime: now() - 3600 },
    { name: 'notes.md', dir: false, size: 3412, mode: '-rw-r--r--', modTime: now() - 86400 },
  ],
  '/Users/erzen/Projects/LiveAgent': [
    { name: 'ui', dir: true, size: 0, mode: 'drwxr-xr-x', modTime: now() - 120 },
    { name: 'cmd', dir: true, size: 0, mode: 'drwxr-xr-x', modTime: now() - 86400 },
    { name: 'README.md', dir: false, size: 14512, mode: '-rw-r--r--', modTime: now() - 300 },
    { name: 'go.mod', dir: false, size: 1174, mode: '-rw-r--r--', modTime: now() - 86400 * 3 },
    { name: 'Makefile', dir: false, size: 1329, mode: '-rw-r--r--', modTime: now() - 86400 * 2 },
  ],
}

function listingFor(requested: string): FsListing {
  const path = requested === '~' || requested === '' ? '/Users/erzen' : requested
  return { path, entries: tree[path] ?? [] }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

function device(id: string) {
  return devices.find((d) => d.id === id)
}

async function route(method: string, path: string, search: URLSearchParams, body: Record<string, unknown>): Promise<Response> {
  if (path === '/api/me') {
    return json({ setupDone: true, authenticated: authed, version: '1.4.2-demo' })
  }
  if (method === 'POST' && (path === '/api/login' || path === '/api/setup')) {
    authed = true
    sessionStorage.setItem(AUTH_KEY, '1')
    return json({ ok: true })
  }
  if (method === 'POST' && path === '/api/logout') {
    authed = false
    sessionStorage.removeItem(AUTH_KEY)
    return json({ ok: true })
  }
  if (!authed) return json({ error: 'unauthorized' }, 401)

  const previewResponse = previewRoute(method, path, body)
  if (previewResponse) return previewResponse
  const threadResponse = await threadRoute(method, path, body)
  if (threadResponse) return threadResponse
  const execMatch = path.match(/^\/api\/devices\/([^/]+)\/exec$/)
  if (method === 'POST' && execMatch) {
    return json(mockExec(String(body.command ?? '')) ?? { exitCode: 127, stdout: '', stderr: 'demo: command not available in this preview' })
  }

  if (method === 'GET' && path === '/api/devices') return json(devices)
  if (method === 'GET' && path === '/api/agents') return json([...sessions].sort((a, b) => b.lastActivity - a.lastActivity))

  if (method === 'GET' && path === '/api/projects') return json(projects)
  if (method === 'POST' && path === '/api/projects') {
    const project: Project = {
      id: crypto.randomUUID(),
      name: String(body.name ?? 'Untitled'),
      deviceId: String(body.deviceId ?? devices[0].id),
      path: String(body.path ?? '~'),
      createdAt: now(),
      updatedAt: now(),
    }
    projects = [...projects, project]
    return json(project)
  }
  const projectMatch = path.match(/^\/api\/projects\/([^/]+)$/)
  if (projectMatch) {
    const id = decodeURIComponent(projectMatch[1])
    if (method === 'PATCH') {
      projects = projects.map((p) => p.id === id ? { ...p, ...body, id, updatedAt: now() } as Project : p)
      return json(projects.find((p) => p.id === id))
    }
    if (method === 'DELETE') {
      projects = projects.filter((p) => p.id !== id)
      return json({ ok: true })
    }
  }
  if (method === 'POST' && /^\/api\/projects\/[^/]+\/exec$/.test(path)) {
    return json({ exitCode: 0, stdout: '', stderr: '' })
  }

  if (method === 'GET' && path === '/api/presets') return json(presets)
  if (method === 'POST' && path === '/api/presets') {
    const preset: Preset = { id: nextId++, name: String(body.name ?? 'Preset'), command: String(body.command ?? ''), kind: 'shell' }
    presets = [...presets, preset]
    return json(preset)
  }
  const presetMatch = path.match(/^\/api\/presets\/(\d+)$/)
  if (method === 'DELETE' && presetMatch) {
    presets = presets.filter((p) => p.id !== Number(presetMatch[1]))
    return json({ ok: true })
  }

  if (method === 'GET' && path === '/api/tokens') return json(tokens)
  if (method === 'POST' && path === '/api/tokens') {
    const token = { id: nextId++, name: String(body.name ?? 'token'), createdAt: now() }
    tokens = [...tokens, token]
    return json({ token: `overseer_pat_demo_${token.id}_${Math.random().toString(36).slice(2, 18)}` })
  }
  const tokenMatch = path.match(/^\/api\/tokens\/(\d+)$/)
  if (method === 'DELETE' && tokenMatch) {
    tokens = tokens.filter((t) => t.id !== Number(tokenMatch[1]))
    return json({ ok: true })
  }

  if (path === '/api/updates' || /^\/api\/updates\/(check|install|rollback)$/.test(path)) {
    const status: UpdateStatus = {
      currentVersion: '1.4.2',
      latestVersion: '1.4.2',
      updateAvailable: false,
      autoUpdate: true,
      managed: true,
      checking: false,
      applying: false,
      lastChecked: now() - 180,
      fleetTotal: devices.length,
      fleetOutdated: 1,
    }
    if (method === 'PATCH') return json({ ...status, autoUpdate: Boolean(body.autoUpdate) })
    return json(status)
  }

  if (method === 'POST' && path === '/api/enroll-tokens') {
    return json({
      command: 'curl -fsSL http://localhost:4200/install/DEMO.sh | sh',
      windowsCommand: 'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm http://localhost:4200/install/DEMO.ps1 | iex"',
    })
  }

  const deviceMatch = path.match(/^\/api\/devices\/([^/]+)\/(sessions|setup|fs|fs\/download|fs\/upload)$/)
  if (deviceMatch) {
    const id = decodeURIComponent(deviceMatch[1])
    const what = deviceMatch[2]
    const target = device(id)
    if (what === 'sessions') {
      if (method === 'GET') {
        return json(sessions.filter((s) => s.deviceId === id).map((s): Session => ({
          name: s.name,
          kind: s.kind,
          status: s.status,
          createdAt: s.createdAt,
          lastActivity: s.lastActivity,
          attached: s.attached,
          ephemeral: s.ephemeral,
        })))
      }
      if (method === 'POST') {
        const name = String(body.name ?? `term-${nextId++}`)
        sessions = [
          { name, kind: String(body.kind ?? 'shell'), status: 'idle', createdAt: now(), lastActivity: now(), attached: false, ephemeral: false, deviceId: id, deviceName: target?.name ?? id },
          ...sessions.filter((s) => !(s.deviceId === id && s.name === name)),
        ]
        return json({ ok: true })
      }
    }
    if (what === 'setup' && target) return json(setupTools(target))
    if (what === 'fs' && method === 'GET') return json(listingFor(search.get('path') ?? '~'))
    if (what === 'fs/download') return new Response('Demo file contents.\n', { headers: { 'Content-Type': 'text/plain' } })
    if (what === 'fs/upload') return json({ ok: true })
  }

  const sessionMatch = path.match(/^\/api\/devices\/([^/]+)\/sessions\/([^/]+)$/)
  if (method === 'DELETE' && sessionMatch) {
    const id = decodeURIComponent(sessionMatch[1])
    const name = decodeURIComponent(sessionMatch[2])
    sessions = sessions.filter((s) => !(s.deviceId === id && s.name === name))
    return json({ ok: true })
  }

  return json({ error: `Demo mode has no handler for ${method} ${path}` }, 404)
}

export function installMockApi() {
  if (!mockEnabled) return
  const original = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const url = new URL(raw, location.origin)
    if (!url.pathname.startsWith('/api/')) return original(input, init)
    const method = (init?.method ?? 'GET').toUpperCase()
    let body: Record<string, unknown> = {}
    if (typeof init?.body === 'string') {
      try { body = JSON.parse(init.body) } catch { /* not json */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 80))
    return route(method, url.pathname, url.searchParams, body)
  }
}
