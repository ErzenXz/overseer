import { useEffect, useState } from 'react'
import { api } from './api'

// Agent Wrapped: the shape of GET /api/stats and the small helpers the page,
// the canvas card and the Monday nudge share.

export type StatsRange = 'week' | 'month' | 'all'

export interface StatsTotals { sessions: number; turns: number; agentMs: number; prs: number; lines: number; approvals: number }

export interface StatsGroup {
  id: string
  name: string
  sessions: number
  turns: number
  agentMs: number
  added: number
  removed: number
  prs: number
  costUsd?: number
}

export interface StatsDay { date: string; sessions: number; turns: number; agentMs: number; lines: number }

export interface StatsSession {
  id: string
  title: string
  agent: string
  deviceName: string
  added: number
  removed: number
  turns: number
  agentMs: number
}

export interface WrappedStats {
  range: StatsRange | 'custom'
  start: number
  end: number
  tz: string
  sessions: { started: number; finished: number }
  turns: number
  agentMs: number
  agentHours: number
  prs: { opened: number; merged: number }
  lines: { added: number; removed: number }
  files: number
  approvals: number
  tokens: { input: number; output: number }
  costUsd: number
  agents: StatsGroup[]
  machines: StatsGroup[]
  days: StatsDay[]
  busiestDay?: StatsDay
  longestSession?: StatsSession
  topSession?: StatsSession
  streak: { current: number; longest: number }
  previous?: StatsTotals
}

const cache = new Map<StatsRange, WrappedStats>()

// useStats loads one range. A range seen before shows at once and refreshes
// in the background.
export function useStats(range: StatsRange) {
  const [stats, setStats] = useState<WrappedStats | null>(cache.get(range) ?? null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    setStats(cache.get(range) ?? null)
    setError('')
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    api.get<WrappedStats>(`/api/stats?range=${range}&tz=${encodeURIComponent(tz)}`)
      .then((next) => { cache.set(range, next); if (alive) setStats(next) })
      .catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : 'Could not load stats') })
    return () => { alive = false }
  }, [range])
  return { stats, error }
}

// ---- formatting ----

export function compact(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0).replace(/\.0$/, '')}M`
}

export const withCommas = (n: number) => Math.round(n).toLocaleString('en-US')

// hours turns milliseconds into a headline figure: "7.5" below ten hours,
// "31" above, "42" for minutes when under an hour.
export function hours(ms: number): { value: string; unit: string } {
  const h = ms / 3.6e6
  if (h < 1) return { value: String(Math.max(0, Math.round(ms / 60_000))), unit: 'min' }
  return { value: h < 10 ? h.toFixed(1).replace(/\.0$/, '') : String(Math.round(h)), unit: 'h' }
}

export const hoursText = (ms: number) => { const h = hours(ms); return `${h.value}${h.unit === 'min' ? ' min' : 'h'}` }

const monthDay = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

// rangeLabel: "Oct 20 – 26", "Oct 28 – Nov 3" or "All time".
export function rangeLabel(stats: WrappedStats): string {
  if (stats.range === 'all') return 'All time'
  const a = new Date(stats.start * 1000)
  const b = new Date(stats.end * 1000 - 1)
  return a.getMonth() === b.getMonth() ? `${monthDay(a)} – ${b.getDate()}` : `${monthDay(a)} – ${monthDay(b)}`
}

export const periodNoun = (range: WrappedStats['range']) => (range === 'week' ? 'this week' : range === 'month' ? 'this month' : 'so far')

// parseDay reads a YYYY-MM-DD day as local midnight.
export const parseDay = (date: string) => { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d) }

export const weekday = (date: string, style: 'short' | 'long' = 'long') => parseDay(date).toLocaleDateString('en-US', { weekday: style })

export function change(now: number, before?: number): { pct: number; up: boolean } | null {
  if (before === undefined || before <= 0 || now === before) return null
  return { pct: Math.round(Math.abs((now - before) / before) * 100), up: now > before }
}

export const hasActivity = (stats: WrappedStats) => stats.turns > 0 || stats.sessions.started > 0 || stats.agentMs > 0

// The most-used agent and machine are the first of their lists (the hub
// sorts by time worked).
export const mvp = (list: StatsGroup[]) => list[0]

export function shareText(stats: WrappedStats): string {
  const parts = [
    stats.prs.opened > 0 ? `${stats.prs.opened} PR${stats.prs.opened === 1 ? '' : 's'}` : '',
    stats.lines.added + stats.lines.removed > 0 ? `${compact(stats.lines.added + stats.lines.removed)} lines` : '',
    stats.agentMs > 0 ? `${hours(stats.agentMs).value}${hours(stats.agentMs).unit === 'min' ? ' agent-minutes' : ' agent-hours'}` : '',
  ].filter(Boolean)
  const when = stats.range === 'all' ? '' : stats.range === 'month' ? ' this month' : ' this week'
  return `My coding agents${when}: ${parts.join(', ') || `${stats.sessions.started} sessions`}. Run yours with Overseer → overseer.sh`
}

export const tweetUrl = (text: string) => `https://x.com/intent/post?text=${encodeURIComponent(text)}`

// ---- the Monday nudge ----

// weekKey names the local week (Monday first) a date falls in.
export function weekKey(date = new Date()): string {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7))
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`
}

// isNudgeDay: the week's recap is offered on Mondays only.
export const isNudgeDay = (date = new Date()) => date.getDay() === 1
