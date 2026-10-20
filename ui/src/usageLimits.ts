import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { useHubStream } from './store'
import type { PlanLimits } from './types'

// One shared reading of every machine's plan limits. The hub caches for five
// minutes and pushes `usage.limits` when a session sees fresh numbers.
let cached: { at: number; accounts: PlanLimits[] } | null = null
let inflight: Promise<PlanLimits[]> | null = null
const listeners = new Set<(accounts: PlanLimits[]) => void>()

// fresh skips the browser's copy; refresh also makes the hub re-ask the CLIs.
function load({ fresh = false, refresh = false } = {}): Promise<PlanLimits[]> {
  if (!fresh && !refresh && cached && Date.now() - cached.at < 60_000) return Promise.resolve(cached.accounts)
  if (inflight && !refresh) return inflight
  inflight = api.get<{ accounts: PlanLimits[] }>(`/api/usage/limits${refresh ? '?refresh=1' : ''}`)
    .then((data) => {
      cached = { at: Date.now(), accounts: data.accounts ?? [] }
      listeners.forEach((listener) => listener(cached!.accounts))
      return cached.accounts
    })
    .finally(() => { inflight = null })
  return inflight
}

export function usePlanLimits() {
  const [accounts, setAccounts] = useState<PlanLimits[] | null>(cached?.accounts ?? null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  useEffect(() => {
    listeners.add(setAccounts)
    load().catch((cause) => setError(cause instanceof Error ? cause.message : 'Couldn’t load limits'))
    return () => { listeners.delete(setAccounts) }
  }, [])
  // A session saw new numbers; the hub already has them cached.
  useHubStream(useCallback((event: { type: string }) => { if (event.type === 'usage.limits') load({ fresh: true }).catch(() => {}) }, []))
  const refresh = useCallback(async () => {
    setRefreshing(true)
    setError('')
    try { await load({ refresh: true }) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Couldn’t refresh') } finally { setRefreshing(false) }
  }, [])
  return { accounts, error, refreshing, refresh }
}

export const limitsFor = (accounts: PlanLimits[] | null, deviceId: string, agent: string) =>
  accounts?.find((item) => item.deviceId === deviceId && item.agent === agent)

// "in 2h 14m", "in 3 days", or "" when unknown.
export function resetsIn(at?: number) {
  if (!at) return ''
  const minutes = Math.max(0, Math.round((at * 1000 - Date.now()) / 60_000))
  if (minutes < 60) return `in ${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `in ${hours}h ${minutes % 60}m`
  const days = Math.round(hours / 24)
  return `in ${days} day${days === 1 ? '' : 's'}`
}

export const limitTone = (percent: number) => percent >= 90 ? 'is-high' : percent >= 70 ? 'is-mid' : ''
