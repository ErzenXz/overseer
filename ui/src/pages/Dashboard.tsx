import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, formatBytes, timeAgo } from '../api'
import { useHubEvents, usePoll } from '../hooks'
import type { Device } from '../types'
import AddDeviceModal from '../components/AddDeviceModal'
import Icon, { type IconName } from '../components/Icon'

export default function Dashboard() {
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [view, setView] = useState<'list' | 'grid'>('list')
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try { setDevices(await api.get<Device[]>('/api/devices')); setError('') }
    catch { setError('Unable to refresh your fleet. Displayed data may be out of date.') }
  }, [])
  usePoll(load, 15000)
  useHubEvents((event) => {
    if (event.type === 'device.online' || event.type === 'device.offline') load()
    if (event.type === 'device.stats' && event.deviceId && event.stats) {
      setDevices((current) => current?.map((d) => d.id === event.deviceId ? { ...d, stats: event.stats } : d) ?? current)
    }
  })
  const fleet = useMemo(() => {
    const list = devices ?? [], online = list.filter((d) => d.online), reporting = online.filter((d) => d.stats)
    return {
      total: list.length, online: online.length, reporting: reporting.length,
      cores: reporting.reduce((n, d) => n + (d.stats?.cpuCores ?? 0), 0),
      memory: reporting.reduce((n, d) => n + Math.max(0, (d.stats?.memTotal ?? 0) - (d.stats?.memUsed ?? 0)), 0),
      attention: list.filter((d) => !d.online || (d.stats?.cpuPercent ?? 0) >= 80).length,
    }
  }, [devices])
  const visible = (devices ?? []).filter((d) => (filter === 'all' || (filter === 'online' ? d.online : !d.online)) && `${d.name} ${d.hostname} ${d.os}`.toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <div className="page-shell">
      <header className="page-heading"><div><p className="eyebrow">Your control plane</p><h1>Fleet overview</h1><p>All your machines. One place to build.</p></div><button onClick={() => setShowAdd(true)} className="btn-primary"><Icon name="plus" size={16} />Add device</button></header>
      {error && <div className="error-banner" role="alert">{error}<button onClick={load}>Retry</button></div>}
      <section className="summary-grid" aria-label="Fleet summary">
        <Summary icon="monitor" label="Devices online" value={devices ? String(fleet.online) : '—'} detail={devices ? `of ${fleet.total} in your fleet` : 'Connecting to your hub'} good />
        <Summary icon="cpu" label="CPU cores" value={fleet.reporting ? String(fleet.cores) : '—'} detail={`Across ${fleet.reporting} reporting devices`} />
        <Summary icon="memory" label="Available memory" value={fleet.reporting ? formatBytes(fleet.memory) : '—'} detail="On reporting online devices" />
        <Summary icon="activity" label="Needs attention" value={devices ? String(fleet.attention) : '—'} detail={fleet.attention ? 'Offline or CPU usage ≥ 80%' : 'No offline or high-CPU devices'} good={!fleet.attention} />
      </section>
      <section className="device-section" aria-label="Devices">
        <div className="section-heading"><h2>Devices <span className="count-badge">{devices?.length ?? '—'}</span></h2><span className="text-xs text-zinc-500">Updates automatically</span></div>
        <div className="fleet-controls"><label className="search-field"><Icon name="search" size={16} /><input aria-label="Search devices" placeholder="Search devices…" value={query} onChange={(e) => setQuery(e.target.value)} />{query && <button onClick={() => setQuery('')} aria-label="Clear search"><Icon name="close" size={14} /></button>}</label><div className="flex items-center gap-3"><select aria-label="Filter devices by status" className="filter-select" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All statuses</option><option value="online">Online</option><option value="offline">Offline</option></select><div className="view-switch" aria-label="Device layout"><button aria-label="List view" aria-pressed={view === 'list'} onClick={() => setView('list')}><Icon name="list" size={16} /></button><button aria-label="Grid view" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><Icon name="fleet" size={15} /></button></div></div></div>
        {devices === null ? <div className="surface rounded-xl p-8 text-sm text-zinc-400" role="status">{error ? 'Your fleet could not be loaded.' : 'Loading your fleet…'}</div> : devices.length === 0 ? <div className="empty-state"><span className="empty-icon"><Icon name="monitor" size={26} /></span><h2>Your fleet starts here</h2><p>Connect a machine with a single install command.</p><button onClick={() => setShowAdd(true)} className="btn-primary">Add your first device</button></div> : visible.length === 0 ? <div className="empty-state"><Icon name="search" size={25} /><h2>No matching devices</h2><p>Try another name, platform, or status.</p><button className="btn-secondary" onClick={() => { setQuery(''); setFilter('all') }}>Clear filters</button></div> : <div className={`device-collection device-collection-${view}`}>{view === 'list' && <div className="device-table-head"><span>Device</span><span>CPU</span><span>Memory</span><span>Load · 1 min</span><span>Status</span><span /></div>}{visible.map((device) => <DeviceItem key={device.id} device={device} />)}</div>}
        {devices && devices.length > 0 && <p className="mt-3 text-xs text-zinc-500">Showing {visible.length} of {devices.length} devices</p>}
      </section>
      <section className="mt-10"><div className="section-heading"><h2>Make yourself at home</h2><span className="text-xs text-zinc-500">Built for your workflow</span></div><div className="quick-links"><QuickLink to="/code" icon="code" title="Start a project" description="Your code, on any machine." /><QuickLink to="/agents" icon="terminal" title="Run an agent" description="Launch, watch, and steer your work." /><QuickLink to="/setup" icon="setup" title="Prepare your machines" description="Coding tools and private access." /></div></section>
      <footer className="page-footnote"><Icon name="shield" size={13} />Your infrastructure. Your data. Your control.</footer>
      {showAdd && <AddDeviceModal onClose={() => { setShowAdd(false); load() }} />}
    </div>
  )
}

