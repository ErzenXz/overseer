import { useCallback, useState } from 'react'
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
      /* transient */
    }
  }, [])

  usePoll(load, 15000)
  useHubEvents((e) => {
    if (e.type === 'device.online' || e.type === 'device.offline') load()
    if (e.type === 'device.stats' && e.deviceId && e.stats) {
      setDevices((ds) =>
        ds
          ? ds.map((d) => (d.id === e.deviceId ? { ...d, stats: e.stats } : d))
          : ds,
      )
    }
  })

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Devices</h1>
          <p className="mt-1 text-sm text-slate-400">
            Every machine in your fleet, live.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-400"
        >
          + Add device
        </button>
      </div>

      {devices === null ? (
        <p className="text-slate-500">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {devices.map((d) => (
            <DeviceCard key={d.id} device={d} />
          ))}
        </div>
      )}

      {showAdd && (
        <AddDeviceModal
          onClose={() => {
            setShowAdd(false)
            load()
          }}
        />
      )}
    </div>
  )
}

function DeviceCard({ device: d }: { device: Device }) {
  return (
    <Link
      to={`/devices/${d.id}`}
      className="group rounded-xl border border-slate-800 bg-slate-900/50 p-5 transition hover:border-slate-700 hover:bg-slate-900"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              d.online ? 'bg-emerald-400' : 'bg-slate-600'
            }`}
          />
          <span className="font-medium text-slate-100 group-hover:text-white">
            {d.name}
          </span>
          {d.isHub && (
            <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[11px] font-medium text-sky-400">
              hub
            </span>
          )}
        </div>
        <span className="text-xs text-slate-500">
          {d.os && `${d.os}/${d.arch}`}
        </span>
      </div>

      {d.online && d.stats ? (
        <div className="grid grid-cols-3 gap-3 text-sm">
          <Meter label="CPU" pct={d.stats.cpuPercent} />
          <Meter
            label="RAM"
            pct={(d.stats.memUsed / d.stats.memTotal) * 100}
            sub={formatBytes(d.stats.memUsed)}
          />
          <Meter
            label="Disk"
            pct={(d.stats.diskUsed / d.stats.diskTotal) * 100}
            sub={formatBytes(d.stats.diskTotal - d.stats.diskUsed) + ' free'}
          />
        </div>
      ) : d.online ? (
        <p className="text-sm text-slate-500">online — gathering stats…</p>
      ) : (
        <p className="text-sm text-slate-500">
          offline · last seen {timeAgo(d.lastSeen)}
        </p>
      )}
      {d.online && !d.tmux && (
        <p className="mt-3 text-xs text-amber-400/80">
          tmux not installed — terminals won't survive disconnects
        </p>
      )}
    </Link>
  )
}

function Meter({ label, pct, sub }: { label: string; pct: number; sub?: string }) {
  const clamped = Math.min(100, Math.max(0, pct || 0))
  const color =
    clamped > 90 ? 'bg-rose-400' : clamped > 70 ? 'bg-amber-400' : 'bg-sky-400'
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs text-slate-400">{label}</span>
        <span className="text-xs tabular-nums text-slate-300">
          {Math.round(clamped)}%
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full ${color} transition-all duration-500`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {sub && <div className="mt-1 text-[11px] text-slate-500">{sub}</div>}
    </div>
  )
}
