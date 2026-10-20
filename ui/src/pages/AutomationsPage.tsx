import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { accessLevels, agentCatalog, agentInfo, relativeTime, untilTime } from '../agents'
import Icon, { AgentMark, type IconName } from '../components/Icon'
import { Menu, MenuItem, MenuSeparator, Switch } from '../components/Menu'
import Modal from '../components/Modal'
import { useShell } from '../shell'
import { createThread, useDevices } from '../store'
import type { Access, Automation } from '../types'

interface Template {
  name: string
  description: string
  prompt: string
  schedule: string
  category: 'Maintenance' | 'CI/CD & Release' | 'Security' | 'Fleet'
  icon: IconName
  tags: string[]
}

const templates: Template[] = [
  { name: 'Fix CI failures', category: 'CI/CD & Release', icon: 'github', tags: ['GitHub'], schedule: '0 */2 * * *', description: 'Every two hours, Overseer checks your open pull requests for failing checks, reproduces them and pushes a fix.', prompt: 'List my open pull requests with failing CI checks (gh pr list --author @me --json number,statusCheckRollup). For each one, check out the branch, reproduce the failure locally, fix it, and push. Summarise what you changed.' },
  { name: 'Weekly dependency update', category: 'Maintenance', icon: 'calendar', tags: ['Git'], schedule: '0 9 * * 1', description: 'Every Monday, Overseer updates dependencies to the latest compatible versions, runs the tests, and opens a PR.', prompt: 'Update dependencies to the latest compatible versions using the package manager this repo already uses. Run the tests. If anything changed and tests pass, open a pull request with a changelog summary.' },
  { name: 'Morning repo digest', category: 'Maintenance', icon: 'calendar', tags: ['Git', 'GitHub'], schedule: '30 8 * * 1-5', description: 'Each weekday, Overseer summarises yesterday’s commits, open PRs and new issues so you start the day informed.', prompt: 'Summarise what happened in this repository in the last 24 hours: commits on main, pull requests opened or merged, and new issues. Keep it under 15 bullet points.' },
  { name: 'Security audit', category: 'Security', icon: 'shield', tags: ['npm audit', 'govulncheck'], schedule: '0 7 * * 1', description: 'Weekly, Overseer runs the ecosystem’s audit tools, triages real vulnerabilities and fixes the safe ones.', prompt: 'Run the security audit tool for this project (npm audit / pnpm audit / govulncheck / cargo audit as appropriate). Triage findings, fix the ones with safe upgrades, and open a PR. List anything that needs a human decision.' },
  { name: 'Secret scan', category: 'Security', icon: 'lock', tags: ['Git'], schedule: '0 6 * * *', description: 'Daily, Overseer scans new commits for leaked keys and tokens and tells you where they are.', prompt: 'Scan commits from the last day for accidentally committed secrets (API keys, tokens, private keys). Report the file, commit and line for each finding. Do not print the secret values.' },
  { name: 'Clean disk space', category: 'Fleet', icon: 'disk', tags: ['Machine'], schedule: '0 3 * * 0', description: 'Weekly, Overseer clears caches and build output that rebuild themselves — never your source or data.', prompt: 'Report free disk space. Then clear only caches and build output that rebuild themselves (package manager caches, Docker dangling images and build cache, old build folders in ~/Projects that are gitignored). Never delete source code, uncommitted work or user data. Report what you cleared and how much space it freed.' },
  { name: 'Update coding agents', category: 'Fleet', icon: 'bot', tags: ['Machine'], schedule: '0 4 * * *', description: 'Nightly, Overseer updates Claude Code, Codex and Gemini CLI on this machine so every agent is current.', prompt: 'Update the installed coding agent CLIs on this machine (claude, codex, gemini) to their latest versions using the install method each one was installed with. Report old and new versions.' },
  { name: 'Keep the README honest', category: 'Maintenance', icon: 'book', tags: ['Git'], schedule: '0 10 * * 5', description: 'Weekly, Overseer checks that install and run instructions in the README still work and fixes them if not.', prompt: 'Follow the README install and run instructions in a clean temp checkout. If any step fails or is out of date, fix the README and open a pull request.' },
  { name: 'Release notes draft', category: 'CI/CD & Release', icon: 'git-commit', tags: ['GitHub'], schedule: '0 16 * * 5', description: 'Every Friday, Overseer drafts release notes from merged pull requests since the last tag.', prompt: 'Draft release notes from pull requests merged since the latest git tag. Group into Features, Fixes and Internal. Save to RELEASE_NOTES.md without committing.' },
]

