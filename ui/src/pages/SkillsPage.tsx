import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { agentInfo } from '../agents'
import { extensionsApi, isReadOnly, kindLabels, scopeLabels, useExtensions } from '../extensions'
import Icon, { AgentMark, type IconName } from '../components/Icon'
import Markdown from '../components/Markdown'
import { Menu, MenuItem, MenuLabel, MenuSeparator, Switch } from '../components/Menu'
import Modal from '../components/Modal'
import { useShell } from '../shell'
import { useDevices, usePref, useThreads } from '../store'
import type { CatalogPlugin, ExtItem, ExtKind } from '../types'

// Skills & plugins: everything that extends each agent on a machine, in one
// place: what's installed, where it comes from, which agents share it, and
// the safe operations on it (toggle, share, create, install, remove).

type Tab = 'skill' | 'plugin' | 'command' | 'subagent' | 'rule' | 'hook' | 'mcp_server' | 'browse'
const tabs: { id: Tab; label: string; kinds: ExtKind[] }[] = [
  { id: 'skill', label: 'Skills', kinds: ['skill'] },
  { id: 'plugin', label: 'Plugins', kinds: ['plugin', 'extension', 'marketplace'] },
  { id: 'command', label: 'Commands', kinds: ['command', 'output_style'] },
  { id: 'subagent', label: 'Subagents', kinds: ['subagent'] },
  { id: 'rule', label: 'Rules', kinds: ['rule'] },
  { id: 'hook', label: 'Hooks', kinds: ['hook'] },
  { id: 'mcp_server', label: 'MCP', kinds: ['mcp_server'] },
  { id: 'browse', label: 'Browse', kinds: [] },
]
const kindIcons: Record<string, IconName> = {
  skill: 'sparkles', plugin: 'box', extension: 'box', marketplace: 'grid', command: 'slash', output_style: 'edit',
  subagent: 'bot', rule: 'book', hook: 'zap', mcp_server: 'layers',
}

