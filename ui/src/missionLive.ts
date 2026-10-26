import { useEffect, useMemo, useState } from 'react'
import { openThreadStream } from './store'
import { buildSegments, currentActivity, type Activity, type Segment, type StepItem } from './lib/steps'
import type { Thread, ThreadMessage } from './types'

// What a Mission control tile shows beyond the session row: the live step,
// subagents and diff size. They come from the session's own stream, opened
// only for tiles on screen.

export interface TileLive {
  activity: Activity | null
  ask: string // the approval or question the session is stopped on
  last: string // the last thing the agent said
  subagents: number
  add: number
  del: number
  turnStartedAt: number // ms; when the current prompt was sent
}

export function useThreadMessages(id: string, enabled: boolean): ThreadMessage[] | null {
  const [messages, setMessages] = useState<ThreadMessage[] | null>(null)
  useEffect(() => {
    if (!enabled) return
    const stop = openThreadStream(id, (event) => {
      if (event.type === 'snapshot') setMessages([...event.messages].sort((a, b) => a.seq - b.seq))
      else if (event.type === 'message') {
        setMessages((current) => {
          const list = current ?? []
          const index = list.findIndex((message) => message.id === event.message.id)
          if (index === -1) return [...list, event.message].sort((a, b) => a.seq - b.seq)
          const next = list.slice()
          next[index] = event.message
          return next
        })
      }
    }, () => {})
    return stop
  }, [id, enabled])
  return messages
}

// firstLine is the first non-empty line, with Markdown marks removed.
const firstLine = (text: string) => (text.trim().split('\n').find((line) => line.trim()) ?? '')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^[#>\-*\s]+/, '').replace(/[*_`]/g, '').trim()

function countAgents(items: StepItem[]): number {
  let n = 0
  for (const item of items) {
    if (item.kind === 'agent') n++
    else if (item.kind === 'agents') n += item.items.length
  }
  return n
}

function tally(segments: Segment[]) {
  let add = 0
  let del = 0
  let subagents = 0
  for (const segment of segments) {
    if (segment.kind !== 'work') continue
    add += segment.add
    del += segment.del
  }
  const lastWork = [...segments].reverse().find((segment) => segment.kind === 'work')
  if (lastWork && lastWork.kind === 'work') subagents = countAgents(lastWork.items)
  return { add, del, subagents }
}

function factsOf(list: ThreadMessage[], segments: Segment[], createdAt: number): Omit<TileLive, 'activity'> {
  const { add, del, subagents } = tally(segments)
  let ask = ''
  for (let i = list.length - 1; i >= 0 && !ask; i--) {
    const message = list[i]
    if (message.role === 'approval' && message.approval && !message.approval.resolved) ask = message.approval.title
    else if (message.role === 'question' && message.question && !message.question.answered?.length) ask = message.question.text
    else if (message.role === 'user' && !message.queued) break
  }
  const reply = [...list].reverse().find((message) => message.role === 'assistant' && message.text.trim())
  const lastUser = [...list].reverse().find((message) => message.role === 'user' && !message.queued)
  return { ask, last: reply ? firstLine(reply.text) : '', subagents, add, del, turnStartedAt: lastUser?.at ?? createdAt * 1000 }
}

export function useTileLive(thread: Thread, enabled: boolean, now: number): TileLive {
  const messages = useThreadMessages(thread.id, enabled)
  // Steps are rebuilt only when messages change; the clock just moves the activity.
  const segments = useMemo(() => buildSegments(messages ?? [], thread.status === 'working'), [messages, thread.status])
  const facts = useMemo(() => factsOf(messages ?? [], segments, thread.createdAt), [messages, segments, thread.createdAt])
  return { ...facts, activity: currentActivity(segments, thread.status, thread.deviceName, now) }
}
