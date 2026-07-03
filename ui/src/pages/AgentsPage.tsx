import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, timeAgo } from '../api'
import { useHubEvents, usePoll } from '../hooks'
import type { Device, FleetSession } from '../types'
import LaunchSessionModal from '../components/LaunchSessionModal'
import StatusBadge from '../components/StatusBadge'

// AgentsPage is the fleet-wide view: every session on every machine, with
// coding agents front and center.
export default function AgentsPage() {
  const [sessions, setSessions] = useState<FleetSession[] | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [showLaunch, setShowLaunch] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([
        api.get<FleetSession[]>('/api/agents'),
        api.get<Device[]>('/api/devices'),
      ])
      setSessions(s)
      setDevices(d)
    } catch {
      /* transient */
    }
  }, [])

  usePoll(load, 8000)
  useHubEvents((e) => {
    if (e.type === 'sessions.changed') load()
  })

  const agents = (sessions ?? []).filter(
    (s) => showAll || (s.kind && s.kind !== 'shell'),
  )

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Agents</h1>
          <p className="mt-1 text-sm text-slate-400">
            Every coding agent running across your fleet.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-400">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
              className="accent-sky-500"
            />
            show plain terminals
          </label>
          <button
            onClick={() => setShowLaunch(true)}
            className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-400"
          >
            ▸ Launch agent
          </button>
        </div>
      </div>

      {sessions === null ? (
        <p className="text-slate-500">Loading…</p>
      ) : agents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 p-12 text-center">
          <p className="mb-2 text-slate-300">Nothing running yet.</p>
          <p className="text-sm text-slate-500">
            Launch Claude Code, Codex, or any CLI agent on any of your machines
            — then watch and steer them all from here.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Session</th>
                <th className="px-4 py-2.5 font-medium">Device</th>
                <th className="px-4 py-2.5 font-medium">Kind</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Last activity</th>
                <th className="w-24 px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {agents.map((s) => (
                <tr
                  key={`${s.deviceId}:${s.name}`}
                  className="cursor-pointer border-t border-slate-800/60 transition hover:bg-slate-900/60"
                  onClick={() => navigate(`/devices/${s.deviceId}`)}
                >
                  <td className="px-4 py-3 font-mono text-[13px] text-slate-200">
                    {s.name}
                  </td>
                  <td className="px-4 py-3 text-slate-300">{s.deviceName}</td>
                  <td className="px-4 py-3 text-slate-400">
                    {s.kind || 'terminal'}
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2">
                      <StatusBadge status={s.status} kind={s.kind} />
                      <span
                        className={
                          s.status === 'working'
                            ? 'text-emerald-300'
                            : 'text-slate-400'
                        }
                      >
                        {s.status}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {timeAgo(s.lastActivity)}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-sky-400">
                    open →
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showLaunch && (
        <LaunchSessionModal
          devices={devices}
          onLaunched={(deviceId) => {
            setShowLaunch(false)
            navigate(`/devices/${deviceId}`)
          }}
          onClose={() => setShowLaunch(false)}
        />
      )}
    </div>
  )
}
