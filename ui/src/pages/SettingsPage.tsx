import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import { agentCatalog, agentInfo, loadAgentCatalog, relativeTime, useAgentCatalog, type AgentInfo } from '../agents'
import AddDeviceModal from '../components/AddDeviceModal'
import Icon, { AgentMark, type IconName } from '../components/Icon'
import { Switch } from '../components/Menu'
import { settingsSections } from '../settings'
import { SidebarToggle, useOwnHeader, useShell } from '../shell'
import { useDevices, usePref, useThreads } from '../store'
import type { DeviceAgent, ExecResult } from '../types'
import Modal from '../components/Modal'
import { McpHelp, Presets, ApiTokens, PreviewSettings, SoftwareUpdates } from './SettingsParts'
import { Meter, type ComposerSettings } from '../components/Composer'
import { resetsIn, usePlanLimits } from '../usageLimits'

export default function SettingsPage() {
  useOwnHeader()
  const { section = '' } = useParams()
  const current = settingsSections.find((item) => item.id === section)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="topbar topbar-bordered">
        <SidebarToggle />
        <nav className="topbar-crumb">
          {current ? <Link to="/settings">Settings</Link> : <span className="current">Settings</span>}
          {current && <><span className="text-faint">/</span><span className="current">{current.title}</span></>}
        </nav>
      </header>
      <div className="main-scroll">
        {current && current.group !== 'personal' && (
          <div className="mx-auto w-full max-w-[1100px] px-6 pt-6"><Link to="/settings" className="settings-back" style={{ margin: 0 }}><Icon name="arrow-left" size={16} />Back to hub</Link></div>
        )}
        <div className="settings-page" style={current ? { paddingTop: 36 } : undefined}>
          {!current ? <Overview /> : (
            <>
              <h1 className="settings-h1">{current.title}</h1>
              <p className="settings-sub">{current.description}</p>
              {section === 'preferences' && <Preferences />}
              {section === 'shortcuts' && <Shortcuts />}
              {section === 'notifications' && <Notifications />}
              {section === 'general' && <SoftwareUpdates />}
              {section === 'connections' && <Connections />}
              {section === 'machines' && <MachinesSettings />}
              {section === 'previews' && <PreviewSettings />}
              {section === 'usage' && <Usage />}
              {section === 'agents' && <AgentsSettings />}
              {section === 'automations' && <LinkCard to="/automations" icon="automation" title="Open Automations" text="Create schedules, run them now, and see past runs." />}
              {section === 'mcp' && <><LinkCard to="/customize" icon="layers" title="Manage MCP servers in Customize" text="Servers you enable there are passed to every agent session on every machine." /><McpHelp /></>}
              {section === 'review' && <LinkCard to="/review" icon="pull-request" title="Open Review" text="Review uses the GitHub CLI signed in on one of your machines. Choose which one from the person icon in Review’s toolbar." />}
              {section === 'presets' && <Presets />}
              {section === 'tokens' && <ApiTokens />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Overview() {
  const [name] = usePref('displayName', 'Overseer')
  const row = (id: string) => {
    const item = settingsSections.find((entry) => entry.id === id)!
    return (
      <Link key={id} to={`/settings/${id}`} className="settings-row">
        <span className={`tile-icon ${item.group === 'products' ? 'tile-icon-blue' : ''}`}><Icon name={item.icon} size={18} /></span>
        <span className="settings-row-main"><span className="settings-row-title">{item.title}</span></span>
        <Icon name="chevron" size={17} />
      </Link>
    )
  }
  return (
    <>
      <h1 className="settings-h1">{name || 'Overseer'}</h1>
      <p className="settings-sub">Hub preferences and settings</p>
      <div className="settings-group">{['general', 'connections', 'machines', 'previews', 'usage'].map(row)}</div>
      <h2 className="settings-h2">Products</h2>
      <p className="settings-sub" style={{ fontSize: 15 }}>Configure agents and the tools they get</p>
      <div className="settings-group">{['agents', 'automations', 'mcp', 'review'].map(row)}</div>
      <h2 className="settings-h2">Advanced</h2>
      <p className="settings-sub" style={{ fontSize: 15 }}>Terminals and programmatic access</p>
      <div className="settings-group">{['presets', 'tokens'].map(row)}</div>
      <h2 className="settings-h2">Personal</h2>
      <div className="settings-group">{['preferences', 'shortcuts', 'notifications'].map(row)}</div>
    </>
  )
}

function LinkCard({ to, icon, title, text }: { to: string; icon: IconName; title: string; text: string }) {
  return (
    <div className="settings-group">
      <Link to={to} className="settings-row">
        <span className="tile-icon tile-icon-blue"><Icon name={icon} size={18} /></span>
        <span className="settings-row-main"><span className="settings-row-title">{title}</span><span className="settings-row-sub block">{text}</span></span>
        <Icon name="chevron" size={17} />
      </Link>
    </div>
  )
}

function Field({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="settings-row" style={{ minHeight: 76 }}>
      <span className="settings-row-main flex-1"><span className="settings-row-title">{title}</span>{sub && <span className="settings-row-sub block">{sub}</span>}</span>
      <span className="settings-row-end">{children}</span>
    </div>
  )
}

function Preferences() {
  const [name, setName] = usePref('displayName', 'Overseer')
  const [theme, setTheme] = usePref<'system' | 'light' | 'dark'>('theme', 'system')
  const [defaults, setDefaults] = usePref<Partial<ComposerSettings>>('composer.defaults', {})
  const [terminals, setTerminals] = usePref('sidebar.terminals', false)
  return (
    <div className="settings-group">
      <Field title="Workspace name" sub="Shown at the top of the sidebar">
        <input className="input" style={{ width: 220 }} value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field title="Theme">
        <div className="seg" role="group" aria-label="Theme">
          {(['system', 'light', 'dark'] as const).map((value) => <button key={value} aria-pressed={theme === value} onClick={() => setTheme(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}
        </div>
      </Field>
      <Field title="Default agent" sub="Preselected when you start a new session">
        <select className="select" value={defaults.agent ?? 'claude'} onChange={(event) => setDefaults({ ...defaults, agent: event.target.value, model: '', effort: '', fast: false, mode: '' })}>
          {agentCatalog.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
        </select>
      </Field>
      <Field title="Model, thinking and mode" sub="Picked in the composer and remembered per agent">
        <Link to="/" className="settings-row-end hover:text-ink">Open composer<Icon name="chevron" size={15} /></Link>
      </Field>
      <Field title="Show terminals in the sidebar" sub="Plain terminal sessions appear next to agent sessions">
        <Switch checked={terminals} label="Show terminals in the sidebar" onChange={setTerminals} />
      </Field>
    </div>
  )
}

function Shortcuts() {
  const mod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl'
  const rows: [string, string[]][] = [
    ['Search sessions, machines and actions', [mod, 'K']],
    ['New session', ['⇧', mod, 'O']],
    ['Show or hide the sidebar', [mod, 'B']],
    ['Send message', ['↵']],
    ['New line in a message', ['⇧', '↵']],
    ['Search settings', ['/']],
    ['Close a menu or dialog', ['Esc']],
  ]
  return (
    <div className="settings-group">
      {rows.map(([label, keys]) => <Field key={label} title={label}><span className="flex gap-1">{keys.map((key) => <span key={key} className="kbd" style={{ height: 24, minWidth: 24, fontSize: 12.5 }}>{key}</span>)}</span></Field>)}
    </div>
  )
}

function Notifications() {
  const [enabled, setEnabled] = usePref('notify.enabled', false)
  const [onDone, setOnDone] = usePref('notify.done', true)
  const [onApproval, setOnApproval] = usePref('notify.approval', true)
  const [permission, setPermission] = useState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  const toggle = async (value: boolean) => {
    if (value && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      const result = await Notification.requestPermission()
      setPermission(result)
      if (result !== 'granted') return
    }
    setEnabled(value)
  }
  return (
    <>
      <div className="settings-group">
        <Field title="Desktop notifications" sub={permission === 'denied' ? 'Blocked by the browser. Allow notifications for this site in its settings.' : permission === 'unsupported' ? 'This browser doesn’t support notifications.' : 'Shown while Overseer is open in a tab'}>
          <Switch checked={enabled && permission === 'granted'} disabled={permission === 'denied' || permission === 'unsupported'} label="Desktop notifications" onChange={toggle} />
        </Field>
        <Field title="When an agent finishes"><Switch checked={onDone} disabled={!enabled} label="When an agent finishes" onChange={setOnDone} /></Field>
        <Field title="When an agent needs approval"><Switch checked={onApproval} disabled={!enabled} label="When an agent needs approval" onChange={setOnApproval} /></Field>
      </div>
      {enabled && permission === 'granted' && <button className="btn btn-outline mt-4" onClick={() => new Notification('Overseer', { body: 'Notifications are working.' })}>Send a test notification</button>}
    </>
  )
}

function Connections() {
  const { value: devices } = useDevices()
  const hub = devices?.find((device) => device.isHub && device.online) ?? devices?.find((device) => device.online)
  const [status, setStatus] = useState<Record<string, { ok: boolean; detail: string } | undefined>>({})
  useEffect(() => {
    if (!hub) return
    const check = async (key: string, command: string, pattern: RegExp) => {
      try {
        const result = await api.post<ExecResult>(`/api/devices/${hub.id}/exec`, { command, timeoutSec: 20 })
        const text = `${result.stdout}\n${result.stderr}`
        const account = text.match(pattern)?.[1]
        setStatus((current) => ({ ...current, [key]: { ok: result.exitCode === 0, detail: result.exitCode === 0 ? `Signed in${account ? ` as ${account}` : ''} on ${hub.name}` : `Not signed in on ${hub.name}` } }))
      } catch {
        setStatus((current) => ({ ...current, [key]: { ok: false, detail: `CLI not found on ${hub.name}` } }))
      }
    }
    check('github', 'gh auth status', /account (\S+)/)
    check('gitlab', 'glab auth status', /as (\S+)/)
  }, [hub?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const provider = (key: string, name: string, icon: React.ReactNode, cli: string) => {
    const state = status[key]
    return (
      <div className="settings-row" style={{ minHeight: 78 }}>
        {icon}
        <span className="settings-row-main flex-1">
          <span className="settings-row-title">{name}</span>
          <span className={`settings-row-sub block ${state?.ok ? 'settings-row-status-ok' : ''}`}>{state === undefined ? (hub ? 'Checking…' : 'No machine online') : state.ok ? state.detail.replace(/^Signed in/, 'Connected') : state.detail}</span>
        </span>
        {!state?.ok && hub && <Link to={`/machines/${hub.id}?tab=terminal`} className="settings-row-end hover:text-ink" title={`Run “${cli} auth login” in a terminal`}>Sign in<Icon name="chevron" size={15} /></Link>}
      </div>
    )
  }
  return (
    <>
      <div className="callout mt-7">
        <div className="min-w-0 flex-1">
          <div className="callout-title"><Icon name="info" size={19} />MCPs are now in Customize</div>
          <p className="callout-text">Connect MCP servers once and every agent on every machine gets them.</p>
        </div>
        <Link to="/customize" className="btn btn-dark">Go to Customize</Link>
      </div>
      <div className="settings-section">
        <div className="settings-section-title">Git providers</div>
        <div className="settings-section-sub">Agents push branches and open pull requests with each machine’s own CLI login</div>
        <div className="settings-group" style={{ marginTop: 18 }}>
          {provider('github', 'GitHub', <Icon name="github" size={26} />, 'gh')}
          {provider('gitlab', 'GitLab', <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path fill="#e24329" d="m12 21.4 3.7-11.3H8.3z" /><path fill="#fc6d26" d="M12 21.4 8.3 10.1H3.1z" /><path fill="#fca326" d="M3.1 10.1 2 13.5c-.1.3 0 .7.3.9l9.7 7z" /><path fill="#fc6d26" d="M12 21.4l3.7-11.3h5.2z" /><path fill="#fca326" d="m20.9 10.1 1.1 3.4c.1.3 0 .7-.3.9l-9.7 7z" /><path fill="#e24329" d="M3.1 10.1h5.2L6.1 3.3c-.1-.4-.6-.4-.7 0zm17.8 0h-5.2l2.2-6.8c.1-.4.6-.4.7 0z" /></svg>, 'glab')}
        </div>
      </div>
      <div className="settings-section">
        <div className="settings-section-title">Programmatic access</div>
        <div className="settings-section-sub">Tokens for the Overseer CLI and remote MCP clients</div>
        <div className="settings-group" style={{ marginTop: 18 }}>
          <Link to="/settings/tokens" className="settings-row"><span className="tile-icon"><Icon name="key" size={18} /></span><span className="settings-row-main flex-1">API tokens</span><Icon name="chevron" size={17} /></Link>
          <Link to="/settings/mcp" className="settings-row"><span className="tile-icon"><Icon name="layers" size={18} /></span><span className="settings-row-main flex-1">Use Overseer from Claude, ChatGPT or Cursor</span><Icon name="chevron" size={17} /></Link>
        </div>
      </div>
    </>
  )
}

function MachinesSettings() {
  const { value: devices } = useDevices()
  const [adding, setAdding] = useState(false)
  return (
    <>
      <div className="mt-6"><button className="btn btn-dark" onClick={() => setAdding(true)}><Icon name="plus" size={16} />Add a machine</button></div>
      <div className="settings-group">
        {(devices ?? []).map((device) => (
          <Link key={device.id} to={`/machines/${device.id}`} className="settings-row" style={{ minHeight: 70 }}>
            <span className="tile-icon"><Icon name="monitor" size={18} /></span>
            <span className="settings-row-main flex-1"><span className="settings-row-title">{device.name}{device.isHub ? ' · hub' : ''}</span><span className="settings-row-sub block">{device.os}/{device.arch} · agent {device.agentVersion ?? 'unknown'}</span></span>
            <span className={`badge ${device.online ? 'badge-green' : ''}`}>{device.online ? 'Online' : 'Offline'}</span>
            <Icon name="chevron" size={17} />
          </Link>
        ))}
      </div>
      {adding && <AddDeviceModal onClose={() => setAdding(false)} />}
    </>
  )
}

function Usage() {
  const { value: threads } = useThreads()
  const rows = useMemo(() => {
    const byAgent = new Map<string, { sessions: number; tokens: number; cost: number }>()
    for (const thread of threads ?? []) {
      const row = byAgent.get(thread.agent) ?? { sessions: 0, tokens: 0, cost: 0 }
      row.sessions++
      row.tokens += (thread.usage?.inputTokens ?? 0) + (thread.usage?.outputTokens ?? 0)
      row.cost += thread.usage?.costUsd ?? 0
      byAgent.set(thread.agent, row)
    }
    return [...byAgent.entries()].sort((a, b) => b[1].tokens - a[1].tokens)
  }, [threads])
  const total = rows.reduce((sum, [, row]) => ({ sessions: sum.sessions + row.sessions, tokens: sum.tokens + row.tokens, cost: sum.cost + row.cost }), { sessions: 0, tokens: 0, cost: 0 })
  return (
    <>
      <PlanLimitsSection />
      <h2 className="settings-h2">Sessions in Overseer</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div className="stat-card"><div className="k">Sessions</div><div className="v">{total.sessions}</div></div>
        <div className="stat-card"><div className="k">Tokens</div><div className="v">{(total.tokens / 1000).toFixed(0)}k</div></div>
        <div className="stat-card"><div className="k">Reported cost</div><div className="v">${total.cost.toFixed(2)}</div><div className="d">Only agents that report cost</div></div>
      </div>
      <div className="list-card mt-6">
        <table className="table">
          <thead><tr><th>Agent</th><th>Sessions</th><th>Tokens</th><th>Cost</th></tr></thead>
          <tbody>{rows.map(([agent, row]) => <tr key={agent}><td><span className="flex items-center gap-2 text-ink"><AgentMark agent={agent} />{agentInfo(agent).name}</span></td><td>{row.sessions}</td><td className="data-number">{row.tokens.toLocaleString()}</td><td className="data-number">{row.cost ? `$${row.cost.toFixed(2)}` : '—'}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="hint mt-3">Agents run on your own subscriptions and API keys. Overseer only shows what each CLI reports.</p>
    </>
  )
}

// Each subscription's rolling limits, as the agent CLIs on your machines
// report them.
function PlanLimitsSection() {
  const { accounts, error, refreshing, refresh } = usePlanLimits()
  const newest = Math.max(0, ...(accounts ?? []).map((item) => item.fetchedAt ?? 0))
  return (
    <section className="mt-7">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="settings-h2" style={{ marginTop: 0 }}>Plan limits</h2>
          <p className="hint mt-1">Your Claude and ChatGPT subscriptions’ rolling limits, read from the CLIs on each machine.</p>
        </div>
        <button className="btn btn-outline btn-sm" onClick={refresh} disabled={refreshing}><Icon name="refresh" size={14} className={refreshing ? 'animate-spin' : ''} />{refreshing ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      {error && <p className="mt-3 text-[13px] text-danger">{error}</p>}
      {!accounts ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">{[0, 1].map((key) => <div key={key} className="skeleton h-36 rounded-xl" />)}</div>
      ) : accounts.length === 0 ? (
        <div className="list-card mt-4 p-6 text-center text-[13.5px] text-muted">No subscriptions found. Sign in to Claude Code or Codex on a machine (Machines → Setup) and they show up here.</div>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {accounts.map((item) => (
            <div key={`${item.deviceId}:${item.agent}`} className="limit-card">
              <div className="limit-card-head">
                <AgentMark agent={item.agent} size={18} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-ink">{agentInfo(item.agent).name}{item.plan ? <span className="limit-plan">{item.plan}</span> : null}</div>
                  <div className="truncate text-[12.5px] text-muted">{item.deviceName}{item.account ? ` · ${item.account}` : ''}</div>
                </div>
                {item.status === 'limited' && <span className="badge badge-red">Limited</span>}
              </div>
              {item.error ? <p className="mt-3 text-[13px] text-muted">{item.error}</p> : (
                <div className="mt-3 space-y-3">
                  {(item.windows ?? []).map((window) => (
                    <div key={window.id}>
                      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[13px]"><span className="text-ink">{window.label}</span><span className="data-number text-muted">{Math.round(window.usedPercent)}% used{window.resetsAt ? ` · resets ${resetsIn(window.resetsAt)}` : ''}</span></div>
                      <Meter percent={window.usedPercent} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {newest > 0 && <p className="hint mt-3">Updated {relativeTime(newest)}. Running sessions keep these current.</p>}
    </section>
  )
}

function AgentsSettings() {
  const catalog = useAgentCatalog()
  const { value: devices } = useDevices()
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<Record<string, { device: string; version?: string }[]>>({})
  const [adding, setAdding] = useState(false)
  const { toast } = useShell()
  const online = (devices ?? []).filter((device) => device.online)
  const onlineKey = online.map((device) => device.id).join()

  // Which machines have which agents, asked of every online machine.
  useEffect(() => {
    let alive = true
    Promise.all(online.map((device) => api.get<DeviceAgent[]>(`/api/devices/${device.id}/agents`).then((items) => ({ device, items })).catch(() => ({ device, items: [] as DeviceAgent[] }))))
      .then((results) => {
        if (!alive) return
        const next: Record<string, { device: string; version?: string }[]> = {}
        for (const { device, items } of results) for (const item of items) if (item.installed && item.id !== 'acp') (next[item.id] ??= []).push({ device: device.name, version: item.version })
        setFound(next)
      })
    return () => { alive = false }
  }, [onlineKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const match = (agent: AgentInfo) => !query || `${agent.name} ${agent.vendor} ${agent.description ?? ''}`.toLowerCase().includes(query.toLowerCase())
  const installed = catalog.filter((agent) => found[agent.id] && match(agent))
  const custom = catalog.filter((agent) => agent.source === 'custom' && !found[agent.id] && match(agent))
  const available = catalog.filter((agent) => agent.source !== 'custom' && !found[agent.id] && match(agent))
  const remove = async (agent: AgentInfo) => {
    if (!confirm(`Remove ${agent.name}?`)) return
    try { await api.del(`/api/agents/custom/${encodeURIComponent(agent.id)}`); await loadAgentCatalog(true) } catch (cause) { toast(cause instanceof Error ? cause.message : 'Couldn’t remove it') }
  }
  const row = (agent: AgentInfo, end: ReactNode) => (
    <div key={agent.id} className="settings-row" style={{ minHeight: 68 }}>
      <span className="tile-icon"><AgentMark agent={agent.id} size={19} /></span>
      <span className="settings-row-main min-w-0 flex-1">
        <span className="settings-row-title">{agent.name}{agent.vendor ? <span className="ml-2 text-[12.5px] font-normal text-muted">{agent.vendor}</span> : null}</span>
        <span className="settings-row-sub block truncate">{found[agent.id] ? found[agent.id].map((item) => `${item.device}${item.version ? ` ${item.version}` : ''}`).join(' · ') : agent.description || (agent.protocol === 'acp' ? 'Agent Client Protocol' : 'Native protocol')}</span>
      </span>
      {end}
    </div>
  )
  return (
    <>
      <div className="mt-7 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Icon name="search" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input pl-9" placeholder={`Search ${catalog.length} agents`} value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <button className="btn btn-outline" onClick={() => setAdding(true)}><Icon name="plus" size={15} />Add your own</button>
      </div>
      <p className="hint mt-2">Overseer finds agents on your machines by itself, including every agent in the <a className="link" href="https://agentclientprotocol.com/registry" target="_blank" rel="noreferrer">ACP registry</a>. Install one and it shows up in the agent picker within a minute.</p>

      <h2 className="settings-h2" style={{ marginTop: 28 }}>On your machines</h2>
      <div className="settings-group mt-3">
        {installed.length ? installed.map((agent) => row(agent, agent.source === 'custom' ? <button className="icon-btn" aria-label={`Remove ${agent.name}`} onClick={() => remove(agent)}><Icon name="trash" size={16} /></button> : null))
          : <p className="p-5 text-[13.5px] text-muted">{online.length ? 'No agents found on your online machines yet.' : 'No machines are online.'}</p>}
      </div>

      {custom.length > 0 && (
        <>
          <h2 className="settings-h2" style={{ marginTop: 28 }}>Your agents</h2>
          <div className="settings-group mt-3">{custom.map((agent) => row(agent, <button className="icon-btn" aria-label={`Remove ${agent.name}`} onClick={() => remove(agent)}><Icon name="trash" size={16} /></button>))}</div>
        </>
      )}

      <h2 className="settings-h2" style={{ marginTop: 28 }}>Available</h2>
      <div className="settings-group mt-3">
        {available.map((agent) => row(agent, agent.install
          ? <button className="btn btn-outline btn-sm" title={agent.install} onClick={() => navigator.clipboard?.writeText(agent.install).then(() => toast('Install command copied')).catch(() => {})}><Icon name="copy" size={14} />Install</button>
          : agent.website ? <a className="btn btn-outline btn-sm" href={agent.website} target="_blank" rel="noreferrer">Get it<Icon name="arrow-up-right" size={13} /></a> : null))}
        {!available.length && <p className="p-5 text-[13.5px] text-muted">Nothing else matches.</p>}
      </div>
      {adding && <AddAgentModal onClose={() => setAdding(false)} />}
    </>
  )
}

// AddAgentModal registers any ACP agent by the command that starts it.
function AddAgentModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.post('/api/agents/custom', { name: name.trim(), command: command.trim() })
      await loadAgentCatalog(true)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Couldn’t add it')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="Add your own agent" onClose={onClose} footer={<><button className="btn btn-outline" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="add-agent" disabled={busy || !name.trim() || !command.trim()}>{busy ? 'Adding…' : 'Add agent'}</button></>}>
      <form id="add-agent" onSubmit={save} className="space-y-4">
        <label className="block"><span className="mb-1.5 block text-sm font-medium text-ink">Name</span><input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="My agent" /></label>
        <label className="block"><span className="mb-1.5 block text-sm font-medium text-ink">Command</span><input className="input input-mono" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="my-agent --acp" spellCheck={false} /></label>
        <p className="text-[13px] text-muted">Any agent that speaks the Agent Client Protocol over stdio. Machines that have the command show it in the agent picker.</p>
        {error && <p className="text-[13px] text-danger">{error}</p>}
      </form>
    </Modal>
  )
}
