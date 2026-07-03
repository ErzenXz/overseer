import { useEffect, useRef } from 'react'
import { wsURL } from './api'
import type { HubEvent } from './types'

// useHubEvents keeps one events WebSocket open and invokes the handler for
// every pushed event. Reconnects quietly while the tab stays open.
export function useHubEvents(onEvent: (e: HubEvent) => void) {
  const handler = useRef(onEvent)
  handler.current = onEvent

  useEffect(() => {
    let ws: WebSocket | null = null
    let timer: number | undefined
    let stopped = false

    const connect = () => {
      ws = new WebSocket(wsURL('/api/ws/events'))
      ws.onmessage = (ev) => {
        try {
          handler.current(JSON.parse(ev.data))
        } catch {
          /* ignore malformed */
        }
      }
      ws.onclose = () => {
        if (!stopped) timer = window.setTimeout(connect, 2000)
      }
    }
    connect()

    return () => {
      stopped = true
      window.clearTimeout(timer)
      ws?.close()
    }
  }, [])
}

// usePoll invokes fn now and on an interval.
export function usePoll(fn: () => void, ms: number) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    ref.current()
    const t = window.setInterval(() => ref.current(), ms)
    return () => window.clearInterval(t)
  }, [ms])
}
