// DEV-ONLY MOCK. Remove this file plus the installMockApi() call in main.tsx
// to go back to the real hub. Disable without editing: localStorage
// 'overseer:mock' = 'off' and reload.

import { mockExec, mockThreadStream as rawThreadStream, setThreadsChangedHandler, threadRoute } from './mockThreads'
import { teamsMe, teamsRoute, withTeamStream } from './mockTeams'
import { scheduleRoute, scheduleThreadStream, withSchedule } from './mockSchedule'
import { desktopRoute } from './mockDesktop'
import { wrappedRoute } from './mockWrapped'
import { previewRoute } from './mockPreview'
import { skillsRoute } from './mockSkills'
import { githubRoute } from './mockGithub'
import { autopilotRoute } from './mockAutopilot'
import { chatRoute } from './mockChat'
import { arenaRoute } from './mockArena'
import { cloudRoute } from './mockCloud'
import { shareRoute, mockShareStream } from './mockShare'
import type { Device, FleetSession, FsListing, GitPathInfo, Preset, Project, Session, SetupOverview, Stats, UpdateNotes, UpdateStatus, ReleaseNotes } from './types'

const STORAGE_KEY = 'overseer:mock'
const AUTH_KEY = 'overseer:mock:auth'

// ?demo=1 / ?demo=0 switches the dev UI between demo data and the real hub.
if (import.meta.env.DEV) {
  const demo = new URLSearchParams(location.search).get('demo')
  if (demo === '1') { localStorage.removeItem(STORAGE_KEY); sessionStorage.setItem(AUTH_KEY, '1') }
  if (demo === '0') localStorage.setItem(STORAGE_KEY, 'off')
}

export const mockEnabled = import.meta.env.DEV && localStorage.getItem(STORAGE_KEY) !== 'off'
export const mockThreadStream = withTeamStream(scheduleThreadStream(rawThreadStream))
export { mockShareStream }

let changeTimer: number | undefined
setThreadsChangedHandler(() => {
  window.clearTimeout(changeTimer)
  changeTimer = window.setTimeout(() => window.dispatchEvent(new CustomEvent('overseer:mock-event', { detail: { type: 'threads.changed' } })), 120)
})

let authed = sessionStorage.getItem(AUTH_KEY) === '1'

const now = () => Math.floor(Date.now() / 1000)

const UPDATE_KEY = 'overseer:mock:installed'
const mockReleases = () => {
  const v050: ReleaseNotes = {
    version: 'v0.5.0',
    date: '2026-10-28',
    intro: 'Pick exactly where a session runs, drop files into the composer, and get told when an agent is waiting for you.',
    groups: [
      { title: 'New', items: [
        '**Where it runs.** One picker for the machine, folder and branch, with when each machine was last seen. Starting from a GitHub repo clones it for you.',
        '**Drag, drop and paste attachments.** Drop files or paste screenshots into the composer; they upload before the agent starts.',
        '**Needs you.** Sessions waiting on an approval or a question sit at the top of the sidebar, the tab title and icon show a count, and a gentle reminder comes after 5 and 30 minutes.',
        '**One-click remote desktop.** Machines without a desktop get a setup button that installs and checks everything, with a clear message when something is missing.',
        '**Update notice.** The sidebar tells you when a release is out and what it adds, and shows what changed after Overseer updates.',
      ] },
      { title: 'Improved', items: [
        '**Safer session start.** If the hub can’t confirm a session started, Overseer checks before offering to retry, so a double click never starts two.',
        'The composer keeps your draft and attachments when you switch machines.',
      ] },
    ],
  }
  const v041: ReleaseNotes = {
    version: 'v0.4.1',
    date: '2026-10-23',
    groups: [{ title: 'Fixed', items: [
      'Plan limits no longer show as zero on machines that were asleep during the last refresh.',
      'Long `AGENTS.md` files no longer push the Skills page off screen.',
    ] }],
  }
  const v040: ReleaseNotes = {
    version: 'v0.4.0',
    date: '2026-10-20',
    intro: 'Skills and plugins for every agent in one place, your real plan limits, and every ACP agent found automatically.',
    groups: [{ title: 'New', items: ['**Skills & plugins.** A new page shows what extends each agent on each machine.'] }],
  }
  return { v050, v041, v040 }
}
const mockUpdateNotes = (): UpdateNotes => {
  const { v050, v041, v040 } = mockReleases()
  const installedAt = Number(sessionStorage.getItem(UPDATE_KEY) ?? 0)
  if (installedAt > 0 && Date.now() - installedAt > 5000) return { currentVersion: 'v0.5.0', latestVersion: 'v0.5.0', newer: [], current: v050 }
  return { currentVersion: 'v0.4.0', latestVersion: 'v0.5.0', newer: [v050, v041], current: v040 }
}
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
    ...['api-gateway', 'archive', 'billing-service', 'codex-harness', 'design-system', 'docs-site', 'infra', 'mobile-app', 'orbit-api', 'ops-scripts', 'takvimi', 'worker', 'web', 'website'].map((name, i) => ({ name, dir: true, size: 0, mode: 'drwxr-xr-x', modTime: now() - 86400 * (i + 2) })),
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
  const path = requested === '~' || requested === '' ? '/Users/erzen' : requested.startsWith('~/') ? `/Users/erzen/${requested.slice(2)}` : requested
  return { path, entries: tree[path] ?? [] }
}