const categories = ['All', 'Maintenance', 'CI/CD & Release', 'Security', 'Fleet'] as const

const schedulePresets = [
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Every day at 9:00', cron: '0 9 * * *' },
  { label: 'Weekdays at 9:00', cron: '0 9 * * 1-5' },
  { label: 'Mondays at 9:00', cron: '0 9 * * 1' },
  { label: 'Sundays at 3:00', cron: '0 3 * * 0' },
]

export function describeCron(cron: string) {
  const preset = schedulePresets.find((item) => item.cron === cron)
  if (preset) return preset.label
  const [min, hour, dom, mon, dow] = cron.trim().split(/\s+/)
  if (!dow) return cron
  const time = /^\d+$/.test(hour) && /^\d+$/.test(min) ? `${hour.padStart(2, '0')}:${min.padStart(2, '0')}` : ''
  const days = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
  if (hour.startsWith('*/') && min === '0') return `Every ${hour.slice(2)} hours`
  if (min.startsWith('*/')) return `Every ${min.slice(2)} minutes`
  if (dom === '*' && mon === '*' && dow === '*' && time) return `Every day at ${time}`
  if (dom === '*' && mon === '*' && dow === '1-5' && time) return `Weekdays at ${time}`
  if (dom === '*' && mon === '*' && /^\d$/.test(dow) && time) return `${days[Number(dow)]} at ${time}`
  return cron
}

