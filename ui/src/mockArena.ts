// DEV-ONLY MOCK (see mock.ts): Agent Arena demo data. `demo` is a race that
// starts when you first open it (three agents, one still working after half a
// minute, then a scoreboard); `demo-done` is the same race, long finished.
// Starting an arena from the setup page makes a new one that plays out the
// same way.

import type { Arena, ArenaContestant, ArenaOutcome } from './arena'
import type { StreamEvent } from './store'
import type { Thread, ThreadMessage } from './types'

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

interface Step { tool: ThreadMessage['tool'] & { name: string }; note?: string }

interface Script {
  agent: string
  model?: string
  effort?: string
  finishAfter: number // real seconds until it stops
  duration: number // seconds it "took", as shown
  stats: { files: number; additions: number; deletions: number }
  check: { exitCode: number; output: string; durationMs: number }
  tokens: { in: number; out: number; cost?: number }
  steps: Step[]
  answer: string
}

const edit = (path: string, additions: number, deletions: number): Step => ({ tool: { name: 'edit', title: `Edit ${path}`, status: 'completed', input: path, files: [{ path, additions, deletions }] } })
const read = (path: string): Step => ({ tool: { name: 'read', title: `Read ${path}`, status: 'completed', input: path } })
const grep = (what: string): Step => ({ tool: { name: 'grep', title: `Search for ${what}`, status: 'completed', input: what } })
const bash = (command: string, output = ''): Step => ({ tool: { name: 'bash', title: 'Run command', status: 'completed', input: command, output } })

const scripts: Script[] = [
  {
    agent: 'claude', model: 'opus', effort: 'high', finishAfter: 14, duration: 130,
    stats: { files: 4, additions: 86, deletions: 21 },
    check: { exitCode: 0, durationMs: 41_000, output: 'ok  \tgithub.com/acme/api/internal/auth\t3.412s\nok  \tgithub.com/acme/api/internal/session\t0.884s' },
    tokens: { in: 188_400, out: 23_900, cost: 1.12 },
    steps: [
      read('internal/auth/session_test.go'), grep('time.Sleep'), read('internal/auth/session.go'), edit('internal/auth/clock.go', 24, 0),
      edit('internal/auth/session.go', 18, 9), edit('internal/auth/session_test.go', 38, 12), bash('go test ./internal/auth/... -count=20', 'ok  \tgithub.com/acme/api/internal/auth\t3.412s'),
    ],
    answer: 'The flake was a race between the session expiry ticker and `time.Sleep(10ms)` in the tests.\n\nI added a small `Clock` interface (`internal/auth/clock.go`), injected it into the session store, and replaced the sleeps with `clock.Advance(ttl)`. The suite now passes 20 runs in a row.',
  },
  {
    agent: 'codex', finishAfter: 26, duration: 182,
    stats: { files: 6, additions: 142, deletions: 57 },
    check: { exitCode: 0, durationMs: 52_000, output: 'ok  \tgithub.com/acme/api/internal/auth\t4.071s\nok  \tgithub.com/acme/api/internal/session\t1.002s' },
    tokens: { in: 281_000, out: 24_300, cost: 0.88 },
    steps: [
      grep('Sleep'), read('internal/auth/session_test.go'), read('internal/auth/store.go'), edit('internal/auth/store.go', 31, 14), edit('internal/auth/clock.go', 29, 0),
      edit('internal/auth/session_test.go', 44, 19), edit('internal/session/session.go', 22, 18), edit('internal/auth/export_test.go', 16, 6), bash('go test ./internal/... -count=10', 'ok  \tgithub.com/acme/api/internal/auth\t4.071s'),
    ],
    answer: 'Replaced real sleeps with a fake clock across the auth and session packages, and tightened the store so expiry is computed from one place.\n\nTests pass 10 runs in a row. This touches more files than strictly needed, so review `internal/session/session.go` first.',
  },
  {
    agent: 'gemini', model: 'gemini-2.5-pro', finishAfter: 44, duration: 281,
    stats: { files: 3, additions: 64, deletions: 9 },
    check: { exitCode: 1, durationMs: 38_000, output: '--- FAIL: TestSessionExpiry (0.02s)\n    session_test.go:97: expired session still valid\nFAIL\nFAIL\tgithub.com/acme/api/internal/auth\t3.208s\nFAIL' },
    tokens: { in: 171_200, out: 16_800, cost: 0.31 },
    steps: [
      read('internal/auth/session_test.go'), read('internal/auth/session.go'), grep('Expiry'), edit('internal/auth/session.go', 20, 4), edit('internal/auth/session_test.go', 44, 5),
      bash('go test ./internal/auth/...', 'FAIL\tgithub.com/acme/api/internal/auth'),
    ],
    answer: 'I made the expiry check use a configurable clock and updated the tests to advance it. One test still fails intermittently; I was not able to find why in the time available.',
  },
]

