// Replay of a finished session: a timeline over the messages' own
// timestamps, and "what is on screen at this moment". Pure, so it can be
// checked without React.
//
// Real sessions have long waits (a build, a person thinking). The timeline
// squeezes every gap to a few seconds so a replay stays watchable; the
// squeeze only changes how fast playback moves, never the times shown on the
// steps themselves.

import type { ThreadMessage } from '../types'

export interface Timeline {
  /** Playback length in ms (squeezed). */
  total: number
  /** Real ms (as stamped on messages) at a playback position. */
  real(position: number): number
  /** Playback position of a real timestamp. */
  position(real: number): number
  start: number
  end: number
}

const MIN_GAP = 350
const MAX_GAP = 3500

export function buildTimeline(messages: ThreadMessage[]): Timeline {
  const stamps = [...new Set(messages.flatMap((message) => [message.at, message.updatedAt]).filter((value) => value > 0))].sort((a, b) => a - b)
  if (stamps.length < 2) {
    const only = stamps[0] ?? 0
    return { total: 0, real: () => only, position: () => 0, start: only, end: only }
  }
  const pos = [0]
  for (let i = 1; i < stamps.length; i++) pos.push(pos[i - 1] + Math.min(MAX_GAP, Math.max(MIN_GAP, stamps[i] - stamps[i - 1])))
  const total = pos[pos.length - 1]
  // Binary search for the interval containing a value.
  const locate = (xs: number[], value: number) => {
    let lo = 0
    let hi = xs.length - 1
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1
      if (xs[mid] <= value) lo = mid
      else hi = mid
    }
    return lo
  }
  const lerp = (xs: number[], ys: number[], value: number) => {
    if (value <= xs[0]) return ys[0]
    if (value >= xs[xs.length - 1]) return ys[ys.length - 1]
    const i = locate(xs, value)
    const span = xs[i + 1] - xs[i]
    return span <= 0 ? ys[i] : ys[i] + ((value - xs[i]) * (ys[i + 1] - ys[i])) / span
  }
  return {
    total,
    start: stamps[0],
    end: stamps[stamps.length - 1],
    real: (position) => lerp(pos, stamps, position),
    position: (real) => lerp(stamps, pos, real),
  }
}

const finished = (message: ThreadMessage, now: number) => now >= message.updatedAt

// frameAt returns the messages as they looked at a playback position:
// later messages are not there yet, a running step is still running, and an
// answer is partly written.
export function frameAt(messages: ThreadMessage[], timeline: Timeline, position: number): ThreadMessage[] {
  if (position >= timeline.total) return messages
  const now = timeline.real(position)
  const out: ThreadMessage[] = []
  for (const message of messages) {
    if (message.at > now) continue
    if (finished(message, now)) { out.push(message); continue }
    const span = Math.max(1, message.updatedAt - message.at)
    const done = Math.min(1, Math.max(0, (now - message.at) / span))
    if (message.role === 'tool' && message.tool) {
      out.push({ ...message, tool: { ...message.tool, status: 'running', output: undefined }, updatedAt: Math.round(now) })
    } else if (message.role === 'assistant' || message.role === 'thought') {
      const length = Math.ceil(message.text.length * done)
      out.push({ ...message, text: message.text.slice(0, length), updatedAt: Math.round(now), durationMs: undefined })
    } else out.push(message)
  }
  return out
}

export function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
