import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { agentInfo } from './agents'
import { createResource } from './store'
import type { Thread } from './types'

// Agent Arena: one prompt, several agents, each in its own git worktree of the
// same commit. The hub keeps the arena and measures every contestant
// (internal/hub/arena.go); this file is the shape of that data, the calls, and
// the scoreboard rules.

export type ArenaState = 'preparing' | 'running' | 'checking' | 'done' | 'failed'
export type ArenaOutcome = 'pr' | 'applied' | 'kept'

export interface ArenaStats {
  files: number
  additions: number
  deletions: number
  changed?: { path: string; additions: number; deletions: number }[]
}

export interface ArenaCheck {
  exitCode: number
  output?: string
  durationMs?: number
  error?: string // the check could not run at all
}

export interface ArenaContestant {
  n: number
  agent: string
  model?: string
  effort?: string
  fast?: boolean
  deviceId: string
  deviceName: string
  cwd: string
  threadId?: string
  worktree?: string
  branch?: string
  state: ArenaState
  error?: string
  startedAt?: number
  finishedAt?: number
  stats?: ArenaStats
  check?: ArenaCheck
  removed?: boolean
  thread?: Thread
}

export interface Arena {
  id: string
  title: string
  prompt: string
  deviceId: string
  deviceName: string
  cwd: string
  repoRoot?: string
  remoteKey?: string
  baseCommit: string
  baseBranch?: string
  dirtyAtStart?: number
  check?: string
  access: string
  status: 'preparing' | 'running' | 'finished'
  winner?: number
  outcome?: ArenaOutcome
  outcomeUrl?: string
  outcomeNote?: string
  cleaned?: boolean
  createdAt: number
  finishedAt?: number
  contestants: ArenaContestant[]
}

export interface NewArena {
  title?: string
  prompt: string
  deviceId: string
  cwd: string
  check?: string
  access?: string
  contestants: { agent: string; model?: string; effort?: string; fast?: boolean; deviceId: string; cwd: string }[]
}

export const MAX_CONTESTANTS = 4
export const MIN_CONTESTANTS = 2

export const arenasResource = createResource<Arena[]>('/api/arenas', 20000)

export async function createArena(input: NewArena) {
  const arena = await api.post<Arena>('/api/arenas', input, 90_000)
  arenasResource.set((list) => [arena, ...(list ?? []).filter((item) => item.id !== arena.id)])
  return arena
}

const SLOW = 6 * 60_000
export const pickWinner = (id: string, contestant: number, action: 'pr' | 'apply' | 'keep') => api.post<Arena>(`/api/arenas/${encodeURIComponent(id)}/winner`, { contestant, action }, SLOW)
export const cleanUpArena = (id: string, includeWinner: boolean) => api.post<Arena>(`/api/arenas/${encodeURIComponent(id)}/cleanup`, { confirm: true, includeWinner }, SLOW)
export const stopArena = (id: string) => api.post<Arena>(`/api/arenas/${encodeURIComponent(id)}/stop`)
export const forgetArena = async (id: string) => {
  await api.del(`/api/arenas/${encodeURIComponent(id)}`)
  arenasResource.set((list) => list?.filter((item) => item.id !== id) ?? list)
}
export const patchUrl = (id: string, contestant: number) => `/api/arenas/${encodeURIComponent(id)}/patch?contestant=${contestant}`

// useArena follows one arena: quick while it runs, still afterwards.
export function useArena(id: string) {
  const [arena, setArena] = useState<Arena | null>(null)
  const [error, setError] = useState('')
  const alive = useRef(true)
  const status = arena?.status
  const refresh = useCallback(async () => {
    try {
      const next = await api.get<Arena>(`/api/arenas/${encodeURIComponent(id)}`)
      if (alive.current) { setArena(next); setError('') }
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : 'Could not load the arena')
    }
  }, [id])
  useEffect(() => {
    alive.current = true
    setArena(null)
    setError('')
    refresh()
    return () => { alive.current = false }
  }, [id, refresh])
  useEffect(() => {
    if (status === 'finished') return
    const timer = window.setInterval(refresh, 2500)
    return () => window.clearInterval(timer)
  }, [status, refresh])
  return { arena, error, refresh, set: setArena }
}

// ---- reading a contestant ----

export const agentLabel = (agent: string) => agentInfo(agent).name

// modelLabel is "Opus · High": what was asked for, not what the CLI chose.
export function modelLabel(c: Pick<ArenaContestant, 'agent' | 'model' | 'effort'>): string {
  const info = agentInfo(c.agent)
  const model = c.model ? (info.models.find((item) => item.id === c.model)?.label ?? c.model) : ''
  const effort = c.effort ? c.effort.charAt(0).toUpperCase() + c.effort.slice(1) : ''
  return [model, effort].filter(Boolean).join(' · ')
}

