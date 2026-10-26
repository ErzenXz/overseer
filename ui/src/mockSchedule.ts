// DEV-ONLY MOCK for scheduled sessions, guardrails and "continue in another
// agent". Served by mock.ts in demo mode; nothing here ships to a real hub.

import type { ScheduledItem, GuardCfg, GuardNotice, ContinuePreview, ContinueLinks } from './schedule'
import type { Thread, ThreadMessage } from './types'

type Base = (method: string, path: string, body: Record<string, unknown>) => Promise<Response | null>

const now = () => Math.floor(Date.now() / 1000)
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const names: Record<string, string> = { macbook: 'MacBook Pro', studio: 'Studio', homelab: 'Homelab', office: 'Office PC' }
const online = (id: string) => id !== 'office'

let counter = 1
const uid = (prefix: string) => `${prefix}_${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

function tomorrowNine() {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  date.setHours(9, 0, 0, 0)
  return Math.floor(date.getTime() / 1000)
}

function item(partial: Partial<ScheduledItem> & Pick<ScheduledItem, 'id' | 'title' | 'agent' | 'deviceId' | 'trigger' | 'startsAt'>): ScheduledItem {
  return {
    status: 'waiting', deviceName: names[partial.deviceId] ?? partial.deviceId, deviceOnline: online(partial.deviceId), createdAt: now() - 600,
    cwd: '~/Projects/storefront', prompt: partial.title, ...partial,
  }
}

let scheduled: ScheduledItem[] = [
  item({
    id: 'sc_hold', title: 'Refactor the billing export job', agent: 'claude', model: 'sonnet', deviceId: 'studio', reason: 'guardrail', cwd: '~/Projects/storefront',
    prompt: 'Refactor the billing export job so it streams rows instead of loading them all, and add a test with 100k rows.',
    trigger: { kind: 'limit_reset', window: 'seven_day', windowLabel: 'Weekly', threshold: 90, resetsAt: now() + 3 * 86400 + 5 * 3600 }, startsAt: now() + 3 * 86400 + 5 * 3600 + 30, createdAt: now() - 420,
  }),
  item({
    id: 'sc_reset', title: 'Review migration 0042 for locking', agent: 'codex', deviceId: 'macbook', cwd: '~/Projects/storefront',
    prompt: 'Review migration 0042 for table locks on large tables and suggest a safer order.',
    trigger: { kind: 'limit_reset', window: 'primary', windowLabel: '5-hour', threshold: 90, resetsAt: now() + 72 * 60 }, startsAt: now() + 72 * 60 + 30, createdAt: now() - 1500,
  }),
  item({
    id: 'sc_morning', title: 'Weekly dependency update', agent: 'claude', model: 'opus', deviceId: 'macbook', cwd: '~/Projects/api-gateway',
    prompt: 'Update dependencies, run the tests, and open a pull request.', trigger: { kind: 'time', at: tomorrowNine() }, startsAt: tomorrowNine(), createdAt: now() - 3600,
  }),
  item({
    id: 'sc_office', title: 'Index the docs folder', agent: 'claude', deviceId: 'office', cwd: '~/src/storefront',
    prompt: 'Index the docs folder and list stale pages.', trigger: { kind: 'time', at: now() - 900 }, startsAt: now() - 900, note: 'Waiting for Office PC to come online', createdAt: now() - 7200,
  }),
]

let guardrails: Record<string, GuardCfg> = {
  claude: { holdEnabled: true, holdPercent: 90, pauseEnabled: false, pausePercent: 98 },
  codex: { holdEnabled: false, holdPercent: 90, pauseEnabled: false, pausePercent: 98 },
}

let notices: GuardNotice[] = [
  {
    id: 'gn_1', kind: 'hold', agent: 'claude', deviceId: 'studio', deviceName: 'Studio', percent: 93, threshold: 90, refId: 'sc_hold', title: 'Refactor the billing export job',
    message: 'Held “Refactor the billing export job”: Claude’s weekly limit on Studio is at 93% (hold at 90%). It starts when the limit resets, in 3d 5h.', createdAt: now() - 420,
  },
]

// ---- the continued pair ----

const A = 'th_pay_claude'
const B = 'th_pay_codex'
const links: Record<string, { from?: string; to: string[] }> = { [A]: { to: [B] }, [B]: { from: A, to: [] } }

function thread(partial: Partial<Thread> & Pick<Thread, 'id' | 'title' | 'agent'>): Thread {
  const updated = partial.updatedAt ?? now() - 600
  return { deviceId: 'macbook', deviceName: 'MacBook Pro', cwd: '~/Projects/storefront', access: 'auto', status: 'idle', createdAt: updated - 5400, updatedAt: updated, lastReadAt: updated, terminal: `t-${partial.id}`, ...partial }
}

const demoThreads: Thread[] = [
  thread({ id: A, title: 'Move payments webhooks to the new SDK', agent: 'claude', model: 'opus', status: 'error', error: 'Claude usage limit reached. Your limit resets at 3:00 PM.', updatedAt: now() - 2400, lastReadAt: now() - 2400, usage: { inputTokens: 311_000, outputTokens: 18_400, costUsd: 1.9, contextTokens: 74_000, contextWindow: 200_000 } }),
  thread({ id: B, title: 'Continue: Move payments webhooks to the new SDK', agent: 'codex', status: 'idle', updatedAt: now() - 900, lastReadAt: now() - 900, usage: { inputTokens: 96_000, outputTokens: 7_400, costUsd: 0.52, contextTokens: 38_000, contextWindow: 272_000 } }),
]

const known: Thread[] = [...demoThreads] // fixtures plus sessions continued in this demo
let seq = 1
function message(partial: Partial<ThreadMessage> & Pick<ThreadMessage, 'id' | 'role' | 'text'>, secondsAgo: number): ThreadMessage {
  const at = (now() - secondsAgo) * 1000
  return { seq: seq++, at, updatedAt: at, ...partial }
}

const HANDOFF = `You are taking over a coding task from Claude Code (you are Codex). Carry on in the same folder (~/Projects/storefront) from where it left off. Do not redo finished work.

