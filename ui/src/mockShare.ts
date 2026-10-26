// DEV-ONLY MOCK for shared session links. /s/demo is a replay of a finished
// demo session, /s/demo-live follows the running one, /s/demo-expired shows
// the expired page.

import { mockThreadStream, threadRoute } from './mockThreads'
import { WORK_IDS } from './mockWork'
import { looksPrivate, summarize, type PublicShare, type PublicThread, type ShareEvent, type ShareLink, type ShareMode } from './share'
import type { Thread, ThreadMessage } from './types'

const nowSec = () => Math.floor(Date.now() / 1000)
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

const agentNames: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI', opencode: 'OpenCode' }

interface Entry { link: ShareLink; token: string }
let entries: Entry[] = [
  { token: 'demo', link: { id: 'sh_demo1', threadId: WORK_IDS.done, title: 'Add retry with backoff to the login client', mode: 'replay', hideNames: true, createdAt: nowSec() - 3600 * 5, expiresAt: nowSec() + 86400 * 2, views: 41, expired: false } },
  { token: 'demo-live', link: { id: 'sh_demo2', threadId: WORK_IDS.live, title: 'Move session storage to Redis', mode: 'live', hideNames: true, createdAt: nowSec() - 600, expiresAt: 0, views: 3, expired: false } },
  { token: 'demo-expired', link: { id: 'sh_demo3', threadId: 'th_auth', title: 'Fix flaky auth integration tests', mode: 'replay', hideNames: false, createdAt: nowSec() - 86400 * 9, expiresAt: nowSec() - 86400 * 2, views: 212, expired: true } },
]

function publicThread(thread: Thread, hide: boolean): PublicThread {
  return {
    title: thread.title, agent: thread.agent, agentName: agentNames[thread.agent] ?? thread.agent, model: thread.model, status: thread.status, error: thread.error,
    createdAt: thread.createdAt, updatedAt: thread.updatedAt, deviceName: hide ? '' : thread.deviceName, cwd: hide ? '' : thread.cwd,
  }
}

const visible = (message: ThreadMessage) => message.role !== 'approval' && message.role !== 'question' && !message.queued

async function load(threadId: string): Promise<{ thread: Thread; messages: ThreadMessage[] } | null> {
  const response = await threadRoute('GET', `/api/threads/${threadId}`, {})
  return response && response.ok ? response.json() : null
}

function toPublic(data: { thread: Thread; messages: ThreadMessage[] }, mode: ShareMode, hide: boolean, expiresAt: number, freeze: boolean): PublicShare {
  const messages = data.messages.filter(visible)
  const thread = publicThread(data.thread, hide)
  if (freeze && ['working', 'starting', 'waiting'].includes(thread.status)) thread.status = 'idle'
  return { mode, hideNames: hide, expiresAt, thread, summary: summarize(messages), messages }
}

const find = (token: string) => entries.find((entry) => entry.token === token && !entry.link.expired)

export async function shareRoute(method: string, path: string, body: Record<string, unknown>): Promise<Response | null> {
  if (path === '/api/shares/info' && method === 'GET') return json({ baseUrl: location.origin, private: looksPrivate(location.host), docsUrl: 'https://overseer.sh/docs/remote-access/' })
  if (path === '/api/shares' && method === 'GET') return json([...entries].map((entry) => entry.link).sort((a, b) => b.createdAt - a.createdAt))
  if (path === '/api/shares' && method === 'POST') {
    const response = await threadRoute('GET', `/api/threads/${String(body.threadId)}`, {})
    if (!response || !response.ok) return json({ error: 'session not found' }, 404)
    const { thread } = await response.json() as { thread: Thread }
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 43)
    const ttl = ({ '1d': 86400, '7d': 86400 * 7, never: 0 } as Record<string, number>)[String(body.expires ?? '7d')] ?? 0
    const link: ShareLink = {
      id: `sh_${token.slice(0, 8)}`, threadId: thread.id, title: thread.title, mode: body.mode === 'live' ? 'live' : 'replay', hideNames: body.hideNames !== false,
      createdAt: nowSec(), expiresAt: ttl ? nowSec() + ttl : 0, views: 0, expired: false,
    }
    entries = [{ token, link }, ...entries]
    return json({ share: link, token, url: `${location.origin}/s/${token}`, private: looksPrivate(location.host) })
  }
  const revoke = path.match(/^\/api\/shares\/([^/]+)$/)
  if (revoke && method === 'DELETE') {
    const before = entries.length
    entries = entries.filter((entry) => entry.link.id !== decodeURIComponent(revoke[1]))
    return before === entries.length ? json({ error: 'share not found' }, 404) : json({ ok: true })
  }
  const pub = path.match(/^\/api\/public\/shares\/([^/]+)$/)
  if (pub && method === 'GET') {
    const entry = find(decodeURIComponent(pub[1]))
    const data = entry && await load(entry.link.threadId)
    if (!entry || !data) return json({ error: 'This link has expired' }, 404)
    entry.link.views++
    return json(toPublic(data, entry.link.mode, entry.link.hideNames, entry.link.expiresAt, entry.link.mode === 'replay'))
  }
  return null
}

// mockShareStream turns the demo session's own stream into a public one.
export function mockShareStream(token: string, onEvent: (event: ShareEvent) => void): () => void {
  const entry = find(token)
  if (!entry) { onEvent({ type: 'end', reason: 'expired' }); return () => {} }
  const hide = entry.link.hideNames
  return mockThreadStream(entry.link.threadId, (event) => {
    if (event.type === 'snapshot') onEvent({ type: 'snapshot', share: toPublic({ thread: event.thread, messages: event.messages }, 'live', hide, entry.link.expiresAt, false) })
    else if (event.type === 'message') { if (visible(event.message)) onEvent({ type: 'message', message: event.message }) }
    else onEvent({ type: 'thread', thread: publicThread(event.thread, hide) })
  })
}
