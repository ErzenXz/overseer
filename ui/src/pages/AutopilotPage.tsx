import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { agentInfo, relativeTime } from '../agents'
import { accessForKind, modeOf, useAgentOptions } from '../agentOptions'
import { AgentPicker, ModePicker } from '../components/AgentPicker'
import type { ComposerSettings } from '../components/Composer'
import Icon, { AgentMark } from '../components/Icon'
import { Menu, MenuItem, Switch } from '../components/Menu'
import Modal from '../components/Modal'
import { parseRepoRef, useGitHubRepos } from '../github'
import { useShell } from '../shell'
import { useDevices } from '../store'
import { isActiveRun, runStatusLabel, useAutopilot, type AutopilotRepo, type AutopilotRun, type CloneInfo } from '../autopilot'

// Issue autopilot: label a GitHub issue and an agent works on it on a free
// machine and opens a pull request. Issues are written by other people, so the
// page is plain about what is and is not allowed to start a run.

export default function AutopilotPage() {
  const { data, error, reload } = useAutopilot()
  const { value: devices } = useDevices()
  const { toast } = useShell()
  const [editing, setEditing] = useState<AutopilotRepo | 'new' | null>(null)
  const deviceName = (id: string) => devices?.find((device) => device.id === id)?.name ?? id

  const patchRepo = async (repo: AutopilotRepo, body: Partial<AutopilotRepo>) => {
    try { await api.patch(`/api/autopilot/repos/${repo.id}`, body) } catch (cause) { toast(cause instanceof Error ? cause.message : 'Could not save') }
    reload()
  }
  const removeRepo = async (repo: AutopilotRepo) => {
    if (!confirm(`Stop watching ${repo.repo}? Pull requests already opened stay as they are.`)) return
    try { await api.del(`/api/autopilot/repos/${repo.id}`) } catch (cause) { toast(cause instanceof Error ? cause.message : 'Could not remove') }
    reload()
  }
  const checkNow = async (repo: AutopilotRepo) => {
    try { await api.post(`/api/autopilot/repos/${repo.id}/poll`); toast('Checking GitHub…') } catch (cause) { toast(cause instanceof Error ? cause.message : 'Could not check') }
    window.setTimeout(reload, 2500)
  }
  const act = async (run: AutopilotRun, action: 'retry' | 'approve' | 'stop') => {
    if (action === 'approve' && !confirm(`Run issue #${run.number}?\n\nThe label was added by ${run.labeller ? `@${run.labeller}` : 'someone'} who cannot write to this repo. The agent will read the issue text, which anyone could have written.`)) return
    if (action === 'stop' && !confirm('Stop this run? The agent is stopped and nothing is opened on GitHub.')) return
    try { await api.post(`/api/autopilot/runs/${run.id}/${action}`) } catch (cause) { toast(cause instanceof Error ? cause.message : 'Could not do that') }
    reload()
  }

  const repos = data?.repos ?? []
  const runs = data?.runs ?? []

  return (
    <div className="main-scroll">
      <div className="page page-narrow ap-page">
        <p className="ap-crumb"><Link to="/automations" className="link">Automations</Link></p>
        <h1 className="page-title">Issue autopilot</h1>
        <p className="page-sub">Label a GitHub issue <code className="code-inline">overseer</code> and an agent works on it on a free machine, then opens a pull request.</p>

        <p className="ap-safety" role="note">
          <Icon name="shield" size={14} />
          <span>Only issues labelled by people who can write to the repo start on their own; anything else waits for your OK. Work ends in a pull request, never a merge.</span>
        </p>

        <div className="page-toolbar">
          <h2 className="page-section-title ap-h2">Repos</h2>
          <span className="grow" />
          <button className="btn btn-dark" onClick={() => setEditing('new')}><Icon name="plus" size={15} />Add a repo</button>
        </div>

        {error && !data && <div className="error-banner mt-6">{error}<button onClick={reload}>Retry</button></div>}

        {data && repos.length === 0 && (
          <div className="callout mt-6">
            <div className="min-w-0 flex-1">
              <div className="callout-title"><Icon name="github" size={20} />Off until you add a repo</div>
              <p className="callout-text">Nothing is watched and nothing runs by itself. Pick a repo, say who can trigger it, and Overseer looks for labelled issues every couple of minutes.</p>
            </div>
            <button className="btn btn-outline" onClick={() => setEditing('new')}>Add a repo</button>
          </div>
        )}

        {repos.length > 0 && (
          <div className="list-card mt-6">
            {repos.map((repo) => (
              <div key={repo.id} className="list-row ap-repo">
                <span className="tile-icon"><AgentMark agent={repo.agent} size={18} /></span>
                <div className="min-w-0 flex-1">
                  <div className="list-row-title truncate">{repo.repo}{repo.active > 0 && <span className="badge ml-2"><span className="dot dot-blue dot-pulse" />{repo.active} running</span>}</div>
                  <div className="list-row-sub ap-meta">
                    <span>Label <code className="code-inline">{repo.label}</code></span>
                    <span>{repo.trust === 'me' ? 'Only your labels' : 'Writers can trigger'}</span>
                    <span>{repo.deviceId ? deviceName(repo.deviceId) : 'Any machine with a clone'}</span>
                    <span>Up to {repo.maxConcurrent} at once</span>
                  </div>
                  <div className={`ap-poll ${repo.lastError ? 'is-error' : ''}`}>
                    {repo.lastError ? repo.lastError : repo.lastPollAt ? `Checked GitHub ${relativeTime(repo.lastPollAt)}` : 'Not checked yet'}
                  </div>
                </div>
                <Switch checked={repo.enabled} label={`${repo.enabled ? 'Pause' : 'Resume'} ${repo.repo}`} onChange={(value) => patchRepo(repo, { enabled: value })} />
                <button className="btn btn-sm btn-outline ap-check" disabled={!repo.enabled} onClick={() => checkNow(repo)}><Icon name="refresh" size={14} />Check now</button>
                <Menu placement="bottom-end" width={200} trigger={<button className="icon-btn" aria-label="More"><Icon name="more" size={18} /></button>}>
                  {(close) => (
                    <>
                      <MenuItem icon="edit" label="Edit" onClick={() => { close(); setEditing(repo) }} />
                      <MenuItem icon="trash" label="Stop watching" danger onClick={() => { close(); removeRepo(repo) }} />
                    </>
                  )}
                </Menu>
              </div>
            ))}
          </div>
        )}

        <section className="page-section ap-activity">
          <h2 className="page-section-title">Issues handled</h2>
          {data && runs.length === 0 ? (
            <p className="ap-empty">Nothing yet. Add the label to an issue and it shows up here within a couple of minutes.</p>
          ) : (
            <div className="list-card">
              {runs.map((run) => <RunRow key={run.id} run={run} onAct={act} />)}
            </div>
          )}
        </section>
      </div>
      {editing && <RepoEditor initial={editing === 'new' ? null : editing} existing={repos.map((repo) => repo.repo.toLowerCase())} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </div>
  )
}

const badgeClass = (run: AutopilotRun) => {
  switch (run.status) {
    case 'pr_open': case 'merged': return 'badge badge-green'
    case 'failed': return 'badge badge-red'
    case 'skipped': return 'badge badge-amber'
    default: return 'badge'
  }
}

function RunRow({ run, onAct }: { run: AutopilotRun; onAct: (run: AutopilotRun, action: 'retry' | 'approve' | 'stop') => void }) {
  const live = run.status === 'working' || run.status === 'preparing' || run.status === 'finishing'
  return (
    <div className="list-row ap-run">
      <div className="min-w-0 flex-1">
        <div className="ap-run-title">
          <a href={run.url} target="_blank" rel="noreferrer" className="link ap-run-num">{run.repo.split('/')[1]}#{run.number}</a>
          <span className="truncate">{run.title}</span>
        </div>
        <div className="list-row-sub ap-meta">
          <span className={badgeClass(run)}>{live && <span className="dot dot-blue dot-pulse" />}{runStatusLabel[run.status]}</span>
          {run.status === 'working' && run.threadStatus === 'waiting' && <span className="badge badge-amber">Waiting for approval</span>}
          {run.deviceName && <span>{run.deviceName}</span>}
          {run.attempt > 1 && <span>Attempt {run.attempt}</span>}
          <span>{relativeTime(run.updatedAt)}</span>
        </div>
        {run.detail && <p className="ap-run-detail">{run.detail}</p>}
      </div>
      <div className="ap-run-links">
        {run.threadId && <Link className="btn btn-sm btn-ghost" to={`/sessions/${run.threadId}`}>Session</Link>}
        {run.prUrl && <a className="btn btn-sm btn-outline" href={run.prUrl} target="_blank" rel="noreferrer"><Icon name={run.status === 'merged' ? 'git-merge' : 'pull-request'} size={14} />PR #{run.prNumber}</a>}
        {run.status === 'skipped' && <button className="btn btn-sm btn-outline" onClick={() => onAct(run, 'approve')}>Run anyway</button>}
        {run.status === 'failed' && <button className="btn btn-sm btn-outline" onClick={() => onAct(run, 'retry')}>Retry</button>}
        {isActiveRun(run.status) && run.status !== 'queued' && <button className="btn btn-sm btn-ghost" onClick={() => onAct(run, 'stop')}>Stop</button>}
      </div>
    </div>
  )
}

// A short card for the Automations page.
export function AutopilotEntry() {
  const { data } = useAutopilot()
  const repos = data?.repos.length ?? 0
  const running = data?.runs.filter((run) => run.status === 'working' || run.status === 'preparing' || run.status === 'finishing').length ?? 0
  return (
    <Link to="/automations/autopilot" className="ap-entry">
      <span className="tile-icon"><Icon name="github" size={18} /></span>
      <span className="min-w-0 flex-1">
        <span className="ap-entry-title">Issue autopilot</span>
        <span className="ap-entry-text">{repos === 0 ? 'Label an issue and an agent opens a pull request for it.' : `${repos} repo${repos === 1 ? '' : 's'} watched${running ? ` · ${running} running` : ''}`}</span>
      </span>
      <Icon name="chevron" size={16} className="text-faint" />
    </Link>
  )
}

// A small card for a session started from an issue.
export function IssueChip({ threadId }: { threadId: string }) {
  const [run, setRun] = useState<AutopilotRun | null>(null)
  useEffect(() => {
    let alive = true
    setRun(null)
    api.get<{ run: AutopilotRun | null }>(`/api/autopilot/by-thread/${encodeURIComponent(threadId)}`).then((reply) => { if (alive) setRun(reply.run) }).catch(() => {})
    return () => { alive = false }
  }, [threadId])
  if (!run) return null
  return (
    <a href={run.url} target="_blank" rel="noreferrer" className="ap-chip" title={`${run.repo} issue #${run.number}`}>
      <Icon name="github" size={14} />Issue #{run.number}
    </a>
  )
}

// ---- add or edit a repo ----

function RepoEditor({ initial, existing, onClose, onSaved }: { initial: AutopilotRepo | null; existing: string[]; onClose: () => void; onSaved: () => void }) {
  const { value: devices } = useDevices()
  const online = (devices ?? []).filter((device) => device.online)
  const [form, setForm] = useState({
    repo: initial?.repo ?? '',
    label: initial?.label ?? 'overseer',
    ghDeviceId: initial?.ghDeviceId ?? '',
    deviceId: initial?.deviceId ?? '',
    agent: initial?.agent ?? 'claude',
    model: initial?.model ?? '',
    effort: initial?.effort ?? '',
    mode: initial?.mode ?? '',
    maxConcurrent: initial?.maxConcurrent ?? 1,
    trust: initial?.trust ?? 'writers',
    comment: initial?.comment ?? true,
    footer: initial?.footer ?? true,
  })
  const [acknowledge, setAcknowledge] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [clones, setClones] = useState<CloneInfo[] | null>(null)
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }))

  // The machine whose GitHub CLI watches the repo: the hub's, else any online.
  useEffect(() => {
    if (form.ghDeviceId || !devices) return
    const pick = devices.find((device) => device.isHub && device.online) ?? devices.find((device) => device.online)
    if (pick) set('ghDeviceId', pick.id)
  }, [devices, form.ghDeviceId])

  const repos = useGitHubRepos(form.ghDeviceId || undefined, !!form.ghDeviceId)
  const parsed = parseRepoRef(form.repo)
  const repoName = parsed && parsed.repo === form.repo.trim() ? parsed.repo : ''
  const duplicate = !initial && !!repoName && existing.includes(repoName.toLowerCase())

  useEffect(() => {
    setClones(null)
    if (!repoName) return
    let alive = true
    const timer = window.setTimeout(() => {
      api.get<CloneInfo[]>(`/api/autopilot/clones?repo=${encodeURIComponent(repoName)}`).then((list) => { if (alive) setClones(list) }).catch(() => { if (alive) setClones([]) })
    }, 300)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [repoName])

  const optionsDevice = form.deviceId || form.ghDeviceId
  const options = useAgentOptions(optionsDevice, form.agent)
  // Nobody watches a run, so it starts in the agent's Auto mode.
  const mode = modeOf(options, form.mode || options.modes.find((item) => item.kind === 'auto')?.id)
  const settings: ComposerSettings = { deviceId: optionsDevice, agent: form.agent, model: form.model, effort: form.effort, fast: false, mode: mode?.id ?? form.mode, cwd: '' }
  const onSettings = (next: ComposerSettings) => setForm((current) => ({ ...current, agent: next.agent, model: next.model, effort: next.effort ?? '', mode: next.mode ?? '' }))
  const needsApproval = mode && (mode.kind === 'ask' || mode.kind === 'edits' || mode.kind === 'plan' || mode.kind === 'readonly')

  const suggestions = useMemo(() => (repos.reply?.repos ?? []).slice(0, 300), [repos.reply])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!initial && !repoName) { setError('Choose a repo as owner/name, like acme/widgets.'); return }
    setBusy(true)
    setError('')
    try {
      const body = { ...form, mode: mode?.id ?? form.mode, access: accessForKind(mode?.kind), repo: initial ? undefined : repoName }
      if (initial) await api.patch(`/api/autopilot/repos/${initial.id}`, body)
      else await api.post('/api/autopilot/repos', { ...body, acknowledge })
      onSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save')
      setBusy(false)
    }
  }

  return (
    <Modal title={initial ? `Autopilot for ${initial.repo}` : 'Add a repo to the autopilot'} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-5 ap-form">
        <div>
          <label className="label" htmlFor="ap-repo">Repo</label>
          <input id="ap-repo" className="input input-mono" list="ap-repos" value={form.repo} disabled={!!initial} required placeholder="owner/name" autoComplete="off" spellCheck={false} onChange={(event) => set('repo', event.target.value)} />
          <datalist id="ap-repos">{suggestions.map((repo) => <option key={repo.nameWithOwner} value={repo.nameWithOwner}>{repo.description}</option>)}</datalist>
          {duplicate ? <p className="hint text-danger">This repo is already set up.</p> : <p className="hint">{repos.loading && !repos.reply ? 'Loading your repos…' : repos.reply?.status === 'ok' ? 'Pick one of your repos, or type owner/name.' : repos.reply?.message ?? 'Type owner/name.'}</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="ap-label">Trigger label</label>
            <input id="ap-label" className="input" value={form.label} required maxLength={50} onChange={(event) => set('label', event.target.value)} />
            <p className="hint">Overseer also uses <code className="code-inline">overseer:working</code>, <code className="code-inline">overseer:done</code> and <code className="code-inline">overseer:failed</code>.</p>
          </div>
          <div>
            <label className="label" htmlFor="ap-gh">Watches GitHub from</label>
            <select id="ap-gh" className="select w-full" value={form.ghDeviceId} onChange={(event) => set('ghDeviceId', event.target.value)}>
              {online.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}
              {initial && !online.some((device) => device.id === form.ghDeviceId) && <option value={form.ghDeviceId}>(offline machine)</option>}
            </select>
            <p className="hint">Uses the GitHub CLI signed in on that machine. No webhook needed.</p>
          </div>
        </div>

        <fieldset className="ap-trust">
          <legend className="label">Who can trigger it</legend>
          <label className="ap-radio">
            <input type="radio" name="ap-trust" checked={form.trust === 'writers'} onChange={() => set('trust', 'writers')} />
            <span><strong>The owner and collaborators with write access</strong><em>Recommended. It looks at who added the label.</em></span>
          </label>
          <label className="ap-radio">
            <input type="radio" name="ap-trust" checked={form.trust === 'me'} onChange={() => set('trust', 'me')} />
            <span><strong>Only me</strong><em>Only labels added by the account signed in to GitHub there, or the repo’s owner.</em></span>
          </label>
          <p className="hint">Issues anyone can open are untrusted, and the agent runs code on your machine. A label from anyone else never starts a run on its own; the issue waits for your OK on this page.</p>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="ap-machine">Runs on</label>
            <select id="ap-machine" className="select w-full" value={form.deviceId} onChange={(event) => set('deviceId', event.target.value)}>
              <option value="">Any online machine with a clone (least busy)</option>
              {(clones ?? online.map((device) => ({ deviceId: device.id, name: device.name, hasClone: true, busy: 0 }) as CloneInfo)).map((item) => (
                <option key={item.deviceId} value={item.deviceId} disabled={!item.hasClone}>{item.name}{clones ? (item.hasClone ? (item.busy ? ` · ${item.busy} busy` : ' · has a clone') : ' · no clone') : ''}</option>
              ))}
            </select>
            <p className="hint">Autopilot never clones a repo by itself. Each issue gets its own worktree on a new branch, so your own checkout is not touched.</p>
          </div>
          <div>
            <label className="label" htmlFor="ap-max">At the same time</label>
            <select id="ap-max" className="select w-full" value={form.maxConcurrent} onChange={(event) => set('maxConcurrent', Number(event.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n === 1 ? 'One issue at a time' : `Up to ${n} issues`}</option>)}
            </select>
          </div>
        </div>

        <div>
          <span className="label">Agent</span>
          <div className="automation-agent">
            <AgentPicker settings={settings} onSettings={onSettings} />
            <ModePicker settings={settings} onSettings={onSettings} />
          </div>
          <p className="hint">{needsApproval ? `${agentInfo(form.agent).name} may stop to ask for approval, and nobody is there to answer. Choose an Auto or Full mode so it can work on its own.` : 'It starts in a new session you can open at any time.'}</p>
        </div>

        <div className="ap-toggles">
          <div className="ap-toggle"><span><strong>Comment when it starts</strong><em>Posts “🤖 Working on this in Overseer” on the issue.</em></span><Switch checked={form.comment} label="Comment when it starts" onChange={(value) => set('comment', value)} /></div>
          <div className="ap-toggle"><span><strong>“Built with Overseer” in the pull request</strong><em>A one-line footer with a link.</em></span><Switch checked={form.footer} label="Footer in the pull request" onChange={(value) => set('footer', value)} /></div>
        </div>

        {!initial && (
          <label className="ap-ack">
            <input type="checkbox" checked={acknowledge} onChange={(event) => setAcknowledge(event.target.checked)} />
            <span>I understand that issues are written by other people, and that an agent will run on my machine for each one that is picked up.</span>
          </label>
        )}
        {error && <p className="text-[13px] text-danger">{error}</p>}
        <div className="modal-foot">
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-dark" disabled={busy || duplicate || !form.ghDeviceId || (!initial && !acknowledge)}>{busy && <span className="spinner" />}{initial ? 'Save' : 'Turn on for this repo'}</button>
        </div>
      </form>
    </Modal>
  )
}