function Summary({ icon, label, value, detail, good }: { icon: IconName; label: string; value: string; detail: string; good?: boolean }) {
  return <div className="summary-card"><div className="summary-label">{label}<Icon name={icon} size={16} /></div><p className="summary-value">{value}{good && <span className="status-dot" />}</p><p className="summary-detail">{detail}</p></div>
}
function DeviceItem({ device: d }: { device: Device }) {
  const stats = d.online ? d.stats : undefined
  const memory = stats && stats.memTotal > 0 ? stats.memUsed / stats.memTotal * 100 : undefined
  return <Link to={`/devices/${d.id}`} className="device-item"><div className="device-identity"><span className="device-icon"><Icon name="monitor" size={20} /></span><div className="min-w-0"><div className="flex items-center gap-2"><h3 className="truncate">{d.name}</h3>{d.isHub && <span className="hub-badge">Hub</span>}</div><p className="truncate">{d.os || 'Unknown OS'} <span>·</span> {d.arch || d.hostname}</p></div></div><Metric label="CPU" value={stats?.cpuPercent} /><Metric label="Memory" value={memory} detail={stats && stats.memTotal > 0 ? `${formatBytes(stats.memUsed)} / ${formatBytes(stats.memTotal)}` : undefined} /><div className="device-load"><span className="metric-mobile-label">Load · 1 min</span><span className="font-mono text-xs text-zinc-300">{stats && d.os !== 'windows' ? stats.load1.toFixed(2) : '—'}</span><p>{stats ? `${stats.cpuCores} cores` : d.online ? 'Awaiting metrics' : `Seen ${timeAgo(d.lastSeen)}`}</p></div><span className={`status-pill ${d.online ? 'status-online' : ''}`}><span className="status-dot" />{d.online ? 'Online' : 'Offline'}</span><Icon name="chevron" size={15} className="device-chevron" /></Link>
}
function Metric({ label, value, detail }: { label: string; value?: number; detail?: string }) {
  const percent = value === undefined ? undefined : Math.max(0, Math.min(100, value))
  return <div className="device-metric"><span className="metric-mobile-label">{label}</span><span className="font-mono text-xs text-zinc-300">{percent === undefined ? '—' : `${percent.toFixed(0)}%`}</span><div className="metric-track"><div className={percent !== undefined && percent >= 80 ? 'metric-fill metric-fill-warn' : 'metric-fill'} style={{ width: `${percent ?? 0}%` }} /></div>{detail && <p>{detail}</p>}</div>
}
function QuickLink({ to, icon, title, description }: { to: string; icon: IconName; title: string; description: string }) {
  return <Link to={to} className="quick-link"><span className="quick-icon"><Icon name={icon} size={20} /></span><h3>{title}<Icon name="arrow" size={16} /></h3><p>{description}</p></Link>
}
