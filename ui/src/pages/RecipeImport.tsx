import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import { accessForKind, modeOf, useAgentOptions } from '../agentOptions'
import { agentInfo } from '../agents'
import { AgentPicker, ModePicker } from '../components/AgentPicker'
import { FolderPicker, type ComposerSettings } from '../components/Composer'
import Icon from '../components/Icon'
import { Menu, Switch } from '../components/Menu'
import { recipeDataFromLink, type Recipe, type RecipeMode, type RecipeWarning } from '../recipes'
import { useShell } from '../shell'
import { useDevices } from '../store'
import type { ModeKind } from '../types'
import { describeCron } from './AutomationsPage'

// /automations/import#r=<recipe>: show what a shared recipe would run, let the
// person pick the machine, folder and agent, and add it. Recipes are
// untrusted: the hub checks them, the whole prompt is shown, and nothing runs
// until the person adds the automation (and then only on its schedule).

interface Inspected { recipe: Recipe; warnings: RecipeWarning[] }

const modeText: Record<RecipeMode, string> = {
  plan: 'Plan: read-only, changes nothing',
  ask: 'Ask before changes',
  edits: 'Accept edits, asks before commands',
  auto: 'Auto: no one approves each step',
}

export default function RecipeImport() {
  const { hash } = useLocation()
  const navigate = useNavigate()
  const [paste, setPaste] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [found, setFound] = useState<Inspected | null>(null)

  const data = useMemo(() => recipeDataFromLink(hash), [hash])
  useEffect(() => {
    setFound(null)
    setError('')
    if (!data) return
    let alive = true
    setLoading(true)
    api.post<Inspected>('/api/recipes/inspect', { data })
      .then((result) => { if (alive) setFound(result) })
      .catch((cause) => { if (alive) setError(cause instanceof ApiError ? cause.message : 'Could not read this recipe.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [data])

  const open = (event: FormEvent) => {
    event.preventDefault()
    const next = recipeDataFromLink(paste)
    if (!next) { setError('That doesn’t look like a recipe link.'); return }
    navigate({ hash: `r=${next}` }, { replace: true })
    setPaste('')
  }

  return (
    <div className="main-scroll">
      <div className="page cl-import">
        <h1 className="page-title">Add automation from a link</h1>
        <p className="page-sub">A shared recipe. Read what it does, choose where it runs, then add it. Nothing runs until you add it.</p>

        {!data && (
          <form onSubmit={open} className="cl-paste">
            <label className="label" htmlFor="cl-paste">Recipe link</label>
            <div className="cl-link-field">
              <input id="cl-paste" className="input input-mono" value={paste} onChange={(event) => setPaste(event.target.value)} placeholder="https://overseer.sh/r#… or …/automations/import#r=…" autoComplete="off" spellCheck={false} />
              <button className="btn btn-dark" disabled={!paste.trim()}>Open</button>
            </div>
            <p className="hint">Or pick one from the gallery on the <Link className="link" to="/automations">Automations</Link> page.</p>
          </form>
        )}

        {loading && <div className="grid place-items-center py-16"><span className="spinner" /></div>}
        {error && (
          <div className="error-banner mt-6">
            <span>{error}</span>
            <Link to="/automations">Back to automations</Link>
          </div>
        )}
        {found && <RecipeView key={data} inspected={found} />}
      </div>
    </div>
  )
}

function RecipeView({ inspected }: { inspected: Inspected }) {
  const { recipe, warnings } = inspected
  const navigate = useNavigate()
  const { toast } = useShell()
  const { value: devices } = useDevices()
  const online = (devices ?? []).filter((device) => device.online)
  const [name, setName] = useState(recipe.name)
  const [deviceId, setDeviceId] = useState('')
  const [cwd, setCwd] = useState('')
  const [agent, setAgent] = useState<string>(recipe.agent ?? 'claude')
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState('')
  const [touched, setTouched] = useState(false)
  const [fast, setFast] = useState(false)
  const [modeChoice, setModeChoice] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // The hub's own machine first, once the list has loaded.
  useEffect(() => {
    if (deviceId || online.length === 0) return
    setDeviceId((online.find((device) => device.isHub) ?? online[0]).id)
  }, [deviceId, online])

  const options = useAgentOptions(deviceId, agent)
  // A hint is only a hint: use the model and mode only if this machine's
  // agent has them. With no mode hint, start read-only.
  const hintKind: ModeKind = recipe.mode ?? 'plan'
  const hinted = options.modes.find((item) => item.kind === hintKind) ?? options.modes.find((item) => item.kind === 'readonly')
  const mode = modeOf(options, modeChoice || hinted?.id)
  const modelId = touched ? model : (recipe.model && options.models.some((item) => item.id === recipe.model) ? recipe.model : '')
  const effortId = touched ? effort : (recipe.effort && options.efforts.some((item) => item.id === recipe.effort) ? recipe.effort : '')
  const settings: ComposerSettings = { deviceId, agent, model: modelId, effort: effortId, fast, mode: mode?.id ?? '', cwd }
  const onSettings = (next: ComposerSettings) => {
    setTouched(true)
    setAgent(next.agent)
    setModel(next.model)
    setEffort(next.effort ?? '')
    setFast(!!next.fast)
    setModeChoice(next.mode ?? '')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.post('/api/automations', {
        name: name.trim(), prompt: recipe.prompt, deviceId, agent, model: modelId, effort: effortId, fast, mode: mode?.id ?? '',
        cwd: cwd.trim(), access: accessForKind(mode?.kind), schedule: recipe.schedule, enabled,
      })
      toast(enabled ? `Added “${name.trim()}”` : `Added “${name.trim()}” (turned off)`)
      navigate('/automations', { replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add the automation')
      setBusy(false)
    }
  }

  const warn = warnings.filter((item) => item.level === 'warn')
  const info = warnings.filter((item) => item.level === 'info')
  return (
    <form onSubmit={submit} className="cl-recipe">
      <section className="cl-recipe-card">
        <h2 className="cl-recipe-name">{recipe.name}</h2>
        {recipe.description && <p className="cl-recipe-desc">{recipe.description}</p>}
        <dl className="cl-facts">
          <div><dt>Runs</dt><dd>{describeCron(recipe.schedule)} <code>{recipe.schedule}</code><span className="text-faint"> · hub’s time zone</span></dd></div>
          {recipe.agent && <div><dt>Agent</dt><dd>{agentInfo(recipe.agent).name}{recipe.model ? ` · ${recipe.model}` : ''}</dd></div>}
          {recipe.mode && <div><dt>Mode</dt><dd>{modeText[recipe.mode]}</dd></div>}
          {recipe.requires && recipe.requires.length > 0 && <div><dt>Needs</dt><dd>{recipe.requires.map((tool) => <span key={tool} className="chip cl-tool">{tool}</span>)}<span className="text-faint"> on the machine</span></dd></div>}
        </dl>
      </section>

      {(warn.length > 0 || info.length > 0) && (
        <section className={`cl-warns ${warn.length ? 'has-warn' : ''}`} aria-label="Things to know">
          <h3><Icon name={warn.length ? 'alert' : 'info'} size={16} />{warn.length ? 'Before you add it' : 'Good to know'}</h3>
          <ul>
            {warn.map((item) => <li key={item.text} className="is-warn">{item.text}</li>)}
            {info.map((item) => <li key={item.text}>{item.text}</li>)}
          </ul>
        </section>
      )}

      <section>
        <h3 className="cl-h3">Exactly what it will tell the agent to do</h3>
        <pre className="cl-prompt" tabIndex={0} aria-label="Full prompt">{recipe.prompt}</pre>
        <p className="hint">This is the whole prompt. It came from a link, so read it as you would a script from the internet.</p>
      </section>

      <section className="cl-recipe-card space-y-4">
        <h3 className="cl-h3">Where it runs</h3>
        {online.length === 0 && devices && <p className="text-[13px] text-danger">No machine is online. Bring one online in Machines, then come back to this link.</p>}
        <div><label className="label" htmlFor="ri-name">Name</label><input id="ri-name" className="input" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="ri-machine">Machine</label>
            <select id="ri-machine" className="select w-full" value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>
              {online.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}
            </select>
          </div>
          <div><label className="label" htmlFor="ri-cwd">Folder</label>
            <div className="cl-link-field">
              <input id="ri-cwd" className="input input-mono" value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="~/Projects/my-app" />
              <Menu placement="bottom-end" width={340} trigger={<button type="button" className="btn btn-outline" disabled={!deviceId}><Icon name="folder-open" size={15} />Browse</button>}>
                {(close) => <FolderPicker deviceId={deviceId} value={cwd} onPick={(path) => { setCwd(path); close() }} />}
              </Menu>
            </div>
          </div>
        </div>
        <div>
          <span className="label">Agent</span>
          <div className="automation-agent">
            <AgentPicker settings={settings} onSettings={onSettings} />
            <ModePicker settings={settings} onSettings={onSettings} />
          </div>
          <p className="hint">{mode?.kind === 'full' ? 'Runs without approval prompts.' : mode?.kind === 'auto' ? 'Auto: the agent decides what is safe to run; nobody approves each step.' : mode?.kind === 'readonly' || mode?.kind === 'plan' ? 'Read-only: it reports what it finds and changes nothing.' : `${agentInfo(agent).name} may pause for approval; you will get a notification.`}</p>
        </div>
        <div className="cl-switch-row">
          <div><b>Turn it on right away</b><span>Off keeps it saved but it won’t run until you switch it on.</span></div>
          <Switch checked={enabled} onChange={setEnabled} label="Turn it on right away" />
        </div>
      </section>

      {error && <p className="text-[13px] text-danger">{error}</p>}
      <div className="cl-recipe-foot">
        <Link to="/automations" className="btn btn-outline">Cancel</Link>
        <button className="btn btn-dark" disabled={busy || !deviceId || !name.trim()}>{busy && <span className="spinner" />}Add automation</button>
      </div>
    </form>
  )
}
