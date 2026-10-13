import { useCallback, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, timeAgo } from '../api'
import { useHubEvents, usePoll } from '../hooks'
import type { Device, FleetSession } from '../types'
import LaunchSessionModal from '../components/LaunchSessionModal'
import StatusBadge from '../components/StatusBadge'
import Icon from '../components/Icon'

export default function AgentsPage() {
  const [sessions, setSessions] = useState<FleetSession[] | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [showLaunch, setShowLaunch] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const load = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([api.get<FleetSession[]>('/api/agents'), api.get<Device[]>('/api/devices')])
      setSessions(s); setDevices(d); setError('')
    } catch { setError('Unable to refresh agent runs. Displayed data may be out of date.') }
  }, [])
  usePoll(load, 8000)
  useHubEvents((e) => { if (['sessions.changed', 'device.online', 'device.offline'].includes(e.type)) load() })
  const agents = (sessions ?? []).filter((s) => (showAll || (s.kind && s.kind !== 'shell')) && `${s.name} ${s.deviceName} ${s.kind}`.toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <div className="page-shell">
      <header className="page-heading"><div><p className="eyebrow">Work in motion</p><h1>Agent runs</h1><p>A little less switching tabs. A lot more getting things done.</p></div><button onClick={() => setShowLaunch(true)} className="btn-primary" disabled={!devices.some((d) => d.online)}><Icon name="plus" size={16} />Launch agent</button></header>
      {error && <div className="error-banner" role="alert">{error}<button onClick={load}>Retry</button></div>}
      <div className="fleet-controls"><label className="search-field"><Icon name="search" size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search agent runs" placeholder="Search runs, devices, or agents…" /></label><label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="accent-lime-300" />Include terminals</label></div>
      {sessions === null ? <p className="p-6 text-sm text-zinc-500">{error ? 'Agent runs unavailable.' : 'Loading runs…'}</p> : agents.length === 0 ? <div className="empty-state"><span className="empty-icon"><Icon name="terminal" size={25} /></span><h2>{query ? 'No matching runs' : 'Space for your next great idea'}</h2><p>{query ? 'Try another session, device, or agent name.' : 'Launch Claude Code, Codex, or your favorite CLI on a connected machine. Follow every run right here.'}</p>{query ? <button className="btn-secondary" onClick={() => setQuery('')}>Clear search</button> : devices.some((d) => d.online) ? <button onClick={() => setShowLaunch(true)} className="btn-secondary"><Icon name="plus" size={16} />Launch your first agent</button> : <Link to="/fleet" className="btn-secondary">Connect a device</Link>}</div> : <div className="agent-list">{agents.map((s) => <Link key={`${s.deviceId}:${s.name}`} to={`/devices/${s.deviceId}?session=${encodeURIComponent(s.name)}`} className="agent-row"><span className="device-icon"><Icon name="terminal" /></span><div className="min-w-0 flex-1"><h2 className="truncate text-sm font-medium">{s.name}</h2><p className="mt-1 text-xs text-zinc-500">{s.deviceName} · {s.kind || 'terminal'}</p></div><span className="flex items-center gap-2 text-xs text-zinc-400"><StatusBadge status={s.status} kind={s.kind} />{s.status}</span><span className="text-[11px] text-zinc-500">{timeAgo(s.lastActivity)}</span><Icon name="chevron" size={15} className="text-zinc-500" /></Link>)}</div>}
      {showLaunch && <LaunchSessionModal devices={devices} onLaunched={(deviceId, session) => { setShowLaunch(false); navigate(`/devices/${deviceId}?session=${encodeURIComponent(session)}`) }} onClose={() => setShowLaunch(false)} />}
    </div>
  )
}
