import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { agentInfo, relativeTime } from '../agents'
import { notificationsAllowed, showNotice } from '../notify'
import {
  cancelScheduled, dismissNotice, fromLocalInput, inText, limitReset, loadGuardrails, saveGuardrails, startScheduledNow, toLocalInput, updateScheduled,
  useGuardNotices, useScheduleEvents, useScheduled, whenText, windowModel, type GuardCfg, type GuardNotice, type ScheduledItem,
} from '../schedule'
import { useShell } from '../shell'
import { useDevices, usePref } from '../store'
import { usePlanLimits } from '../usageLimits'
import { AgentPicker } from './AgentPicker'
import type { ComposerSettings } from './Composer'
import Icon, { AgentMark } from './Icon'
import { Switch } from './Menu'
import Modal from './Modal'

// ScheduleWatcher lives in the layout: it keeps the scheduled list current and
// says so (toast, and a system notice when those are on) when a guardrail acts
// or a scheduled session starts.
export function ScheduleWatcher() {
  const { toast } = useShell()
  const navigate = useNavigate()
  const [notify] = usePref('notify.enabled', false)
  useScheduleEvents(
    (notice) => {
      toast(notice.message.length > 120 ? `${notice.message.slice(0, 117)}…` : notice.message)
      if (notify && notificationsAllowed()) showNotice(notice.kind === 'pause' ? 'Paused by your guardrail' : notice.kind === 'hold' ? 'Held by your guardrail' : 'Scheduled session', notice.message, `guard-${notice.id}`, '/', () => { window.focus(); navigate('/') })
    },
    (threadId) => {
      toast('A scheduled session started')
      if (notify && notificationsAllowed() && document.visibilityState !== 'visible') showNotice('Scheduled session started', 'Open it to follow along.', `sched-${threadId}`, `/sessions/${threadId}`, () => { window.focus(); navigate(`/sessions/${threadId}`) })
    },
  )
  return null
}

// ---- sidebar ----

// GuardrailNotices are amber, like "Needs you": a guardrail held or paused
// something and the person should know. They stay until dismissed.
export function GuardrailNotices() {
  const { value: notices } = useGuardNotices()
  const [collapsed, setCollapsed] = useState(true)
  if (!notices?.length) return null
  return (
    <>
      <div className="sessions-sub sessions-sub-inline sessions-needs">
        <button onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed} style={{ color: 'inherit' }}><Icon name="shield" size={16} />Guardrails<span className="sc-count sc-count-amber">{notices.length}</span></button>
      </div>
      {!collapsed && notices.map((notice) => (
        <div key={notice.id} className="sc-notice" role="status">
          <span className="sc-notice-icon"><AgentMark agent={notice.agent} size={14} /></span>
          <p title={notice.message}><strong>{noticeHead(notice)}</strong><span>{noticeBody(notice)}</span></p>
          <button className="icon-btn icon-btn-sm" aria-label="Dismiss" title="Dismiss" onClick={() => dismissNotice(notice.id)}><Icon name="close" size={14} /></button>
        </div>
      ))}
    </>
  )
}

function noticeHead(notice: GuardNotice) {
  const pct = notice.percent ? `${Math.round(notice.percent)}%` : ''
  if (notice.kind === 'hold') return 'Held until the limit resets'
  if (notice.kind === 'pause') return pct ? `Paused at ${pct}` : 'Paused'
  return 'Couldn’t start a scheduled session'
}

function noticeBody(notice: GuardNotice) {
  const who = `${agentInfo(notice.agent).name} weekly limit${notice.deviceName ? ` on ${notice.deviceName}` : ''}`
  if (notice.kind === 'failed') return notice.message.replace(/^Couldn.t start the scheduled session: /, '')
  return `${notice.title ? `“${notice.title}” · ` : ''}${who}${notice.percent ? ` is at ${Math.round(notice.percent)}%` : ''}`
}