const PROMPT = 'The auth integration tests fail about 1 in 5 runs. Find out why and fix it. Keep the change small.'
const CHECK = 'go test ./internal/auth/... -count=20'

interface Run { id: string; start: number; arena: Arena; scripts: Script[]; static?: boolean }
const runs = new Map<string, Run>()
const choice = new Map<string, { winner: number; outcome: ArenaOutcome; url?: string; note?: string; cleaned?: boolean; removed: Set<number> }>()
let made = 0

const START_KEY = 'overseer:mock:arena:demo'

function baseArena(id: string, title: string, prompt: string, check: string, start: number): Arena {
  return {
    id, title, prompt, deviceId: 'macbook', deviceName: 'MacBook Pro', cwd: '~/Projects/api-gateway', repoRoot: '/Users/erzen/Projects/api-gateway',
    remoteKey: 'github.com/acme/api-gateway', baseCommit: '4f1c2aa9d3b8e6a0c5b7d21e9f0a4c3b2d1e0f98', baseBranch: 'main', check, access: 'auto',
    status: 'running', createdAt: Math.floor(start / 1000), contestants: [],
  }
}

function getRun(id: string): Run | null {
  const known = runs.get(id)
  if (known) return known
  if (id === 'demo') {
    let start = Date.now()
    try {
      const saved = Number(sessionStorage.getItem(START_KEY))
      if (saved > 0 && Date.now() - saved < 20 * 60_000) start = saved
      else sessionStorage.setItem(START_KEY, String(start))
    } catch { /* storage unavailable */ }
    const run: Run = { id, start, arena: baseArena(id, 'Fix flaky auth tests', PROMPT, CHECK, start), scripts }
    runs.set(id, run)
    return run
  }
  if (id === 'demo-done') {
    const start = Date.now() - 3 * 3600_000
    const run: Run = { id, start, arena: baseArena(id, 'Add rate limiting to the login endpoint', 'Add rate limiting to the login endpoint: 5 attempts per minute per IP, with a clear error. Add tests.', 'go test ./... ', start), scripts, static: true }
    runs.set(id, run)
    return run
  }
  return null
}

const threadId = (arenaId: string, n: number) => `arena_${arenaId}_${n}`
export const isMockArenaThread = (id: string) => id.startsWith('arena_')

