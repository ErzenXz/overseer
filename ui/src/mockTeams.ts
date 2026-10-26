// DEV-ONLY MOCK for teams: three people (you, Sam and Mira), who started and
// holds each demo session, one session handed to you, people watching a
// session, invites and an activity log. Hooked in from mock.ts.

import type { Person } from './teams'
import type { Thread, ThreadMessage } from './types'

type ThreadRouteFn = (method: string, path: string, body: Record<string, unknown>) => Promise<Response | null>

const nowSec = () => Math.floor(Date.now() / 1000)
const ago = (seconds: number) => nowSec() - seconds

// A time that stays put across reloads of the demo, so it isn't "new" every time.
function stableAgo(key: string, seconds: number) {
  const k = `overseer:mock:team.${key}`
  const saved = Number(sessionStorage.getItem(k) ?? 0)
  if (saved) return saved
  const at = ago(seconds)
  sessionStorage.setItem(k, String(at))
  return at
}

const people: Person[] = [
  { id: 'u_erzen', name: 'Erzen', email: 'erzen@example.com', role: 'owner', createdAt: ago(86400 * 120), lastSeen: nowSec(), disabled: false },
  { id: 'u_sam', name: 'Sam', email: 'sam@example.com', role: 'member', createdAt: ago(86400 * 40), lastSeen: ago(60 * 3), disabled: false },
  { id: 'u_mira', name: 'Mira', email: 'mira@example.com', role: 'member', createdAt: ago(86400 * 12), lastSeen: ago(3600 * 2), disabled: false },
]
const me = people[0]

// Who started each demo session and who has it. Anything not listed is yours.
const holders: Record<string, { createdBy: string; assignee?: string }> = {
  th_audit: { createdBy: 'u_sam' },
  th_retry: { createdBy: 'u_mira' },
  th_rust: { createdBy: 'u_sam' },
  th_auth: { createdBy: 'u_sam' },
  th_archive: { createdBy: 'u_mira' },
  th_store: { createdBy: 'u_sam' },
  th_shop: { createdBy: 'u_mira' },
  th_leak: { createdBy: 'u_sam' },
  th_ui: { createdBy: 'u_mira', assignee: 'u_erzen' },
}

// One session was handed to you 25 minutes ago and is unread, so it sits in
// Needs you.
interface Handoff { by: string; note: string; at: number }
const handoffs: Record<string, Handoff> = {
  th_ui: { by: 'u_mira', note: 'CI is red on the auth tests. I got the retry logic in, can you take it from here?', at: stableAgo('handoff', 60 * 25) },
}

function decorate(thread: Thread): Thread {
  const holder = holders[thread.id] ?? { createdBy: me.id }
  const next: Thread = { ...thread, createdBy: holder.createdBy, assignee: holder.assignee ?? holder.createdBy }
  const handoff = handoffs[thread.id]
  if (handoff) Object.assign(next, { handoffBy: handoff.by, handoffNote: handoff.note, handoffAt: handoff.at })
  return next
}

function decorateMessage(message: ThreadMessage, thread?: Thread): ThreadMessage {
  if (message.role !== 'approval' || !message.approval?.resolved) return message
  const by = thread ? people.find((person) => person.id === (holders[thread.id]?.createdBy ?? me.id)) : me
  return { ...message, approval: { ...message.approval, answeredBy: by?.name ?? me.name } }
}

// Duck-typing keeps this working for lists, {thread}, {found, thread}, and
// {thread, messages} bodies alike.
function looksLikeThread(value: unknown): value is Thread {
  return !!value && typeof value === 'object' && 'deviceId' in value && 'agent' in value && 'status' in value && 'id' in value
}

function decorateBody(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decorateBody)
  if (looksLikeThread(value)) return decorate(value)
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    if (looksLikeThread(object.thread)) {
      const thread = decorate(object.thread)
      return { ...object, thread, ...(Array.isArray(object.messages) ? { messages: (object.messages as ThreadMessage[]).map((message) => decorateMessage(message, thread)) } : {}) }
    }
  }
  return value
}

// Who has each session open right now. You are always in your own list; the
// header shows everyone else.
const viewing: Record<string, string[]> = {
  th_rust: ['u_sam', 'u_mira', 'u_erzen'],
  th_ui: ['u_mira', 'u_erzen'],
}
const presenceFor = (threadId: string) => (viewing[threadId] ?? ['u_erzen']).map((id) => {
  const person = people.find((entry) => entry.id === id)!
  return { id: person.id, name: person.name }
})

