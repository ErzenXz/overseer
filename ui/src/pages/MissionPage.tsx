import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { agentInfo } from '../agents'
import Icon, { AgentMark } from '../components/Icon'
import { useTileLive } from '../missionLive'
import { SidebarToggle, useOwnHeader } from '../shell'
import { useDevices, useThreads } from '../store'
import { useNow } from '../lib/useNow'
import type { Device, Thread } from '../types'
import { DeviceMark } from '../components/DeviceMark'

// Mission control: every agent on every machine on one wall. It reads the
// same live data as the sidebar, so it stays current without polling.

type Group = 'waiting' | 'working' | 'failed' | 'done'

const DONE_WINDOW = 3600 // seconds a finished session stays on the wall
const FAILED_WINDOW = 3 * 3600
const CYCLE_MS = 14_000

// Tiles report their current step here, so the live strip can show it
// without opening its own connections.
const Report = createContext<(id: string, text: string) => void>(() => {})

const labels: Record<Group, string> = { waiting: 'Needs you', working: 'Working', failed: 'Failed', done: 'Done' }

function groupOf(thread: Thread, nowSec: number): Group | null {
  if (thread.archived) return null
  switch (thread.status) {
    case 'waiting': return 'waiting'
    case 'working':
    case 'starting': return 'working'
    case 'error': return nowSec - thread.updatedAt <= FAILED_WINDOW ? 'failed' : null
    default: return nowSec - thread.updatedAt <= DONE_WINDOW ? 'done' : null
  }
}

const order: Record<Group, number> = { waiting: 0, working: 1, failed: 2, done: 3 }

function clock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(s).padStart(2, '0')}`
}

const ago = (sec: number) => {
  const s = Math.max(0, sec)
  return s < 90 ? 'just now' : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`
}

const baseName = (path: string) => path.replace(/\/+$/, '').split('/').pop() || path

