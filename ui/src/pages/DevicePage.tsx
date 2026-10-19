import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, formatBytes, timeAgo } from '../api'
import { usePoll } from '../hooks'
import type { Device, Session } from '../types'
import Terminal from '../components/Terminal'
import FileBrowser from '../components/FileBrowser'
import LaunchSessionModal from '../components/LaunchSessionModal'
import StatusBadge from '../components/StatusBadge'

export default function DevicePage() {
  const { id = '' } = useParams()
  const [searchParams] = useSearchParams()
  const [device, setDevice] = useState<Device | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [active, setActive] = useState<string | null>(null)
  const requestedSession = searchParams.get('session')
  const [tab, setTab] = useState<'overview' | 'terminal' | 'files'>(requestedSession ? 'terminal' : 'overview')
  const [showLaunch, setShowLaunch] = useState(false)
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const request = ++requestId.current
    try {
      const devices = await api.get<Device[]>('/api/devices')
      const d = devices.find((x) => x.id === id) ?? null
      const s = d?.online ? await api.get<Session[]>(`/api/devices/${id}/sessions`) : []
      if (request !== requestId.current) return
      setDevice(d)
      setSessions(s)
      setActive((a) => a ?? requestedSession ?? s[0]?.name ?? null)
    } catch {
      /* transient */
    }
  }, [id, requestedSession])

  usePoll(load, 10000)

  // A sidebar selection may change only the session query, not the route.
  useEffect(() => {
    setActive(requestedSession)
    setSessions([])
    setDevice(null)
    setTab(requestedSession ? 'terminal' : 'overview')
    load()
    return () => { requestId.current++ }
  }, [id, requestedSession, load])

  const newQuickTerminal = () => {
    // tmux new-session -A on the agent side creates it on first attach.
    const base = 'term'
    let n = 1
    while (sessions.some((s) => s.name === `${base}-${n}`)) n++
    const name = `${base}-${n}`
    setSessions((ss) => [
      ...ss,
      {
        name,
        kind: 'shell',
        status: 'idle',
        createdAt: Date.now() / 1000,
        lastActivity: Date.now() / 1000,
        attached: false,
        ephemeral: device ? !device.tmux : false,
      },
    ])
    setActive(name)
    setTab('terminal')
  }

  const killSession = async (name: string) => {
    if (!confirm(`Kill session "${name}"? Anything running in it will stop.`)) return
    try {
      await api.del(`/api/devices/${id}/sessions/${encodeURIComponent(name)}`)
    } catch {
      /* it may already be gone */
    }
    setSessions((ss) => ss.filter((s) => s.name !== name))
    setActive((a) => (a === name ? null : a))
    load()
  }

  if (device === null) {
    return <div className="p-8 text-muted">Loading…</div>
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-4 sm:px-7">
        <div className="flex items-center gap-3">
          <Link to="/fleet" className="text-muted hover:text-ink" aria-label="Back to fleet">
            ←
          </Link>
          <span
            className={`h-2.5 w-2.5 rounded-full ${device.online ? 'bg-positive' : 'bg-muted'}`}
          />
          <h1 className="text-lg font-semibold tracking-tight text-ink">{device.name}</h1>
          <span className="font-mono text-xs text-muted">
            {device.os}/{device.arch}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>
            Overview
          </TabButton>
          <TabButton active={tab === 'terminal'} onClick={() => setTab('terminal')}>
            Terminals
          </TabButton>
          <TabButton active={tab === 'files'} onClick={() => setTab('files')}>
            Files
          </TabButton>
        </div>
      </header>

      {!device.online ? (
        <div className="flex flex-1 items-center justify-center text-muted">
          This device is offline.
        </div>
      ) : tab === 'overview' ? (
        <DeviceOverview device={device} onTerminal={() => setTab('terminal')} onFiles={() => setTab('files')} />
      ) : tab === 'files' ? (
        <FileBrowser deviceId={id} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-1 overflow-x-auto border-b border-line bg-tint px-3 py-2">
            {sessions.map((s) => (
              <div
                key={s.name}
                className={`group flex shrink-0 cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition ${
                  active === s.name
                    ? 'bg-tint text-ink'
                    : 'text-muted hover:bg-tint'
                }`}
                onClick={() => setActive(s.name)}
              >
                <StatusBadge status={s.status} kind={s.kind} />
                <span className="font-mono text-[13px]">{s.name}</span>
                {s.ephemeral && (
                  <span title="No tmux: this session won't survive disconnects">
                    ⚡
                  </span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    killSession(s.name)
                  }}
                  className="hidden rounded p-0.5 text-muted hover:text-danger group-hover:block"
                  title="Kill session"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              onClick={newQuickTerminal}
              className="shrink-0 rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-tint hover:text-ink"
              title="New terminal"
            >
              + Terminal
            </button>
            <button
              onClick={() => setShowLaunch(true)}
              className="shrink-0 rounded-lg px-3 py-1.5 text-sm text-accent hover:bg-accent/10"
              title="Launch a coding agent"
            >
              ▸ Launch agent
            </button>
          </div>
          <div className="min-h-0 flex-1">
            {active ? (
              <Terminal
                key={`${id}:${active}`}
                deviceId={id}
                session={active}
                onExit={() => load()}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-muted">
                {sessions.length === 0
                  ? 'No sessions yet — open a terminal or launch an agent.'
                  : 'Pick a session.'}
              </div>
            )}
          </div>
        </div>
      )}

      {showLaunch && device && (
        <LaunchSessionModal
          devices={[device]}
          onLaunched={(_, name) => {
            setShowLaunch(false)
            load().then(() => {
              setActive(name)
              setTab('terminal')
            })
          }}
          onClose={() => setShowLaunch(false)}
        />
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
        active
          ? 'bg-tint text-ink'
          : 'text-muted hover:bg-tint hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

function DeviceOverview({ device, onTerminal, onFiles }: { device: Device; onTerminal: () => void; onFiles: () => void }) {
  const s = device.stats
  const pct = (used = 0, total = 0) => total ? (used / total) * 100 : 0
  return (
    <div className="page-shell flex-1">
      <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow mb-2">Machine health</p>
          <h2 className="text-2xl font-semibold tracking-[-0.035em] text-ink">{device.platform || device.os} {device.platformVersion}</h2>
          <p className="mt-2 font-mono text-xs text-muted">{device.hostname} · {device.arch} · agent {device.agentVersion || 'unknown'}</p>
        </div>
        <div className="flex gap-2"><button onClick={onTerminal} className="btn-primary">Open terminal</button><button onClick={onFiles} className="btn-secondary">Browse files</button></div>
      </div>
      {s ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <HealthMetric label="CPU" value={`${Math.round(s.cpuPercent)}%`} detail={`${s.cpuCores || '—'} logical cores`} pct={s.cpuPercent} />
            <HealthMetric label="Memory" value={formatBytes(s.memUsed)} detail={`${formatBytes(s.memTotal)} total`} pct={pct(s.memUsed, s.memTotal)} />
            <HealthMetric label="Disk" value={formatBytes(s.diskTotal - s.diskUsed)} detail="available" pct={pct(s.diskUsed, s.diskTotal)} />
            <HealthMetric label="Load" value={s.load1 ? s.load1.toFixed(2) : '—'} detail={`${s.load5?.toFixed(2) || '—'} / ${s.load15?.toFixed(2) || '—'} over time`} />
          </section>
          <section className="surface mt-4 grid grid-cols-2 overflow-hidden rounded-2xl sm:grid-cols-4">
            <Detail label="Network received" value={formatBytes(s.netRxBytes)} />
            <Detail label="Network sent" value={formatBytes(s.netTxBytes)} />
            <Detail label="Processes" value={String(s.processCount || '—')} />
            <Detail label="Last contact" value={timeAgo(device.lastSeen)} />
          </section>
          <section className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="surface rounded-2xl p-5"><p className="eyebrow">Terminal continuity</p><p className="mt-3 text-lg font-semibold text-ink">{device.tmux ? 'Reconnectable sessions ready' : device.os === 'windows' ? 'Windows terminal sessions are live' : 'Install tmux for persistence'}</p><p className="mt-2 text-sm leading-6 text-muted">{device.tmux ? 'Agents and shells continue running after the browser closes.' : 'Commands still work, but sessions may end when the connection closes.'}</p></div>
            <div className="surface rounded-2xl p-5"><p className="eyebrow">Kernel</p><p className="mt-3 break-words font-mono text-sm text-secondary">{device.kernelVersion || 'Not reported by this agent version'}</p><p className="mt-2 text-sm text-muted">Architecture: {device.arch}</p></div>
          </section>
        </>
      ) : <div className="surface rounded-2xl p-10 text-center text-sm text-muted">Waiting for the first health snapshot…</div>}
    </div>
  )
}

function HealthMetric({ label, value, detail, pct }: { label: string; value: string; detail: string; pct?: number }) {
  return <article className="surface rounded-2xl p-5"><p className="text-[11px] font-medium text-muted">{label}</p><p className="data-number mt-3 text-3xl font-medium tracking-[-0.05em] text-ink">{value}</p><p className="mt-1 text-xs text-muted">{detail}</p>{pct !== undefined && <div className="mt-5 h-1 bg-tint"><div className="h-full bg-accent" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>}</article>
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="border-b border-r border-line p-5 last:border-r-0 sm:border-b-0"><p className="text-[10px] font-medium uppercase tracking-wider text-muted">{label}</p><p className="data-number mt-2 text-sm text-secondary">{value}</p></div>
}
