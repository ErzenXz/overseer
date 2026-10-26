// Teams: who is signed in, who else is on the hub, and what that changes in
// the UI (the Mine / Everyone filter, hand-offs, names on approvals).
// A hub with one person looks exactly as it always did: none of this shows.

import { useEffect, useRef } from 'react'
import { api } from './api'
import { createResource, threadsResource, usePref, useThreads } from './store'
import { notificationsAllowed, showNotice } from './notify'
import type { Thread } from './types'

export type Role = 'owner' | 'member'

export interface Person {
  id: string
  name: string
  email?: string
  role: Role
  createdAt: number
  lastSeen: number
  disabled: boolean
  removed?: boolean
}

interface MeState {
  user?: Person
  multiUser?: boolean
}

const meResource = createResource<MeState>('/api/me', 60_000)
const peopleResource = createResource<Person[]>('/api/users', 30_000)

export function refreshTeam() {
  meResource.refresh()
  peopleResource.refresh()
}

export interface Team {
  me?: Person
  // Everyone who can still use the hub, then everyone ever (for naming old work).
  people: Person[]
  all: Person[]
  multi: boolean
  isOwner: boolean
  loaded: boolean
  nameOf: (id?: string) => string
  find: (id?: string) => Person | undefined
}

export function useTeam(): Team {
  const { value: meState } = meResource.use()
  const { value: list } = peopleResource.use()
  const all = list ?? []
  const people = all.filter((person) => !person.removed && !person.disabled)
  const me = meState?.user
  const find = (id?: string) => (id ? all.find((person) => person.id === id) : undefined)
  const nameOf = (id?: string) => {
    const person = find(id)
    if (!person) return ''
    return person.removed ? `${person.name} (removed)` : person.name
  }
  return { me, people, all, multi: people.length > 1, isOwner: me?.role === 'owner', loaded: meState !== null && list !== null, nameOf, find }
}

// ---- Mine / Everyone ----

export type Scope = 'mine' | 'everyone'

export function useScope(multi: boolean): [Scope, (scope: Scope) => void] {
  const [scope, setScope] = usePref<Scope>('team.scope', 'everyone')
  return [multi ? scope : 'everyone', setScope]
}

// A session is mine when I started it or it is with me now.
export function isMine(thread: Thread, me?: Person) {
  return !!me && (thread.createdBy === me.id || thread.assignee === me.id)
}

// Handed to me and not opened since.
export function handedToMe(thread: Thread, me?: Person) {
  return !!me && !thread.archived && thread.assignee === me.id && !!thread.handoffAt && thread.handoffBy !== me.id && thread.lastReadAt < thread.handoffAt
}

// What the sidebar shows under the current scope.
export function inScope(thread: Thread, scope: Scope, me?: Person) {
  return scope === 'everyone' || isMine(thread, me)
}

// The "Needs you" group: sessions stopped on a question for me, and sessions
// a teammate handed me that I haven't opened yet.
export function needsYou(thread: Thread, scope: Scope, me?: Person) {
  if (thread.archived || !inScope(thread, scope, me)) return false
  return thread.status === 'waiting' || handedToMe(thread, me)
}

// ---- small shared bits ----

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const hues = [212, 262, 330, 24, 160, 190, 48, 290]
export function hueOf(id: string) {
  let hash = 0
  for (let index = 0; index < id.length; index++) hash = (hash * 31 + id.charCodeAt(index)) >>> 0
  return hues[hash % hues.length]
}

// ---- hand-off ----

export async function handOff(threadId: string, to: string, note: string) {
  const thread = await api.post<Thread>(`/api/threads/${encodeURIComponent(threadId)}/assign`, { to, note })
  threadsResource.set((threads) => threads?.map((item) => item.id === thread.id ? thread : item) ?? threads)
  return thread
}

const SEEN_KEY = 'overseer:team.handoffSeen'

function readSeen(): Record<string, number> | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function writeSeen(seen: Record<string, number>) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)) } catch { /* storage unavailable */ }
}

// useHandoffNotices tells me, once, when a teammate hands me a session: a
// toast in the app, and a desktop notice when those are on. The first load
// only records what is already pending, so old hand-offs stay quiet.
export function useHandoffNotices(toast: (text: string) => void, open: (id: string) => void) {
  const { value: threads } = useThreads()
  const team = useTeam()
  const [enabled] = usePref('notify.enabled', false)
  const latest = useRef({ toast, open, enabled })
  latest.current = { toast, open, enabled }
  useEffect(() => {
    if (!threads || !team.me || !team.loaded) return
    const me = team.me
    const first = readSeen() === null
    const seen = readSeen() ?? {}
    let changed = first
    for (const thread of threads) {
      if (!thread.handoffAt || thread.assignee !== me.id || thread.handoffBy === me.id) continue
      if ((seen[thread.id] ?? 0) >= thread.handoffAt) continue
      seen[thread.id] = thread.handoffAt
      changed = true
      if (first) continue
      const from = team.nameOf(thread.handoffBy) || 'Someone'
      latest.current.toast(`${from} handed you “${thread.title}”${thread.handoffNote ? `: ${thread.handoffNote}` : ''}`)
      if (latest.current.enabled && notificationsAllowed()) {
        showNotice(thread.title, `${from} handed you this session${thread.handoffNote ? `: ${thread.handoffNote}` : ''}`, `handoff-${thread.id}`, `/sessions/${thread.id}`, () => latest.current.open(thread.id))
      }
    }
    if (changed) writeSeen(seen)
  }, [threads, team.me?.id, team.loaded]) // eslint-disable-line react-hooks/exhaustive-deps
}
