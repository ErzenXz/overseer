import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, formatBytes } from '../api'
import { agentInfo, relativeTime } from '../agents'
import AddDeviceModal from '../components/AddDeviceModal'
import Icon from '../components/Icon'
import { Menu, MenuItem, MenuSeparator } from '../components/Menu'
import { devicesResource, terminalsResource, useDevices, useTerminals, useThreads } from '../store'
import type { Device } from '../types'
import SetupPage from './SetupPage'

type Tab = 'machines' | 'terminals' | 'setup'

export function osLabel(device: Device) {
  const names: Record<string, string> = { darwin: 'macOS', linux: 'Linux', windows: 'Windows' }
  const platform = device.platform && device.platform !== device.os ? device.platform : names[device.os] ?? device.os
  return [platform.charAt(0).toUpperCase() + platform.slice(1), device.platformVersion].filter(Boolean).join(' ')
}

export function pct(used = 0, total = 0) {
  return total ? Math.round((used / total) * 100) : 0
}

export default function MachinesPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'machines'
  const [adding, setAdding] = useState(params.get('add') === '1')
  const [query, setQuery] = useState('')
  const { value: devices, error } = useDevices()
  const { value: terminals } = useTerminals()
  const { value: threads } = useThreads()

  useEffect(() => { if (params.get('add') === '1') setAdding(true) }, [params])
  const setTab = (next: Tab) => setParams(next === 'machines' ? {} : { tab: next })

  const list = (devices ?? []).filter((device) => !query || `${device.name} ${device.hostname} ${device.os}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Number(b.online) - Number(a.online) || Number(b.isHub) - Number(a.isHub) || a.name.localeCompare(b.name))
  const termList = (terminals ?? []).filter((session) => !query || `${session.name} ${session.deviceName}`.toLowerCase().includes(query.toLowerCase()))
  const busy = (id: string) => (threads ?? []).filter((thread) => thread.deviceId === id && (thread.status === 'working' || thread.status === 'waiting')).length

  const kill = async (deviceId: string, name: string) => {
    if (!confirm(`End “${name}”? Anything running in it stops.`)) return
    await api.del(`/api/devices/${deviceId}/sessions/${encodeURIComponent(name)}`).catch(() => {})
    terminalsResource.refresh()
  }

  return (
    <div className="main-scroll">
      <div className="page">
        <h1 className="page-title">Machines</h1>
        <p className="page-sub">Every computer connected to this hub — their agents, terminals and desktops</p>
        <div className="page-toolbar">
          <div className="pill-tabs" role="tablist">
            <button role="tab" className="pill-tab" aria-selected={tab === 'machines'} onClick={() => setTab('machines')}>Machines <span className="count">{devices?.length ?? 0}</span></button>
            <button role="tab" className="pill-tab" aria-selected={tab === 'terminals'} onClick={() => setTab('terminals')}>Terminals <span className="count">{terminals?.length ?? 0}</span></button>
            <button role="tab" className="pill-tab" aria-selected={tab === 'setup'} onClick={() => setTab('setup')}>Setup</button>
          </div>
          <span className="grow" />
          {tab !== 'setup' && <label className="inline-search"><Icon name="search" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === 'terminals' ? 'Search terminals' : 'Search machines'} aria-label="Search" /></label>}
          {tab !== 'setup' && <button className="icon-btn" aria-label="Refresh" onClick={() => { devicesResource.refresh(); terminalsResource.refresh() }}><Icon name="refresh" size={18} /></button>}
          <Menu placement="bottom-end" width={260} trigger={<button className="btn btn-dark">Add machine<Icon name="chevron-down" size={15} /></button>}>
            {(close) => (
              <>
                <MenuItem icon="user-plus" label="Connect a machine" description="One command on macOS, Linux or Windows" onClick={() => { close(); setAdding(true) }} />
                <MenuItem icon="setup" label="Install agents on a machine" onClick={() => { close(); setTab('setup') }} />
                <MenuSeparator />
                <MenuItem icon="book" label="How desktops work" href="https://github.com/ErzenXz/overseer#remote-desktop" onClick={close} />
              </>
            )}
          </Menu>
        </div>

        {error && !devices && <div className="error-banner mt-6">Couldn’t reach the hub: {error}<button onClick={() => devicesResource.refresh()}>Retry</button></div>}

        {tab === 'machines' && (
          devices && devices.length === 0 ? (
            <div className="empty">
              <span className="empty-icon"><Icon name="monitor" size={24} /></span>
              <h2>No machines yet</h2>
              <p>Paste one command on any computer to connect it. It dials out to this hub, so it works behind NAT and firewalls.</p>
              <button className="btn btn-dark" onClick={() => setAdding(true)}>Connect a machine</button>
            </div>
          ) : (
            <div className="list-card mt-8">
              {devices === null && [0, 1, 2].map((index) => <div key={index} className="list-row"><div className="skeleton h-9 w-full" /></div>)}
              {list.map((device) => {
                const s = device.stats
                const cpu = Math.round(s?.cpuPercent ?? 0)
                const mem = pct(s?.memUsed, s?.memTotal)
                const disk = pct(s?.diskUsed, s?.diskTotal)
                const running = busy(device.id)
                return (
                  <Link key={device.id} to={`/machines/${device.id}`} className="list-row">
                    <span className="tile-icon"><Icon name={device.os === 'darwin' ? 'laptop' : device.os === 'windows' ? 'monitor' : 'server'} size={19} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="list-row-title flex items-center gap-2">
                        <span className="truncate">{device.name}</span>
                        {device.isHub && <span className="badge">Hub</span>}
                        {running > 0 && <span className="badge"><span className="dot dot-blue dot-pulse" />{running} active</span>}
                      </div>
                      <div className="list-row-sub flex items-center gap-1.5">
                        <span className={`dot ${device.online ? 'dot-green' : ''}`} />
                        <span>{device.online ? 'Online' : `Offline · seen ${relativeTime(device.lastSeen)}`}</span>
                        <span className="text-faint">·</span><span className="truncate">{osLabel(device)} · {device.arch}</span>
                      </div>
                    </div>
                    {device.online && s ? (
                      <div className="machine-row-stats">
                        <Stat label="CPU" value={cpu} />
                        <Stat label="Memory" value={mem} />
                        <Stat label="Disk" value={disk} detail={`${formatBytes((s.diskTotal ?? 0) - (s.diskUsed ?? 0))} free`} />
                      </div>
                    ) : <span className="machine-row-stats" />}
                    <Icon name="chevron" size={16} className="text-faint" />
                  </Link>
                )
              })}
              {devices && devices.length > 0 && list.length === 0 && <p className="menu-empty px-6 py-6">No machines match “{query}”.</p>}
            </div>
          )
        )}

        {tab === 'terminals' && (
          termList.length === 0 ? (
            <div className="empty">
              <span className="empty-icon"><Icon name="terminal" size={24} /></span>
              <h2>No terminals running</h2>
              <p>Terminals run in tmux on each machine, so they keep going after you close the browser.</p>
              <Link to="/?mode=terminal" className="btn btn-dark">New terminal</Link>
            </div>
          ) : (
            <div className="list-card mt-8">
              {termList.map((session) => (
                <div key={`${session.deviceId}:${session.name}`} className="list-row">
                  <span className="tile-icon"><Icon name="terminal" size={18} /></span>
                  <Link to={`/machines/${session.deviceId}?tab=terminal&session=${encodeURIComponent(session.name)}`} className="min-w-0 flex-1">
                    <div className="list-row-title font-mono text-[14px]">{session.name}</div>
                    <div className="list-row-sub">{session.deviceName} · {session.kind && session.kind !== 'shell' ? agentInfo(session.kind).name : 'Shell'} · {session.status === 'working' ? 'Running' : session.status === 'exited' ? 'Ended' : 'Idle'} · {relativeTime(session.lastActivity)}{session.ephemeral ? ' · not persistent' : ''}</div>
                  </Link>
                  <button className="icon-btn" aria-label={`End ${session.name}`} title="End terminal" onClick={() => kill(session.deviceId, session.name)}><Icon name="trash" size={17} /></button>
                </div>
              ))}
            </div>
          )
        )}

        {tab === 'setup' && <div className="mt-8"><SetupPage /></div>}
      </div>
      {adding && <AddDeviceModal onClose={() => { setAdding(false); if (params.get('add')) setParams({}); devicesResource.refresh() }} />}
    </div>
  )
}

function Stat({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <div className="stat" title={detail}>
      <div className="stat-label"><span>{label}</span><span className="data-number">{value}%</span></div>
      <div className={`meter ${value > 90 ? 'meter-bad' : value > 75 ? 'meter-warn' : ''}`}><span style={{ width: `${Math.min(100, value)}%` }} /></div>
    </div>
  )
}
