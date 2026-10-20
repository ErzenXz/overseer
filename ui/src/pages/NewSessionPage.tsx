import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import Composer, { ContextStrip, type ComposerSettings } from '../components/Composer'
import Icon from '../components/Icon'
import { LogoMark } from '../components/Logo'
import { accessForKind, builtinOptions, modeOf } from '../agentOptions'
import { createThread, terminalsResource, useDevices, usePref, useThreads } from '../store'

const suggestions = [
  { icon: 'code' as const, label: 'Fix failing tests', text: 'Run the tests, fix what fails, and explain the root cause.' },
  { icon: 'pull-request' as const, label: 'Review my PR', text: 'Review my open pull request for bugs and risky changes.' },
  { icon: 'disk' as const, label: 'Free up disk space', text: 'Find what is using the most disk space and clean caches that rebuild themselves.' },
]

type AgentChoice = Pick<ComposerSettings, 'model' | 'effort' | 'fast' | 'mode'>

const blank: ComposerSettings = { deviceId: '', agent: 'claude', model: '', effort: '', fast: false, mode: '', cwd: '' }

export default function NewSessionPage() {
  const { value: devices } = useDevices()
  const { value: threads } = useThreads()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const [stored, setDefaults] = usePref<Partial<ComposerSettings>>('composer.defaults', blank)
  // Each agent remembers its own model, thinking level, speed and mode.
  const [perAgent, setPerAgent] = usePref<Record<string, AgentChoice>>('composer.perAgent', {})
  const defaults: ComposerSettings = { ...blank, ...stored }
  const [mode, setMode] = useState<'agent' | 'terminal'>(params.get('mode') === 'terminal' ? 'terminal' : 'agent')
  const [settings, setSettings] = useState<ComposerSettings>(defaults)
  const [seed, setSeed] = useState(params.get('prompt') ?? '')
  const online = useMemo(() => (devices ?? []).filter((device) => device.online), [devices])

  useEffect(() => { setMode(params.get('mode') === 'terminal' ? 'terminal' : 'agent') }, [params])

  // Pick a sensible machine: the requested one, the last used, the hub, then any online.
  useEffect(() => {
    if (!devices) return
    const requested = params.get('device')
    const pick = [requested, settings.deviceId].find((id) => id && online.some((device) => device.id === id))
      ?? online.find((device) => device.isHub)?.id ?? online[0]?.id ?? ''
    const cwd = params.get('cwd')
    if (pick !== settings.deviceId || cwd) setSettings((current) => ({ ...current, deviceId: pick, cwd: cwd ?? (pick === defaults.deviceId ? current.cwd : '') }))
  }, [devices]) // eslint-disable-line react-hooks/exhaustive-deps

  const update = (next: ComposerSettings) => {
    let value = next
    if (next.agent !== settings.agent) {
      const remembered = perAgent[next.agent]
      value = { ...next, ...(remembered ?? { model: '', effort: '', fast: false, mode: '' }) }
    } else {
      setPerAgent({ ...perAgent, [next.agent]: { model: next.model, effort: next.effort, fast: next.fast, mode: next.mode } })
    }
    setSettings(value)
    setDefaults(value)
  }

  const start = async (text: string) => {
    const effective = settings
    if (mode === 'terminal') {
      const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '')
      const name = `term-${stamp}`
      await api.post(`/api/devices/${effective.deviceId}/sessions`, { name, cwd: effective.cwd, command: text, kind: 'shell' })
      terminalsResource.refresh()
      navigate(`/machines/${effective.deviceId}?tab=terminal&session=${encodeURIComponent(name)}`)
      return
    }
    const kind = modeOf(builtinOptions(effective.agent), effective.mode)?.kind
    const thread = await createThread({
      deviceId: effective.deviceId,
      agent: effective.agent,
      cwd: effective.cwd,
      prompt: text,
      model: effective.model || undefined,
      effort: effective.effort || undefined,
      fast: effective.fast || undefined,
      mode: effective.mode || undefined,
      access: accessForKind(kind),
    })
    navigate(`/sessions/${thread.id}`)
  }

  const recentFolders = useMemo(() => {
    const seen = new Set<string>()
    return (threads ?? []).filter((thread) => thread.deviceId === settings.deviceId && thread.cwd && !seen.has(thread.cwd) && seen.add(thread.cwd)).slice(0, 4).map((thread) => thread.cwd)
  }, [threads, settings.deviceId])

  if (devices && online.length === 0) {
    return (
      <div className="new-page">
        <div className="empty">
          <span className="empty-icon"><Icon name="monitor" size={24} /></span>
          <h2>Connect a machine to start a session</h2>
          <p>Agents run on your own computers. Add one with a single command, then come back here.</p>
          <Link to="/machines?add=1" className="btn btn-dark">Add a machine</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="new-page">
      <div className="new-wrap">
        <div className="new-head">
          <span className="brand"><LogoMark size={24} />Overseer</span>
          <div className="seg" role="group" aria-label="Mode">
            <button aria-pressed={mode === 'agent'} onClick={() => { setMode('agent'); setParams({}) }}>Agent</button>
            <button aria-pressed={mode === 'terminal'} onClick={() => setMode('terminal')}>Terminal</button>
          </div>
        </div>
        <Composer
          autoFocus
          placeholder={mode === 'terminal' ? 'Command to run, or press Enter for a plain shell' : 'Ask Overseer to build features, fix bugs, or work on your code'}
          devices={devices ?? []}
          settings={settings}
          onSettings={update}
          onSubmit={start}
          initialText={seed}
          agentOptional={mode === 'terminal'}
          context={<ContextStrip devices={devices ?? []} settings={settings} onSettings={update} recents={recentFolders} />}
        />
        {mode !== 'terminal' && (
          <div className="new-suggestions">
            {suggestions.map((item) => (
              <button key={item.label} className="suggestion" onClick={() => setSeed(item.text)} title={item.text}>
                <Icon name={item.icon} size={14} />{item.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