export default function AutomationsPage() {
  const [items, setItems] = useState<Automation[] | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'active' | 'all'>('all')
  const [category, setCategory] = useState<(typeof categories)[number]>('All')
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [editing, setEditing] = useState<Partial<Automation> | null>(null)
  const [params, setParams] = useSearchParams()
  const { value: devices } = useDevices()
  const navigate = useNavigate()
  const { toast } = useShell()

  const load = useCallback(async () => {
    try { setItems(await api.get<Automation[]>('/api/automations')); setError('') } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load automations'); setItems((current) => current ?? []) }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (params.get('create')) { setEditing({}); setParams({}, { replace: true }) }
  }, [params, setParams])

  const active = (items ?? []).filter((item) => item.enabled)
  const shown = (tab === 'active' ? active : items ?? []).filter((item) => !query || `${item.name} ${item.prompt}`.toLowerCase().includes(query.toLowerCase()))
  const suggested = templates.filter((item) => (category === 'All' || item.category === category) && (!query || `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase())))
  const deviceName = (id: string) => devices?.find((device) => device.id === id)?.name ?? id

  const toggle = async (item: Automation, enabled: boolean) => {
    setItems((current) => current?.map((entry) => entry.id === item.id ? { ...entry, enabled } : entry) ?? current)
    try { await api.patch(`/api/automations/${item.id}`, { enabled }) } catch { load() }
  }
  const runNow = async (item: Automation) => {
    try {
      const thread = await api.post<{ id: string }>(`/api/automations/${item.id}/run`)
      navigate(`/sessions/${thread.id}`)
    } catch (cause) { toast(cause instanceof Error ? cause.message : 'Could not run') }
  }
  const remove = async (item: Automation) => {
    if (!confirm(`Delete “${item.name}”?`)) return
    await api.del(`/api/automations/${item.id}`)
    load()
  }
  const suggest = async () => {
    const hub = devices?.find((device) => device.isHub && device.online) ?? devices?.find((device) => device.online)
    if (!hub) { toast('Bring a machine online first'); return }
    const thread = await createThread({ deviceId: hub.id, agent: 'claude', cwd: '~/Projects', access: 'ask', title: 'Suggest automations', prompt: 'Look at the git history of the repositories in this folder over the last month. Find repetitive tasks I do by hand (dependency bumps, release chores, fixing CI, formatting, docs) and suggest up to five automations. For each: a name, a cron schedule, and the exact prompt an agent should run.' })
    navigate(`/sessions/${thread.id}`)
  }

  return (
    <div className="main-scroll">
      <div className="page">
        <h1 className="page-title">Automations</h1>
        <p className="page-sub">Bring Overseer into your recurring and event-driven workflows</p>
        <div className="page-toolbar">
          <div className="pill-tabs" role="tablist">
            <button role="tab" className="pill-tab" aria-selected={tab === 'active'} onClick={() => setTab('active')}>Active <span className="count">{active.length}</span></button>
            <button role="tab" className="pill-tab" aria-selected={tab === 'all'} onClick={() => setTab('all')}>All <span className="count">{items?.length ?? 0}</span></button>
          </div>
          <span className="grow" />
          {searching ? (
            <label className="inline-search"><Icon name="search" size={16} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search automations" onBlur={() => !query && setSearching(false)} onKeyDown={(event) => { if (event.key === 'Escape') { setQuery(''); setSearching(false) } }} /></label>
          ) : <button className="icon-btn" aria-label="Search" onClick={() => setSearching(true)}><Icon name="search" size={19} /></button>}
          <Menu placement="bottom-end" width={230} trigger={<button className="icon-btn" aria-label="Filter by category"><Icon name="filter" size={19} /></button>}>
            {(close) => categories.map((item) => <MenuItem key={item} label={item} checked={category === item} onClick={() => { setCategory(item); close() }} />)}
          </Menu>
          <Link to="/sessions?filter=automations" className="icon-btn" aria-label="Automation runs" title="Automation runs"><Icon name="presentation" size={19} /></Link>
          <Menu placement="bottom-end" width={260} trigger={<button className="btn btn-dark">Create automation<Icon name="chevron-down" size={15} /></button>}>
            {(close) => (
              <>
                <MenuItem icon="edit" label="From scratch" onClick={() => { close(); setEditing({}) }} />
                <MenuSeparator />
                {templates.slice(0, 5).map((item) => <MenuItem key={item.name} icon={item.icon} label={item.name} onClick={() => { close(); setEditing(fromTemplate(item)) }} />)}
              </>
            )}
          </Menu>
        </div>

        {error && <div className="error-banner mt-6">{error}<button onClick={load}>Retry</button></div>}

        {shown.length > 0 ? (
          <div className="list-card mt-8">
            {shown.map((item) => (
              <div key={item.id} className="list-row">
                <span className="tile-icon"><AgentMark agent={item.agent} size={18} /></span>
                <div className="min-w-0 flex-1">
                  <div className="list-row-title truncate">{item.name}</div>
                  <div className="list-row-sub truncate">{describeCron(item.schedule)} · {deviceName(item.deviceId)} · <span className="font-mono text-[12.5px]">{item.cwd || '~'}</span></div>
                </div>
                <div className="hidden text-right text-[13px] text-muted md:block">
                  {item.lastRunAt ? <div>Last run {relativeTime(item.lastRunAt)}{item.lastThreadId && <> · <Link className="link" to={`/sessions/${item.lastThreadId}`}>view</Link></>}</div> : <div>Never run</div>}
                  {item.enabled && item.nextRunAt ? <div>Next run {untilTime(item.nextRunAt)}</div> : null}
                </div>
                <Switch checked={item.enabled} label={`${item.enabled ? 'Disable' : 'Enable'} ${item.name}`} onChange={(value) => toggle(item, value)} />
                <button className="btn btn-sm btn-outline" onClick={() => runNow(item)}><Icon name="play" size={14} />Run</button>
                <Menu placement="bottom-end" width={200} trigger={<button className="icon-btn" aria-label="More"><Icon name="more" size={18} /></button>}>
                  {(close) => (
                    <>
                      <MenuItem icon="edit" label="Edit" onClick={() => { close(); setEditing(item) }} />
                      <MenuItem icon="trash" label="Delete" danger onClick={() => { close(); remove(item) }} />
                    </>
                  )}
                </Menu>
              </div>
            ))}
          </div>
        ) : (
          <div className="callout mt-8">
            <div className="min-w-0 flex-1">
              <div className="callout-title"><Icon name="sparkles" size={20} />Let Overseer find new ways to help</div>
              <p className="callout-text">Overseer looks at your recent work to find repetitive tasks worth automating.</p>
            </div>
            <button className="btn btn-outline" onClick={suggest}>Suggest automations for me</button>
          </div>
        )}

        <section className="page-section">
          <h2 className="page-section-title">Suggested automations</h2>
          <div className="pill-tabs mb-6 flex-wrap" role="tablist">
            {categories.map((item) => <button key={item} role="tab" className="pill-tab" aria-selected={category === item} onClick={() => setCategory(item)}>{item}</button>)}
          </div>
          <div className="grid-cards">
            {suggested.map((item) => (
              <button key={item.name} className="tpl-card" onClick={() => setEditing(fromTemplate(item))}>
                <span className="tpl-card-title"><Icon name={item.icon} size={19} className="text-muted" />{item.name}</span>
                <span className="tpl-card-desc">{item.description}</span>
                <span className="tpl-card-tags">{item.tags.map((tag) => <span key={tag} className="chip">{tag}</span>)}<span className="chip">{describeCron(item.schedule)}</span></span>
              </button>
            ))}
          </div>
        </section>
      </div>
      {editing && <AutomationEditor initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
    </div>
  )
}

function fromTemplate(item: Template): Partial<Automation> {
  return { name: item.name, prompt: item.prompt, schedule: item.schedule }
}

function AutomationEditor({ initial, onClose, onSaved }: { initial: Partial<Automation>; onClose: () => void; onSaved: () => void }) {
  const { value: devices } = useDevices()
  const online = (devices ?? []).filter((device) => device.online || device.id === initial.deviceId)
  const [form, setForm] = useState({
    name: initial.name ?? '',
    prompt: initial.prompt ?? '',
    deviceId: initial.deviceId ?? online.find((device) => device.isHub)?.id ?? online[0]?.id ?? '',
    agent: initial.agent ?? 'claude',
    cwd: initial.cwd ?? '',
    access: (initial.access ?? 'auto') as Access,
    schedule: initial.schedule ?? '0 9 * * 1-5',
    enabled: initial.enabled ?? true,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const preset = useMemo(() => schedulePresets.find((item) => item.cron === form.schedule)?.cron ?? 'custom', [form.schedule])
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }))

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (form.schedule.trim().split(/\s+/).length !== 5) { setError('Schedule must be a 5-field cron expression, like “0 9 * * 1-5”.'); return }
    setBusy(true)
    setError('')
    try {
      if (initial.id) await api.patch(`/api/automations/${initial.id}`, form)
      else await api.post('/api/automations', form)
      onSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save')
      setBusy(false)
    }
  }

  return (
    <Modal title={initial.id ? 'Edit automation' : 'Create automation'} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-4">
        <div><label className="label" htmlFor="au-name">Name</label><input id="au-name" className="input" required value={form.name} onChange={(event) => set('name', event.target.value)} placeholder="Weekly dependency update" /></div>
        <div><label className="label" htmlFor="au-prompt">What should the agent do?</label><textarea id="au-prompt" className="textarea" rows={5} required value={form.prompt} onChange={(event) => set('prompt', event.target.value)} placeholder="Describe the task as you would to a teammate." /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="au-machine">Machine</label>
            <select id="au-machine" className="select w-full" value={form.deviceId} onChange={(event) => set('deviceId', event.target.value)}>
              {online.map((device) => <option key={device.id} value={device.id}>{device.name}{device.online ? '' : ' (offline)'}</option>)}
            </select>
          </div>
          <div><label className="label" htmlFor="au-agent">Agent</label>
            <select id="au-agent" className="select w-full" value={form.agent} onChange={(event) => set('agent', event.target.value)}>
              {agentCatalog.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
          </div>
          <div><label className="label" htmlFor="au-cwd">Folder</label><input id="au-cwd" className="input input-mono" value={form.cwd} onChange={(event) => set('cwd', event.target.value)} placeholder="~/Projects/my-app" /></div>
          <div><label className="label" htmlFor="au-access">Access</label>
            <select id="au-access" className="select w-full" value={form.access} onChange={(event) => set('access', event.target.value as Access)}>
              {accessLevels.map((level) => <option key={level.id} value={level.id}>{level.label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="au-schedule">Schedule</label>
          <div className="flex gap-2">
            <select className="select" value={preset} onChange={(event) => event.target.value !== 'custom' && set('schedule', event.target.value)} aria-label="Schedule preset">
              {schedulePresets.map((item) => <option key={item.cron} value={item.cron}>{item.label}</option>)}
              <option value="custom">Custom…</option>
            </select>
            <input id="au-schedule" className="input input-mono flex-1" value={form.schedule} onChange={(event) => set('schedule', event.target.value)} />
          </div>
          <p className="hint">{describeCron(form.schedule)} · cron in the hub’s time zone. {form.access === 'full' ? 'Runs without approval prompts.' : form.access === 'ask' ? 'Read-only.' : `${agentInfo(form.agent).name} may pause for approval; you’ll get a notification.`}</p>
        </div>
        {error && <p className="text-[13px] text-danger">{error}</p>}
        <div className="modal-foot">
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-dark" disabled={busy || !form.deviceId}>{busy && <span className="spinner" />}{initial.id ? 'Save' : 'Create automation'}</button>
        </div>
      </form>
    </Modal>
  )
}
