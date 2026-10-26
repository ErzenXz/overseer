import { useCallback, useEffect, useRef } from 'react'
import { api } from './api'
import { createResource, useHubStream } from './store'
import type { PlanLimits } from './types'

// Scheduled sessions, guardrails and "continue in another agent": the data
// layer. The hub starts scheduled sessions itself; this file only lists,
// edits and cancels them (docs/agent-sessions-api.md).

export type ScheduleTrigger =
  | { kind: 'time'; at: number }
  | { kind: 'limit_reset'; window?: string; windowLabel?: string; threshold?: number; resetsAt?: number }

export interface ScheduledItem {
  id: string
  status: 'waiting' | 'starting' | 'started' | 'failed'
  reason?: 'guardrail'
  trigger: ScheduleTrigger
  deviceId: string
  deviceName: string
  deviceOnline: boolean
  startsAt: number
  note?: string
  threadId?: string
  error?: string
  createdAt: number
  agent: string
  model?: string
  effort?: string
  fast?: boolean
  mode?: string
  cwd: string
  prompt: string
  title: string
  images?: { path: string }[]
  source?: { repo: string; branch: string; known?: string[] }
}

export interface GuardCfg {
  holdEnabled: boolean
  holdPercent: number
  pauseEnabled: boolean
  pausePercent: number
}

export interface GuardNotice {
  id: string
  kind: 'hold' | 'pause' | 'failed'
  agent: string
  deviceId: string
  deviceName: string
  percent?: number
  threshold?: number
  refId?: string
  title?: string
  message: string
  createdAt: number
}

export type LaterChoice = { kind: 'limit_reset' } | { kind: 'time'; at: number }

export interface ScheduleInput {
  deviceId: string
  agent: string
  cwd: string
  prompt: string
  images?: { path: string }[]
  model?: string
  effort?: string
  fast?: boolean
  mode?: string
  access?: string
  source?: { repo: string; branch: string; known?: string[] }
  clientRequestId?: string
  title?: string
}

export const scheduledResource = createResource<ScheduledItem[]>('/api/scheduled', 30_000)
export const noticesResource = createResource<GuardNotice[]>('/api/guardrails/notices', 60_000)
export const useScheduled = () => scheduledResource.use()
export const useGuardNotices = () => noticesResource.use()

export async function scheduleSession(input: ScheduleInput, when: LaterChoice) {
  const item = await api.post<ScheduledItem>('/api/scheduled', { ...input, trigger: when }, 20_000)
  scheduledResource.set((list) => [...(list ?? []).filter((entry) => entry.id !== item.id), item])
  scheduledResource.refresh()
  return item
}

export async function updateScheduled(id: string, patch: Partial<ScheduleInput> & { trigger?: LaterChoice }) {
  const item = await api.patch<ScheduledItem>(`/api/scheduled/${encodeURIComponent(id)}`, patch)
  scheduledResource.set((list) => list?.map((entry) => entry.id === id ? item : entry) ?? list)
  return item
}

export async function cancelScheduled(id: string) {
  await api.del(`/api/scheduled/${encodeURIComponent(id)}`)
  scheduledResource.set((list) => list?.filter((entry) => entry.id !== id) ?? list)
}

// startScheduledNow skips the trigger (and any guardrail): you asked for it.
export async function startScheduledNow(id: string) {
  const item = await api.post<ScheduledItem>(`/api/scheduled/${encodeURIComponent(id)}/start`, undefined, 20_000)
  scheduledResource.refresh()
  return item
}

export async function dismissNotice(id: string) {
  noticesResource.set((list) => list?.filter((entry) => entry.id !== id) ?? list)
  await api.del(`/api/guardrails/notices/${encodeURIComponent(id)}`).catch(() => {})
}

export const loadGuardrails = () => api.get<Record<string, GuardCfg>>('/api/guardrails')
export const saveGuardrails = (value: Record<string, GuardCfg>) => api.put<Record<string, GuardCfg>>('/api/guardrails', value)

