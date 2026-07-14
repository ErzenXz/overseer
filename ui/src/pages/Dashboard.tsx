import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, formatBytes, timeAgo } from '../api'
import { useHubEvents, usePoll } from '../hooks'
import type { Device } from '../types'
import AddDeviceModal from '../components/AddDeviceModal'

export default function Dashboard() {
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const load = useCallback(async () => {
    try {
      setDevices(await api.get<Device[]>('/api/devices'))
    } catch {
      /* a short network interruption should not clear the fleet */
    }
  }, [])

  usePoll(load, 15000)
  useHubEvents((e) => {
    if (e.type === 'device.online' || e.type === 'device.offline') load()
    if (e.type === 'device.stats' && e.deviceId && e.stats) {
      setDevices((current) => current?.map((d) => d.id === e.deviceId ? { ...d, stats: e.stats } : d) ?? current)
    }
  })

  const fleet = useMemo(() => {
    const list = devices ?? []
    const online = list.filter((d) => d.online)
    const loaded = online.filter((d) => (d.stats?.cpuPercent ?? 0) >= 80)
    const platforms = new Set(list.map((d) => d.os).filter(Boolean))
    return { total: list.length, online: online.length, attention: loaded.length, platforms: platforms.size }
  }, [devices])

  return (
    <div className="page-shell">
      <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow mb-3">Live fleet</p>
          <h1 className="text-3xl font-semibold tracking-[-0.045em] text-white sm:text-4xl">Your machines, at a glance.</h1>
          <p className="mt-3 text-sm text-zinc-500">Health, capacity, and access across every connected device.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/setup" className="btn-secondary">Prepare a machine</Link>
          <button onClick={() => setShowAdd(true)} className="btn-primary">Add device</button>
        </div>
      </header>

      <section className="mb-7 grid grid-cols-2 overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.025] sm:grid-cols-4" aria-label="Fleet summary">
        <Summary label="Online" value={`${fleet.online}/${fleet.total}`} tone="good" />
        <Summary label="Platforms" value={String(fleet.platforms)} />
        <Summary label="High CPU" value={String(fleet.attention)} tone={fleet.attention ? 'warn' : 'muted'} />
        <Summary label="Remote setup" value="Ready" tone="good" />
      </section>

      {devices === null ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((x) => <div key={x} className="surface h-72 animate-pulse rounded-2xl" />)}</div>
      ) : devices.length === 0 ? (
        <div className="surface rounded-2xl px-6 py-16 text-center">
          <p className="font-medium text-zinc-200">This fleet is empty</p>
          <p className="mt-2 text-sm text-zinc-500">Add your first computer with one install command.</p>
          <button onClick={() => setShowAdd(true)} className="btn-primary mt-5">Add first device</button>
        </div>
      ) : (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {devices.map((d) => <DeviceCard key={d.id} device={d} />)}
        </section>
      )}

      {showAdd && <AddDeviceModal onClose={() => { setShowAdd(false); load() }} />}
    </div>
  )
}

function Summary({ label, value, tone = 'muted' }: { label: string; value: string; tone?: 'good' | 'warn' | 'muted' }) {
  const color = tone === 'good' ? 'text-lime-300' : tone === 'warn' ? 'text-amber-200' : 'text-zinc-200'
  return <div className="border-r border-white/[0.06] px-4 py-4 last:border-r-0 sm:px-5"><p className="text-[11px] font-medium text-zinc-600">{label}</p><p className={`data-number mt-1 text-xl font-medium ${color}`}>{value}</p></div>
}

