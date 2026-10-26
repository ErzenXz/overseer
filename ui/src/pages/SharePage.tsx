import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { formatDuration } from '../agents'
import Icon, { AgentMark } from '../components/Icon'
import { LogoMark } from '../components/Logo'
import Transcript from '../components/Transcript'
import { buildTimeline, clock, frameAt } from '../lib/replay'
import { ClockContext } from '../lib/useNow'
import { openShareStream, summarize, type PublicShare, type PublicThread } from '../share'
import { usePref } from '../store'
import type { Thread, ThreadMessage } from '../types'

// The public page behind /s/{token}: no login, no controls, only the session.
// A replay opens on the finished result with a Replay button; a live link
// follows the running session.

const SITE = 'https://overseer.sh'
const SPEEDS = [1, 4, 16] as const

type Load = { state: 'loading' } | { state: 'gone' } | { state: 'error' } | { state: 'ready'; share: PublicShare }

const noApprove = async () => {}

function toThread(pub: PublicThread, status: Thread['status']): Thread {
  return {
    id: '', title: pub.title, deviceId: '', deviceName: pub.deviceName || 'the machine', agent: pub.agent, cwd: pub.cwd, model: pub.model,
    access: 'auto', status, error: pub.error, createdAt: pub.createdAt, updatedAt: pub.updatedAt, lastReadAt: pub.updatedAt,
  }
}

