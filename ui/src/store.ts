import { useEffect, useSyncExternalStore } from 'react'
import { api, wsURL } from './api'
import { mockEnabled, mockThreadStream } from './mock'
import type { Access, Device, FleetSession, Thread, ThreadMessage } from './types'

// A tiny shared cache: one fetch serves every component that subscribes, and
// hub events trigger a refresh instead of each page polling on its own.
function createResource<T>(path: string, intervalMs: number) {
  let value: T | null = null
  let error = ''
  let inflight: Promise<void> | null = null
  let timer: number | undefined
  const listeners = new Set<() => void>()
  let snapshot: { value: T | null; error: string } = { value, error }

  const emit = () => {
    snapshot = { value, error }
    listeners.forEach((listener) => listener())
  }
  // A response may only replace state that is no newer than its request:
  // local updates bump `version`, and a refresh asked for while one is in
  // flight runs again afterwards instead of reusing the older response.
  let version = 0
  let again = false
  const refresh = (): Promise<void> => {
    if (inflight) { again = true; return inflight }
    const started = version
    inflight = api.get<T>(path)
      .then((next) => {
        if (version === started) { value = next; error = '' }
        else again = true
      })
      .catch((cause) => { if (version === started) error = cause instanceof Error ? cause.message : 'Request failed' })
      .finally(() => {
        inflight = null
        emit()
        if (again) { again = false; refresh() }
      })
    return inflight
  }
  const set = (updater: (current: T | null) => T | null) => {
    version++
    value = updater(value)
    emit()
  }
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    if (listeners.size === 1) {
      refresh()
      timer = window.setInterval(refresh, intervalMs)
    }
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) window.clearInterval(timer)
    }
  }
  const use = () => useSyncExternalStore(subscribe, () => snapshot)
  return { refresh, set, use, get: () => value }
}

export const threadsResource = createResource<Thread[]>('/api/threads', 15000)
export const devicesResource = createResource<Device[]>('/api/devices', 10000)
export const terminalsResource = createResource<FleetSession[]>('/api/agents', 15000)

export const useThreads = () => threadsResource.use()
export const useDevices = () => devicesResource.use()
export const useTerminals = () => terminalsResource.use()

// One events socket for the whole app, fanning hub events into the caches.
let eventsSocket: WebSocket | null = null
const eventListeners = new Set<(event: { type: string; deviceId?: string }) => void>()
export function useHubStream(onEvent?: (event: { type: string; deviceId?: string }) => void) {
  useEffect(() => {
    if (onEvent) eventListeners.add(onEvent)
    return () => { if (onEvent) eventListeners.delete(onEvent) }
  }, [onEvent])
  useEffect(() => {
    if (!mockEnabled) return
    const onMock = (event: Event) => {
      const detail = (event as CustomEvent).detail as { type: string }
      if (detail.type === 'threads.changed') threadsResource.refresh()
      eventListeners.forEach((listener) => listener(detail))
    }
    window.addEventListener('overseer:mock-event', onMock)
    return () => window.removeEventListener('overseer:mock-event', onMock)
  }, [])
  useEffect(() => {
    if (mockEnabled || eventsSocket) return
    let stopped = false
    let retry: number | undefined
    const connect = () => {
      const ws = new WebSocket(wsURL('/api/ws/events'))
      eventsSocket = ws
      ws.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data)
          if (event.type === 'threads.changed') threadsResource.refresh()
          if (event.type === 'device.online' || event.type === 'device.offline') { devicesResource.refresh(); terminalsResource.refresh() }
          if (event.type === 'sessions.changed') terminalsResource.refresh()
          if (event.type === 'device.stats' && event.deviceId && event.stats) {
            devicesResource.set((devices) => devices?.map((device) => device.id === event.deviceId ? { ...device, stats: event.stats } : device) ?? devices)
          }
          eventListeners.forEach((listener) => listener(event))
        } catch { /* ignore malformed */ }
      }
      ws.onclose = () => {
        eventsSocket = null
        if (!stopped) retry = window.setTimeout(connect, 2500)
      }
    }
    connect()
    return () => { stopped = true; window.clearTimeout(retry) }
  }, [])
}

