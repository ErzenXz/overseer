// DEV-ONLY demo data for Agent Wrapped (GET /api/stats) and Mission control
// (a few more live sessions on top of the ones in mockThreads.ts).

import type { MockKit } from './mockWork'
import type { Thread, ThreadMessage } from './types'
import type { StatsDay, StatsGroup, StatsRange, WrappedStats } from './wrapped'

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// A small deterministic generator, so the demo looks the same on every load.
function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
}

// How busy a person who works with agents is on each weekday (Sun first).
const weekdayLoad = [0.22, 0.95, 1.1, 0.9, 1.25, 0.8, 0.3]

const SPECS: Record<StatsRange, { days: number; scale: number }> = {
  week: { days: 7, scale: 1 },
  month: { days: 30, scale: 3.7 },
  all: { days: 84, scale: 11.4 },
}

function split(total: number, shares: number[]): number[] {
  const sum = shares.reduce((a, b) => a + b, 0)
  const parts = shares.map((share) => Math.round((total * share) / sum))
  parts[0] += total - parts.reduce((a, b) => a + b, 0)
  return parts
}

export function mockWrappedStats(range: StatsRange): WrappedStats {
  const { days: count, scale } = SPECS[range]
  const rand = rng(range.length * 977 + 11)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const loads: number[] = []
  const dates: Date[] = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    dates.push(d)
    // Longer ranges ramp up a little, as real usage does.
    const ramp = range === 'all' ? 0.45 + 0.55 * ((count - i) / count) : 1
    loads.push(weekdayLoad[d.getDay()] * (0.7 + rand() * 0.6) * ramp)
  }
  const turnsTotal = Math.round(214 * scale)
  const msTotal = Math.round(27.4 * 3.6e6 * scale)
  const linesTotal = Math.round(20056 * scale)
  const sessionsTotal = Math.round(38 * scale)
  const turns = split(turnsTotal, loads)
  const ms = split(msTotal, loads)
  const lines = split(linesTotal, loads.map((l) => l * (0.6 + rand() * 0.8)))
  const sessions = split(sessionsTotal, loads)
  const days: StatsDay[] = dates.map((d, i) => ({ date: dayKey(d), sessions: sessions[i], turns: turns[i], agentMs: ms[i], lines: lines[i] }))
  const busiest = days.reduce((best, d) => (d.agentMs > best.agentMs ? d : best), days[0])

  const agents = (): StatsGroup[] => {
    const [t, m, s, a, p, c] = [split(turnsTotal, [60, 30, 7, 3]), split(msTotal, [62, 28, 7, 3]), split(sessionsTotal, [21, 11, 4, 2]), split(linesTotal, [58, 31, 8, 3]), split(Math.round(21 * scale), [12, 7, 2, 0]), split(Math.round(84.2 * scale * 100), [66, 24, 8, 2])]
    return ['claude', 'codex', 'gemini', 'opencode'].map((id, i) => ({
      id, name: id, sessions: s[i], turns: t[i], agentMs: m[i], added: Math.round(a[i] * 0.74), removed: Math.round(a[i] * 0.26), prs: p[i], costUsd: c[i] / 100,
    }))
  }
  const machines = (): StatsGroup[] => {
    const [t, m, s, a, p] = [split(turnsTotal, [46, 38, 12, 4]), split(msTotal, [49.6, 36, 11.6, 2.8]), split(sessionsTotal, [17, 14, 5, 2]), split(linesTotal, [52, 34, 11, 3]), split(Math.round(21 * scale), [10, 8, 3, 0])]
    return ['studio:Studio', 'macbook:MacBook Pro', 'homelab:Homelab', 'office:Office PC'].map((entry, i) => {
      const [id, name] = entry.split(':')
      return { id, name, sessions: s[i], turns: t[i], agentMs: m[i], added: Math.round(a[i] * 0.74), removed: Math.round(a[i] * 0.26), prs: p[i] }
    })
  }

  const k = scale
  const stats: WrappedStats = {
    range,
    start: Math.floor(dates[0].getTime() / 1000),
    end: Math.floor(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime() / 1000),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    sessions: { started: sessionsTotal, finished: sessionsTotal - 2 },
    turns: turnsTotal,
    agentMs: msTotal,
    agentHours: msTotal / 3.6e6,
    prs: { opened: Math.round(21 * k), merged: Math.round(16 * k) },
    lines: { added: Math.round(linesTotal * 0.74), removed: linesTotal - Math.round(linesTotal * 0.74) },
    files: Math.round(312 * k),
    approvals: Math.round(96 * k),
    tokens: { input: Math.round(18_400_000 * k), output: Math.round(940_000 * k) },
    costUsd: 84.2 * k,
    agents: agents(),
    machines: machines(),
    days,
    busiestDay: busiest,
    topSession: { id: 'th_live', title: 'Move session storage to Redis', agent: 'claude', deviceName: 'Studio', added: Math.round(1284 * (0.6 + k * 0.4)), removed: Math.round(402 * (0.6 + k * 0.4)), turns: 31, agentMs: 4.2 * 3.6e6 },
    longestSession: { id: 'th_audit', title: 'Audit the storefront API for SQL injection', agent: 'claude', deviceName: 'Homelab', added: 212, removed: 40, turns: 22, agentMs: 5.8 * 3.6e6 },
    streak: { current: 9, longest: 14 },
  }
  if (range !== 'all') {
    stats.previous = { sessions: Math.round(sessionsTotal * 0.86), turns: Math.round(turnsTotal * 0.81), agentMs: Math.round(msTotal * 0.78), prs: Math.round(21 * k * 0.7), lines: Math.round(linesTotal * 0.88), approvals: Math.round(96 * k * 0.9) }
  }
  return stats
}