function contestantAt(run: Run, script: Script, index: number, nowMs: number): ArenaContestant {
  const n = index + 1
  const real = run.static ? Infinity : (nowMs - run.start) / 1000
  const finishAt = run.static ? 0 : script.finishAfter
  const phase: ArenaContestant['state'] = real < 2 ? 'preparing' : real < finishAt ? 'running' : real < finishAt + 3 ? 'checking' : 'done'
  const finishedMs = run.static ? run.start + script.duration * 1000 : run.start + finishAt * 1000
  // A finished one counts from when it began; a running one counts up from now.
  const startedMs = phase === 'running' || phase === 'preparing' ? run.start + 1500 : finishedMs - script.duration * 1000
  const done = phase === 'done' || phase === 'checking'
  const id = threadId(run.id, n)
  const usageShare = phase === 'running' ? Math.min(1, Math.max(0, (real - 2) / Math.max(1, finishAt - 2))) : 1
  const thread: Thread = {
    id, title: `${run.arena.title} · ${script.agent}`, deviceId: 'macbook', deviceName: 'MacBook Pro', agent: script.agent, model: script.model,
    cwd: `~/.overseer/worktrees/arena/${run.id}/${n}-${script.agent}`, access: 'auto', status: done ? 'idle' : phase === 'preparing' ? 'starting' : 'working',
    createdAt: Math.floor(run.start / 1000), updatedAt: Math.floor((done ? finishedMs : nowMs) / 1000), lastReadAt: Math.floor(nowMs / 1000), folder: 'Arena',
    usage: phase === 'preparing' ? undefined : { inputTokens: Math.round(script.tokens.in * usageShare), outputTokens: Math.round(script.tokens.out * usageShare), costUsd: script.tokens.cost ? +(script.tokens.cost * usageShare).toFixed(2) : undefined },
  }
  const removed = choice.get(run.id)?.removed.has(n)
  const c: ArenaContestant = {
    n, agent: script.agent, model: script.model, effort: script.effort, deviceId: 'macbook', deviceName: 'MacBook Pro', cwd: run.arena.cwd,
    threadId: id, worktree: removed ? undefined : thread.cwd, branch: `arena/${run.id}/${script.agent}`, state: phase, startedAt: Math.floor(startedMs / 1000),
    thread,
  }
  if (done) {
    c.finishedAt = Math.floor(finishedMs / 1000)
    c.stats = { ...script.stats, changed: [] }
    if (phase === 'done' && run.arena.check) c.check = script.check
  }
  if (removed) c.removed = true
  return c
}

function viewOf(run: Run, nowMs = Date.now()): Arena {
  const contestants = run.scripts.map((script, i) => contestantAt(run, script, i, nowMs))
  const pending = contestants.some((c) => c.state !== 'done' && c.state !== 'failed')
  const pick = choice.get(run.id)
  return {
    ...run.arena,
    contestants,
    status: pending ? (contestants.every((c) => c.state === 'preparing') ? 'preparing' : 'running') : 'finished',
    winner: pick?.winner, outcome: pick?.outcome, outcomeUrl: pick?.url, outcomeNote: pick?.note, cleaned: pick?.cleaned,
    finishedAt: pending ? undefined : Math.floor(nowMs / 1000),
  }
}

// ---- messages for the live view ----

let seq = 0
function messagesFor(run: Run, index: number, nowMs: number): ThreadMessage[] {
  const script = run.scripts[index]
  const c = contestantAt(run, script, index, nowMs)
  const out: ThreadMessage[] = []
  const t0 = run.start + 1500
  const push = (partial: Partial<ThreadMessage> & Pick<ThreadMessage, 'role'>, at: number, updatedAt = at) => {
    out.push({ id: `${c.threadId}_m${out.length}`, seq: ++seq + out.length, at, updatedAt, text: '', ...partial })
  }
  push({ role: 'user', text: run.arena.prompt }, t0)
  if (c.state === 'preparing') return out
  const span = run.static ? script.duration * 1000 : (script.finishAfter - 2) * 1000
  const finished = c.state === 'done' || c.state === 'checking'
  const stepGap = span / (script.steps.length + 1)
  push({ role: 'thought', text: 'Start by finding what the tests wait on.' }, t0 + 800, t0 + 2200)
  script.steps.forEach((step, i) => {
    const at = t0 + 1200 + stepGap * (i + 0.7)
    if (!run.static && at > nowMs) return
    const next = t0 + 1200 + stepGap * (i + 1.7)
    const running = !finished && nowMs < next
    push({ role: 'tool', tool: { ...step.tool, status: running ? 'running' : 'completed' } }, at, running ? at : Math.min(next, at + 4000))
  })
  if (finished) push({ role: 'assistant', text: script.answer, durationMs: script.duration * 1000 }, run.static ? t0 + script.duration * 1000 : run.start + script.finishAfter * 1000)
  return out
}

export function mockArenaStream(id: string, onEvent: (event: StreamEvent) => void): () => void {
  const match = id.match(/^arena_(.+)_(\d+)$/)
  const run = match ? getRun(match[1]) : null
  if (!match || !run) return () => {}
  const index = Number(match[2]) - 1
  const emit = () => {
    const now = Date.now()
    const view = viewOf(run, now)
    const contestant = view.contestants[index]
    if (contestant?.thread) onEvent({ type: 'snapshot', thread: contestant.thread, messages: messagesFor(run, index, now) })
  }
  emit()
  const timer = window.setInterval(emit, 1000)
  return () => window.clearInterval(timer)
}