// useScheduleEvents keeps the lists current: the hub says when a scheduled
// session changed or started and when a guardrail acted.
export function useScheduleEvents(onNotice?: (notice: GuardNotice) => void, onStarted?: (threadId: string) => void) {
  const seen = useRef<Set<string> | null>(null)
  const handler = useRef({ onNotice, onStarted })
  handler.current = { onNotice, onStarted }
  const listener = useCallback((event: { type: string; threadId?: string }) => {
    if (event.type === 'schedule.changed') scheduledResource.refresh()
    if (event.type === 'schedule.started') { scheduledResource.refresh(); if (event.threadId) handler.current.onStarted?.(event.threadId) }
    if (event.type === 'guardrail.notice') noticesResource.refresh()
  }, [])
  useHubStream(listener)
  const { value: notices } = noticesResource.use()
  useEffect(() => {
    // The first list only seeds what is already known; later ones announce.
    if (!notices) return
    if (seen.current === null) { seen.current = new Set(notices.map((notice) => notice.id)); return }
    for (const notice of notices) {
      if (seen.current.has(notice.id)) continue
      seen.current.add(notice.id)
      handler.current.onNotice?.(notice)
    }
  }, [notices])
}

// ---- reading plan limits ----

// A model-specific window ("seven_day_opus", "Weekly (Opus)") only counts for that model.
export const windowModel = (window: { id: string; label: string }) => {
  if (/^seven_day_/i.test(window.id)) return window.id.slice('seven_day_'.length).toLowerCase()
  return window.label.match(/\(([^)]+)\)/)?.[1].trim().toLowerCase() ?? ''
}
const windowApplies = (window: { id: string; label: string }, model: string) => { const only = windowModel(window); return !only || model.toLowerCase().includes(only) }

// limitReset finds the window a "when my limit resets" send would wait for:
// those used up, else those at or above `threshold`, the one that resets last.
// null when the limit is not high (or no reset time is known).
export function limitReset(accounts: PlanLimits[] | null, deviceId: string, agent: string, model = '', threshold = 90) {
  const plan = accounts?.find((item) => item.deviceId === deviceId && item.agent === agent)
  if (!plan?.windows?.length || plan.error) return null
  const nowSec = Date.now() / 1000
  const usable = plan.windows.filter((window) => windowApplies(window, model) && (window.resetsAt ?? 0) > nowSec)
  const pick = (min: number) => usable.filter((window) => window.usedPercent >= min).sort((a, b) => (b.resetsAt ?? 0) - (a.resetsAt ?? 0))[0]
  const window = pick(100) ?? pick(threshold)
  return window ? { window, resetsAt: window.resetsAt as number, percent: window.usedPercent, plan } : null
}

// ---- times ----

export const clock = (date: Date) => date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const startOfDay = (date: Date) => { const d = new Date(date); d.setHours(0, 0, 0, 0); return d.getTime() }

// tonightAt is the next time the clock reads `hour:00`.
export function tonightAt(hour = 1, now = new Date()) {
  const date = new Date(now)
  date.setHours(hour, 0, 0, 0)
  if (date.getTime() <= now.getTime() + 60_000) date.setDate(date.getDate() + 1)
  return date
}

export function tomorrowAt(hour = 9, now = new Date()) {
  const date = new Date(now)
  date.setDate(date.getDate() + 1)
  date.setHours(hour, 0, 0, 0)
  return date
}

// whenText names a moment the way people say it: "Today 1:00 AM", "Tomorrow 9:00 AM".
export function whenText(unixSec: number, now = new Date()) {
  const date = new Date(unixSec * 1000)
  const days = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000)
  if (days === 0) return `Today ${clock(date)}`
  if (days === 1) return `Tomorrow ${clock(date)}`
  if (days > 1 && days < 7) return `${date.toLocaleDateString([], { weekday: 'short' })} ${clock(date)}`
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${clock(date)}`
}

// inText is a short wait: "in 12m", "in 1h 12m", "in 3 days".
export function inText(unixSec: number, now = Date.now()) {
  const minutes = Math.max(0, Math.round((unixSec * 1000 - now) / 60_000))
  if (minutes < 1) return 'any moment'
  if (minutes < 60) return `in ${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `in ${hours}h ${minutes % 60}m`
  const days = Math.round(hours / 24)
  return `in ${days} day${days === 1 ? '' : 's'}`
}

// toLocalInput / fromLocalInput convert for <input type="datetime-local">.
export function toLocalInput(unixSec: number) {
  const date = new Date(unixSec * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
export const fromLocalInput = (value: string) => { const ms = new Date(value).getTime(); return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0 }

// ---- continue in another agent ----

export interface ContinuePreview {
  prompt: string
  title: string
  files: { path: string; additions: number; deletions: number }[]
  stats: { turns: number; files: number; planDone: number; planTotal: number; lastError: boolean; diffStat: boolean }
}

export interface ContinueLink { id: string; title: string; agent: string; status: string }
export interface ContinueLinks { from: ContinueLink | null; to: ContinueLink[] }