export function wrappedRoute(method: string, path: string, search: URLSearchParams): Response | null {
  if (method !== 'GET' || path !== '/api/stats') return null
  const range = (['week', 'month', 'all'] as const).find((r) => r === search.get('range')) ?? 'week'
  return new Response(JSON.stringify(mockWrappedStats(range)), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

// ---- Mission control: more sessions for a full wall ----

const deviceNames: Record<string, string> = { macbook: 'MacBook Pro', studio: 'Studio', homelab: 'Homelab', office: 'Office PC' }

// seedMissionDemo adds a few sessions that are working, waiting, finished
// and failed, so the wall isn't thin. Their steps are static: "running"
// tools simply never complete.
export function seedMissionDemo(kit: MockKit, threads: Thread[]) {
  const nowSec = Math.floor(Date.now() / 1000)
  const nowMs = Date.now()
  const add = (partial: Partial<Thread> & Pick<Thread, 'id' | 'title' | 'deviceId' | 'agent' | 'cwd'>): Thread => {
    const updated = partial.updatedAt ?? nowSec - 60
    const item: Thread = { deviceName: deviceNames[partial.deviceId] ?? partial.deviceId, access: 'auto', status: 'idle', createdAt: updated - 1800, updatedAt: updated, lastReadAt: updated, terminal: `t-${partial.id}`, ...partial }
    threads.push(item)
    kit.messages[item.id] = []
    return item
  }
  const say = (id: string, role: ThreadMessage['role'], atMsAgo: number, partial: Partial<ThreadMessage> = {}, tookMs = 1500) => {
    const m = kit.msg(id, { role, text: '', ...partial }, nowMs - atMsAgo)
    m.updatedAt = nowMs - atMsAgo + tookMs
    return m
  }
  const edit = (id: string, turn: string, ago: number, path: string, additions: number, deletions: number) =>
    say(id, 'tool', ago, { turn, tool: { name: 'edit', title: `Edit ${path}`, status: 'completed', input: path, files: [{ path, additions, deletions }] } })

  const billing = add({ id: 'th_billing', title: 'Migrate billing webhooks to the new SDK', deviceId: 'macbook', agent: 'codex', model: 'gpt-5-codex', cwd: '~/Projects/billing', status: 'working', updatedAt: nowSec - 3, createdAt: nowSec - 1500 })
  {
    const u = say(billing.id, 'user', 1_400_000, { text: billing.title })
    edit(billing.id, u.id, 1_100_000, 'src/webhooks/stripe.ts', 148, 61)
    edit(billing.id, u.id, 760_000, 'src/webhooks/verify.ts', 42, 12)
    edit(billing.id, u.id, 410_000, 'test/webhooks.test.ts', 96, 8)
    say(billing.id, 'tool', 26_000, { turn: u.id, tool: { name: 'bash', title: 'Run the webhook tests', status: 'running', input: 'npm test -- webhooks --run' } }, 0)
  }
  const e2e = add({ id: 'th_e2e', title: 'Write end-to-end tests for checkout', deviceId: 'homelab', agent: 'gemini', model: 'gemini-2.5-pro', cwd: '/srv/storefront', status: 'working', updatedAt: nowSec - 6, createdAt: nowSec - 900 })
  {
    const u = say(e2e.id, 'user', 880_000, { text: e2e.title })
    edit(e2e.id, u.id, 640_000, 'e2e/checkout.spec.ts', 188, 0)
    edit(e2e.id, u.id, 300_000, 'e2e/fixtures/cart.ts', 54, 3)
    say(e2e.id, 'tool', 9_000, { turn: u.id, tool: { name: 'edit', title: 'Edit e2e/pages/payment.ts', status: 'running', input: 'e2e/pages/payment.ts' } }, 0)
  }
  const gomod = add({ id: 'th_gomod', title: 'Bump Go to 1.24 across the services', deviceId: 'studio', agent: 'claude', model: 'opus', cwd: '~/Projects/platform', status: 'waiting', updatedAt: nowSec - 95, createdAt: nowSec - 2400 })
  {
    const u = say(gomod.id, 'user', 2_300_000, { text: gomod.title })
    edit(gomod.id, u.id, 1_600_000, 'go.mod', 4, 4)
    edit(gomod.id, u.id, 1_200_000, 'services/auth/go.mod', 3, 3)
    say(gomod.id, 'approval', 95_000, { turn: u.id, approval: { id: 'ap_go', title: 'Run go mod tidy in 14 modules', detail: 'for d in services/*; do (cd $d && go mod tidy); done', options: [
      { id: 'allow', label: 'Allow once', kind: 'allow_once' }, { id: 'reject', label: 'Reject', kind: 'reject_once' },
    ] } }, 0)
  }
  const ci = add({ id: 'th_ci', title: 'Fix the flaky CI job on the gateway', deviceId: 'macbook', agent: 'claude', model: 'sonnet', cwd: '~/Projects/api-gateway', updatedAt: nowSec - 60 * 11, pr: { url: 'https://github.com/ErzenXz/api-gateway/pull/91', number: 91, state: 'open', checks: 'passing' } })
  {
    const u = say(ci.id, 'user', 1_500_000, { text: ci.title })
    edit(ci.id, u.id, 1_200_000, '.github/workflows/ci.yml', 22, 9)
    edit(ci.id, u.id, 900_000, 'internal/proxy/retry_test.go', 61, 34)
    say(ci.id, 'assistant', 700_000, { turn: u.id, text: 'Fixed. The retry test raced the fake clock; CI is green across 20 reruns.', durationMs: 800_000 })
  }
  const client = add({ id: 'th_client', title: 'Generate the API client from the OpenAPI spec', deviceId: 'studio', agent: 'codex', cwd: '~/Projects/platform', updatedAt: nowSec - 60 * 38 })
  {
    const u = say(client.id, 'user', 2_800_000, { text: client.title })
    edit(client.id, u.id, 2_500_000, 'sdk/client.gen.ts', 1420, 0)
    say(client.id, 'assistant', 2_300_000, { turn: u.id, text: 'Generated the client and wired it into the web app.', durationMs: 520_000 })
  }
  const docs = add({ id: 'th_docs', title: 'Deploy a preview for the docs site', deviceId: 'homelab', agent: 'opencode', cwd: '/srv/docs', status: 'error', error: 'opencode exited with status 1: build failed', updatedAt: nowSec - 60 * 21 })
  {
    const u = say(docs.id, 'user', 1_400_000, { text: docs.title })
    say(docs.id, 'error', 1_300_000, { turn: u.id, text: docs.error ?? '' })
  }
}