export default function SharePage() {
  const { pathname } = useLocation()
  const token = decodeURIComponent(pathname.replace(/^\/s\//, '').split('/')[0] ?? '')
  const [theme] = usePref<'system' | 'light' | 'dark'>('theme', 'system')
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [thread, setThread] = useState<PublicThread | null>(null)
  const [connected, setConnected] = useState(true)
  const [ended, setEnded] = useState(false)
  const mode = load.state === 'ready' ? load.share.mode : null

  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Fetch once. A live link then keeps listening.
  useEffect(() => {
    let stop = () => {}
    let alive = true
    setLoad({ state: 'loading' })
    fetch(`/api/public/shares/${encodeURIComponent(token)}`, { credentials: 'omit' })
      .then(async (res) => {
        if (!alive) return
        if (res.status === 404) return setLoad({ state: 'gone' })
        if (!res.ok) return setLoad({ state: 'error' })
        const share = (await res.json()) as PublicShare
        setThread(share.thread)
        setMessages([...share.messages].sort((a, b) => a.seq - b.seq))
        setLoad({ state: 'ready', share })
        if (share.mode === 'live') {
          stop = openShareStream(token, (event) => {
            if (event.type === 'snapshot') {
              setThread(event.share.thread)
              setMessages([...event.share.messages].sort((a, b) => a.seq - b.seq))
            } else if (event.type === 'thread') setThread(event.thread)
            else if (event.type === 'message') {
              setMessages((current) => {
                const index = current.findIndex((message) => message.id === event.message.id)
                if (index === -1) return [...current, event.message].sort((a, b) => a.seq - b.seq)
                const next = current.slice()
                next[index] = event.message
                return next
              })
            } else if (event.type === 'end') {
              if (event.reason === 'expired') setLoad({ state: 'gone' })
              else setEnded(true)
            }
          }, setConnected)
        }
      })
      .catch(() => { if (alive) setLoad({ state: 'error' }) })
    return () => { alive = false; stop() }
  }, [token])

  const title = thread?.title || 'Shared session'
  useEffect(() => {
    document.title = load.state === 'gone' ? 'This link has expired · Overseer' : `${title} · Overseer`
  }, [title, load.state])

  if (load.state === 'loading') return <Shell><div className="sh-col"><div className="space-y-5 pt-10">{[44, 90, 70, 82].map((width) => <div key={width} className="skeleton h-5" style={{ width: `${width}%` }} />)}</div></div></Shell>
  if (load.state === 'gone' || load.state === 'error') {
    const gone = load.state === 'gone'
    return (
      <Shell>
        <div className="sh-gone">
          <span className="empty-icon"><Icon name={gone ? 'clock' : 'alert'} size={24} /></span>
          <h1>{gone ? 'This link has expired' : 'Couldn’t load this session'}</h1>
          <p>{gone ? 'The person who shared it may have turned it off. Ask them for a new link.' : 'Check your connection and try again.'}</p>
          {!gone && <button className="btn btn-dark" onClick={() => location.reload()}>Try again</button>}
        </div>
      </Shell>
    )
  }
  return mode === 'live'
    ? <LiveView share={load.share} thread={thread ?? load.share.thread} messages={messages} connected={connected} ended={ended} />
    : <ReplayView share={load.share} />
}

// --- frame ---

function Shell({ children, badge, scroller, onScroll, footer }: { children: React.ReactNode; badge?: React.ReactNode; scroller?: React.RefObject<HTMLDivElement>; onScroll?: () => void; footer?: React.ReactNode }) {
  return (
    <div className="sh-page">
      <header className="sh-top">
        <a className="sh-brand" href={SITE} target="_blank" rel="noopener noreferrer"><LogoMark size={22} /><span>Overseer</span></a>
        <span className="sh-top-end">{badge}</span>
      </header>
      <div className="sh-scroll" ref={scroller} onScroll={onScroll}>
        {children}
        <footer className="sh-foot">
          <a href={SITE} target="_blank" rel="noopener noreferrer">
            <LogoMark size={16} />
            <span>Made with Overseer</span>
            <span className="sh-foot-dot" aria-hidden="true">·</span>
            <span className="sh-foot-cta">Run your coding agents on every machine <Icon name="arrow" size={14} /></span>
          </a>
        </footer>
      </div>
      {footer}
    </div>
  )
}

function Head({ thread, messages, working }: { thread: PublicThread; messages: ThreadMessage[]; working: boolean }) {
  const sum = useMemo(() => summarize(messages), [messages])
  const when = new Date(thread.createdAt * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  const bits = [
    <span key="agent" className="sh-agent"><AgentMark agent={thread.agent} size={15} />{thread.agentName || thread.agent}</span>,
    sum.durationMs >= 1000 && <span key="time">{working ? 'Working for ' : ''}{formatDuration(sum.durationMs)}</span>,
    sum.steps > 0 && <span key="steps">{sum.steps} step{sum.steps === 1 ? '' : 's'}</span>,
    (sum.additions > 0 || sum.deletions > 0) && <span key="diff" className="sh-diff"><span className="plus">+{sum.additions}</span> <span className="minus">−{sum.deletions}</span></span>,
    sum.files > 0 && <span key="files">{sum.files} file{sum.files === 1 ? '' : 's'}</span>,
    thread.deviceName && <span key="device"><Icon name="monitor" size={14} />{thread.deviceName}</span>,
    thread.createdAt > 0 && <span key="when">{when}</span>,
  ].filter(Boolean)
  return (
    <div className="sh-head">
      <h1 className="sh-title">{thread.title}</h1>
      <p className="sh-meta">{bits.map((bit, index) => <span key={index} className="sh-meta-item">{bit}</span>)}</p>
    </div>
  )
}

// useFollow keeps a scroller pinned to the bottom while content grows, until
// the reader scrolls up.
function useFollow(initial: boolean) {
  const node = useRef<HTMLDivElement>(null)
  const follow = useRef(initial)
  const onScroll = useCallback(() => {
    const el = node.current
    if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90
  }, [])
  const toBottom = useCallback(() => { const el = node.current; if (el && follow.current) el.scrollTop = el.scrollHeight }, [])
  return { node, follow, onScroll, toBottom }
}

// --- live ---

function LiveView({ share, thread, messages, connected, ended }: { share: PublicShare; thread: PublicThread; messages: ThreadMessage[]; connected: boolean; ended: boolean }) {
  const f = useFollow(true)
  const status = (ended ? 'idle' : thread.status) as Thread['status']
  const view = useMemo(() => toThread(thread, status), [thread, status])
  useLayoutEffect(() => { f.toBottom() }, [messages, status]) // eslint-disable-line react-hooks/exhaustive-deps
  const working = status === 'working' || status === 'starting'
  const badge = ended
    ? <span className="badge">Ended</span>
    : !connected ? <span className="badge badge-amber">Reconnecting…</span>
    : <span className="sh-live"><span className="dot dot-green dot-pulse" />Live</span>
  return (
    <Shell scroller={f.node} onScroll={f.onScroll} badge={badge}>
      <main className="sh-col">
        <Head thread={thread} messages={messages} working={working} />
        <Transcript thread={view} messages={messages} expandAll={false} onApprove={noApprove} />
        {!working && !ended && messages.length > 0 && <p className="sh-idle">Waiting for the next step</p>}
        {ended && <p className="sh-idle">This session has ended.</p>}
        <p className="sh-note">{share.expiresAt ? `View only. This link works until ${new Date(share.expiresAt * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}.` : 'View only.'}</p>
      </main>
    </Shell>
  )
}

// --- replay ---

function ReplayView({ share }: { share: PublicShare }) {
  const messages = useMemo(() => [...share.messages].sort((a, b) => a.seq - b.seq), [share])
  const timeline = useMemo(() => buildTimeline(messages), [messages])
  const total = timeline.total
  const [position, setPosition] = useState(total)
  const [playing, setPlaying] = useState(false)
  // Long sessions start faster, so a replay is never a long wait.
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(total <= 90_000 ? 1 : total <= 360_000 ? 4 : 16)
  const f = useFollow(false)
  const at = useRef(total)
  at.current = position
  const atEnd = position >= total

  // Playback: advance by elapsed time x speed, ten times a second.
  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    const timer = window.setInterval(() => {
      const nowMs = performance.now()
      const next = Math.min(total, at.current + (nowMs - last) * speed)
      last = nowMs
      at.current = next
      setPosition(next)
      if (next >= total) setPlaying(false)
    }, 100)
    return () => window.clearInterval(timer)
  }, [playing, speed, total])

  const shown = useMemo(() => frameAt(messages, timeline, position), [messages, timeline, position])
  useLayoutEffect(() => { f.toBottom() }, [shown]) // eslint-disable-line react-hooks/exhaustive-deps
  const running = playing || !atEnd
  const final = share.thread.status
  const status = (running ? 'working' : final === 'error' ? 'error' : 'idle') as Thread['status']
  const view = useMemo(() => toThread(share.thread, status), [share.thread, status])

  const toggle = () => {
    if (playing) return setPlaying(false)
    if (atEnd) { setPosition(0); at.current = 0; f.follow.current = true }
    setPlaying(true)
  }
  const scrub = (value: number) => { f.follow.current = true; setPlaying(false); setPosition(value); at.current = value }
  const skip = () => { setPlaying(false); setPosition(total); at.current = total }
  const played = total > 0 ? (position / total) * 100 : 100

  const bar = total > 0 && (
    <div className="sh-bar">
      <div className="sh-player" role="group" aria-label="Replay">
        <button type="button" className="sh-play" onClick={toggle} aria-label={playing ? 'Pause' : atEnd ? 'Replay' : 'Play'}>
          <Icon name={playing ? 'pause' : 'play'} size={15} />
          <span>{playing ? 'Pause' : atEnd ? 'Replay' : 'Play'}</span>
        </button>
        <input
          className="sh-range" type="range" min={0} max={Math.round(total)} step={50} value={Math.round(position)}
          style={{ '--p': `${played}%` } as React.CSSProperties}
          aria-label="Position in the replay" aria-valuetext={`${clock(position)} of ${clock(total)}`}
          onChange={(event) => scrub(Number(event.target.value))}
        />
        <span className="sh-clock" aria-hidden="true">{clock(position)}<span> / {clock(total)}</span></span>
        <span className="sh-player-end">
          <span className="seg" role="group" aria-label="Speed">
            {SPEEDS.map((value) => <button key={value} type="button" aria-pressed={speed === value} onClick={() => setSpeed(value)}>{value}×</button>)}
          </span>
          <button type="button" className="sh-skip" onClick={skip} disabled={atEnd}>Skip to result<Icon name="arrow-down" size={14} /></button>
        </span>
      </div>
    </div>
  )

  return (
    <Shell scroller={f.node} onScroll={f.onScroll} badge={<span className="badge">{running ? <><span className="dot dot-blue dot-pulse" />Replaying</> : 'Replay'}</span>} footer={bar}>
      <main className="sh-col">
        <Head thread={share.thread} messages={messages} working={false} />
        <ClockContext.Provider value={running ? timeline.real(position) : null}>
          <Transcript thread={view} messages={shown} expandAll={false} onApprove={noApprove} />
        </ClockContext.Provider>
      </main>
    </Shell>
  )
}
