import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, formatBytes } from '../api'
import { agentCatalog, relativeTime, threadStatusLabel } from '../agents'
import { useAgentsOn } from '../components/Composer'
import FileBrowser from '../components/FileBrowser'
import Icon, { AgentMark } from '../components/Icon'
import { Menu, MenuItem } from '../components/Menu'
import Terminal from '../components/Terminal'
import PreviewPanel from '../components/PreviewPanel'
import VncViewer from '../components/VncViewer'
import { SidebarToggle, useOwnHeader, useShell } from '../shell'
import { devicesResource, terminalsResource, useDevices, useTerminals, useThreads } from '../store'
import { metricMissing, type Device } from '../types'
import { osLabel, pct } from './MachinesPage'

type Tab = 'overview' | 'desktop' | 'preview' | 'terminal' | 'files' | 'agents'

export default function MachinePage() {
  useOwnHeader()
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'overview'
  const { value: devices } = useDevices()
  const device = devices?.find((item) => item.id === id)
  const navigate = useNavigate()
  const { toast } = useShell()
  const setTab = (next: Tab, extra: Record<string, string> = {}) => setParams(next === 'overview' ? extra : { tab: next, ...extra })

  const rename = async () => {
    if (!device) return
    const name = prompt('Rename machine', device.name)?.trim()
    if (!name || name === device.name) return
    await api.patch(`/api/devices/${device.id}`, { name }).catch((cause) => toast(cause.message))
    devicesResource.refresh()
  }
  const remove = async () => {
    if (!device || !confirm(`Remove ${device.name} from this hub? Its agent stops connecting until you add it again.`)) return
    await api.del(`/api/devices/${device.id}`)
    devicesResource.refresh()
    navigate('/machines')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="topbar">
        <SidebarToggle />
        <nav className="topbar-crumb">
          <Link to="/machines">Machines</Link>
          <Icon name="chevron" size={13} />
          <span className="current">{device?.name ?? '…'}</span>
        </nav>
        {device && <span className={`badge ${device.online ? 'badge-green' : ''}`}><span className={`dot ${device.online ? 'dot-green' : ''}`} />{device.online ? 'Online' : 'Offline'}</span>}
        <div className="topbar-actions">
          <Link to={`/?device=${id}`} className="btn btn-sm btn-dark"><Icon name="plus" size={15} />New session</Link>
          <Menu placement="bottom-end" width={220} trigger={<button className="icon-btn" aria-label="Machine actions"><Icon name="more" size={19} /></button>}>
            {(close) => (
              <>
                <MenuItem icon="edit" label="Rename" onClick={() => { close(); rename() }} />
                <MenuItem icon="setup" label="Install agents" to="/machines?tab=setup" onClick={close} />
                {!device?.isHub && <MenuItem icon="trash" label="Remove machine" danger onClick={() => { close(); remove() }} />}
              </>
            )}
          </Menu>
        </div>
      </header>
      <div className="underline-tabs px-5" role="tablist">
        {([['overview', 'gauge', 'Overview'], ['desktop', 'presentation', 'Desktop'], ['preview', 'globe', 'Preview'], ['terminal', 'terminal', 'Terminals'], ['files', 'folder', 'Files'], ['agents', 'bot', 'Agents']] as const).map(([key, icon, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}><Icon name={icon} size={16} />{label}</button>
        ))}
      </div>
      {!devices ? <div className="grid flex-1 place-items-center"><span className="spinner" /></div>
        : !device ? <div className="empty"><h2>Machine not found</h2><Link to="/machines" className="btn btn-outline">Back to machines</Link></div>
          : !device.online && tab !== 'overview' ? (
            <div className="empty">
              <span className="empty-icon"><Icon name="monitor" size={24} /></span>
              <h2>{device.name} is offline</h2>
              <p>Last seen {relativeTime(device.lastSeen)}. It reconnects on its own when it’s back on the network.</p>
            </div>
          ) : (
            <div className="relative min-h-0 flex-1">
              {tab === 'overview' && <Overview device={device} onTab={setTab} />}
              {tab === 'desktop' && <VncViewer deviceId={device.id} deviceName={device.name} />}
              {tab === 'preview' && <PreviewPanel deviceId={device.id} deviceName={device.name} online={device.online} />}
              {tab === 'terminal' && <Terminals device={device} active={params.get('session')} onSelect={(name) => setTab('terminal', name ? { session: name } : {})} />}
              {tab === 'files' && <div className="h-full"><FileBrowser deviceId={device.id} /></div>}
              {tab === 'agents' && <Agents device={device} />}
            </div>
          )}
    </div>
  )
}