export default function MissionPage() {
  useOwnHeader()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { value: threads } = useThreads()
  const { value: devices } = useDevices()
  const now = useNow()
  const nowSec = Math.floor(now / 1000)
  const [tv, setTv] = useState(params.get('tv') === '1')
  const [page, setPage] = useState(0)
  const [idle, setIdle] = useState(false)
  const [size, setSize] = useState({ cols: 1, rows: 1, em: 14 })
  const grid = useRef<HTMLDivElement>(null)

  const tiles = useMemo(() => {
    const out: { thread: Thread; group: Group }[] = []
    for (const thread of threads ?? []) {
      const group = groupOf(thread, nowSec)
      if (group) out.push({ thread, group })
    }
    return out.sort((a, b) => order[a.group] - order[b.group]
      // The longest wait comes first; everything else shows the freshest first.
      || (a.group === 'waiting' ? a.thread.updatedAt - b.thread.updatedAt : b.thread.updatedAt - a.thread.updatedAt))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads, Math.floor(nowSec / 20)])

  const counts = useMemo(() => {
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0)
    const today = (threads ?? []).filter((thread) => !thread.archived && thread.status === 'idle' && thread.updatedAt >= midnight.getTime() / 1000).length
    return {
      working: tiles.filter((tile) => tile.group === 'working').length,
      waiting: tiles.filter((tile) => tile.group === 'waiting').length,
      failed: tiles.filter((tile) => tile.group === 'failed').length,
      done: today,
    }
  }, [tiles, threads])

  // ---- full screen / TV mode ----
  const enter = () => { setTv(true); document.documentElement.requestFullscreen?.().catch(() => {}) }
  const exit = () => { setTv(false); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}) }
  const toggle = () => (tv ? exit() : enter())
  const latest = useRef(toggle)
  latest.current = toggle

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const typing = (event.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable]')
      if (typing) return
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); latest.current() }
      else if (event.key === 'Escape') setTv(false)
    }
    const onFullscreen = () => { if (!document.fullscreenElement) setTv(false) }
    window.addEventListener('keydown', onKey)
    document.addEventListener('fullscreenchange', onFullscreen)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('fullscreenchange', onFullscreen)
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    }
  }, [])

  // A screen on the wall should not go to sleep.
  useEffect(() => {
    if (!tv) return
    let lock: { release: () => Promise<void> } | null = null
    const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } }
    nav.wakeLock?.request('screen').then((sentinel) => { lock = sentinel }).catch(() => {})
    return () => { lock?.release().catch(() => {}) }
  }, [tv])

  // The cursor hides when nobody is touching the mouse.
  useEffect(() => {
    if (!tv) { setIdle(false); return }
    let timer = window.setTimeout(() => setIdle(true), 3000)
    const wake = () => { setIdle(false); window.clearTimeout(timer); timer = window.setTimeout(() => setIdle(true), 3000) }
    window.addEventListener('mousemove', wake)
    return () => { window.removeEventListener('mousemove', wake); window.clearTimeout(timer) }
  }, [tv])

  // In TV mode the wall fits the screen: as many tiles as fit, then pages.
  useEffect(() => {
    const el = grid.current
    if (!el || !tv) return
    const measure = () => {
      const em = parseFloat(getComputedStyle(el).fontSize) || 16
      const gap = em * 0.9
      const minW = em * 25
      const minH = em * 13.5
      const cols = Math.max(1, Math.floor((el.clientWidth + gap) / (minW + gap)))
      const rows = Math.max(1, Math.floor((el.clientHeight + gap) / (minH + gap)))
      setSize({ cols, rows, em })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [tv])

  const perPage = tv ? size.cols * size.rows : Infinity
  const pages = tv ? Math.max(1, Math.ceil(tiles.length / perPage)) : 1
  useEffect(() => { if (page >= pages) setPage(0) }, [page, pages])
  useEffect(() => {
    if (!tv || pages < 2) return
    const timer = window.setInterval(() => setPage((current) => (current + 1) % pages), CYCLE_MS)
    return () => window.clearInterval(timer)
  }, [tv, pages])

  const shown = tv ? tiles.slice(page * perPage, (page + 1) * perPage) : tiles
  // Fit the grid to what is on this page, so a quiet wall has big tiles.
  const layout = useMemo(() => {
    if (!tv) return undefined
    const n = Math.max(1, shown.length)
    const cols = Math.min(size.cols, Math.max(1, Math.ceil(Math.sqrt(n * 1.3))))
    const rows = Math.min(size.rows, Math.ceil(n / cols))
    return { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }
  }, [tv, shown.length, size.cols, size.rows])

  const liveLimit = tv ? shown.length : 30
  const online = (devices ?? []).filter((device) => device.online)
  const [steps, setSteps] = useState<Record<string, string>>({})
  const report = useCallback((id: string, text: string) => setSteps((current) => (current[id] === text ? current : { ...current, [id]: text })), [])
  const working = tiles.filter((tile) => tile.group === 'working').map((tile) => tile.thread)

  return (
    <div className={`mc ${tv ? 'mc-tv' : ''} ${idle ? 'mc-idle' : ''}`}>
      <header className="mc-bar">
        {!tv && <SidebarToggle />}
        <div className="mc-brand"><Icon name="radio" size={16} /><span>Mission control</span></div>
        <div className="mc-counts" aria-label="Session counts">
          <Count tone="working" n={counts.working} label="working" />
          <Count tone="waiting" n={counts.waiting} label="waiting" />
          {counts.failed > 0 && <Count tone="failed" n={counts.failed} label="failed" />}
          <Count tone="done" n={counts.done} label="done today" />
        </div>
        <span className="mc-spacer" />
        <FleetSummary devices={online} />
        <time className="mc-clock" dateTime={new Date(now).toISOString()}>
          <b>{new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b>
          <span>{new Date(now).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span>
        </time>
        <button className="mc-full" onClick={toggle} title={tv ? 'Exit full screen (F)' : 'Full screen (F)'} aria-label={tv ? 'Exit full screen' : 'Full screen'}>
          <Icon name={tv ? 'minimize' : 'maximize'} size={tv ? 20 : 16} />
          <span>{tv ? 'Exit' : 'Full screen'}</span>
          {!tv && <kbd>F</kbd>}
        </button>
      </header>
      <LiveStrip threads={working} steps={steps} />

      {threads && tiles.length === 0 ? (
        <div className="mc-empty">
          <Icon name="radio" size={34} />
          <p>All quiet</p>
          <span>No agents are running right now.</span>
          {!tv && <Link to="/" className="btn btn-dark">New session</Link>}
        </div>
      ) : (
        <Report.Provider value={report}>
        <div className="mc-grid" ref={grid} style={layout}>
          {shown.map(({ thread, group }, index) => (
            <Tile key={thread.id} thread={thread} group={group} now={now} live={index < liveLimit} onOpen={() => { navigate(`/sessions/${thread.id}`) }} />
          ))}
        </div>
        </Report.Provider>
      )}

      {tv && pages > 1 && (
        <div className="mc-pager" aria-label={`Page ${page + 1} of ${pages}`}>
          {Array.from({ length: pages }, (_, i) => <i key={i} data-on={i === page} />)}
        </div>
      )}
    </div>
  )
}

function Count({ tone, n, label }: { tone: string; n: number; label: string }) {
  return <span className="mc-count" data-tone={tone}><i /><b>{n}</b>{label}</span>
}

// FleetSummary is the machines in one quiet line; hover for each one's load.
function FleetSummary({ devices }: { devices: Device[] }) {
  if (!devices.length) return <span className="mc-fleet">No machines online</span>
  const load = (device: Device) => {
    const stats = device.stats
    if (!stats) return device.name
    const mem = stats.memTotal > 0 ? Math.round((stats.memUsed / stats.memTotal) * 100) : 0
    return `${device.name}: CPU ${Math.round(stats.cpuPercent)}%, memory ${mem}%`
  }
  const busiest = Math.max(0, ...devices.map((device) => Math.round(device.stats?.cpuPercent ?? 0)))
  return (
    <span className="mc-fleet" title={devices.map(load).join('\n')}>
      <Icon name="monitor" size={14} />{devices.length} machine{devices.length === 1 ? '' : 's'}<em>busiest CPU {busiest}%</em>
    </span>
  )
}

const agentHue: Record<string, string> = { claude: '#d97757', codex: '#10a37f', gemini: '#7b8cf7', opencode: '#9ca3af', copilot: '#a78bfa', cursor: '#9ca3af', goose: '#f5b544' }

// LiveStrip: every working agent as a pulse and its current step, so the
// wall feels alive. It drifts sideways like a ticker when it overflows.
function LiveStrip({ threads, steps }: { threads: Thread[]; steps: Record<string, string> }) {
  const track = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState(false)
  useEffect(() => {
    const el = track.current
    if (!el) return
    const check = () => setOverflow(el.scrollWidth > el.clientWidth + 4)
    check()
    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => observer.disconnect()
  }, [threads.length])
  if (!threads.length) return <div className="mc-live is-quiet"><span className="mc-live-label"><i />Live</span><span className="mc-live-none">No agent is working right now.</span></div>
  const pills = threads.map((thread) => (
    <span key={thread.id} className="mc-pulse" style={{ ['--hue' as string]: agentHue[thread.agent] ?? 'var(--mc-working)' }}>
      <AgentMark agent={thread.agent} size={15} />
      <span className="mc-eq" aria-hidden="true"><i /><i /><i /><i /><i /></span>
      <span className="mc-pulse-text"><b>{thread.deviceName}</b>{steps[thread.id] || 'Working…'}</span>
    </span>
  ))
  return (
    <div className="mc-live" aria-label={`${threads.length} agents working`}>
      <span className="mc-live-label"><i />Live</span>
      <div className="mc-live-track" ref={track}>
        <div className={`mc-live-run ${overflow ? 'is-moving' : ''}`} style={{ ['--n' as string]: threads.length }}>
          {pills}
          {overflow && pills.map((pill) => <span key={`${pill.key}-again`} aria-hidden="true" className="mc-live-dup">{pill}</span>)}
        </div>
      </div>
    </div>
  )
}

function Tile({ thread, group, now, live, onOpen }: { thread: Thread; group: Group; now: number; live: boolean; onOpen: () => void }) {
  const facts = useTileLive(thread, live, now)
  const info = agentInfo(thread.agent)
  const nowSec = Math.floor(now / 1000)

  const time = group === 'working' ? clock(now - facts.turnStartedAt)
    : group === 'waiting' ? `waiting ${clock((nowSec - thread.updatedAt) * 1000)}`
    : `${group === 'failed' ? 'failed' : 'finished'} ${ago(nowSec - thread.updatedAt)}`

  let line: { verb: string; target: string; mono: boolean }
  if (group === 'working') {
    const activity = facts.activity
    line = activity ? { verb: activity.verb, target: activity.target, mono: activity.mono } : { verb: thread.status === 'starting' ? 'Starting…' : 'Working…', target: '', mono: false }
  } else if (group === 'waiting') {
    line = facts.ask ? { verb: 'Asks', target: facts.ask, mono: false } : { verb: 'Waiting for your answer', target: '', mono: false }
  } else if (group === 'failed') {
    line = { verb: '', target: thread.error || 'The session failed', mono: false }
  } else {
    line = { verb: '', target: facts.last || 'Finished', mono: false }
  }

  const report = useContext(Report)
  const text = [line.verb, line.target].filter(Boolean).join(' ')
  useEffect(() => { if (group === 'working') report(thread.id, text) }, [group, thread.id, text, report])

  return (
    <button type="button" className="mc-tile" data-group={group} onClick={onOpen} aria-label={`${thread.title}, ${labels[group]}, on ${thread.deviceName}`}>
      <span className="mc-tile-top">
        <span className="mc-status"><i />{labels[group]}</span>
        <span className="mc-time">{time}</span>
      </span>
      <span className="mc-title">{thread.title}</span>
      <span className="mc-meta">
        <span className="mc-agent"><AgentMark agent={thread.agent} size={16} />{info.name}{thread.model ? <em>{thread.model}</em> : null}</span>
        <span className="mc-where"><DeviceMark deviceId={thread.deviceId} size={13} />{thread.deviceName}<em>{baseName(thread.cwd)}</em></span>
      </span>
      <span className="mc-line" data-mono={line.mono}>
        {line.verb && <b>{line.verb}</b>}
        {line.target && <span>{line.target}</span>}
      </span>
      {group === 'working' && <span className="mc-scan" aria-hidden="true" />}
      <span className="mc-foot">
        {facts.subagents > 0 && <span className="mc-chip"><Icon name="bot" size={13} />{facts.subagents} subagent{facts.subagents === 1 ? '' : 's'}</span>}
        {(facts.add > 0 || facts.del > 0) && <span className="mc-chip mc-diff"><b>+{facts.add}</b><i>−{facts.del}</i></span>}
        {thread.pr && <span className="mc-chip"><Icon name="pull-request" size={13} />#{thread.pr.number}</span>}
      </span>
    </button>
  )
}
