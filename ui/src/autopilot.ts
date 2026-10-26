import { useCallback, useEffect, useState } from 'react'
import { api } from './api'

// Issue autopilot and before/after screenshots: what the hub sends the UI.
// See internal/hub/autopilot.go and shots.go.

export type RunStatus = 'queued' | 'preparing' | 'working' | 'finishing' | 'pr_open' | 'merged' | 'closed' | 'failed' | 'skipped'

export interface AutopilotRepo {
  id: string
  repo: string
  enabled: boolean
  label: string
  agent: string
  model?: string
  effort?: string
  mode?: string
  access: string
  deviceId: string // '' = any online machine with a clone
  ghDeviceId: string
  maxConcurrent: number
  trust: 'writers' | 'me'
  comment: boolean
  footer: boolean
  createdAt: number
  lastPollAt: number
  lastError?: string
  active: number
}

export interface AutopilotRun {
  id: string
  repoId: string
  repo: string
  number: number
  title: string
  url: string
  author?: string
  labeller?: string
  status: RunStatus
  detail?: string
  deviceId?: string
  deviceName?: string
  threadId?: string
  branch?: string
  prNumber?: number
  prUrl?: string
  attempt: number
  approved?: boolean
  createdAt: number
  updatedAt: number
  startedAt?: number
  finishedAt?: number
  threadStatus?: string
}

export interface AutopilotOverview {
  repos: AutopilotRepo[]
  runs: AutopilotRun[]
}

export interface CloneInfo {
  deviceId: string
  name: string
  hasClone: boolean
  path?: string
  busy: number
}

export const runStatusLabel: Record<RunStatus, string> = {
  queued: 'Queued',
  preparing: 'Starting',
  working: 'Working',
  finishing: 'Opening PR',
  pr_open: 'PR open',
  merged: 'Merged',
  closed: 'PR closed',
  failed: 'Failed',
  skipped: 'Needs your OK',
}

export const isActiveRun = (status: RunStatus) => status === 'queued' || status === 'preparing' || status === 'working' || status === 'finishing'

// useAutopilot loads the repos and recent runs and refreshes them while the
// view is open, faster while something is running.
export function useAutopilot(): { data: AutopilotOverview | null; error: string; reload: () => Promise<void> } {
  const [data, setData] = useState<AutopilotOverview | null>(null)
  const [error, setError] = useState('')
  const reload = useCallback(async () => {
    try {
      setData(await api.get<AutopilotOverview>('/api/autopilot'))
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the autopilot')
    }
  }, [])
  const busy = data?.runs.some((run) => isActiveRun(run.status)) ?? false
  useEffect(() => {
    reload()
    const timer = window.setInterval(() => { if (!document.hidden) reload() }, busy ? 4000 : 12000)
    return () => window.clearInterval(timer)
  }, [reload, busy])
  return { data, error, reload }
}

// ---- screenshots ----

export interface ThreadShot {
  id: string
  threadId: string
  kind: 'before' | 'after'
  form: 'desktop' | 'phone'
  turn?: string
  port?: number
  mime: string
  width?: number
  height?: number
  size: number
  note?: string
  createdAt: number
  url: string
}

export interface ShotsReply {
  shots: ThreadShot[]
  info: { status?: string; note?: string; pr: { state?: 'commented' | 'skipped' | 'failed'; url?: string; reason?: string } }
  config: { enabled: boolean; phone: boolean; prComment: boolean }
  publicBase?: string
  publicReason?: string
}

// useShots reads a session's screenshots, checking again while the session is
// running or the panel is open.
export function useShots(threadId: string, live: boolean): { reply: ShotsReply | null; reload: () => Promise<void>; setReply: (reply: ShotsReply) => void } {
  const [reply, setReply] = useState<ShotsReply | null>(null)
  const reload = useCallback(async () => {
    try { setReply(await api.get<ShotsReply>(`/api/threads/${encodeURIComponent(threadId)}/shots`)) } catch { /* older hubs have no screenshots */ }
  }, [threadId])
  useEffect(() => {
    setReply(null)
    reload()
    const timer = window.setInterval(() => { if (!document.hidden) reload() }, live ? 4000 : 20000)
    return () => window.clearInterval(timer)
  }, [reload, live])
  return { reply, reload, setReply }
}
