import { createContext, useContext, useSyncExternalStore } from 'react'

// One shared one-second clock for every live timer on screen, so a busy
// transcript doesn't run a timer per row. Idle (no subscribers) it stops.
const listeners = new Set<() => void>()
let timer: number | undefined
let value = Date.now()

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (timer === undefined) {
    value = Date.now()
    timer = window.setInterval(() => { value = Date.now(); listeners.forEach((fn) => fn()) }, 1000)
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size && timer !== undefined) { window.clearInterval(timer); timer = undefined }
  }
}

const never = () => () => {}

// A replay (pages/SharePage.tsx) provides its own clock, so live timers show
// the session's time instead of today's.
export const ClockContext = createContext<number | null>(null)

// useNow returns the current time, refreshed every second while `on`.
export function useNow(on = true): number {
  const fixed = useContext(ClockContext)
  const live = on && fixed === null
  return useSyncExternalStore(live ? subscribe : never, () => (live ? value : 0), () => 0) || fixed || Date.now()
}