// Folders the demo machines "have": where they live, which repo, which branch.
const mockHomes: Record<string, string> = { macbook: '/Users/erzen', studio: '/home/erzen', homelab: '/home/erzen' }
const mockRepos: Record<string, { branch: string; remote: string; dirty: number }> = {
  'macbook:/Users/erzen/Projects/LiveAgent': { branch: 'user-feedback', remote: 'github.com/ErzenXz/overseer', dirty: 14 },
  'macbook:/Users/erzen/Projects/takvimi': { branch: 'main', remote: 'github.com/ErzenXz/takvimi', dirty: 0 },
  'studio:/home/erzen/code/overseer': { branch: 'main', remote: 'github.com/ErzenXz/overseer', dirty: 0 },
  'studio:/home/erzen/Projects/codex-harness': { branch: 'main', remote: 'github.com/ErzenXz/codex-harness', dirty: 2 },
  'studio:/home/erzen/Projects/archive': { branch: 'redesign-home', remote: 'github.com/ErzenXz/archive', dirty: 3 },
  'studio:/home/erzen/Projects/storefront': { branch: 'main', remote: 'github.com/ErzenXz/storefront', dirty: 0 },
  'homelab:/home/erzen/Projects/LiveAgent': { branch: 'release-1.4', remote: 'github.com/ErzenXz/overseer', dirty: 0 },
  'homelab:/srv/api-gateway': { branch: 'main', remote: 'github.com/ErzenXz/api-gateway', dirty: 1 },
  'homelab:/srv/worker': { branch: 'fix/leak', remote: 'github.com/ErzenXz/worker', dirty: 0 },
}