// Wraps the demo session stream: ownership on every thread it sends, names on
// answered approvals, and presence right after the snapshot.
export function withTeamStream<L extends (event: any) => void>(inner: (id: string, listener: L) => () => void) {
  return (id: string, listener: L) => {
    let thread: Thread | undefined
    const wrapped = ((event: any) => {
      if (event.type === 'snapshot') {
        thread = decorate(event.thread)
        listener({ ...event, thread, messages: (event.messages as ThreadMessage[]).map((message) => decorateMessage(message, thread)) })
        window.setTimeout(() => listener({ type: 'presence', users: presenceFor(id) }), 60)
      } else if (event.type === 'thread') {
        thread = decorate(event.thread)
        listener({ ...event, thread })
      } else if (event.type === 'message') {
        listener({ ...event, message: decorateMessage(event.message, thread) })
      } else listener(event)
    }) as L
    return inner(id, wrapped)
  }
}

// ---- invites and the activity log ----

interface MockInvite { id: string; label?: string; createdBy: string; createdAt: number; expiresAt: number; status: 'pending' | 'used' | 'expired' | 'revoked'; usedBy?: string }
let invites: MockInvite[] = [
  { id: 'inv_1', label: 'Priya', createdBy: 'Erzen', createdAt: ago(86400 * 2), expiresAt: nowSec() + 86400 * 5, status: 'pending' },
  { id: 'inv_0', label: 'Mira', createdBy: 'Erzen', createdAt: ago(86400 * 12), expiresAt: ago(86400 * 5), status: 'used', usedBy: 'Mira' },
]

interface MockEntry { id: number; at: number; actor: string; action: string; target?: string; detail?: string }
let log: MockEntry[] = []
let logId = 1
const record = (actor: string, action: string, target?: string, detail?: string, at = nowSec()) => { log.unshift({ id: logId++, at, actor, action, target, detail }) }
;(() => {
  const seed: [number, string, string, string?, string?][] = [
    [86400 * 12 + 3600, 'Erzen', 'invite.create', 'Mira'],
    [86400 * 12, 'Mira', 'invite.accept', 'Mira'],
    [86400 * 9, 'Mira', 'login'],
    [86400 * 6, 'Sam', 'login'],
    [86400 * 5, 'Sam', 'session.start', 'Audit the storefront API for SQL injection'],
    [86400 * 5 - 900, 'Sam', 'approval', 'Audit the storefront API for SQL injection', 'allow_once'],
    [86400 * 2, 'Erzen', 'invite.create', 'Priya'],
    [86400, 'Mira', 'session.start', 'Add retry with backoff to the login client'],
    [3600 * 9, 'Erzen', 'settings.previews'],
    [3600 * 6, 'Sam', 'login'],
    [3600 * 5, 'Sam', 'session.start', 'Build Rust OpenAI harness'],
    [3600 * 4, 'Sam', 'approval', 'Build Rust OpenAI harness', 'allow_always'],
    [3600 * 3, 'Erzen', 'login'],
    [3600 * 2, 'Mira', 'session.start', 'Improve dashboard UI and features'],
    [60 * 40, 'Mira', 'login.failed'],
    [60 * 25, 'Mira', 'thread.handoff', 'Improve dashboard UI and features', 'to Erzen'],
    [60 * 11, 'Sam', 'approval', 'Fix flaky auth integration tests', 'allow_once'],
    [60 * 4, 'Erzen', 'session.start', 'Move session storage to Redis'],
  ]
  seed.forEach(([secs, actor, action, target, detail]) => record(actor, action, target, detail, ago(secs)))
  // Older history so "Show older" has something to show.
  for (let index = 0; index < 34; index++) record(index % 3 === 0 ? 'Erzen' : index % 3 === 1 ? 'Sam' : 'Mira', index % 4 === 0 ? 'login' : 'session.start', index % 4 === 0 ? undefined : `Older session ${index}`, undefined, ago(86400 * (14 + index)))
  log.sort((a, b) => b.at - a.at).forEach((entry, index, all) => { entry.id = all.length - index })
  logId = log.length + 1
})()

const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const fail = (error: string, status: number) => reply({ error }, status)

// What /api/me adds.
export function teamsMe(authed: boolean) {
  if (!authed) return { multiUser: sessionStorage.getItem('overseer:mock:multi') === '1' }
  return { multiUser: true, user: me }
}