// ---- thread actions ----

export interface NewThread {
  deviceId: string
  agent: string
  command?: string
  cwd: string
  prompt: string
  model?: string
  access?: Access
  title?: string
}

export async function createThread(input: NewThread) {
  const thread = await api.post<Thread>('/api/threads', input)
  threadsResource.set((threads) => [thread, ...(threads ?? []).filter((item) => item.id !== thread.id)])
  return thread
}

export async function patchThread(id: string, patch: Partial<Pick<Thread, 'title' | 'access' | 'model'>> & { read?: boolean }) {
  const thread = await api.patch<Thread>(`/api/threads/${id}`, patch)
  threadsResource.set((threads) => threads?.map((item) => item.id === id ? thread : item) ?? threads)
  return thread
}

export async function deleteThread(id: string) {
  await api.del(`/api/threads/${id}`)
  threadsResource.set((threads) => threads?.filter((item) => item.id !== id) ?? threads)
}

export const sendPrompt = (id: string, text: string) => api.post(`/api/threads/${id}/prompt`, { text })
export const cancelThread = (id: string) => api.post(`/api/threads/${id}/cancel`)
export const answerApproval = (id: string, approvalId: string, optionId: string) => api.post(`/api/threads/${id}/approval`, { approvalId, optionId })

// ---- live thread stream ----

export type StreamEvent =
  | { type: 'snapshot'; thread: Thread; messages: ThreadMessage[] }
  | { type: 'message'; message: ThreadMessage }
  | { type: 'thread'; thread: Thread }

export function openThreadStream(id: string, onEvent: (event: StreamEvent) => void, onStatus: (connected: boolean) => void): () => void {
  if (mockEnabled) {
    onStatus(true)
    return mockThreadStream(id, onEvent)
  }
  let stopped = false
  let ws: WebSocket | null = null
  let retry: number | undefined
  const connect = () => {
    ws = new WebSocket(wsURL(`/api/ws/threads/${encodeURIComponent(id)}`))
    ws.onopen = () => onStatus(true)
    ws.onmessage = (message) => {
      try { onEvent(JSON.parse(message.data)) } catch { /* ignore malformed */ }
    }
    ws.onclose = () => {
      onStatus(false)
      if (!stopped) retry = window.setTimeout(connect, 2000)
    }
  }
  // Load the snapshot over HTTP first so the page renders even if the
  // socket is slow to come up.
  api.get<{ thread: Thread; messages: ThreadMessage[] }>(`/api/threads/${encodeURIComponent(id)}`)
    .then((data) => { if (!stopped) onEvent({ type: 'snapshot', ...data }) })
    .catch(() => { /* the socket snapshot will retry */ })
  connect()
  return () => { stopped = true; window.clearTimeout(retry); ws?.close() }
}

// ---- small preferences store (per browser) ----

export function usePref<T>(key: string, fallback: T): [T, (value: T) => void] {
  const read = () => {
    try {
      const raw = localStorage.getItem(`overseer:${key}`)
      return raw === null ? fallback : (JSON.parse(raw) as T)
    } catch {
      return fallback
    }
  }
  const value = useSyncExternalStore(
    (listener) => { prefListeners.add(listener); return () => prefListeners.delete(listener) },
    () => prefCache.get(key) ?? (prefCache.set(key, read()), prefCache.get(key)),
  ) as T
  const set = (next: T) => {
    prefCache.set(key, next)
    try { localStorage.setItem(`overseer:${key}`, JSON.stringify(next)) } catch { /* storage unavailable */ }
    prefListeners.forEach((listener) => listener())
  }
  return [value, set]
}
const prefCache = new Map<string, unknown>()
const prefListeners = new Set<() => void>()