## Original goal
Move the payments webhooks to the new payments SDK. Keep the signature checks, and keep the old endpoints answering until the cutover.

## What happened so far
1. Asked: Move the payments webhooks to the new payments SDK. Keep the signature checks…
   Result: Ported charge.succeeded and charge.refunded to the new SDK handlers with signature verification. invoice.paid is still on the old path.
2. Asked: Add tests for the new handlers.
   Result: no final answer (interrupted or stuck).

## Files changed
- internal/payments/webhook.go (+148 −61)
- internal/payments/webhook_test.go (+92 −0)

Current \`git diff --stat\`:
\`\`\`
 internal/payments/webhook.go      | 209 ++++++++++++++++++---
 internal/payments/webhook_test.go |  92 ++++++++++
 2 files changed, 241 insertions(+), 60 deletions(-)
\`\`\`

## Current plan
- [x] Port charge.succeeded
- [x] Port charge.refunded
- [~] Add tests for the new handlers
- [ ] Port invoice.paid
([x] done, [~] in progress, [ ] to do)

## Last error
\`\`\`
Claude usage limit reached. Your limit resets at 3:00 PM.
\`\`\`

## What is left
- Add tests for the new handlers
- Port invoice.paid
- Work out why the last step failed and fix it.

Start by running \`git status\` and \`git diff\` to see the current state of the folder, then continue.`

