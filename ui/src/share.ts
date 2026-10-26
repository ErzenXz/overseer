// Shared session links: types, calls and the live stream. The public page
// (pages/SharePage.tsx) and the owner's dialog (components/ShareDialog.tsx)
// both build on this.

import { api } from './api'
import { mockEnabled, mockShareStream } from './mock'
import type { ThreadMessage } from './types'

export type ShareMode = 'replay' | 'live'
export type ShareExpiry = '1d' | '7d' | 'never'

// One row in Settings → Shared links. The link itself is never stored, only
// shown once when it is made.
export interface ShareLink {
  id: string
  threadId: string
  title: string
  mode: ShareMode
  hideNames: boolean
  createdAt: number // unix seconds
  expiresAt: number // unix seconds, 0 = never
  views: number
  expired: boolean
}

export interface ShareInfo {
  baseUrl: string
  private: boolean
  docsUrl: string
}

export interface CreatedShare {
  share: ShareLink
  token: string
  url: string
  private: boolean
}

export const sharesApi = {
  info: () => api.get<ShareInfo>('/api/shares/info'),
  list: () => api.get<ShareLink[]>('/api/shares'),
  create: (body: { threadId: string; mode: ShareMode; hideNames: boolean; expires: ShareExpiry }) => api.post<CreatedShare>('/api/shares', body),
  revoke: (id: string) => api.del<{ ok: boolean }>(`/api/shares/${encodeURIComponent(id)}`),
}

// What the public page gets: only what is needed to draw the session.
export interface PublicThread {
  title: string
  agent: string
  agentName: string
  model?: string
  status: string
  error?: string
  createdAt: number
  updatedAt: number
  deviceName: string // empty when names are hidden
  cwd: string
}

export interface PublicSummary {
  steps: number
  files: number
  additions: number
  deletions: number
  turns: number
  durationMs: number
}

export interface PublicShare {
  mode: ShareMode
  hideNames: boolean
  expiresAt: number
  thread: PublicThread
  summary: PublicSummary
  messages: ThreadMessage[]
}

export type ShareEvent =
  | { type: 'snapshot'; share: PublicShare }
  | { type: 'message'; message: ThreadMessage }
  | { type: 'thread'; thread: PublicThread }
  | { type: 'end'; reason: string }

// openShareStream follows a live share. EventSource reconnects by itself and
// the hub starts every connection with a fresh snapshot.
export function openShareStream(token: string, onEvent: (event: ShareEvent) => void, onStatus: (connected: boolean) => void): () => void {
  if (mockEnabled) {
    onStatus(true)
    return mockShareStream(token, onEvent)
  }
  const source = new EventSource(`/api/public/shares/${encodeURIComponent(token)}/stream`)
  const parse = (event: MessageEvent) => { try { return JSON.parse(event.data) } catch { return null } }
  source.onopen = () => onStatus(true)
  source.onerror = () => onStatus(false)
  source.addEventListener('snapshot', (event) => { const share = parse(event as MessageEvent); if (share) onEvent({ type: 'snapshot', share }) })
  source.addEventListener('message', (event) => { const data = parse(event as MessageEvent); if (data?.message) onEvent({ type: 'message', message: data.message }) })
  source.addEventListener('thread', (event) => { const data = parse(event as MessageEvent); if (data?.thread) onEvent({ type: 'thread', thread: data.thread }) })
  source.addEventListener('end', (event) => { const data = parse(event as MessageEvent); source.close(); onEvent({ type: 'end', reason: data?.reason ?? 'ended' }) })
  return () => source.close()
}

// summarize counts what a session did, for the page header.
export function summarize(messages: ThreadMessage[]): PublicSummary {
  const files = new Set<string>()
  const sum: PublicSummary = { steps: 0, files: 0, additions: 0, deletions: 0, turns: 0, durationMs: 0 }
  let first = 0
  let last = 0
  let worked = 0
  for (const message of messages) {
    if (!first || message.at < first) first = message.at
    if (message.updatedAt > last) last = message.updatedAt
    if (message.role === 'user') sum.turns++
    else if (message.role === 'assistant' || message.role === 'status') worked += message.durationMs ?? 0
    else if (message.role === 'tool') {
      sum.steps++
      for (const file of message.tool?.files ?? []) {
        files.add(file.path)
        sum.additions += file.additions ?? 0
        sum.deletions += file.deletions ?? 0
      }
    }
  }
  sum.files = files.size
  sum.durationMs = worked || Math.max(0, last - first)
  return sum
}

// A hub address that only people on the same machine, network or tailnet can
// reach (the hub says so too; this is for the instant before it answers).
export function looksPrivate(host: string): boolean {
  const h = host.replace(/:\d+$/, '').toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.lan') || h.endsWith('.ts.net')) return true
  if (!h.includes('.') && !h.includes(':')) return true
  const m = h.match(/^(\d+)\.(\d+)\.\d+\.\d+$/)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
}