export default function SkillsPage() {
  const { value: devices } = useDevices()
  const { value: threads } = useThreads()
  const { toast } = useShell()
  const [params, setParams] = useSearchParams()
  const online = (devices ?? []).filter((device) => device.online)
  const [savedDevice, setSavedDevice] = usePref('skills.device', '')
  const deviceId = params.get('device') || (online.find((device) => device.id === savedDevice) ?? online.find((device) => device.isHub) ?? online[0])?.id || ''
  const device = (devices ?? []).find((item) => item.id === deviceId)
  const cwd = params.get('cwd') ?? ''
  const tab = (params.get('tab') as Tab) || 'skill'
  const [agentFilter, setAgentFilter] = useState('')
  const [query, setQuery] = useState('')
  const [viewing, setViewing] = useState<ExtItem | null>(null)
  const [sharing, setSharing] = useState<ExtItem | null>(null)
  const [creating, setCreating] = useState(false)
  const { data, error, loading, reload } = useExtensions(deviceId, cwd)

  const set = (next: Record<string, string>) => {
    const merged = new URLSearchParams(params)
    for (const [key, value] of Object.entries(next)) value ? merged.set(key, value) : merged.delete(key)
    setParams(merged, { replace: true })
  }
  const folders = useMemo(() => [...new Set((threads ?? []).filter((thread) => thread.deviceId === deviceId && thread.cwd).map((thread) => thread.cwd))].slice(0, 8), [threads, deviceId])
  const agents = (data?.agents ?? []).filter((item) => item.ok).map((item) => item.agent)
  const current = tabs.find((item) => item.id === tab)!
  const items = (data?.items ?? []).filter((item) => current.kinds.includes(item.kind))
    .filter((item) => !agentFilter || item.agent === agentFilter || item.sharedWith?.includes(agentFilter))
    .filter((item) => !query || `${item.name} ${item.qualifiedName} ${item.description ?? ''}`.toLowerCase().includes(query.toLowerCase()))
  const counts = (kinds: ExtKind[]) => (data?.items ?? []).filter((item) => kinds.includes(item.kind)).length

  const toggle = async (item: ExtItem, enabled: boolean) => {
    try {
      const result = await extensionsApi.toggle(deviceId, item.key, enabled)
      toast(result.note ?? (enabled ? `${item.name} enabled` : `${item.name} disabled`))
      reload()
    } catch (cause) { toast(cause instanceof Error ? cause.message : 'Couldn’t change it') }
  }
  const remove = async (item: ExtItem) => {
    const skill = item.kind === 'skill'
    if (skill ? !confirm(`Move “${item.name}” to the trash? You can restore it from ${item.path ? item.path.replace(/\/[^/]+\/SKILL\.md$/, '/.trash') : 'the .trash folder'}.`) : prompt(`Type ${item.name} to uninstall it.`) !== item.name) return
    try {
      const result = await extensionsApi.uninstall(deviceId, item.key)
      toast(result.note ?? (skill ? 'Moved to the trash' : 'Uninstalled'))
      reload()
    } catch (cause) { toast(cause instanceof Error ? cause.message : 'Couldn’t remove it') }
  }

  return (
    <div className="main-scroll">
      <div className="page">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="page-title">Skills & plugins</h1>
            <p className="page-sub">What extends your agents on each machine, and which agents share it</p>
          </div>
          <button className="btn btn-dark" onClick={() => setCreating(true)} disabled={!deviceId}><Icon name="plus" size={15} />New skill</button>
        </div>

        <div className="skills-scope">
          <Menu placement="bottom-start" width={260} trigger={<button className="ctl"><Icon name="monitor" size={15} /><span>{device?.name ?? 'Choose a machine'}</span><Icon name="chevron-down" size={12} className="ctl-chev" /></button>}>
            {(close) => (
              <>
                <MenuLabel>Machine</MenuLabel>
                {online.map((item) => <MenuItem key={item.id} icon="monitor" label={item.name} checked={item.id === deviceId} onClick={() => { close(); setSavedDevice(item.id); set({ device: item.id, cwd: '' }) }} />)}
                {online.length === 0 && <div className="menu-label normal-case">No machines are online</div>}
              </>
            )}
          </Menu>
          <span className="text-faint">/</span>
          <Menu placement="bottom-start" width={320} trigger={<button className="ctl"><Icon name="folder" size={15} /><span className="max-w-[260px] truncate">{cwd ? cwd.replace(/^\/(Users|home)\/[^/]+/, '~') : 'User level'}</span><Icon name="chevron-down" size={12} className="ctl-chev" /></button>}>
            {(close) => (
              <>
                <MenuItem icon="user" label="User level" description="What applies in every project" checked={!cwd} onClick={() => { close(); set({ cwd: '' }) }} />
                {folders.length > 0 && <><MenuSeparator /><MenuLabel>Also show a project’s</MenuLabel></>}
                {folders.map((folder) => <MenuItem key={folder} icon="folder" label={folder.replace(/^\/(Users|home)\/[^/]+/, '~')} checked={cwd === folder} onClick={() => { close(); set({ cwd: folder }) }} />)}
                <MenuSeparator />
                <MenuItem icon="edit" label="Another folder…" onClick={() => { close(); const value = window.prompt('Project folder on this machine')?.trim(); if (value) set({ cwd: value }) }} />
              </>
            )}
          </Menu>
          <span className="grow" />
          {agents.length > 1 && tab !== 'browse' && (
            <Menu placement="bottom-end" width={220} trigger={<button className="ctl">{agentFilter ? <AgentMark agent={agentFilter} size={14} /> : <Icon name="filter" size={14} />}<span>{agentFilter ? agentInfo(agentFilter).name : 'All agents'}</span><Icon name="chevron-down" size={12} className="ctl-chev" /></button>}>
              {(close) => (
                <>
                  <MenuItem label="All agents" checked={!agentFilter} onClick={() => { close(); setAgentFilter('') }} />
                  <MenuSeparator />
                  {agents.map((agent) => <MenuItem key={agent} icon={<AgentMark agent={agent} size={16} />} label={agentInfo(agent).name} checked={agentFilter === agent} onClick={() => { close(); setAgentFilter(agent) }} />)}
                </>
              )}
            </Menu>
          )}
          <button className="icon-btn" aria-label="Refresh" title="Read again" onClick={() => reload(true)} disabled={loading}><Icon name="refresh" size={17} className={loading ? 'animate-spin' : ''} /></button>
        </div>

        <div className="page-toolbar skills-toolbar">
          <div className="pill-tabs" role="tablist">
            {tabs.map((item) => (
              <button key={item.id} role="tab" className="pill-tab" aria-selected={tab === item.id} onClick={() => set({ tab: item.id === 'skill' ? '' : item.id })}>
                {item.label}{item.kinds.length > 0 && data ? <span className="count">{counts(item.kinds)}</span> : null}
              </button>
            ))}
          </div>
          <span className="grow" />
          {tab !== 'browse' && <label className="inline-search"><Icon name="search" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${current.label.toLowerCase()}`} /></label>}
        </div>

        {data?.agents.some((item) => !item.ok) && (
          <p className="mt-4 text-[13px] text-muted">
            Couldn’t read {data.agents.filter((item) => !item.ok).map((item) => `${agentInfo(item.agent).name}${item.error ? ` (${item.error})` : ''}`).join(', ')}.
          </p>
        )}

        {tab === 'browse' ? (
          <Browse deviceId={deviceId} cwd={cwd} agents={agents} onInstalled={() => reload(true)} />
        ) : !deviceId ? (
          <div className="empty"><span className="empty-icon"><Icon name="monitor" size={24} /></span><h2>No machine online</h2><p>Skills and plugins are read from the machine the agents run on.</p></div>
        ) : error ? (
          <div className="empty"><h2>Couldn’t read {device?.name}</h2><p>{error}</p><button className="btn btn-outline" onClick={() => reload(true)}>Try again</button></div>
        ) : !data ? (
          <div className="mt-6 space-y-3">{[0, 1, 2, 3].map((key) => <div key={key} className="skeleton h-16 rounded-xl" />)}</div>
        ) : items.length === 0 ? (
          <div className="empty">
            <span className="empty-icon"><Icon name={kindIcons[current.kinds[0]] ?? 'box'} size={24} /></span>
            <h2>{query ? 'Nothing matches' : `No ${current.label.toLowerCase()} yet`}</h2>
            <p>{tab === 'skill' ? 'Skills teach an agent how to do something your way. Create one and share it with every agent.' : tab === 'plugin' ? 'Install plugins from Claude’s and Codex’s marketplaces in Browse.' : `None of your agents on ${device?.name} have any${cwd ? ' here' : ''}.`}</p>
            {tab === 'skill' && !query && <button className="btn btn-dark" onClick={() => setCreating(true)}>New skill</button>}
            {tab === 'plugin' && !query && <button className="btn btn-outline" onClick={() => set({ tab: 'browse' })}>Browse plugins</button>}
          </div>
        ) : (
          <div className="list-card mt-5">
            {items.map((item) => (
              <ItemRow key={item.key} item={item} onOpen={() => setViewing(item)} onToggle={(enabled) => toggle(item, enabled)} onShare={() => setSharing(item)} onRemove={() => remove(item)} canShare={item.kind === 'skill' && agents.some((agent) => agent !== item.agent && !item.sharedWith?.includes(agent))} />
            ))}
          </div>
        )}
        {data && <p className="hint mt-3">Read from {device?.name} {Math.max(0, Math.round(Date.now() / 1000 - data.fetchedAt))}s ago. Changes apply to new sessions.</p>}
      </div>
      {viewing && <ItemModal deviceId={deviceId} item={viewing} onClose={() => setViewing(null)} />}
      {sharing && <ShareModal deviceId={deviceId} item={sharing} agents={agents} onClose={() => setSharing(null)} onDone={() => { setSharing(null); reload(true) }} />}
      {creating && <CreateSkillModal deviceId={deviceId} cwd={cwd} agents={agents} onClose={() => setCreating(false)} onDone={() => { setCreating(false); set({ tab: '' }); reload(true) }} />}
    </div>
  )
}

function ItemRow({ item, onOpen, onToggle, onShare, onRemove, canShare }: { item: ExtItem; onOpen: () => void; onToggle: (enabled: boolean) => void; onShare: () => void; onRemove: () => void; canShare: boolean }) {
  const readOnly = isReadOnly(item)
  const users = [item.agent, ...(item.sharedWith ?? [])]
  const removable = !readOnly && (item.kind === 'plugin' || (item.kind === 'skill' && (item.scope === 'user' || item.scope === 'project')))
  return (
    <div className={`list-row skill-row ${item.enabled === false ? 'is-off' : ''}`}>
      <span className="tile-icon"><Icon name={kindIcons[item.kind] ?? 'box'} size={17} /></span>
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="list-row-title truncate">{item.displayName && item.displayName !== item.qualifiedName ? item.displayName : item.name}</span>
          {item.qualifiedName && item.qualifiedName !== item.name && <code className="skill-qname truncate">{item.kind === 'command' ? '/' : ''}{item.qualifiedName}</code>}
          {item.version && <span className="text-[12px] text-faint">{item.version}</span>}
        </div>
        <div className="list-row-sub truncate">{item.kind === 'mcp_server' && item.mcp ? `${item.mcp.transport}${item.mcp.toolCount !== undefined ? ` · ${item.mcp.toolCount} tools` : ''}${item.mcp.authStatus ? ` · ${item.mcp.authStatus}` : ''}` : item.kind === 'hook' && item.hook ? `${item.hook.event}${item.hook.matcher ? ` · ${item.hook.matcher}` : ''} · ${item.hook.command ?? item.hook.handlerType}` : item.description || item.path}</div>
      </button>
      <span className="skill-agents" title={`Used by ${users.map((agent) => agentInfo(agent).name).join(', ')}`}>
        {users.map((agent) => <span key={agent} className="skill-agent"><AgentMark agent={agent} size={14} /></span>)}
      </span>
      <span className="chip skill-scope" title={item.projectPath ?? undefined}>{readOnly && <Icon name="lock" size={12} />}{item.parentId && item.scope === 'plugin' ? item.parentId.split('@')[0] : scopeLabels[item.scope] ?? item.scope}</span>
      {item.enabled !== null && <Switch checked={!!item.enabled} label={`${item.enabled ? 'Disable' : 'Enable'} ${item.name}`} disabled={readOnly} onChange={onToggle} />}
      <Menu placement="bottom-end" width={230} trigger={<button className="icon-btn icon-btn-sm" aria-label={`${item.name} actions`}><Icon name="more" size={16} /></button>}>
        {(close) => (
          <>
            <MenuItem icon="eye" label="View" onClick={() => { close(); onOpen() }} />
            {canShare && <MenuItem icon="link" label="Share with other agents…" onClick={() => { close(); onShare() }} />}
            {item.path && <MenuItem icon="copy" label="Copy path" onClick={() => { close(); navigator.clipboard?.writeText(item.path!) }} />}
            {removable && (
              <>
                <MenuSeparator />
                <MenuItem icon="trash" danger label={item.kind === 'skill' ? 'Move to trash' : 'Uninstall…'} onClick={() => { close(); onRemove() }} />
              </>
            )}
            {readOnly && <div className="menu-label normal-case">{item.lockedBy === 'plugin' ? 'Comes from a plugin: turn the plugin off instead.' : 'Managed outside Overseer: read-only.'}</div>}
          </>
        )}
      </Menu>
    </div>
  )
}

// ItemModal shows what an item is, where it lives and its file.
function ItemModal({ deviceId, item, onClose }: { deviceId: string; item: ExtItem; onClose: () => void }) {
  const [detail, setDetail] = useState<{ content?: string; frontmatter?: Record<string, unknown> } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    extensionsApi.item(deviceId, item.key).then(setDetail).catch((cause) => setError(cause instanceof Error ? cause.message : 'Couldn’t open it'))
  }, [deviceId, item.key])
  const body = detail?.content?.replace(/^---\n[\s\S]*?\n---\n?/, '') ?? ''
  const facts: [string, React.ReactNode][] = [
    ['Kind', kindLabels[item.kind] ?? item.kind],
    ['Used by', [item.agent, ...(item.sharedWith ?? [])].map((agent) => agentInfo(agent).name).join(', ')],
    ['Scope', `${scopeLabels[item.scope] ?? item.scope}${item.projectPath ? ` · ${item.projectPath}` : ''}`],
  ]
  if (item.parentId) facts.push(['From', item.parentId])
  if (item.version) facts.push(['Version', item.version])
  if (item.invocation) facts.push(['Invoked by', [item.invocation.user && 'you (/' + item.name + ')', item.invocation.model && 'the agent when relevant'].filter(Boolean).join(' and ') || 'nobody'])
  if (item.cost?.alwaysOnTokens) facts.push(['Context cost', `${item.cost.alwaysOnTokens} tokens always, ${item.cost.onInvokeTokens ?? '?'} when used`])
  if (item.usage?.count) facts.push(['Used', `${item.usage.count} times`])
  if (item.source?.repo || item.source?.url || item.source?.package) facts.push(['Source', item.source.repo ?? item.source.url ?? item.source.package])
  if (item.path) facts.push(['File', <code key="p" className="break-all font-mono text-[12.5px]">{item.path}</code>])
  return (
    <Modal title={item.displayName || item.name} onClose={onClose} wide>
      {item.description && <p className="-mt-2 mb-4 text-[14px] text-secondary">{item.description}</p>}
      <dl className="skill-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {item.errors?.length ? <p className="mt-3 text-[13px] text-danger">{item.errors.join(' · ')}</p> : null}
      {error ? <p className="mt-4 text-[13px] text-danger">{error}</p> : body ? (
        <div className="skill-content"><div className="msg-agent"><Markdown text={body} /></div></div>
      ) : detail ? null : <div className="skeleton mt-4 h-40 rounded-lg" />}
    </Modal>
  )
}

function ShareModal({ deviceId, item, agents, onClose, onDone }: { deviceId: string; item: ExtItem; agents: string[]; onClose: () => void; onDone: () => void }) {
  const options = agents.filter((agent) => agent !== item.agent)
  const [chosen, setChosen] = useState<string[]>(options.filter((agent) => !item.sharedWith?.includes(agent)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const share = async () => {
    setBusy(true)
    setError('')
    try { await extensionsApi.share(deviceId, item.key, chosen); onDone() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Couldn’t share it'); setBusy(false) }
  }
  return (
    <Modal title={`Share “${item.name}”`} onClose={onClose} footer={<><button className="btn btn-outline" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !chosen.length} onClick={share}>{busy ? 'Sharing…' : 'Share'}</button></>}>
      <p className="mb-4 text-[13.5px] text-secondary">The skill stays in one place; the other agents read it through a link, so edits apply everywhere.</p>
      <AgentChecklist agents={options} chosen={chosen} locked={item.sharedWith ?? []} onChange={setChosen} />
      {error && <p className="mt-3 text-[13px] text-danger">{error}</p>}
    </Modal>
  )
}

function AgentChecklist({ agents, chosen, locked = [], onChange }: { agents: string[]; chosen: string[]; locked?: string[]; onChange: (next: string[]) => void }) {
  return (
    <div className="settings-group">
      {agents.map((agent) => {
        const already = locked.includes(agent)
        const on = already || chosen.includes(agent)
        return (
          <label key={agent} className="settings-row cursor-pointer" style={{ minHeight: 52 }}>
            <AgentMark agent={agent} size={18} />
            <span className="flex-1 text-[14px] text-ink">{agentInfo(agent).name}{already && <span className="ml-2 text-[12.5px] text-muted">already shared</span>}</span>
            <input type="checkbox" checked={on} disabled={already} onChange={(event) => onChange(event.target.checked ? [...chosen, agent] : chosen.filter((item) => item !== agent))} />
          </label>
        )
      })}
    </div>
  )
}

const skillTemplate = `## When to use this

Describe the situations where the agent should reach for this skill.

## How to do it

1. First step
2. Second step

## Check your work

- What “done” looks like
`

function CreateSkillModal({ deviceId, cwd, agents, onClose, onDone }: { deviceId: string; cwd: string; agents: string[]; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [body, setBody] = useState(skillTemplate)
  const [scope, setScope] = useState<'user' | 'project'>(cwd ? 'project' : 'user')
  const [chosen, setChosen] = useState<string[]>(agents)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
  const save = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await extensionsApi.createSkill(deviceId, { name: slug, description: description.trim(), body, scope, cwd: scope === 'project' ? cwd : undefined, agents: chosen })
      onDone()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Couldn’t create it')
      setBusy(false)
    }
  }
  return (
    <Modal title="New skill" onClose={onClose} wide footer={<><button className="btn btn-outline" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="new-skill" disabled={busy || !slug || !description.trim() || !chosen.length}>{busy ? 'Creating…' : 'Create skill'}</button></>}>
      <form id="new-skill" onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block"><span className="label">Name</span><input className="input input-mono" value={name} onChange={(event) => setName(event.target.value)} placeholder="release-notes" autoFocus />{name && slug !== name && <span className="hint">Saved as <code>{slug}</code></span>}</label>
          <label className="block"><span className="label">Where</span>
            <select className="select w-full" value={scope} onChange={(event) => setScope(event.target.value as 'user' | 'project')}>
              <option value="user">Every project (user)</option>
              {cwd && <option value="project">This project only</option>}
            </select>
          </label>
        </div>
        <label className="block"><span className="label">When should the agent use it?</span><input className="input" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Write release notes from merged PRs in our house style" maxLength={1024} /><span className="hint">Agents read this to decide when the skill applies.</span></label>
        <label className="block"><span className="label">Instructions</span><textarea className="textarea font-mono text-[13px]" rows={10} value={body} onChange={(event) => setBody(event.target.value)} /></label>
        <div><span className="label">Agents</span><AgentChecklist agents={agents} chosen={chosen} onChange={setChosen} /></div>
        {error && <p className="text-[13px] text-danger">{error}</p>}
      </form>
    </Modal>
  )
}

// Browse lists what each agent's marketplaces offer, with install behind a
// confirmation: plugins can bring hooks and MCP servers that run code.
function Browse({ deviceId, cwd, agents, onInstalled }: { deviceId: string; cwd: string; agents: string[]; onInstalled: () => void }) {
  const sources = ['claude', 'codex'].filter((agent) => agents.length === 0 || agents.includes(agent))
  const [agent, setAgent] = useState(sources[0] ?? 'claude')
  const [entries, setEntries] = useState<CatalogPlugin[] | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState('')
  // Claude's marketplaces list thousands of plugins; render a page at a time.
  const [limit, setLimit] = useState(60)
  useEffect(() => { setLimit(60) }, [agent, query])
  const { toast } = useShell()
  useEffect(() => {
    if (!deviceId) return
    setEntries(null)
    setError('')
    extensionsApi.catalog(deviceId, agent).then((data) => setEntries(data.entries ?? [])).catch((cause) => setError(cause instanceof Error ? cause.message : 'Couldn’t load the marketplace'))
  }, [deviceId, agent])
  const shown = (entries ?? []).filter((entry) => !query || `${entry.name} ${entry.description ?? ''} ${entry.category ?? ''}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (b.installCount ?? 0) - (a.installCount ?? 0))
  const install = async (entry: CatalogPlugin, scope: 'user' | 'project') => {
    const parts = [entry.hasSkills && 'skills', entry.hasMcp && 'MCP servers', entry.hasHooks && 'hooks'].filter(Boolean)
    if (!confirm(`Install ${entry.name} for ${agentInfo(agent).name}${scope === 'project' ? ' in this project' : ''}?${parts.length ? `\n\nIt adds ${parts.join(', ')}.` : ''}${entry.hasHooks || entry.hasMcp ? ' Hooks and MCP servers run code on this machine.' : ''}`)) return
    setBusy(entry.id)
    try {
      let result = await extensionsApi.install(deviceId, { agent, id: entry.id, scope, cwd: scope === 'project' ? cwd : undefined })
      if (result.needsApproval) {
        if (!confirm(`This plugin’s marketplace wants to run a command to install it:\n\n${result.needsApproval.command}\n\nRun it?`)) { setBusy(''); return }
        result = await extensionsApi.install(deviceId, { agent, id: entry.id, scope, cwd: scope === 'project' ? cwd : undefined, acceptCommand: result.needsApproval.sha })
      }
      toast(result.note ?? `${entry.name} installed`)
      setEntries((current) => current?.map((item) => item.id === entry.id ? { ...item, installed: true } : item) ?? current)
      onInstalled()
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Couldn’t install it')
    } finally {
      setBusy('')
    }
  }
  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="seg" role="group" aria-label="Marketplace">
          {sources.map((item) => <button key={item} aria-pressed={agent === item} onClick={() => setAgent(item)}><span className="inline-flex items-center gap-1.5"><AgentMark agent={item} size={14} />{agentInfo(item).name}</span></button>)}
        </div>
        <span className="grow" />
        <label className="inline-search"><Icon name="search" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${entries?.length ?? ''} plugins`} /></label>
      </div>
      {error ? <p className="mt-6 text-[13.5px] text-danger">{error}</p> : !entries ? (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((key) => <div key={key} className="skeleton h-32 rounded-xl" />)}</div>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.slice(0, limit).map((entry) => (
            <div key={entry.id} className="plugin-card">
              <div className="flex items-start gap-3">
                <span className="tile-icon"><Icon name="box" size={17} /></span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-ink">{entry.name}</div>
                  <div className="truncate text-[12.5px] text-muted">{entry.marketplace ?? entry.category ?? ''}{entry.installCount ? ` · ${entry.installCount.toLocaleString()} installs` : ''}</div>
                </div>
              </div>
              <p className="plugin-card-desc">{entry.description}</p>
              <div className="mt-auto flex items-center gap-1.5 pt-3">
                {entry.hasSkills && <span className="chip">Skills</span>}
                {entry.hasMcp && <span className="chip">MCP</span>}
                {entry.hasHooks && <span className="chip">Hooks</span>}
                <span className="grow" />
                {entry.installed ? <span className="text-[12.5px] text-positive">Installed</span> : (
                  <Menu placement="bottom-end" width={220} trigger={<button className="btn btn-outline btn-sm" disabled={!!busy}>{busy === entry.id ? 'Installing…' : 'Install'}</button>}>
                    {(close) => (
                      <>
                        <MenuItem icon="user" label="For every project" onClick={() => { close(); install(entry, 'user') }} />
                        <MenuItem icon="folder" label="This project only" disabled={!cwd} description={cwd ? undefined : 'Pick a project folder above'} onClick={() => { close(); install(entry, 'project') }} />
                      </>
                    )}
                  </Menu>
                )}
              </div>
            </div>
          ))}
          {shown.length === 0 && <p className="text-[13.5px] text-muted">Nothing matches.</p>}
        </div>
      )}
      {entries && shown.length > limit && (
        <div className="mt-5 flex justify-center"><button className="btn btn-outline" onClick={() => setLimit((value) => value + 60)}>Show more <span className="text-muted">{(shown.length - limit).toLocaleString()} left</span></button></div>
      )}
    </div>
  )
}