// ---- routes ----

export function arenaRoute(method: string, path: string, body: Record<string, unknown>): Response | null {
  if (!path.startsWith('/api/arenas')) return null
  if (path === '/api/arenas' && method === 'GET') return json(['demo', 'demo-done', ...[...runs.keys()].filter((id) => id.startsWith('demo-') && id !== 'demo-done')].map((id) => viewOf(getRun(id)!)))
  if (path === '/api/arenas' && method === 'POST') {
    const list = Array.isArray(body.contestants) ? (body.contestants as Record<string, unknown>[]) : []
    if (list.length < 2 || list.length > 4) return json({ error: 'an arena needs 2 to 4 contestants' }, 400)
    if (!String(body.prompt ?? '').trim()) return json({ error: 'prompt is required' }, 400)
    const id = `demo-new${++made}`
    const start = Date.now()
    const prompt = String(body.prompt).trim()
    const picked = list.map((item, i) => ({ ...scripts[i % scripts.length], agent: String(item.agent), model: String(item.model ?? '') || undefined, effort: String(item.effort ?? '') || undefined }))
    const arena = baseArena(id, String(body.title ?? '').trim() || prompt.split('\n')[0].slice(0, 60), prompt, String(body.check ?? '').trim(), start)
    const run: Run = { id, start, arena, scripts: picked }
    runs.set(id, run)
    return json(viewOf(run))
  }
  const match = path.match(/^\/api\/arenas\/([^/]+)(?:\/(winner|cleanup|stop|patch))?$/)
  if (!match) return null
  const run = getRun(decodeURIComponent(match[1]))
  if (!run) return json({ error: 'arena not found' }, 404)
  const action = match[2]
  if (!action && method === 'GET') return json(viewOf(run))
  if (!action && method === 'DELETE') { runs.delete(run.id); return json({ ok: true }) }
  if (action === 'patch') return new Response(`diff --git a/internal/auth/clock.go b/internal/auth/clock.go\nnew file mode 100644\n+++ b/internal/auth/clock.go\n@@ -0,0 +1,3 @@\n+package auth\n+\n+// demo patch\n`, { headers: { 'Content-Type': 'text/x-diff' } })
  if (action === 'stop') return json(viewOf(run))
  if (action === 'winner') {
    const n = Number(body.contestant)
    const view = viewOf(run)
    if (!view.contestants.some((c) => c.n === n && c.state === 'done')) return json({ error: 'only a contestant that finished can win' }, 409)
    const existing = choice.get(run.id)
    const entry = { winner: n, outcome: 'kept' as ArenaOutcome, removed: existing?.removed ?? new Set<number>(), cleaned: existing?.cleaned }
    if (body.action === 'pr') Object.assign(entry, { outcome: 'pr', url: 'https://github.com/acme/api-gateway/pull/412', note: '' })
    else if (body.action === 'apply') {
      if (run.arena.cwd.includes('LiveAgent')) return json({ error: 'The folder has uncommitted changes, so nothing was changed. Commit or stash them, or open a pull request instead.', code: 'dirty', dirty: 14 }, 409)
      Object.assign(entry, { outcome: 'applied', note: `Applied to ${run.arena.cwd} as uncommitted changes.` })
    } else Object.assign(entry, { outcome: 'kept', note: `Kept the branch arena/${run.id}/${view.contestants[n - 1].agent} on MacBook Pro.` })
    choice.set(run.id, entry)
    return json(viewOf(run))
  }
  if (action === 'cleanup') {
    const entry = choice.get(run.id)
    if (!entry) return json({ error: 'pick a winner first' }, 409)
    viewOf(run).contestants.forEach((c) => { if (c.n !== entry.winner || body.includeWinner) entry.removed.add(c.n) })
    entry.cleaned = true
    return json(viewOf(run))
  }
  return null
}