// ScheduledGroup lists sessions waiting for their time or for a limit to reset.
export function ScheduledGroup() {
  const { value: items } = useScheduled()
  const [open, setOpen] = usePref('sidebar.scheduledOpen', false)
  const [editing, setEditing] = useState<string | null>(null)
  const list = (items ?? []).filter((item) => item.status !== 'started')
  const current = list.find((item) => item.id === editing)
  useEffect(() => { if (editing && !current) setEditing(null) }, [editing, current])
  if (!list.length) return null
  return (
    <>
      <div className="sessions-sub sessions-sub-inline">
        <button onClick={() => setOpen(!open)} aria-expanded={open}><Icon name="clock" size={16} />Scheduled<span className="sc-count">{list.length}</span></button>
      </div>
      {open && list.map((item) => <ScheduledRow key={item.id} item={item} onOpen={() => setEditing(item.id)} />)}
      {current && <ScheduledEditor item={current} onClose={() => setEditing(null)} />}
    </>
  )
}

export function whenLine(item: ScheduledItem) {
  if (item.trigger.kind === 'time') return whenText(item.trigger.at)
  return item.startsAt ? `Resets ${inText(item.startsAt)}` : 'When the limit resets'
}

function ScheduledRow({ item, onOpen }: { item: ScheduledItem; onOpen: () => void }) {
  const { toast } = useShell()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const failed = item.status === 'failed'
  const startNow = async () => {
    setBusy(true)
    try {
      const started = await startScheduledNow(item.id)
      if (started.threadId) navigate(`/sessions/${started.threadId}`)
      else toast('Starting…')
    } catch (cause) { toast(cause instanceof Error ? cause.message : 'Could not start it') } finally { setBusy(false) }
  }
  const cancel = async () => {
    if (!confirm(`Cancel “${item.title}”? It will not start.`)) return
    try { await cancelScheduled(item.id) } catch (cause) { toast(cause instanceof Error ? cause.message : 'Could not cancel it') }
  }
  const meta = failed
    ? <span className="err">Couldn’t start</span>
    : item.status === 'starting' ? <span className="shimmer">{item.note || 'Starting'}</span>
      : item.note ? <span className="warn truncate">{item.note.startsWith('Waiting for') ? `${item.deviceName} is offline` : item.note}</span> : <span className="truncate">{whenLine(item)}</span>
  return (
    <div className="session-row-wrap sc-row-wrap">
      <button className="session-row" onClick={onOpen} title={failed ? item.error : `${item.title} · ${item.deviceName}`}>
        <span className="session-row-lead">{failed ? <span className="dot dot-red" style={{ width: 6, height: 6 }} /> : <Icon name={item.reason === 'guardrail' ? 'shield' : 'clock'} size={13} />}</span>
        <span className="session-row-body">
          <span className="session-row-title">{item.title}</span>
          <span className="session-row-meta">{meta}<span className="sep">·</span><span className="truncate">{agentInfo(item.agent).name}</span></span>
        </span>
      </button>
      <span className="session-row-actions">
        <button className="icon-btn icon-btn-sm" aria-label="Start now" title={failed ? 'Try again now' : 'Start now'} disabled={busy} onClick={startNow}><Icon name="play" size={14} /></button>
        <button className="icon-btn icon-btn-sm" aria-label="Edit" title="Edit" onClick={onOpen}><Icon name="edit" size={14} /></button>
        <button className="icon-btn icon-btn-sm" aria-label="Cancel" title="Cancel" onClick={cancel}><Icon name="close" size={14} /></button>
      </span>
    </div>
  )
}

// ---- edit ----

