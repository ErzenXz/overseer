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
    <div className="page-shell">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="eyebrow mb-3">Active work</p>
          <h1 className="text-3xl font-semibold tracking-[-0.04em] text-zinc-100">Agents</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Every coding agent running across your fleet.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
              className="accent-lime-300"
            />
            show plain terminals
          </label>
          <button
            onClick={() => setShowLaunch(true)}
            className="btn-primary"
          >
            ▸ Launch agent
          </button>
        </div>
      </div>

      {sessions === null ? (
        <p className="text-zinc-500">Loading…</p>
      ) : agents.length === 0 ? (
        <div className="surface rounded-2xl p-12 text-center">
          <p className="mb-2 text-zinc-300">Nothing running yet.</p>
          <p className="text-sm text-zinc-500">
            Launch Claude Code, Codex, or any CLI agent on any of your machines
            — then watch and steer them all from here.
          </p>
        </div>
      ) : (
        <div className="surface overflow-hidden rounded-2xl">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-left text-xs text-zinc-500">
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
                  className="cursor-pointer border-t border-zinc-800/60 transition hover:bg-zinc-900/60"
                  onClick={() => navigate(`/devices/${s.deviceId}`)}
                >
                  <td className="px-4 py-3 font-mono text-[13px] text-zinc-200">
                    {s.name}
                  </td>
                  <td className="px-4 py-3 text-zinc-300">{s.deviceName}</td>
                  <td className="px-4 py-3 text-zinc-400">
                    {s.kind || 'terminal'}
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2">
                      <StatusBadge status={s.status} kind={s.kind} />
                      <span
                        className={
                          s.status === 'working'
                            ? 'text-emerald-300'
                            : 'text-zinc-400'
                        }
                      >
                        {s.status}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-500">
                    {timeAgo(s.lastActivity)}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-lime-400">
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
