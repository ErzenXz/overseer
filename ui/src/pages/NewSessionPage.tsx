import { AgentOnboarding, AuthNotice } from '../components/AgentAccess'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, startUnknown } from '../api'
import Composer, { type ComposerSettings } from '../components/Composer'
import Icon from '../components/Icon'
import WrappedNudge from '../components/WrappedNudge'
import PrepareNotice, { type PrepareState } from '../components/PrepareNotice'
import StartNotice, { type StartAttempt } from '../components/StartNotice'
import { TargetStrip } from '../components/TargetPicker'
import { accessForKind, builtinOptions, modeOf } from '../agentOptions'
import { PrepareCancelled, prepareCheckout, type RepoSource } from '../github'
import { HeldError } from '../held'
import { inText, scheduleSession, whenText, type LaterChoice } from '../schedule'
import { useShell } from '../shell'
import { knownClonePaths, knownFolders, probe } from '../where'
import { createThread, findStarted, newRequestId, terminalsResource, useDevices, usePref, useThreads, type NewThread } from '../store'

type AgentChoice = Pick<ComposerSettings, 'model' | 'effort' | 'fast' | 'mode'>

const blank: ComposerSettings = { deviceId: '', agent: 'claude', model: '', effort: '', fast: false, mode: '', cwd: '' }

