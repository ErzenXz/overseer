import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { usePoll } from '../hooks'
import type { Device, SetupOverview, SetupTool } from '../types'

const toolMarks: Record<string, string> = {
  node: 'JS',
  codex: 'CX',
  claude: 'CL',
  gemini: 'GM',
  tailscale: 'TS',
}

export default function SetupPage() {
  const [devices, setDevices] = useState<Device[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [setup, setSetup] = useState<SetupOverview | null>(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const navigate = useNavigate()

  const loadDevices = useCallback(async () => {
    const result = await api.get<Device[]>('/api/devices')
    setDevices(result)
    setDeviceId((current) => {
      if (current && result.some((d) => d.id === current && d.online)) return current
      return result.find((d) => d.online)?.id ?? ''
    })
  }, [])
  usePoll(loadDevices, 15000)

  const loadSetup = useCallback(async () => {
    if (!deviceId) {
      setSetup(null)
      return
    }
    setRefreshing(true)
    setError('')
    try {
      setSetup(await api.get<SetupOverview>(`/api/devices/${deviceId}/setup`))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not inspect this device')
    } finally {
      setRefreshing(false)
    }
  }, [deviceId])

  useEffect(() => {
    loadSetup()
  }, [loadSetup])

  const selected = useMemo(() => devices.find((d) => d.id === deviceId), [devices, deviceId])
  const core = setup?.tools.filter((t) => ['codex', 'claude', 'gemini'].includes(t.id)) ?? []
  const readyCount = core.filter((t) => t.installed).length

  const launchSetup = async (name: string, command: string, kind = 'setup') => {
    if (!deviceId || !command) return
    setError('')
    const session = `${name}-${Date.now().toString().slice(-6)}`
    try {
      await api.post(`/api/devices/${deviceId}/sessions`, {
        name: session,
        command,
        kind,
      })
      navigate(`/devices/${deviceId}?session=${encodeURIComponent(session)}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start setup')
    }
  }

  return (
    <div className="page-shell">
      <section className="mb-9 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="eyebrow mb-3">Machine setup</p>
          <h1 className="max-w-3xl text-3xl font-semibold tracking-[-0.045em] text-white sm:text-4xl">
            Prepare a coding machine from one place.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
            Install the major coding agents, open their secure sign-in flows, and add private remote access without moving auth files between computers.
          </p>
        </div>
        <div className="surface flex min-w-72 items-center gap-3 rounded-xl p-3">
          <span className={`h-2 w-2 rounded-full ${selected?.online ? 'bg-lime-300' : 'bg-zinc-700'}`} />
          <select
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm font-medium text-zinc-100"
            aria-label="Device to configure"
          >
            {devices.filter((d) => d.online).map((d) => (
              <option key={d.id} value={d.id} className="bg-zinc-900">
                {d.name} · {d.os}/{d.arch}
              </option>
            ))}
          </select>
          <button onClick={loadSetup} disabled={refreshing || !deviceId} className="text-xs font-medium text-zinc-500 hover:text-white">
            {refreshing ? 'Checking…' : 'Refresh'}
          </button>
        </div>
      </section>

      {error && <div className="mb-5 rounded-lg border border-rose-400/20 bg-rose-400/[0.07] px-4 py-3 text-sm text-rose-200">{error}</div>}

      <section className="mb-5 grid gap-4 rounded-2xl border border-[#82aaff]/15 bg-[#82aaff]/[0.045] p-5 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:p-6">
        <span className="grid h-11 w-11 place-items-center rounded-xl border border-[#82aaff]/20 bg-[#82aaff]/10 font-mono text-sm font-semibold text-[#bdd0ff]">fx</span>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-zinc-200">fx control plane is built in</h2>
            <span className="rounded bg-[#77d9ab]/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#77d9ab]">ready</span>
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-500">Sign in once from Code. The embedded fx runtime stays in your browser and routes work to any project node, so fx itself does not need to be installed or authenticated on every PC.</p>
        </div>
        <button onClick={() => navigate('/code')} className="btn-secondary">Open Code</button>
      </section>

      {!deviceId ? (
        <EmptyState />
      ) : setup === null ? (
        <SetupSkeleton />
      ) : (
        <>
          <section className="surface mb-5 grid gap-5 rounded-2xl p-5 sm:grid-cols-[1fr_auto] sm:items-center sm:p-6">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="eyebrow">Agent pack</span>
                <span className="text-xs text-zinc-600">{setup.os}/{setup.arch}</span>
              </div>
              <h2 className="text-xl font-semibold tracking-tight text-zinc-100">
                {readyCount === 3 ? 'Core agents are installed' : `${readyCount} of 3 core agents ready`}
              </h2>
              <p className="mt-1 max-w-xl text-sm leading-6 text-zinc-500">
                One setup terminal installs Codex, Claude Code, and Gemini CLI using their official distribution paths.
              </p>
            </div>
            <button
              onClick={() => launchSetup('agent-pack', setup.bundleCommand)}
              className="btn-primary"
            >
              {readyCount === 3 ? 'Repair or update all' : 'Install all three'}
            </button>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            {setup.tools.map((tool) => (
              <ToolCard key={tool.id} tool={tool} onLaunch={launchSetup} />
            ))}
          </section>

          <section className="mt-7 border-l border-lime-300/30 pl-5">
            <h2 className="text-sm font-semibold text-zinc-200">Why legacy agent sign-in still opens once per machine</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-500">
              Codex, Claude, and Gemini store device credentials in their own protected local storage. LiveAgent starts each official login flow and keeps it visible in a remote terminal, but never copies those private tokens into the hub database. The built-in fx workspace above is the one-login path across nodes.
            </p>
          </section>
        </>
      )}
    </div>
  )
}

function ToolCard({
  tool,
  onLaunch,
}: {
  tool: SetupTool
  onLaunch: (name: string, command: string, kind?: string) => void
}) {
  const connected = tool.auth === 'connected' || tool.auth === 'not-required'
  const isRemote = tool.id === 'tailscale'
  return (
    <article className={`surface rounded-2xl p-5 sm:p-6 ${isRemote ? 'lg:col-span-2' : ''}`}>
      <div className="flex items-start gap-4">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/[0.06] font-mono text-[11px] font-bold tracking-wider text-lime-200">
          {toolMarks[tool.id]}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold tracking-tight text-zinc-100">{tool.name}</h2>
            <Status installed={tool.installed} connected={connected} auth={tool.auth} />
          </div>
          <p className="mt-1 text-sm leading-6 text-zinc-500">{tool.description}</p>
          {tool.version && <p className="mt-2 truncate font-mono text-[11px] text-zinc-600">{tool.version}</p>}
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4">
        <button onClick={() => onLaunch(`install-${tool.id}`, tool.installCommand)} className={tool.installed ? 'btn-secondary' : 'btn-primary'}>
          {tool.installed ? 'Update or repair' : 'Install'}
        </button>
        {tool.authCommand && tool.installed && (
          <button onClick={() => onLaunch(`login-${tool.id}`, tool.authCommand!, tool.id)} className="btn-secondary">
            {isRemote ? (connected ? 'Refresh private access' : 'Connect privately') : connected ? 'Open again' : 'Sign in'}
          </button>
        )}
        <a href={tool.docsUrl} target="_blank" rel="noreferrer" className="ml-auto text-xs font-medium text-zinc-600 hover:text-zinc-300">
          Official guide ↗
        </a>
      </div>
      {tool.note && <p className="mt-3 text-xs leading-5 text-zinc-600">{tool.note}</p>}
    </article>
  )
}

function Status({ installed, connected, auth }: { installed: boolean; connected: boolean; auth: string }) {
  const label = !installed ? 'Not installed' : auth === 'not-required' ? 'Ready' : connected ? 'Connected' : auth === 'ready' ? 'Sign-in needed' : 'Installed'
  const color = !installed ? 'bg-zinc-700 text-zinc-400' : connected ? 'bg-lime-300/10 text-lime-300' : 'bg-amber-300/10 text-amber-200'
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${color}`}>{label}</span>
}

function EmptyState() {
  return <div className="surface rounded-2xl p-12 text-center"><p className="font-medium text-zinc-200">No online machines</p><p className="mt-2 text-sm text-zinc-500">Connect a device first, then return here to prepare it.</p></div>
}

function SetupSkeleton() {
  return <div className="grid gap-4 lg:grid-cols-2">{[0, 1, 2, 3].map((x) => <div key={x} className="surface rounded-2xl p-6"><div className="skeleton h-5 w-32" /><div className="skeleton mt-4 h-3 w-full" /><div className="skeleton mt-2 h-3 w-2/3" /><div className="skeleton mt-7 h-9 w-28" /></div>)}</div>
}
