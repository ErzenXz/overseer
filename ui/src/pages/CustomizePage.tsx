import { FormEvent, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { agentCatalog } from '../agents'
import Icon, { AgentMark } from '../components/Icon'
import { Menu, MenuItem, MenuLabel, MenuSeparator, Switch } from '../components/Menu'
import Modal from '../components/Modal'
import { useAgentsOn } from '../components/Composer'
import { useShell } from '../shell'
import { useDevices } from '../store'
import type { Device, McpServer } from '../types'

const popular: (Omit<McpServer, 'id' | 'enabled'> & { description: string })[] = [
  { name: 'GitHub', transport: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer ${GITHUB_TOKEN}' }, description: 'Issues, pull requests and code search' },
  { name: 'Playwright', transport: 'stdio', command: 'npx', args: ['@playwright/mcp@latest'], description: 'Drive a real browser: click, type, screenshot' },
  { name: 'Chrome DevTools', transport: 'stdio', command: 'npx', args: ['chrome-devtools-mcp@latest'], description: 'Inspect pages, network and performance' },
  { name: 'Context7', transport: 'http', url: 'https://mcp.context7.com/mcp', description: 'Up-to-date library documentation' },
  { name: 'Sentry', transport: 'http', url: 'https://mcp.sentry.dev/mcp', description: 'Errors and stack traces from production' },
  { name: 'Linear', transport: 'http', url: 'https://mcp.linear.app/mcp', description: 'Read and update Linear issues' },
]

type Tab = 'mcp' | 'agents'

export default function CustomizePage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'mcp'
  const [servers, setServers] = useState<McpServer[] | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Partial<McpServer> | null>(null)
  const { value: devices } = useDevices()
  const { toast } = useShell()

  const load = useCallback(async () => {
    try { setServers(await api.get<McpServer[]>('/api/mcp-servers')); setError('') } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load MCP servers'); setServers((current) => current ?? []) }
  }, [])
  useEffect(() => { load() }, [load])

  const toggle = async (server: McpServer, enabled: boolean) => {
    setServers((current) => current?.map((item) => item.id === server.id ? { ...item, enabled } : item) ?? current)
    try { await api.patch(`/api/mcp-servers/${server.id}`, { enabled }) } catch (cause) { toast(cause instanceof Error ? cause.message : 'Could not save'); load() }
  }
  const remove = async (server: McpServer) => {
    if (!confirm(`Remove ${server.name}? Agents started after this won’t get it.`)) return
    await api.del(`/api/mcp-servers/${server.id}`)
    load()
  }

  return (
    <div className="main-scroll">
      <div className="page">
        <h1 className="page-title">Customize</h1>
        <p className="page-sub">Tools and agents every session gets, on every machine</p>
        <div className="page-toolbar">
          <div className="pill-tabs" role="tablist">
            <button role="tab" className="pill-tab" aria-selected={tab === 'mcp'} onClick={() => setParams({})}>MCP servers <span className="count">{servers?.length ?? 0}</span></button>
            <button role="tab" className="pill-tab" aria-selected={tab === 'agents'} onClick={() => setParams({ tab: 'agents' })}>Agents <span className="count">{agentCatalog.length}</span></button>
          </div>
          <span className="grow" />
          {tab === 'mcp' && (
            <Menu placement="bottom-end" width={330} trigger={<button className="btn btn-dark">Add MCP server<Icon name="chevron-down" size={15} /></button>}>
              {(close) => (
                <>
                  <MenuItem icon="terminal" label="Custom command (stdio)" onClick={() => { close(); setEditing({ transport: 'stdio' }) }} />
                  <MenuItem icon="globe" label="Custom URL (HTTP)" onClick={() => { close(); setEditing({ transport: 'http' }) }} />
                  <MenuSeparator />
                  <MenuLabel>Popular</MenuLabel>
                  {popular.map((item) => <MenuItem key={item.name} icon="layers" label={item.name} description={item.description} onClick={() => { close(); setEditing({ ...item }) }} />)}
                </>
              )}
            </Menu>
          )}
        </div>

        {error && <div className="error-banner mt-6">{error}<button onClick={load}>Retry</button></div>}

        {tab === 'mcp' && (
          <>
            <div className="callout mt-8">
              <div className="min-w-0 flex-1">
                <div className="callout-title"><Icon name="layers" size={20} />Configure once, use everywhere</div>
                <p className="callout-text">Enabled servers are handed to Claude Code, Codex and every ACP agent when a session starts, on whichever machine it runs. Use <code className="rounded bg-tint px-1.5 text-[13px]">{'${VAR}'}</code> to read secrets from that machine’s environment.</p>
              </div>
            </div>
            <div className="list-card mt-6">
              {servers === null && [0, 1].map((index) => <div key={index} className="list-row"><div className="skeleton h-9 w-full" /></div>)}
              {servers?.length === 0 && <p className="menu-empty px-6 py-6">No MCP servers yet.</p>}
              {servers?.map((server) => (
                <div key={server.id} className="list-row">
                  <span className="tile-icon">{server.builtin ? <Icon name="fleet" size={18} /> : <Icon name={server.transport === 'http' ? 'globe' : 'terminal'} size={18} />}</span>
                  <div className="min-w-0 flex-1">
                    <div className="list-row-title flex items-center gap-2">{server.name}{server.builtin && <span className="badge">Built in</span>}<span className="badge">{server.transport === 'http' ? 'HTTP' : 'stdio'}</span></div>
                    <div className="list-row-sub truncate font-mono text-[12.5px]">{server.builtin ? 'Lets agents see machines, start sessions and read terminals across your fleet' : server.transport === 'http' ? server.url : [server.command, ...(server.args ?? [])].join(' ')}</div>
                  </div>
                  <Switch checked={server.enabled} label={`${server.enabled ? 'Disable' : 'Enable'} ${server.name}`} onChange={(value) => toggle(server, value)} />
                  <Menu placement="bottom-end" width={200} trigger={<button className="icon-btn" aria-label={`${server.name} actions`}><Icon name="more" size={18} /></button>}>
                    {(close) => (
                      <>
                        <MenuItem icon="edit" label="Edit" disabled={server.builtin} onClick={() => { close(); setEditing(server) }} />
                        <MenuItem icon="trash" label="Remove" danger disabled={server.builtin} onClick={() => { close(); remove(server) }} />
                      </>
                    )}
                  </Menu>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'agents' && <AgentMatrix devices={(devices ?? []).filter((device) => device.online)} />}
      </div>
      {editing && <McpEditor initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
    </div>
  )
}

function AgentMatrix({ devices }: { devices: Device[] }) {
  if (!devices.length) return <div className="empty"><h2>No machines online</h2><p>Bring a machine online to see which agents it has.</p></div>
  return (
    <div className="list-card mt-8 overflow-x-auto">
      <table className="table">
        <thead><tr><th>Agent</th><th>Protocol</th>{devices.map((device) => <th key={device.id}>{device.name}</th>)}</tr></thead>
        <tbody>
          {agentCatalog.map((agent) => (
            <tr key={agent.id}>
              <td><span className="flex items-center gap-2.5 text-ink"><AgentMark agent={agent.id} size={18} />{agent.name}</span></td>
              <td>{agent.protocol === 'acp' ? 'ACP' : 'Native'}</td>
              {devices.map((device) => <AgentCell key={device.id} deviceId={device.id} agentId={agent.id} />)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint px-4 pb-4">Install missing agents from a machine’s Agents tab. Any other ACP agent works too: start a session with agent “Custom ACP” and its command.</p>
    </div>
  )
}

function AgentCell({ deviceId, agentId }: { deviceId: string; agentId: string }) {
  const agents = useAgentsOn(deviceId)
  const state = agents?.find((item) => item.id === agentId)
  if (agents === null) return <td><span className="skeleton inline-block h-3 w-12" /></td>
  return <td>{state?.installed ? <span className="flex items-center gap-1.5 text-positive"><Icon name="check" size={15} />{state.version ?? 'Installed'}</span> : <span className="text-faint">—</span>}</td>
}

function McpEditor({ initial, onClose, onSaved }: { initial: Partial<McpServer>; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial.name ?? '')
  const [transport, setTransport] = useState<McpServer['transport']>(initial.transport ?? 'stdio')
  const [command, setCommand] = useState([initial.command, ...(initial.args ?? [])].filter(Boolean).join(' '))
  const [url, setUrl] = useState(initial.url ?? '')
  const [pairs, setPairs] = useState(Object.entries((transport === 'http' ? initial.headers : initial.env) ?? {}).map(([key, value]) => `${key}=${value}`).join('\n'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    const map = Object.fromEntries(pairs.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]).filter(([key]) => key))
    const parts = command.trim().split(/\s+/)
    const body: Partial<McpServer> = transport === 'stdio'
      ? { name, transport, command: parts[0], args: parts.slice(1), env: map, enabled: initial.enabled ?? true }
      : { name, transport, url, headers: map, enabled: initial.enabled ?? true }
    try {
      if (initial.id) await api.patch(`/api/mcp-servers/${initial.id}`, body)
      else await api.post('/api/mcp-servers', body)
      onSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save')
      setBusy(false)
    }
  }

  return (
    <Modal title={initial.id ? `Edit ${initial.name}` : 'Add MCP server'} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <div><label className="label" htmlFor="mcp-name">Name</label><input id="mcp-name" className="input" required value={name} onChange={(event) => setName(event.target.value)} placeholder="Playwright" /></div>
        <div className="seg" role="group" aria-label="Transport">
          <button type="button" aria-pressed={transport === 'stdio'} onClick={() => setTransport('stdio')}>Command (stdio)</button>
          <button type="button" aria-pressed={transport === 'http'} onClick={() => setTransport('http')}>URL (HTTP)</button>
        </div>
        {transport === 'stdio' ? (
          <div><label className="label" htmlFor="mcp-cmd">Command</label><input id="mcp-cmd" className="input input-mono" required value={command} onChange={(event) => setCommand(event.target.value)} placeholder="npx @playwright/mcp@latest" /><p className="hint">Runs on the machine where each session starts, in the session’s folder.</p></div>
        ) : (
          <div><label className="label" htmlFor="mcp-url">URL</label><input id="mcp-url" className="input input-mono" type="url" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/mcp" /></div>
        )}
        <div>
          <label className="label" htmlFor="mcp-pairs">{transport === 'stdio' ? 'Environment variables' : 'Headers'} <span className="font-normal text-muted">— one KEY=value per line</span></label>
          <textarea id="mcp-pairs" className="textarea input-mono" rows={3} value={pairs} onChange={(event) => setPairs(event.target.value)} placeholder={transport === 'stdio' ? 'API_KEY=${MY_API_KEY}' : 'Authorization=Bearer ${GITHUB_TOKEN}'} />
          <p className="hint">Write <code>{'${NAME}'}</code> to read the value from the machine’s environment instead of storing it on the hub.</p>
        </div>
        {error && <p className="text-[13px] text-danger">{error}</p>}
        <div className="modal-foot">
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-dark" disabled={busy}>{busy && <span className="spinner" />}{initial.id ? 'Save' : 'Add server'}</button>
        </div>
      </form>
    </Modal>
  )
}