function Overview({ device, onTab }: { device: Device; onTab: (tab: Tab) => void }) {
  const s = device.stats
  const { value: threads } = useThreads()
  const mine = (threads ?? []).filter((thread) => thread.deviceId === device.id).slice(0, 6)
  return (
    <div className="main-scroll h-full">
      <div className="page page-narrow" style={{ paddingTop: 40 }}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="page-title">{device.name}</h1>
            <p className="page-sub">{osLabel(device)} · {device.arch} · {device.hostname}{device.agentVersion ? ` · agent ${device.agentVersion}` : ''}</p>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-outline" onClick={() => onTab('desktop')} disabled={!device.online}><Icon name="presentation" size={16} />Desktop</button>
            <button className="btn btn-outline" onClick={() => onTab('terminal')} disabled={!device.online}><Icon name="terminal" size={16} />Terminal</button>
          </div>
        </div>
        {device.online && s ? (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card label="CPU" value={metricMissing(s, 'cpu') ? '—' : `${Math.round(s.cpuPercent)}%`} detail={`${s.cpuCores} cores · load ${metricMissing(s, 'load') ? 'unavailable' : s.load1.toFixed(2)}`} pctValue={metricMissing(s, 'cpu') ? undefined : s.cpuPercent} />
            <Card label="Memory" value={metricMissing(s, 'memory') || !s.memTotal ? '—' : formatBytes(s.memUsed)} detail={metricMissing(s, 'memory') || !s.memTotal ? 'unavailable' : `of ${formatBytes(s.memTotal)}`} pctValue={metricMissing(s, 'memory') || !s.memTotal ? undefined : pct(s.memUsed, s.memTotal)} />
            <Card label="Disk free" value={metricMissing(s, 'disk') || !s.diskTotal ? '—' : formatBytes(s.diskTotal - s.diskUsed)} detail={metricMissing(s, 'disk') || !s.diskTotal ? 'unavailable' : `of ${formatBytes(s.diskTotal)}`} pctValue={metricMissing(s, 'disk') || !s.diskTotal ? undefined : pct(s.diskUsed, s.diskTotal)} />
            <Card label="Uptime" value={metricMissing(s, 'uptime') ? '—' : `${Math.floor(s.uptimeSec / 86400)}d ${Math.floor((s.uptimeSec % 86400) / 3600)}h`} detail={metricMissing(s, 'processes') ? 'processes unavailable' : `${s.processCount} processes`} />
          </div>
        ) : !device.online ? (
          <div className="callout mt-8" style={{ borderLeftColor: 'var(--text-4)' }}><div><div className="callout-title">Offline</div><p className="callout-text">Last seen {relativeTime(device.lastSeen)}. Sessions on it resume when it reconnects.</p></div></div>
        ) : <div className="mt-8 skeleton h-28" />}
        {device.online && !device.tmux && device.os !== 'windows' && (
          <div className="callout mt-4" style={{ borderLeftColor: '#e0a526' }}><div><div className="callout-title">Install tmux for lasting terminals</div><p className="callout-text">Without tmux, terminals end when the browser disconnects. Agent sessions are not affected.</p></div></div>
        )}
        <section className="page-section" style={{ marginTop: 44 }}>
          <div className="mb-4 flex items-center justify-between"><h2 className="page-section-title" style={{ margin: 0 }}>Sessions on this machine</h2><Link to={`/?device=${device.id}`} className="btn btn-sm btn-outline"><Icon name="plus" size={14} />New</Link></div>
          {mine.length === 0 ? <p className="text-[14px] text-muted">No agent sessions yet.</p> : (
            <div className="list-card">
              {mine.map((thread) => {
                const label = threadStatusLabel(thread)
                return (
                  <Link key={thread.id} to={`/sessions/${thread.id}`} className="list-row" style={{ minHeight: 56 }}>
                    <AgentMark agent={thread.agent} size={18} />
                    <div className="min-w-0 flex-1"><div className="list-row-title truncate">{thread.title}</div><div className="list-row-sub truncate font-mono text-[12.5px]">{thread.cwd}</div></div>
                    {label.text && <span className={`badge ${label.tone === 'ok' ? 'badge-green' : label.tone === 'warn' ? 'badge-amber' : label.tone === 'err' ? 'badge-red' : ''}`}>{label.text}</span>}
                    <span className="text-[13px] text-muted">{relativeTime(thread.updatedAt)}</span>
                  </Link>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function Card({ label, value, detail, pctValue }: { label: string; value: string; detail: string; pctValue?: number }) {
  return (
    <div className="stat-card">
      <div className="k">{label}</div>
      <div className="v">{value}</div>
      <div className="d">{detail}</div>
      {pctValue !== undefined && <div className={`meter mt-4 ${pctValue > 90 ? 'meter-bad' : pctValue > 75 ? 'meter-warn' : ''}`}><span style={{ width: `${Math.min(100, pctValue)}%` }} /></div>}
    </div>
  )
}

function Terminals({ device, active, onSelect }: { device: Device; active: string | null; onSelect: (name: string | null) => void }) {
  const { value: all } = useTerminals()
  const sessions = (all ?? []).filter((session) => session.deviceId === device.id)
  const [extra, setExtra] = useState<string[]>([])
  const names = [...new Set([...sessions.map((session) => session.name), ...extra, ...(active ? [active] : [])])]
  const current = active ?? names[0] ?? null

  useEffect(() => { if (!active && names[0]) onSelect(names[0]) }, [active, names[0]]) // eslint-disable-line react-hooks/exhaustive-deps

  const newTerminal = async () => {
    let n = 1
    while (names.includes(`term-${n}`)) n++
    const name = `term-${n}`
    await api.post(`/api/devices/${device.id}/sessions`, { name, kind: 'shell' }).catch(() => {})
    setExtra((list) => [...list, name])
    terminalsResource.refresh()
    onSelect(name)
  }
  const kill = async (name: string) => {
    if (!confirm(`End “${name}”? Anything running in it stops.`)) return
    await api.del(`/api/devices/${device.id}/sessions/${encodeURIComponent(name)}`).catch(() => {})
    setExtra((list) => list.filter((item) => item !== name))
    terminalsResource.refresh()
    onSelect(names.find((item) => item !== name) ?? null)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="workspace-tabs" style={{ overflowX: 'auto' }}>
        {names.map((name) => (
          <span key={name} className="group relative inline-flex">
            <button className="workspace-tab pr-7 font-mono text-[13px]" aria-selected={current === name} onClick={() => onSelect(name)}>
              <span className={`dot ${sessions.find((session) => session.name === name)?.status === 'working' ? 'dot-green' : ''}`} />{name}
            </button>
            <button className="icon-btn icon-btn-sm absolute right-0.5 top-[3px] opacity-0 group-hover:opacity-100" aria-label={`End ${name}`} onClick={() => kill(name)}><Icon name="close" size={13} /></button>
          </span>
        ))}
        <button className="icon-btn" aria-label="New terminal" title="New terminal" onClick={newTerminal}><Icon name="plus" size={17} /></button>
      </div>
      <div className="min-h-0 flex-1">
        {current ? <Terminal key={`${device.id}:${current}`} deviceId={device.id} session={current} onExit={() => terminalsResource.refresh()} /> : (
          <div className="empty"><h2>No terminals on {device.name}</h2><p>Open one — it runs in tmux and survives closing the browser.</p><button className="btn btn-dark" onClick={newTerminal}>New terminal</button></div>
        )}
      </div>
    </div>
  )
}

function Agents({ device }: { device: Device }) {
  const agents = useAgentsOn(device.id)
  const navigate = useNavigate()
  const install = async (name: string, command: string) => {
    const session = `install-${name}-${Date.now().toString().slice(-5)}`
    await api.post(`/api/devices/${device.id}/sessions`, { name: session, command, kind: 'setup' })
    terminalsResource.refresh()
    navigate(`/machines/${device.id}?tab=terminal&session=${encodeURIComponent(session)}`)
  }
  return (
    <div className="main-scroll h-full">
      <div className="page page-narrow" style={{ paddingTop: 40 }}>
        <h1 className="page-title">Agents on {device.name}</h1>
        <p className="page-sub">Overseer drives Claude Code and Codex natively and everything else over ACP.</p>
        <div className="list-card mt-8">
          {agentCatalog.map((agent) => {
            const state = agents?.find((item) => item.id === agent.id)
            return (
              <div key={agent.id} className="list-row">
                <span className="tile-icon"><AgentMark agent={agent.id} size={19} /></span>
                <div className="min-w-0 flex-1">
                  <div className="list-row-title">{agent.name} <span className="text-[13px] text-muted">· {agent.vendor} · {agent.protocol === 'acp' ? 'ACP' : 'native'}</span></div>
                  <div className="list-row-sub font-mono text-[12.5px]">{state?.installed ? `installed${state.version ? ` · ${state.version}` : ''}` : agent.install}</div>
                </div>
                {agents === null ? <span className="spinner" /> : state?.installed ? (
                  <>
                    <span className="badge badge-green"><Icon name="check" size={12} />Ready</span>
                    {agent.login && <button className="btn btn-sm btn-ghost" onClick={() => install(agent.id, agent.login!)}>Sign in</button>}
                  </>
                ) : <button className="btn btn-sm btn-outline" onClick={() => install(agent.id, agent.install)}>Install</button>}
              </div>
            )
          })}
        </div>
        <p className="hint mt-4">Install and sign-in run in a terminal on {device.name} so you can follow along and answer prompts.</p>
      </div>
    </div>
  )
}