const demoMessages: Record<string, ThreadMessage[]> = {
  [A]: [
    message({ id: 'pa1', role: 'user', text: 'Move the payments webhooks to the new payments SDK. Keep the signature checks, and keep the old endpoints answering until the cutover.' }, 5200),
    message({ id: 'pa2', role: 'tool', turn: 'pa1', text: '', tool: { name: 'edit', title: 'Edit internal/payments/webhook.go', status: 'completed', input: 'internal/payments/webhook.go', files: [{ path: 'internal/payments/webhook.go', additions: 148, deletions: 61 }] } }, 4800),
    message({ id: 'pa3', role: 'assistant', turn: 'pa1', durationMs: 640_000, text: 'Ported `charge.succeeded` and `charge.refunded` to the new SDK handlers with signature verification. `invoice.paid` is still on the old path.' }, 4400),
    message({ id: 'pa4', role: 'user', text: 'Add tests for the new handlers.' }, 3000),
    message({ id: 'pa5', role: 'tool', turn: 'pa4', text: '', tool: { name: 'edit', title: 'Edit internal/payments/webhook_test.go', status: 'completed', input: 'internal/payments/webhook_test.go', files: [{ path: 'internal/payments/webhook_test.go', additions: 92, deletions: 0 }] } }, 2700),
    message({ id: 'pa6', role: 'error', turn: 'pa4', text: 'Claude usage limit reached. Your limit resets at 3:00 PM.' }, 2400),
    message({ id: 'pa7', role: 'status', text: 'Continued in “Continue: Move payments webhooks to the new SDK” (Codex).' }, 880),
  ],
  [B]: [
    message({ id: 'pb0', role: 'status', text: 'Continued from “Move payments webhooks to the new SDK” (Claude Code).' }, 905),
    message({ id: 'pb1', role: 'user', text: HANDOFF }, 900),
    message({ id: 'pb2', role: 'tool', turn: 'pb1', text: '', tool: { name: 'bash', title: 'Check the folder', status: 'completed', input: 'git status --short && git diff --stat', output: ' M internal/payments/webhook.go\n?? internal/payments/webhook_test.go' } }, 860),
    message({ id: 'pb3', role: 'assistant', turn: 'pb1', durationMs: 214_000, text: 'Picked this up from the diff. The two ported handlers look right, so I finished the test file and ran it.\n\n**All 9 tests pass.** `invoice.paid` is next.' }, 600),
  ],
}

function previewFor(base: Thread, messages: ThreadMessage[], toAgent: string): ContinuePreview {
  if (base.id === A) {
    return { prompt: HANDOFF.replace('(you are Codex)', `(you are ${toAgent === 'claude' ? 'Claude Code' : toAgent === 'codex' ? 'Codex' : toAgent})`), title: `Continue: ${base.title}`, files: [{ path: 'internal/payments/webhook.go', additions: 148, deletions: 61 }, { path: 'internal/payments/webhook_test.go', additions: 92, deletions: 0 }], stats: { turns: 2, files: 2, planDone: 2, planTotal: 4, lastError: true, diffStat: true } }
  }
  const users = messages.filter((entry) => entry.role === 'user' && !entry.queued)
  const answers = messages.filter((entry) => entry.role === 'assistant')
  const files = new Map<string, { additions: number; deletions: number }>()
  for (const entry of messages) for (const file of entry.tool?.files ?? []) {
    const prev = files.get(file.path) ?? { additions: 0, deletions: 0 }
    files.set(file.path, { additions: prev.additions + (file.additions ?? 0), deletions: prev.deletions + (file.deletions ?? 0) })
  }
  const lastError = [...messages].reverse().find((entry) => entry.role === 'error')?.text ?? ''
  const lines = [
    `You are taking over a coding task from ${base.agent === 'claude' ? 'Claude Code' : base.agent}. Carry on in the same folder (${base.cwd}) from where it left off. Do not redo finished work.`,
    '',
    '## Original goal',
    users[0]?.text ?? base.title,
    '',
    '## What happened so far',
    ...users.map((entry, index) => `${index + 1}. Asked: ${entry.text.split('\n')[0].slice(0, 160)}\n   Result: ${(answers.find((answer) => answer.turn === entry.id)?.text ?? 'no final answer (interrupted or stuck).').split('\n')[0].slice(0, 240)}`),
    '',
    ...(files.size ? ['## Files changed', ...[...files.entries()].map(([path, count]) => `- ${path} (+${count.additions} −${count.deletions})`), ''] : []),
    ...(lastError ? ['## Last error', '```', lastError, '```', ''] : []),
    '## What is left',
    '- Check the work against the original goal and finish anything missing.',
    '',
    'Start by running `git status` and `git diff` to see the current state of the folder, then continue.',
  ]
  return { prompt: lines.join('\n'), title: `Continue: ${base.title}`, files: [...files.entries()].map(([path, count]) => ({ path, ...count })), stats: { turns: users.length, files: files.size, planDone: 0, planTotal: 0, lastError: !!lastError, diffStat: false } }
}