function ScheduledEditor({ item, onClose }: { item: ScheduledItem; onClose: () => void }) {
  const { toast } = useShell()
  const navigate = useNavigate()
  const { accounts } = usePlanLimits()
  const [settings, setSettings] = useState<ComposerSettings>({ deviceId: item.deviceId, agent: item.agent, model: item.model ?? '', effort: item.effort ?? '', fast: !!item.fast, mode: item.mode ?? '', cwd: item.cwd })
  const [prompt, setPrompt] = useState(item.prompt)
  const [kind, setKind] = useState<'time' | 'limit_reset'>(item.trigger.kind)
  const [at, setAt] = useState(toLocalInput(item.trigger.kind === 'time' ? item.trigger.at : Math.floor(Date.now() / 1000) + 3600))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const reset = limitReset(accounts, item.deviceId, settings.agent, settings.model)
  const canLimit = kind === 'limit_reset' || !!reset || item.trigger.kind === 'limit_reset'
  const atSec = fromLocalInput(at)
  const bad = !prompt.trim() || (kind === 'time' && atSec <= Math.floor(Date.now() / 1000))

  const save = async () => {
    setBusy('save')
    setError('')
    try {
      await updateScheduled(item.id, {
        prompt, agent: settings.agent, model: settings.model, effort: settings.effort, fast: settings.fast, mode: settings.mode,
        trigger: kind === 'time' ? { kind: 'time', at: atSec } : { kind: 'limit_reset' },
      })
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save'); setBusy('') }
  }
  const startNow = async () => {
    setBusy('start')
    setError('')
    try {
      const started = await startScheduledNow(item.id)
      onClose()
      if (started.threadId) navigate(`/sessions/${started.threadId}`)
      else toast('Starting…')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not start it'); setBusy('') }
  }
  const cancel = async () => {
    if (!confirm('Cancel this scheduled session? It will not start.')) return
    setBusy('cancel')
    try { await cancelScheduled(item.id); onClose() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not cancel it'); setBusy('') }
  }

  return (
    <Modal
      title="Scheduled session"
      onClose={onClose}
      wide
      footer={(
        <>
          <button className="btn btn-ghost sc-danger" onClick={cancel} disabled={!!busy}>Cancel session</button>
          <span className="flex-1" />
          <button className="btn btn-outline" onClick={startNow} disabled={!!busy}>{busy === 'start' && <span className="spinner" />}Start now</button>
          <button className="btn btn-dark" onClick={save} disabled={!!busy || bad}>{busy === 'save' && <span className="spinner" />}Save</button>
        </>
      )}
    >
      <div className="sc-editor">
        {item.reason === 'guardrail' && <p className="sc-banner"><Icon name="shield" size={15} />Held by your guardrail. It starts when the limit resets.</p>}
        {item.status === 'failed' && <p className="sc-banner sc-banner-red"><Icon name="alert" size={15} />Couldn’t start: {item.error || 'unknown error'}. Save to try again at the time below.</p>}
        {item.note && item.status === 'waiting' && <p className="sc-banner"><Icon name="alert" size={15} />{item.note}.</p>}
        <p className="sc-where"><Icon name="monitor" size={14} />{item.deviceName}{item.source ? ` · ${item.source.repo} (${item.source.branch})` : item.cwd ? ` · ${item.cwd}` : ''}</p>
        <label className="sc-field">
          <span>Prompt</span>
          <textarea className="textarea sc-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={6} />
        </label>
        {(item.images?.length ?? 0) > 0 && <p className="hint">{item.images!.length} attached image{item.images!.length === 1 ? '' : 's'} will be sent with it.</p>}
        <div className="sc-field">
          <span>Agent</span>
          <div><AgentPicker settings={settings} onSettings={setSettings} /></div>
        </div>
        <div className="sc-field">
          <span>Start</span>
          <div className="seg sc-seg" role="group" aria-label="When">
            <button type="button" aria-pressed={kind === 'time'} onClick={() => setKind('time')}>At a time</button>
            <button type="button" aria-pressed={kind === 'limit_reset'} disabled={!canLimit} title={canLimit ? undefined : 'Only when this limit is high'} onClick={() => setKind('limit_reset')}>When my limit resets</button>
          </div>
          {kind === 'time'
            ? <input className="input sc-when" type="datetime-local" value={at} min={toLocalInput(Math.floor(Date.now() / 1000))} onChange={(event) => setAt(event.target.value)} />
            : <p className="hint">{item.trigger.kind === 'limit_reset' && item.startsAt ? `The ${item.trigger.windowLabel?.toLowerCase() ?? ''} limit resets ${inText(item.startsAt)} (${whenText(item.startsAt)}). The hub checks it again then.` : reset ? `The ${reset.window.label.toLowerCase()} limit resets ${inText(reset.resetsAt)}.` : 'Starts when the limit resets.'}</p>}
        </div>
        <p className="hint">Added {relativeTime(item.createdAt)}. Starts on the machine above, which must be online.</p>
        {error && <p className="text-[13px] text-danger" role="alert">{error}</p>}
      </div>
    </Modal>
  )
}

// ---- settings ----

const guardAgents = ['claude', 'codex']
const blankGuard: GuardCfg = { holdEnabled: false, holdPercent: 90, pauseEnabled: false, pausePercent: 98 }

// GuardrailsSection is on Settings → Usage & Limits.
export function GuardrailsSection() {
  const { accounts } = usePlanLimits()
  const { value: devices } = useDevices()
  const [cfg, setCfg] = useState<Record<string, GuardCfg> | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const timer = useRef<number>()
  useEffect(() => { loadGuardrails().then(setCfg).catch((cause) => setError(cause instanceof Error ? cause.message : 'Couldn’t load guardrails')) }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const change = (agent: string, patch: Partial<GuardCfg>) => {
    if (!cfg) return
    const next = { ...cfg, [agent]: { ...(cfg[agent] ?? blankGuard), ...patch } }
    setCfg(next)
    setSaved(false)
    setError('')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      saveGuardrails(next).then(() => setSaved(true)).catch((cause) => setError(cause instanceof Error ? cause.message : 'Couldn’t save'))
    }, 450)
  }
  // The most-used weekly window across machines, to show where you stand.
  const weekly = (agent: string) => {
    let best: { percent: number; machine: string } | null = null
    for (const item of accounts ?? []) {
      if (item.agent !== agent) continue
      for (const window of item.windows ?? []) {
        if (!/week|seven|secondary/i.test(`${window.id} ${window.label}`) || windowModel(window)) continue
        if (!best || window.usedPercent > best.percent) best = { percent: window.usedPercent, machine: item.deviceName }
      }
    }
    return best
  }
  const present = guardAgents.filter((agent) => (accounts ?? []).some((item) => item.agent === agent) || (devices ?? []).length === 0)
  const shown = present.length ? present : guardAgents
  return (
    <section className="mt-7">
      <h2 className="settings-h2" style={{ marginTop: 0 }}>Guardrails</h2>
      <p className="hint mt-1">Keep a subscription from running dry. Both are off until you turn them on, and they watch the weekly limit.</p>
      {!cfg ? <div className="skeleton mt-4 h-32 rounded-xl" /> : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {shown.map((agent) => {
            const value = cfg[agent] ?? blankGuard
            const now = weekly(agent)
            return (
              <div key={agent} className="limit-card">
                <div className="limit-card-head">
                  <AgentMark agent={agent} size={18} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-ink">{agentInfo(agent).name}</div>
                    <div className="truncate text-[12.5px] text-muted">{now ? `Weekly limit at ${Math.round(now.percent)}% on ${now.machine}` : 'No weekly limit reported yet'}</div>
                  </div>
                </div>
                <div className="sc-guard">
                  <GuardRow
                    label="Hold new sessions at" enabled={value.holdEnabled} percent={value.holdPercent}
                    onEnabled={(holdEnabled) => change(agent, { holdEnabled })} onPercent={(holdPercent) => change(agent, { holdPercent })}
                    hint="A new session waits in Scheduled and starts when the limit resets."
                    name={`${agentInfo(agent).name} hold`}
                  />
                  <GuardRow
                    label="Pause running sessions at" enabled={value.pauseEnabled} percent={value.pausePercent}
                    onEnabled={(pauseEnabled) => change(agent, { pauseEnabled })} onPercent={(pausePercent) => change(agent, { pausePercent })}
                    hint="Stops the current turn like the Stop button. Sessions are never ended."
                    name={`${agentInfo(agent).name} pause`}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
      <p className="hint mt-3" aria-live="polite">{error ? <span className="text-danger">{error}</span> : saved ? 'Saved.' : 'Changes save by themselves.'}</p>
    </section>
  )
}

function GuardRow({ label, enabled, percent, onEnabled, onPercent, hint, name }: { label: string; enabled: boolean; percent: number; onEnabled: (on: boolean) => void; onPercent: (value: number) => void; hint: string; name: string }) {
  const [text, setText] = useState(String(percent))
  useEffect(() => { setText(String(percent)) }, [percent])
  const commit = () => {
    const value = Math.round(Number(text))
    if (!Number.isFinite(value) || value < 1 || value > 100) { setText(String(percent)); return }
    if (value !== percent) onPercent(value)
  }
  return (
    <div className={`sc-guard-row ${enabled ? '' : 'is-off'}`}>
      <div className="sc-guard-line">
        <Switch checked={enabled} onChange={onEnabled} label={label} />
        <span className="sc-guard-label">{label}</span>
        <input
          className="input sc-pct" type="number" inputMode="numeric" min={1} max={100} value={text} aria-label={`${name} percent`} disabled={!enabled}
          onChange={(event) => setText(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') commit() }}
        />
        <span className="sc-guard-unit">%</span>
      </div>
      <p className="hint">{hint}</p>
    </div>
  )
}