// StartHandled stops the composer from clearing the text or adding its own
// error line: the notice under the box already says what happened.
class StartHandled extends Error {
  constructor() { super('') }
}

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
  const [seed] = useState(params.get('prompt') ?? '')
  const online = useMemo(() => (devices ?? []).filter((device) => device.online), [devices])
  const [attempt, setAttempt] = useState<StartAttempt | null>(null)
  // A GitHub repo and branch chosen instead of a folder, and the machine
  // getting it ready once Send is pressed.
  const [source, setSource] = useState<RepoSource | null>(null)
  const [prep, setPrep] = useState<PrepareState | null>(null)
  const stopPrep = useRef<AbortController | null>(null)
  const { toast } = useShell()
  const selected = (devices ?? []).find((device) => device.id === settings.deviceId)

  useEffect(() => { setMode(params.get('mode') === 'terminal' ? 'terminal' : 'agent') }, [params])

  // A finished-badly prepare belongs to the choice it was for; and leaving the
  // page stops one that is still running.
  useEffect(() => { setPrep((current) => (current?.phase === 'failed' ? null : current)) }, [source, settings.deviceId])
  useEffect(() => () => stopPrep.current?.abort(), [])

  // Pick the machine: the requested one, else the last used, else (first
  // visit only) the hub or any online one. A chosen machine that goes offline
  // stays chosen and is shown as offline: work is never moved to another
  // computer behind your back.
  useEffect(() => {
    if (!devices) return
    const requested = params.get('device')
    const pick = [requested, settings.deviceId].find((id) => id && devices.some((device) => device.id === id))
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
    // A start that never happened no longer belongs to the old choice.
    if (attempt?.phase === 'failed' && (next.deviceId !== settings.deviceId || next.cwd !== settings.cwd)) setAttempt(null)
    setSettings(value)
    setDefaults(value)
  }

  // prepare has the machine check the chosen GitHub branch out and returns the
  // folder to run in. It reports its steps, can be cancelled, and never starts
  // the session itself.
  const prepare = async (from: RepoSource): Promise<string> => {
    const controller = new AbortController()
    stopPrep.current = controller
    const machine = selected?.name ?? 'this machine'
    setPrep({ phase: 'planning', repo: from.repo, branch: from.branch, machine })
    try {
      const known = knownClonePaths(devices ?? [], knownFolders(threads ?? []), from.repo, settings.deviceId)
      const result = await prepareCheckout(settings.deviceId, from, known, {
        signal: controller.signal,
        onPlan: (action) => setPrep((current) => (current ? { ...current, phase: 'working', action } : current)),
      })
      setPrep(null)
      probe(settings.deviceId, [result.path], true)
      update({ ...settings, cwd: result.path })
      if (result.note) toast(result.note)
      return result.path
    } catch (cause) {
      if (cause instanceof PrepareCancelled) setPrep(null)
      else setPrep({ phase: 'failed', repo: from.repo, branch: from.branch, machine, message: cause instanceof Error ? cause.message : '' })
      throw new StartHandled()
    } finally {
      if (stopPrep.current === controller) stopPrep.current = null
    }
  }

  // run starts the session under one idempotency key. When the answer is lost
  // it asks the hub whether the session exists, so it is never started twice.
  const run = async (input: NewThread, key: string, machine: string) => {
    const note = (phase: StartAttempt['phase'], message = '') => setAttempt({ key, input, machine, phase, message })
    note('sending')
    try {
      const thread = await createThread({ ...input, clientRequestId: key })
      setAttempt(null)
      navigate(`/sessions/${thread.id}`)
      return
    } catch (cause) {
      if (cause instanceof HeldError) { // a guardrail saved it under Scheduled
        setAttempt(null)
        toast(cause.message)
        return
      }
      if (!startUnknown(cause)) {
        note('failed', cause instanceof Error ? cause.message : '')
        throw new StartHandled()
      }
    }
    note('checking')
    try {
      const thread = await findStarted(key)
      if (thread) {
        setAttempt(null)
        navigate(`/sessions/${thread.id}`)
        return
      }
      note('failed')
    } catch {
      note('unknown')
    }
    throw new StartHandled()
  }

  const start = async (text: string, images?: { path: string }[]) => {
    // A start that may already be running is never replaced by a different
    // one: sending again retries that same request.
    if (mode !== 'terminal' && attempt?.phase === 'unknown') return run(attempt.input, attempt.key, attempt.machine)
    const effective = source ? { ...settings, cwd: await prepare(source) } : settings
    if (mode === 'terminal') {
      const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '')
      const name = `term-${stamp}`
      await api.post(`/api/devices/${effective.deviceId}/sessions`, { name, cwd: effective.cwd, command: text, kind: 'shell' })
      terminalsResource.refresh()
      navigate(`/machines/${effective.deviceId}?tab=terminal&session=${encodeURIComponent(name)}`)
      return
    }
    const kind = modeOf(builtinOptions(effective.agent), effective.mode)?.kind
    return run({
      deviceId: effective.deviceId,
      agent: effective.agent,
      cwd: effective.cwd,
      prompt: text || 'See the attached image.',
      images,
      model: effective.model || undefined,
      effort: effective.effort || undefined,
      fast: effective.fast || undefined,
      mode: effective.mode || undefined,
      access: accessForKind(kind),
    }, newRequestId(), selected?.name ?? 'this machine')
  }

  // schedule saves the session for later instead of starting it: the hub starts it.
  const schedule = async (text: string, images: { path: string }[] | undefined, when: LaterChoice) => {
    const kind = modeOf(builtinOptions(settings.agent), settings.mode)?.kind
    const known = source ? knownClonePaths(devices ?? [], knownFolders(threads ?? []), source.repo, settings.deviceId) : undefined
    const item = await scheduleSession({
      deviceId: settings.deviceId, agent: settings.agent, cwd: source ? '' : settings.cwd,
      source: source ? { repo: source.repo, branch: source.branch, known } : undefined,
      prompt: text || 'See the attached image.', images, model: settings.model || undefined, effort: settings.effort || undefined,
      fast: settings.fast || undefined, mode: settings.mode || undefined, access: accessForKind(kind), clientRequestId: newRequestId(),
    }, when)
    toast(when.kind === 'limit_reset' ? `Scheduled for when your limit resets (${inText(item.startsAt)})` : `Scheduled for ${whenText(item.startsAt).replace(/^(Today|Tomorrow)/, (word) => word.toLowerCase())}`)
  }

  if (devices && devices.length === 0) {
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
        <WrappedNudge />
        <div className="new-head">
          <div className="seg" role="group" aria-label="Mode">
            <button aria-pressed={mode === 'agent'} onClick={() => { setMode('agent'); setParams({}) }}>Agent</button>
            <button aria-pressed={mode === 'terminal'} onClick={() => setMode('terminal')}>Terminal</button>
            <button aria-pressed={false} title="Race several agents on one task" onClick={() => navigate(`/arena?${new URLSearchParams({ ...(settings.deviceId ? { device: settings.deviceId } : {}), ...(settings.cwd ? { cwd: settings.cwd } : {}) })}`)}>Arena</button>
          </div>
        </div>
        {mode === 'agent' && selected?.online && <AgentOnboarding deviceId={selected.id} deviceName={selected.name} />}
        {mode === 'agent' && selected?.online && <AuthNotice deviceId={selected.id} deviceName={selected.name} agent={settings.agent} />}
        <Composer
          autoFocus
          placeholder={mode === 'terminal' ? 'Command to run, or press Enter for a plain shell' : 'Ask Overseer to build features, fix bugs, or work on your code'}
          devices={devices ?? []}
          settings={settings}
          onSettings={update}
          onSubmit={start}
          onSchedule={mode === 'terminal' ? undefined : schedule}
          initialText={seed}
          agentOptional={mode === 'terminal'}
          blocked={selected ? !selected.online : false}
          context={<TargetStrip locked={(!!prep && prep.phase !== 'failed') || (!!attempt && attempt.phase !== 'failed')} devices={devices ?? []} threads={threads ?? []} settings={settings} onSettings={update} source={source} onSource={setSource} />}
        />
        {prep && <PrepareNotice prep={prep} onCancel={() => stopPrep.current?.abort()} onDismiss={() => setPrep(null)} />}
        {attempt && <StartNotice attempt={attempt} onRetry={() => { run(attempt.input, attempt.key, attempt.machine).catch(() => {}) }} onDiscard={() => setAttempt(null)} />}
      </div>
    </div>
  )
}