// ---- routes ----

export async function scheduleRoute(method: string, path: string, body: Record<string, unknown>, base: Base): Promise<Response | null> {
  if (path === '/api/scheduled' && method === 'GET') return json(scheduled)
  if (path === '/api/scheduled' && method === 'POST') {
    const trigger = body.trigger as { kind: string; at?: number }
    const deviceId = String(body.deviceId ?? 'macbook')
    const agent = String(body.agent ?? 'claude')
    const prompt = String(body.prompt ?? '')
    if (!prompt.trim()) return json({ error: 'prompt is required' }, 400)
    const isLimit = trigger?.kind === 'limit_reset'
    const resetsAt = now() + (agent === 'codex' ? 3 * 3600 + 40 * 60 : 3 * 86400 + 5 * 3600)
    const created = item({
      id: uid('sc'), title: String(body.title || prompt.split('\n')[0].slice(0, 60)), agent, deviceId, cwd: String(body.cwd || ''), prompt, model: body.model ? String(body.model) : undefined,
      source: body.source as ScheduledItem['source'], images: body.images as ScheduledItem['images'], createdAt: now(),
      trigger: isLimit ? { kind: 'limit_reset', window: agent === 'codex' ? 'secondary' : 'seven_day', windowLabel: 'Weekly', threshold: 90, resetsAt } : { kind: 'time', at: Number(trigger?.at ?? now() + 3600) },
      startsAt: isLimit ? resetsAt + 30 : Number(trigger?.at ?? now() + 3600),
    })
    scheduled = [...scheduled, created]
    return json(created)
  }
  const one = path.match(/^\/api\/scheduled\/([^/]+)(\/start)?$/)
  if (one) {
    const id = decodeURIComponent(one[1])
    const found = scheduled.find((entry) => entry.id === id)
    if (!found) return json({ error: 'scheduled session not found' }, 404)
    if (method === 'DELETE') { scheduled = scheduled.filter((entry) => entry.id !== id); return json({ ok: true }) }
    if (method === 'PATCH') {
      const trigger = body.trigger as { kind: string; at?: number } | undefined
      const next: ScheduledItem = { ...found, status: 'waiting', error: undefined, note: undefined, ...(body as Partial<ScheduledItem>), id }
      if (trigger?.kind === 'time') { next.trigger = { kind: 'time', at: Number(trigger.at) }; next.startsAt = Number(trigger.at) }
      if (trigger?.kind === 'limit_reset' && found.trigger.kind !== 'limit_reset') { next.trigger = { kind: 'limit_reset', window: 'seven_day', windowLabel: 'Weekly', threshold: 90, resetsAt: now() + 3 * 86400 }; next.startsAt = now() + 3 * 86400 + 30 }
      next.title = String(body.title ?? (body.prompt ? String(body.prompt).split('\n')[0].slice(0, 60) : found.title))
      scheduled = scheduled.map((entry) => entry.id === id ? next : entry)
      return json(next)
    }
    if (method === 'POST' && one[2]) {
      if (!online(found.deviceId)) return json({ error: 'device is offline' }, 503)
      const response = await base('POST', '/api/threads', { deviceId: found.deviceId, agent: found.agent, cwd: found.cwd, prompt: found.prompt, title: found.title, model: found.model, clientRequestId: `sched-${id}` })
      const started = response ? await response.json() as Thread : null
      scheduled = scheduled.filter((entry) => entry.id !== id)
      return json({ ...found, status: 'started', threadId: started?.id })
    }
  }
  if (path === '/api/guardrails' && method === 'GET') return json(guardrails)
  if (path === '/api/guardrails' && method === 'PUT') { guardrails = { ...guardrails, ...(body as Record<string, GuardCfg>) }; return json(guardrails) }
  if (path === '/api/guardrails/notices' && method === 'GET') return json(notices)
  const notice = path.match(/^\/api\/guardrails\/notices\/([^/]+)$/)
  if (notice && method === 'DELETE') { notices = notices.filter((entry) => entry.id !== decodeURIComponent(notice[1])); return json({ ok: true }) }

  // The continued pair appears in the session list and opens like any session.
  if (path === '/api/threads' && method === 'GET') {
    const response = await base(method, path, body)
    const list = response ? await response.json() as Thread[] : []
    return json([...demoThreads.filter((entry) => !list.some((other) => other.id === entry.id)), ...list].sort((a, b) => b.updatedAt - a.updatedAt))
  }
  const threadPath = path.match(/^\/api\/threads\/([^/]+)(?:\/(continue)(?:\/(preview))?)?$/)
  if (threadPath) {
    const id = decodeURIComponent(threadPath[1])
    const demo = demoThreads.find((entry) => entry.id === id && demoMessages[id])
    if (!threadPath[2]) {
      if (demo && method === 'GET') return json({ thread: demo, messages: demoMessages[id] })
      if (demo && method === 'PATCH') { Object.assign(demo, body.read === true ? { lastReadAt: now() + 1 } : {}); return json({ ...demo }) }
      return null
    }
    if (threadPath[2] === 'continue' && !threadPath[3] && method === 'GET') {
      const pick = (threadId: string) => { const t = known.find((entry) => entry.id === threadId); return t ? { id: t.id, title: t.title, agent: t.agent, status: t.status } : null }
      const entry = links[id]
      const out: ContinueLinks = { from: entry?.from ? pick(entry.from) : null, to: (entry?.to ?? []).map(pick).filter((x): x is NonNullable<typeof x> => !!x) }
      return json(out)
    }
    // Any session can be continued: the fixtures carry their own transcript.
    let source: Thread | undefined = demo
    let messages: ThreadMessage[] = demo ? demoMessages[id] : []
    if (!demo) {
      const found = await base('GET', `/api/threads/${id}`, {})
      const data = found ? await found.json().catch(() => null) as { thread?: Thread; messages?: ThreadMessage[] } | null : null
      source = data?.thread
      messages = data?.messages ?? []
    }
    if (!source) return json({ error: 'thread not found' }, 404)
    if (threadPath[3] === 'preview' && method === 'POST') {
      await new Promise((resolve) => setTimeout(resolve, 350))
      return json(previewFor(source, messages, String(body.agent ?? 'codex')))
    }
    if (threadPath[2] === 'continue' && method === 'POST') {
      if (!online(source.deviceId)) return json({ error: 'device is offline' }, 503)
      const response = await base('POST', '/api/threads', { deviceId: source.deviceId, agent: String(body.agent ?? 'codex'), cwd: source.cwd, prompt: String(body.prompt ?? ''), title: String(body.title ?? `Continue: ${source.title}`), model: body.model, effort: body.effort, clientRequestId: body.clientRequestId })
      if (!response || !response.ok) return response ?? json({ error: 'could not start' }, 500)
      const created = await response.clone().json() as Thread
      links[created.id] = { from: id, to: [] }
      links[id] = { ...(links[id] ?? { to: [] }), to: [...(links[id]?.to ?? []), created.id] }
      known.push(created)
      return response
    }
  }
  return null
}

// scheduleThreadStream lets the demo pair open: other sessions use the normal mock stream.
type Listener = (event: { type: 'snapshot'; thread: Thread; messages: ThreadMessage[] }) => void
export function scheduleThreadStream<T extends (id: string, listener: never) => () => void>(base: T): T {
  return ((id: string, listener: Listener) => {
    const demo = demoThreads.find((entry) => entry.id === id && demoMessages[id])
    if (!demo) return (base as unknown as (id: string, listener: Listener) => () => void)(id, listener)
    const timer = window.setTimeout(() => listener({ type: 'snapshot', thread: { ...demo }, messages: demoMessages[id].map((entry) => ({ ...entry })) }), 60)
    return () => window.clearTimeout(timer)
  }) as unknown as T
}

// withSchedule puts the continued pair into a thread route, so other mock
// layers that read sessions through it (mockTeams.ts) see them too.
export function withSchedule(base: Base): Base {
  return async (method, path, body) => (await scheduleRoute(method, path, body, base)) ?? base(method, path, body)
}