export const isLive = (c: ArenaContestant) => c.state === 'preparing' || c.state === 'running'
export const isFinal = (c: ArenaContestant) => c.state === 'done' || c.state === 'failed'

// elapsedMs is how long a contestant has been working (or worked).
export function elapsedMs(c: ArenaContestant, now: number): number {
  if (!c.startedAt) return 0
  const end = c.state === 'running' || c.state === 'preparing' ? now / 1000 : (c.finishedAt || now / 1000)
  return Math.max(0, Math.round((end - c.startedAt) * 1000))
}

// checkResult: undefined when there is no check, otherwise whether it passed.
export function checkPassed(a: Arena, c: ArenaContestant): boolean | undefined {
  if (!a.check) return undefined
  if (!c.check) return c.state === 'failed' ? false : undefined
  return c.check.exitCode === 0 && !c.check.error
}

// good is "finished and, when there is a check, passed".
export const finishedWell = (a: Arena, c: ArenaContestant) => c.state === 'done' && checkPassed(a, c) !== false

export const totalTokens = (c: ArenaContestant) => (c.thread?.usage ? c.thread.usage.inputTokens + c.thread.usage.outputTokens : 0)
export const costOf = (c: ArenaContestant) => c.thread?.usage?.costUsd ?? 0

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export const fmtCost = (usd: number) => (usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`)

export const fmtTime = (ms: number) => (ms > 0 ? clock(ms) : '–')

// ---- highlights ----

export type Highlight = 'fastest' | 'smallest' | 'cheapest' | 'passes'
export const highlightText: Record<Highlight, string> = {
  fastest: 'Fastest',
  smallest: 'Smallest diff',
  cheapest: 'Cheapest',
  passes: 'Check passes',
}

// highlights awards a badge only where it means something: among contestants
// that finished (and passed the check, when there is one), and only when the
// numbers actually differ.
export function highlights(a: Arena): Map<number, Highlight[]> {
  const out = new Map<number, Highlight[]>()
  const add = (n: number, tag: Highlight) => out.set(n, [...(out.get(n) ?? []), tag])
  const eligible = a.contestants.filter((c) => finishedWell(a, c))
  const best = (value: (c: ArenaContestant) => number, tag: Highlight, usable: (c: ArenaContestant) => boolean = () => true) => {
    const pool = eligible.filter(usable)
    if (pool.length < 2) return
    const min = Math.min(...pool.map(value))
    const winners = pool.filter((c) => value(c) === min)
    if (winners.length === pool.length) return // a tie all round says nothing
    winners.forEach((c) => add(c.n, tag))
  }
  const now = Date.now()
  best((c) => elapsedMs(c, now), 'fastest', (c) => !!c.startedAt)
  best((c) => (c.stats ? c.stats.additions + c.stats.deletions : Infinity), 'smallest', (c) => !!c.stats && c.stats.files > 0)
  best(costOf, 'cheapest', (c) => costOf(c) > 0)
  if (a.check) {
    const passing = a.contestants.filter((c) => checkPassed(a, c) === true)
    if (passing.length && passing.length < a.contestants.length) passing.forEach((c) => add(c.n, 'passes'))
  }
  return out
}

// ---- sharing ----

// verdict is the mark beside a name on the result card.
export function verdict(a: Arena, c: ArenaContestant): '✓' | '✗' | '…' {
  if (c.state === 'failed') return '✗'
  if (c.state !== 'done') return '…'
  return checkPassed(a, c) === false ? '✗' : '✓'
}

// shareLine: "Claude Code ✓ 2m 10s · Codex ✓ 3m 02s · Gemini ✗"
export function shareLine(a: Arena): string {
  const now = Date.now()
  return a.contestants.map((c) => {
    const mark = verdict(a, c)
    const time = mark === '✓' ? ` ${clock(elapsedMs(c, now))}` : ''
    return `${agentLabel(c.agent)} ${mark}${time}`
  }).join(' · ')
}

// clock: 2m 10s style with two-digit seconds, matching the card.
export function clock(ms: number): string {
  const total = Math.max(1, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  if (m === 0) return `${s}s`
  if (m < 60) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export const shareText = (a: Arena) => `Arena: ${a.title} — ${shareLine(a)}`

export const tweetUrl = (a: Arena) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(`${shareText(a)}\n\nRaced on my own code with Overseer`)}`
