import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import Icon, { AgentMark } from '../components/Icon'
import { terminalsResource, useDevices } from '../store'
import type { SetupOverview, SetupTool } from '../types'

// SetupPage is the Machines → Setup tab: pick a machine, see which tools it
// has, and install or sign in with one click. Each action runs in a visible
// terminal on that machine, so prompts can be answered there.
export default function SetupPage() {
  const { value: devices } = useDevices()
  const online = (devices ?? []).filter((device) => device.online)
  const [deviceId, setDeviceId] = useState('')
  const [setup, setSetup] = useState<SetupOverview | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const device = online.find((item) => item.id === deviceId)

  useEffect(() => {
    if (!deviceId || !online.some((item) => item.id === deviceId)) setDeviceId(online.find((item) => item.isHub)?.id ?? online[0]?.id ?? '')
  }, [devices]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    if (!deviceId) { setSetup(null); return }
    setLoading(true)
    setError('')
    try {
      setSetup(await api.get<SetupOverview>(`/api/devices/${deviceId}/setup`))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not check this machine')
    } finally {
      setLoading(false)
    }
  }, [deviceId])
  useEffect(() => { setSetup(null); load() }, [load])

  const run = async (name: string, command: string, kind = 'setup') => {
    if (!deviceId || !command) return
    const session = `${name}-${Date.now().toString().slice(-5)}`
    try {
      await api.post(`/api/devices/${deviceId}/sessions`, { name: session, command, kind })
      terminalsResource.refresh()
      navigate(`/machines/${deviceId}?tab=terminal&session=${encodeURIComponent(session)}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start setup')
    }
  }

  if (devices && online.length === 0) {
    return (
      <div className="empty">
        <span className="empty-icon"><Icon name="monitor" size={24} /></span>
        <h2>No machines online</h2>
        <p>Connect a machine first, then set it up here.</p>
      </div>
    )
  }

  const agents = setup?.tools.filter((tool) => tool.id !== 'tailscale' && tool.id !== 'node') ?? []
  const missing = agents.filter((tool) => !tool.installed).length

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="pill-tabs flex-wrap" role="tablist" aria-label="Machine">
          {online.map((item) => (
            <button key={item.id} role="tab" className="pill-tab" aria-selected={item.id === deviceId} onClick={() => setDeviceId(item.id)}>
              <span className="dot dot-green" />{item.name}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <button className="icon-btn" aria-label="Check again" title="Check again" onClick={load} disabled={loading}>{loading ? <span className="spinner" /> : <Icon name="refresh" size={17} />}</button>
        {setup && (
          <button className="btn btn-dark" onClick={() => run('agent-pack', setup.bundleCommand)}>
            <Icon name="download" size={15} />{missing ? `Install ${missing} missing` : 'Update all agents'}
          </button>
        )}
      </div>

      {error && <div className="error-banner mt-6">{error}<button onClick={load}>Retry</button></div>}

      <h2 className="page-section-title mt-8" style={{ marginBottom: 12 }}>Coding agents{device ? ` on ${device.name}` : ''}</h2>
      <div className="list-card">
        {setup === null ? [0, 1, 2].map((index) => <div key={index} className="list-row"><div className="skeleton h-8 w-full" /></div>) : agents.map((tool) => <ToolRow key={tool.id} tool={tool} onRun={run} />)}
      </div>

      {setup && (
        <>
          <h2 className="page-section-title mt-8" style={{ marginBottom: 12 }}>Runtime and access</h2>
          <div className="list-card">
            {setup.tools.filter((tool) => tool.id === 'node' || tool.id === 'tailscale').map((tool) => <ToolRow key={tool.id} tool={tool} onRun={run} />)}
          </div>
          <p className="hint mt-4">Sign-in opens each agent’s official login in a terminal on {device?.name ?? 'the machine'}. Credentials stay in that tool’s own storage; Overseer never copies them.</p>
        </>
      )}
    </div>
  )
}

function ToolRow({ tool, onRun }: { tool: SetupTool; onRun: (name: string, command: string, kind?: string) => void }) {
  const signedIn = tool.auth === 'connected' || tool.auth === 'not-required'
  const status = !tool.installed ? { text: 'Not installed', className: '' } : signedIn ? { text: tool.auth === 'not-required' ? 'Ready' : 'Signed in', className: 'badge-green' } : tool.authCommand ? { text: 'Sign-in needed', className: 'badge-amber' } : { text: 'Installed', className: 'badge-green' }
  const mark = tool.id === 'node' ? <Icon name="code" size={18} /> : tool.id === 'tailscale' ? <Icon name="lock" size={18} /> : <AgentMark agent={tool.id} size={18} />
  return (
    <div className="list-row">
      <span className="tile-icon">{mark}</span>
      <div className="min-w-0 flex-1">
        <div className="list-row-title flex items-center gap-2">{tool.name}<span className={`badge ${status.className}`}>{status.text}</span></div>
        <div className="list-row-sub truncate">{tool.version ? <span className="font-mono text-[12.5px]">{tool.version}</span> : tool.note ?? tool.description}</div>
      </div>
      {tool.installed && tool.authCommand && !signedIn && <button className="btn btn-sm btn-dark" onClick={() => onRun(`login-${tool.id}`, tool.authCommand!, tool.id)}>{tool.id === 'tailscale' ? 'Connect' : 'Sign in'}</button>}
      {!tool.installed && <button className="btn btn-sm btn-dark" onClick={() => onRun(`install-${tool.id}`, tool.installCommand)}>Install</button>}
      {tool.installed && <button className="btn btn-sm btn-ghost" onClick={() => onRun(`install-${tool.id}`, tool.installCommand)}>Update</button>}
      <a href={tool.docsUrl} target="_blank" rel="noreferrer" className="icon-btn" aria-label={`${tool.name} docs`} title="Official guide"><Icon name="external" size={16} /></a>
    </div>
  )
}
