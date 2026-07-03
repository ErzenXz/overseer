import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import { usePoll } from '../hooks'
import type { Device, Session } from '../types'
import Terminal from '../components/Terminal'
import FileBrowser from '../components/FileBrowser'
import LaunchSessionModal from '../components/LaunchSessionModal'
import StatusBadge from '../components/StatusBadge'

export default function DevicePage() {
  const { id = '' } = useParams()
  const [device, setDevice] = useState<Device | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [tab, setTab] = useState<'terminal' | 'files'>('terminal')
  const [showLaunch, setShowLaunch] = useState(false)

  const load = useCallback(async () => {
    try {
      const devices = await api.get<Device[]>('/api/devices')
      const d = devices.find((x) => x.id === id) ?? null
      setDevice(d)
      if (d?.online) {
        const s = await api.get<Session[]>(`/api/devices/${id}/sessions`)
        setSessions(s)
        setActive((a) => a ?? s[0]?.name ?? null)
      }
    } catch {
      /* transient */
    }
  }, [id])

  usePoll(load, 10000)

  // Reset when navigating between devices.
  useEffect(() => {
    setActive(null)
    setSessions([])
    setDevice(null)
    setTab('terminal')
  }, [id])

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
    return <div className="p-8 text-slate-500">Loading…</div>
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-slate-500 hover:text-slate-300">
            ←
          </Link>
          <span
            className={`h-2.5 w-2.5 rounded-full ${device.online ? 'bg-emerald-400' : 'bg-slate-600'}`}
          />
          <h1 className="text-lg font-semibold text-slate-100">{device.name}</h1>
          <span className="text-sm text-slate-500">
            {device.os}/{device.arch}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <TabButton active={tab === 'terminal'} onClick={() => setTab('terminal')}>
            Terminals
          </TabButton>
          <TabButton active={tab === 'files'} onClick={() => setTab('files')}>
            Files
          </TabButton>
        </div>
      </header>

      {!device.online ? (
        <div className="flex flex-1 items-center justify-center text-slate-500">
          This device is offline.
        </div>
      ) : tab === 'files' ? (
        <FileBrowser deviceId={id} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-800 bg-slate-900/30 px-3 py-2">
            {sessions.map((s) => (
              <div
                key={s.name}
                className={`group flex shrink-0 cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition ${
                  active === s.name
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:bg-slate-800/50'
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
                  className="hidden rounded p-0.5 text-slate-500 hover:text-rose-400 group-hover:block"
                  title="Kill session"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              onClick={newQuickTerminal}
              className="shrink-0 rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
              title="New terminal"
            >
              + Terminal
            </button>
            <button
              onClick={() => setShowLaunch(true)}
              className="shrink-0 rounded-lg px-3 py-1.5 text-sm text-sky-400 hover:bg-sky-500/10"
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
              <div className="flex h-full items-center justify-center text-slate-500">
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
          ? 'bg-slate-800 text-slate-100'
          : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  )
}