function mockGitInfo(deviceId: string, requested: string): GitPathInfo {
  const home = mockHomes[deviceId] ?? '/home/demo'
  const resolved = requested === '' || requested === '~' ? home : requested.startsWith('~/') ? `${home}${requested.slice(1)}` : requested
  const repo = mockRepos[`${deviceId}:${resolved}`]
  if (repo) return { path: requested, resolved, exists: true, isRepo: true, root: resolved, branch: repo.branch, remote: `https://${repo.remote}.git`, remoteKey: repo.remote, dirty: repo.dirty }
  const exists = resolved === home || resolved === `${home}/Projects`
  return { path: requested, resolved, exists, isRepo: false }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

function device(id: string) {
  return devices.find((d) => d.id === id)
}

async function route(method: string, path: string, search: URLSearchParams, body: Record<string, unknown>): Promise<Response> {
  if (path === '/api/me') {
    return json({ setupDone: true, authenticated: authed, version: '1.4.2-demo', ...teamsMe(authed) })
  }
  if (method === 'POST' && (path === '/api/login' || path === '/api/setup' || /^\/api\/invites\/[^/]+\/accept$/.test(path))) {
    authed = true
    sessionStorage.setItem(AUTH_KEY, '1')
    return json({ ok: true })
  }
  if (method === 'POST' && path === '/api/logout') {
    authed = false
    sessionStorage.removeItem(AUTH_KEY)
    return json({ ok: true })
  }
  // Shared links open without a login.
  if (path.startsWith('/api/public/')) return (await shareRoute(method, path, body)) ?? json({ error: 'not found' }, 404)
  // People, invites, the activity log and who holds each session (mockTeams.ts).
  const teamsResponse = await teamsRoute(method, path, search, body, authed, withSchedule(threadRoute))
  if (teamsResponse) return teamsResponse
  if (!authed) return json({ error: 'unauthorized' }, 401)

  if (method === 'GET' && path === '/api/usage/limits') {
    const at = now()
    const claude = (deviceId: string, deviceName: string, five: number, week: number) => ({ deviceId, deviceName, agent: 'claude', plan: 'Max 20x', account: 'you@example.com', status: week > 90 ? 'warning' : 'ok', source: 'live', fetchedAt: at - 40,
      windows: [
        { id: 'five_hour', label: '5-hour', usedPercent: five, resetsAt: at + 2 * 3600 + 14 * 60, windowMinutes: 300 },
        { id: 'seven_day', label: 'Weekly', usedPercent: week, resetsAt: at + 3 * 86400 + 5 * 3600, windowMinutes: 10080 },
        { id: 'seven_day_opus', label: 'Weekly (Opus)', usedPercent: Math.round(week * 0.45), resetsAt: at + 3 * 86400 + 5 * 3600, windowMinutes: 10080 },
      ] })
    const codex = (deviceId: string, deviceName: string, primary: number, secondary: number) => ({ deviceId, deviceName, agent: 'codex', plan: 'Pro', status: 'ok', source: 'session', fetchedAt: at - 300,
      windows: [
        { id: 'primary', label: '5-hour', usedPercent: primary, resetsAt: at + 3 * 3600 + 40 * 60, windowMinutes: 300 },
        { id: 'secondary', label: 'Weekly', usedPercent: secondary, resetsAt: at + 5 * 86400, windowMinutes: 10080 },
      ] })
    return json({ accounts: [claude('macbook', 'MacBook Pro', 42, 68), codex('macbook', 'MacBook Pro', 18, 54), claude('studio', 'Studio', 77, 93), codex('studio', 'Studio', 9, 31), { deviceId: 'homelab', deviceName: 'Homelab', agent: 'claude', error: 'not signed in' }] })
  }
  const chatResponse = chatRoute(method, path, body)
  if (chatResponse) return chatResponse
  const githubResponse = await githubRoute(method, path, search, body, { online: (id) => !!device(id)?.online, home: (id) => mockHomes[id] ?? '/home/demo', info: mockGitInfo })
  if (githubResponse) return githubResponse
  const arenaResponse = arenaRoute(method, path, body)
  if (arenaResponse) return arenaResponse
  const autopilotResponse = autopilotRoute(method, path, body)
  if (autopilotResponse) return autopilotResponse
  const skillsResponse = skillsRoute(method, path, search, body)
  if (skillsResponse) return skillsResponse
  const wrappedResponse = wrappedRoute(method, path, search)
  if (wrappedResponse) return wrappedResponse
  const desktopResponse = desktopRoute(method, path, body)
  if (desktopResponse) return desktopResponse
  const previewResponse = previewRoute(method, path, body)
  if (previewResponse) return previewResponse
  const shareResponse = await shareRoute(method, path, body)
  if (shareResponse) return shareResponse
  const cloudResponse = cloudRoute(method, path, body, devices)
  if (cloudResponse) return cloudResponse
  const scheduleResponse = await scheduleRoute(method, path, body, threadRoute)
  if (scheduleResponse) return scheduleResponse
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

  if (path === '/api/updates/notes') return json(mockUpdateNotes())
  if (path === '/api/updates' || /^\/api\/updates\/(check|install|rollback)$/.test(path)) {
    // Demo: running v0.4.0 with v0.5.0 out. Installing flips to v0.5.0 for the
    // rest of the browser session, so the "updated" notice can be seen too.
    if (method === 'POST' && path === '/api/updates/install') {
      sessionStorage.setItem(UPDATE_KEY, String(Date.now()))
      return json({ ok: true }, 202)
    }
    const installedAt = Number(sessionStorage.getItem(UPDATE_KEY) ?? 0)
    const updated = installedAt > 0 && Date.now() - installedAt > 5000
    const status: UpdateStatus = {
      currentVersion: updated ? 'v0.5.0' : 'v0.4.0',
      latestVersion: 'v0.5.0',
      rollbackVersion: updated ? 'v0.4.0' : undefined,
      updateAvailable: !updated,
      autoUpdate: false,
      managed: true,
      checking: false,
      applying: installedAt > 0 && !updated,
      lastChecked: now() - 180,
      fleetTotal: devices.length,
      fleetOutdated: updated ? 0 : 1,
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

  const gitMatch = path.match(/^\/api\/devices\/([^/]+)\/git-info$/)
  if (method === 'POST' && gitMatch) {
    const id = decodeURIComponent(gitMatch[1])
    if (!device(id)?.online) return json({ error: 'device is offline' }, 503)
    // Each machine answers on its own time, so rows fill in one by one.
    await new Promise((resolve) => setTimeout(resolve, { macbook: 60, studio: 420, homelab: 900 }[id] ?? 300))
    const paths = Array.isArray(body.paths) ? body.paths.map(String) : []
    return json({ home: mockHomes[id] ?? '/home/demo', paths: paths.map((requested) => mockGitInfo(id, requested)) })
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