export async function teamsRoute(method: string, path: string, search: URLSearchParams, body: Record<string, unknown>, authed: boolean, threadRoute: ThreadRouteFn): Promise<Response | null> {
  // Join page: open without signing in. Accepting is handled by mock.ts.
  const check = path.match(/^\/api\/invites\/([^/]+)$/)
  if (method === 'GET' && check) {
    return check[1].startsWith('gone') ? fail('this invite link is invalid or has expired', 404) : reply({ valid: true, label: 'Priya', invitedBy: me.name })
  }
  if (!authed) return null

  if (method === 'GET' && path === '/api/users') return reply(people)
  if (method === 'PATCH' && path === '/api/me') {
    if (typeof body.name === 'string' && body.name.trim()) me.name = body.name.trim()
    if (typeof body.email === 'string') me.email = body.email.trim()
    return reply(me)
  }
  if (method === 'POST' && path === '/api/me/password') {
    if (!body.current) return fail('your current password is wrong', 403)
    record(me.name, 'password.change')
    return reply({ ok: true })
  }
  const user = path.match(/^\/api\/users\/([^/]+)$/)
  if (user) {
    const person = people.find((entry) => entry.id === user[1])
    if (!person) return fail('no such person', 404)
    if (method === 'PATCH') {
      const owners = people.filter((entry) => entry.role === 'owner' && !entry.disabled).length
      if (person.role === 'owner' && owners <= 1 && (body.role === 'member' || body.disabled === true)) return fail('the hub needs at least one owner who can sign in', 409)
      if (typeof body.role === 'string' && body.role !== person.role) { record(me.name, 'user.role', person.name, `${person.role} to ${body.role}`); person.role = body.role as Person['role'] }
      if (typeof body.disabled === 'boolean' && body.disabled !== person.disabled) { record(me.name, body.disabled ? 'user.disable' : 'user.enable', person.name); person.disabled = body.disabled }
      return reply(person)
    }
    if (method === 'DELETE') {
      if (person.id === me.id) return fail('you can’t remove yourself', 409)
      person.removed = true
      person.disabled = true
      record(me.name, 'user.remove', person.name)
      return reply({ ok: true })
    }
  }

  if (method === 'GET' && path === '/api/invites') return reply(invites)
  if (method === 'POST' && path === '/api/invites') {
    const label = typeof body.label === 'string' ? body.label.trim() : ''
    const token = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
    invites = [{ id: `inv_${Date.now()}`, label, createdBy: me.name, createdAt: nowSec(), expiresAt: nowSec() + 7 * 86400, status: 'pending' }, ...invites]
    record(me.name, 'invite.create', label)
    return reply({ id: invites[0].id, label, token, url: `${location.origin}/invite/${token}`, expiresAt: invites[0].expiresAt })
  }
  const revoke = path.match(/^\/api\/invites\/([^/]+)$/)
  if (method === 'DELETE' && revoke) {
    const invite = invites.find((entry) => entry.id === revoke[1] && entry.status === 'pending')
    if (!invite) return fail('no pending invite with that id', 404)
    invite.status = 'revoked'
    record(me.name, 'invite.revoke', invite.label)
    return reply({ ok: true })
  }

  if (method === 'GET' && path === '/api/audit') {
    const before = Number(search.get('before') ?? 0) || Number.MAX_SAFE_INTEGER
    const limit = Math.min(200, Number(search.get('limit') ?? 50) || 50)
    const rows = log.filter((entry) => entry.id < before).sort((a, b) => b.id - a.id)
    const page = rows.slice(0, limit)
    return reply({ entries: page, next: rows.length > limit ? page[page.length - 1].id : 0 })
  }

  const assign = path.match(/^\/api\/threads\/([^/]+)\/assign$/)
  if (method === 'POST' && assign) {
    const to = people.find((entry) => entry.id === body.to && !entry.removed && !entry.disabled)
    if (!to) return fail('that person can’t take sessions', 400)
    if (to.id === me.id) return fail('pick someone else; this session is already with you', 400)
    const id = decodeURIComponent(assign[1])
    const found = await threadRoute('GET', `/api/threads/${id}`, {})
    const data = found ? await found.clone().json() as { thread?: Thread } : null
    if (!data?.thread) return fail('thread not found', 404)
    holders[id] = { createdBy: holders[id]?.createdBy ?? me.id, assignee: to.id }
    handoffs[id] = { by: me.id, note: String(body.note ?? '').trim(), at: nowSec() }
    record(me.name, 'thread.handoff', data.thread.title, `to ${to.name}`)
    window.dispatchEvent(new CustomEvent('overseer:mock-event', { detail: { type: 'threads.changed' } }))
    return reply({ ...decorate({ ...data.thread, lastReadAt: 0 }) })
  }

  // Sessions: the demo threads, with who started them and who has them.
  if (/^\/api\/threads(\/[^/]+)?$/.test(path)) {
    const response = await threadRoute(method, path, body)
    if (!response || !(response.headers.get('Content-Type') ?? '').includes('json')) return response
    const data = await response.clone().json().catch(() => undefined)
    if (data === undefined) return response
    if (method === 'POST' && looksLikeThread(data)) {
      holders[data.id] = { createdBy: me.id }
      record(me.name, 'session.start', data.title)
    }
    return new Response(JSON.stringify(decorateBody(data)), { status: response.status, headers: response.headers })
  }
  return null
}
