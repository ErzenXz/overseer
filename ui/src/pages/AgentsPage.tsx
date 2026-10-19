import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, timeAgo } from '../api'
import { useHubEvents, usePoll } from '../hooks'
import type { Device, FleetSession } from '../types'
import LaunchSessionModal from '../components/LaunchSessionModal'
import Icon from '../components/Icon'

type Filter = 'all' | 'active' | 'exited'

export default function AgentsPage() {
  const [sessions, setSessions] = useState<FleetSession[] | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [showLaunch, setShowLaunch] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [kind, setKind] = useState('all')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const requestId = useRef(0)
  const navigate = useNavigate()
  const load = useCallback(async () => {
    const request = ++requestId.current
    try {
      const [nextSessions, nextDevices] = await Promise.all([
        api.get<FleetSession[]>('/api/agents'), api.get<Device[]>('/api/devices'),
      ])
      if (request !== requestId.current) return
      setSessions(nextSessions); setDevices(nextDevices); setError('')
    } catch {
      if (request === requestId.current) setError('Could not refresh sessions. Displayed data may be out of date.')
    }
  }, [])
  usePoll(load, 8000)
  useEffect(() => () => { requestId.current++ }, [])
  useHubEvents((event) => { if (['sessions.changed', 'device.online', 'device.offline'].includes(event.type)) load() })

  const all = sessions ?? []
  const counts = { all: all.length, active: all.filter((s) => s.status !== 'exited').length, exited: all.filter((s) => s.status === 'exited').length }
  const visible = all.filter((session) =>
    (filter === 'all' || (filter === 'active' ? session.status !== 'exited' : session.status === 'exited')) &&
    (kind === 'all' || (kind === 'agents' ? session.kind && session.kind !== 'shell' : !session.kind || session.kind === 'shell')) &&
    `${session.name} ${session.deviceName} ${session.kind}`.toLowerCase().includes(query.trim().toLowerCase())
  ).sort((a, b) => b.lastActivity - a.lastActivity)
  const online = devices.filter((d) => d.online).length
  const filtered = query.trim() || filter !== 'all' || kind !== 'all'

  return (
    <div className="page-shell sessions-page">
      <header className="page-heading">
        <div><h1>Sessions</h1><p>Your agents and terminals, together.</p></div>
        <button onClick={() => setShowLaunch(true)} className="btn-primary" disabled={!online} title={!online ? 'Connect a machine to start a session' : undefined}><Icon name="plus" size={16} />New session</button>
      </header>
      {error && <div className="error-banner" role="alert">{error}<button onClick={load}>Retry</button></div>}
      <div className="session-tools">
        <div className="segmented-control" role="group" aria-label="Session status">
          {(['all', 'active', 'exited'] as const).map((value) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? 'All sessions' : value === 'active' ? 'Active' : 'Ended'}<span>{sessions === null ? '—' : counts[value]}</span></button>)}
        </div>
        <div className="session-filters">
          <label className="search-field"><Icon name="search" size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search sessions" placeholder="Search sessions…" />{query && <button className="clear-search" onClick={() => setQuery('')} aria-label="Clear search"><Icon name="close" size={13} /></button>}</label>
          <select className="filter-select" aria-label="Session type" value={kind} onChange={(e) => setKind(e.target.value)}><option value="all">All types</option><option value="agents">Agents</option><option value="terminals">Terminals</option></select>
        </div>
      </div>
      <section className="session-collection" aria-label="Session list" aria-busy={sessions === null && !error}>
        <div className="session-table-head" aria-hidden="true"><span>Session</span><span>Machine</span><span>Status</span><span>Last active</span><span /></div>
        {sessions === null ? <div className="session-loading" role="status">{error ? 'Sessions unavailable.' : 'Loading sessions…'}</div> : visible.length === 0 ? (
          <div className="empty-state session-empty">
            <span className="empty-icon"><Icon name={filtered ? 'search' : 'terminal'} size={26} /></span>
            <h2>{filtered ? 'No matching sessions' : 'Ready when you are'}</h2>
            <p>{filtered ? 'Try a different search or filter.' : 'Start an agent or open a terminal on a connected machine.'}</p>
            {filtered ? <button className="btn-secondary" onClick={() => { setQuery(''); setFilter('all'); setKind('all') }}>Clear filters</button> : online ? <button onClick={() => setShowLaunch(true)} className="btn-primary"><Icon name="plus" size={15} />New session</button> : <Link to="/fleet" className="btn-primary">Connect a machine<Icon name="arrow" size={15} /></Link>}
          </div>
        ) : visible.map((session) => (
          <Link key={`${session.deviceId}:${session.name}`} to={`/devices/${session.deviceId}?session=${encodeURIComponent(session.name)}`} className="session-row">
            <div className="session-identity"><span className={`session-app-icon ${session.kind && session.kind !== 'shell' ? 'session-app-agent' : ''}`}><Icon name={session.kind && session.kind !== 'shell' ? 'code' : 'terminal'} size={19} /></span><div className="min-w-0"><h2>{session.name}</h2><p>{session.kind === 'claude' ? 'Claude Code' : session.kind === 'codex' ? 'Codex' : !session.kind || session.kind === 'shell' ? 'Terminal' : session.kind}</p></div></div>
            <span className="session-machine"><Icon name="monitor" size={14} /><span>{session.deviceName}</span></span>
            <span className={`session-state session-state-${session.status}`}><span />{session.status === 'working' ? 'Working' : session.status === 'idle' ? 'Idle' : 'Ended'}</span>
            <span className="session-updated">{timeAgo(session.lastActivity)}</span>
            <Icon name="chevron" size={14} className="session-chevron" />
          </Link>
        ))}
      </section>
      <footer className="sessions-footer"><span>{sessions === null ? 'Connecting to your workspace' : `${visible.length} ${visible.length === 1 ? 'session' : 'sessions'}`}<span className="footer-divider">·</span>Sorted by recent activity</span><Link to="/fleet"><span className={`node-dot ${online ? 'node-dot-online' : ''}`} />{online} {online === 1 ? 'machine' : 'machines'} online<Icon name="chevron" size={12} /></Link></footer>
      <div className="workspace-links"><Link to="/setup"><Icon name="setup" size={15} />Set up an agent<Icon name="arrow" size={13} /></Link><Link to="/settings"><Icon name="settings" size={15} />Manage presets<Icon name="arrow" size={13} /></Link></div>
      {showLaunch && <LaunchSessionModal devices={devices} onLaunched={(deviceId, session) => { setShowLaunch(false); navigate(`/devices/${deviceId}?session=${encodeURIComponent(session)}`) }} onClose={() => setShowLaunch(false)} />}
    </div>
  )
}