function DeviceCard({ device: d }: { device: Device }) {
  const stats = d.stats
  const memory = ratio(stats?.memUsed, stats?.memTotal)
  const disk = ratio(stats?.diskUsed, stats?.diskTotal)
  const network = (stats?.netRxBytes ?? 0) + (stats?.netTxBytes ?? 0)
  return (
    <Link to={`/devices/${d.id}`} className="surface group flex min-h-72 flex-col rounded-2xl p-5 hover:-translate-y-0.5 hover:border-white/[0.13] hover:bg-white/[0.05]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`h-2 w-2 shrink-0 rounded-full ${d.online ? 'bg-lime-300 shadow-[0_0_12px_rgba(190,242,100,0.6)]' : 'bg-zinc-700'}`} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate font-semibold tracking-tight text-zinc-100 group-hover:text-white">{d.name}</h2>
              {d.isHub && <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-400">hub</span>}
            </div>
            <p className="mt-0.5 truncate text-[11px] text-zinc-600">{d.hostname || 'hostname unavailable'}</p>
          </div>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-zinc-600">{d.os}/{d.arch}</span>
      </div>

      {d.online && stats ? (
        <>
          <div className="mt-6 grid grid-cols-3 gap-4">
            <Meter label="CPU" pct={stats.cpuPercent} value={`${Math.round(stats.cpuPercent)}%`} />
            <Meter label="Memory" pct={memory} value={`${Math.round(memory)}%`} />
            <Meter label="Disk" pct={disk} value={`${Math.round(disk)}%`} />
          </div>
          <dl className="mt-6 grid grid-cols-3 gap-x-3 gap-y-4 border-t border-white/[0.06] pt-4">
            <Fact label="Load" value={stats.load1 ? stats.load1.toFixed(2) : '—'} />
            <Fact label="Cores" value={String(stats.cpuCores || '—')} />
            <Fact label="Processes" value={String(stats.processCount || '—')} />
            <Fact label="Uptime" value={formatDuration(stats.uptimeSec)} />
            <Fact label="Network" value={network ? formatBytes(network) : '—'} />
            <Fact label="Agent" value={cleanVersion(d.agentVersion)} />
          </dl>
        </>
      ) : d.online ? (
        <div className="mt-7 space-y-3"><div className="skeleton h-2 w-full" /><div className="skeleton h-2 w-4/5" /><p className="pt-3 text-xs text-zinc-600">Collecting the first health snapshot…</p></div>
      ) : (
        <div className="flex flex-1 flex-col justify-end pt-12"><p className="text-sm text-zinc-500">Offline</p><p className="mt-1 text-xs text-zinc-700">Last seen {timeAgo(d.lastSeen)}</p></div>
      )}
      {d.online && !d.tmux && d.os !== 'windows' && <p className="mt-4 border-t border-amber-300/10 pt-3 text-xs text-amber-200/60">Install tmux for reconnectable terminals.</p>}
    </Link>
  )
}

function Meter({ label, pct, value }: { label: string; pct: number; value: string }) {
  const clamped = Math.min(100, Math.max(0, pct || 0))
  const bar = clamped > 90 ? 'bg-rose-300' : clamped > 75 ? 'bg-amber-200' : 'bg-lime-300'
  return <div><div className="mb-2 flex items-baseline justify-between gap-2"><span className="text-[10px] font-medium text-zinc-600">{label}</span><span className="data-number text-[11px] text-zinc-300">{value}</span></div><div className="h-1 overflow-hidden bg-white/[0.06]"><div className={`h-full ${bar} transition-[width] duration-500`} style={{ width: `${clamped}%` }} /></div></div>
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-[9px] font-medium uppercase tracking-wider text-zinc-700">{label}</dt><dd className="data-number mt-1 truncate text-[11px] text-zinc-400">{value}</dd></div>
}

function ratio(used = 0, total = 0) { return total > 0 ? (used / total) * 100 : 0 }
function cleanVersion(value?: string) { return value?.replace(/^v/, '').slice(0, 12) || '—' }
function formatDuration(seconds = 0) {
  if (!seconds) return '—'
  const days = Math.floor(seconds / 86400)
  if (days) return `${days}d`
  const hours = Math.floor(seconds / 3600)
  if (hours) return `${hours}h`
  return `${Math.floor(seconds / 60)}m`
}
