import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { accessLevels, agentInfo, relativeTime } from '../agents'
import { useAgentsOn } from '../agentOptions'
import { AgentPicker } from '../components/AgentPicker'
import type { ComposerSettings } from '../components/Composer'
import Icon, { AgentMark } from '../components/Icon'
import { Menu, MenuItem } from '../components/Menu'
import { TargetStrip } from '../components/TargetPicker'
import { arenasResource, createArena, MAX_CONTESTANTS, MIN_CONTESTANTS, type Arena } from '../arena'
import { useShell } from '../shell'
import { usePref, useDevices, useThreads } from '../store'
import type { Device } from '../types'
import { buildGroups, knownFolders, probe, probeOf, siblingCandidates, tildePath, useFolderInfo, useWhereVersion } from '../where'
import { OsMark } from '../components/DeviceMark'

interface Slot {
  key: string
  deviceId: string // '' = the machine the repo was chosen on
  agent: string
  model: string
  effort: string
  fast: boolean
}

let slotCounter = 0
const newSlot = (agent: string): Slot => ({ key: `s${++slotCounter}`, deviceId: '', agent, model: '', effort: '', fast: false })

const checkSuggestions = ['npm test', 'go test ./...', 'pytest', 'cargo test']
const preferred = ['claude', 'codex', 'gemini', 'opencode', 'cursor', 'copilot', 'goose']

type Where = { deviceId: string; cwd: string }

export default function ArenaSetupPage() {
  const { value: devices } = useDevices()
  const { value: threads } = useThreads()
  const { value: past } = arenasResource.use()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { toast } = useShell()
  const [composer] = usePref<Partial<ComposerSettings>>('composer.defaults', {})
  const [prompt, setPrompt] = useState(params.get('prompt') ?? '')
  const [where, setWhere] = useState<Where>(() => ({ deviceId: params.get('device') ?? composer.deviceId ?? '', cwd: params.get('cwd') ?? composer.cwd ?? '' }))
  const [slots, setSlots] = useState<Slot[]>(() => [newSlot('claude'), newSlot('codex')])
  const [touched, setTouched] = useState(false)
  const [check, setCheck] = useState('')
  const [showCheck, setShowCheck] = useState(false)
  const [access, setAccess] = useState('auto')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const list = devices ?? []
  const online = useMemo(() => list.filter((device) => device.online), [list])

  // A machine that is not chosen yet: the hub, else any online one.
  useEffect(() => {
    if (!devices || list.some((device) => device.id === where.deviceId)) return
    const pick = online.find((device) => device.isHub) ?? online[0]
    if (pick) setWhere({ deviceId: pick.id, cwd: '' })
  }, [devices]) // eslint-disable-line react-hooks/exhaustive-deps

  // No folder yet: the repo used most recently on that machine.
  const folders = useMemo(() => knownFolders(threads ?? []), [threads])
  const version = useWhereVersion()
  useEffect(() => {
    if (!where.deviceId || where.cwd) return
    const recent = folders.filter((folder) => folder.deviceId === where.deviceId)
    const repo = recent.find((folder) => probeOf(where.deviceId, folder.path)?.info?.isRepo)
    if (repo) setWhere({ deviceId: where.deviceId, cwd: repo.path })
  }, [where.deviceId, where.cwd, folders, version])

  const origin = list.find((device) => device.id === where.deviceId)
  const { entry, loading, home } = useFolderInfo(where.deviceId, where.cwd, !!origin?.online)
  const info = entry?.info
  const isRepo = !!info?.isRepo

  // Which other machines hold a clone of this repo: those can run contestants too.
  useEffect(() => {
    for (const device of online) probe(device.id, folders.filter((folder) => folder.deviceId === device.id).map((folder) => folder.path))
  }, [online, folders])
  useEffect(() => {
    for (const [deviceId, paths] of siblingCandidates(folders, list)) probe(deviceId, paths)
  }, [version, list, folders]) // eslint-disable-line react-hooks/exhaustive-deps
  const clones = useMemo(() => {
    const out = new Map<string, string>()
    const key = info?.remoteKey
    if (!key) return out
    const group = buildGroups(list, folders).find((item) => item.remote === key)
    for (const place of group?.places ?? []) {
      const found = place.probe?.info
      if (!found?.isRepo || !found.exists || place.deviceId === where.deviceId || out.has(place.deviceId)) continue
      if (list.find((device) => device.id === place.deviceId)?.online) out.set(place.deviceId, found.resolved || place.path)
    }
    return out
  }, [info?.remoteKey, list, folders, version, where.deviceId]) // eslint-disable-line react-hooks/exhaustive-deps
  const cwdOn = (deviceId: string) => (!deviceId || deviceId === where.deviceId ? where.cwd : clones.get(deviceId) ?? where.cwd)
  const deviceOf = (slot: Slot) => (clones.has(slot.deviceId) ? slot.deviceId : where.deviceId)

  // Agents that are installed here, so the defaults are not ones that cannot run.
  const installed = useAgentsOn(where.deviceId)
  useEffect(() => {
    if (touched || !installed) return
    const ready = preferred.filter((id) => installed.find((agent) => agent.id === id)?.installed)
    if (ready.length < MIN_CONTESTANTS) return
    setSlots((current) => current.map((slot, index) => ({ ...slot, agent: ready[index] ?? slot.agent })))
  }, [installed, touched])

  const patch = (key: string, next: Partial<Slot>) => {
    setTouched(true)
    setSlots((current) => current.map((slot) => (slot.key === key ? { ...slot, ...next } : slot)))
  }
  const add = () => {
    setTouched(true)
    setSlots((current) => {
      const have = new Set(current.map((slot) => slot.agent))
      const next = preferred.find((id) => !have.has(id) && installed?.find((agent) => agent.id === id)?.installed) ?? preferred.find((id) => !have.has(id)) ?? 'claude'
      return [...current, newSlot(next)]
    })
  }

  const problem = !prompt.trim() ? 'Write the task for the agents.'
    : !origin ? 'Choose a machine.'
    : !origin.online ? `${origin.name} is offline.`
    : loading && !entry ? ''
    : !isRepo ? 'Choose a folder that is a git repository.'
    : ''

  const start = async () => {
    if (busy || problem) return
    setBusy(true)
    setError('')
    try {
      const arena = await createArena({
        prompt: prompt.trim(),
        deviceId: where.deviceId,
        cwd: where.cwd || '~',
        check: check.trim() || undefined,
        access,
        contestants: slots.map((slot) => ({ agent: slot.agent, model: slot.model || undefined, effort: slot.effort || undefined, fast: slot.fast || undefined, deviceId: deviceOf(slot), cwd: cwdOn(deviceOf(slot)) })),
      })
      navigate(`/arena/${arena.id}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start the arena')
      setBusy(false)
    }
  }

  const folder = where.cwd ? tildePath(where.cwd, home) : '~'
  const dirty = info?.dirty ?? 0
  const level = accessLevels.find((item) => item.id === access)
  const strip = (
    <TargetStrip devices={list} threads={threads ?? []} settings={{ deviceId: where.deviceId, cwd: where.cwd, agent: '', model: '', effort: '', fast: false, mode: '' }}
      onSettings={(next) => setWhere({ deviceId: next.deviceId, cwd: next.cwd })} source={null}
      onSource={(source) => { if (source) toast('Arenas run on a folder that is already on a machine. Pick a folder.') }} />
  )
  return (
    <div className="new-page as-page">
      <div className="new-wrap">
        <div className="new-head">
          <div className="seg" role="group" aria-label="Mode">
            <button aria-pressed={false} onClick={() => navigate('/')}>Agent</button>
            <button aria-pressed={false} onClick={() => navigate('/?mode=terminal')}>Terminal</button>
            <button aria-pressed>Arena</button>
          </div>
        </div>

        <form className="composer" onSubmit={(event) => { event.preventDefault(); start() }}>
          <textarea id="ar-prompt" rows={3} autoFocus value={prompt} onChange={(event) => setPrompt(event.target.value)} aria-label="Task for the agents"
            placeholder="Give several agents the same task, then keep the best result"
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); start() } }} />
          {(showCheck || check) && (
            <label className="as-checkrow" title="A command run in each copy when its agent finishes">
              <Icon name="check" size={14} /><span>Then run</span>
              <input autoFocus={!check} value={check} onChange={(event) => setCheck(event.target.value)} placeholder="npm test" spellCheck={false} aria-label="Check command, run when each agent finishes" list="as-checks" />
              <datalist id="as-checks">{checkSuggestions.map((item) => <option key={item} value={item} />)}</datalist>
              <button type="button" className="as-remove" aria-label="Remove the check" onClick={() => { setCheck(''); setShowCheck(false) }}><Icon name="close" size={12} /></button>
            </label>
          )}
          <div className="composer-bar as-bar">
            <Menu placement="top-start" width={250} trigger={<button type="button" className="ctl ctl-icon" aria-label="Add" title="Add"><Icon name="plus" size={17} /></button>}>
              {(close) => (
                <>
                  <MenuItem icon="check" label="Run a check afterwards" description="A command like npm test, run in each copy" onClick={() => { close(); setShowCheck(true) }} />
                </>
              )}
            </Menu>
          <div className="as-racers" aria-label="Agents">
            {slots.map((slot, index) => (
              <SlotRow key={slot.key} index={index} slot={slot} origin={where.deviceId} machine={deviceOf(slot)} machines={[where.deviceId, ...clones.keys()].map((id) => list.find((device) => device.id === id)).filter((device): device is Device => !!device)}
                pathOn={cwdOn} home={home} onChange={(next) => patch(slot.key, next)} onRemove={slots.length > MIN_CONTESTANTS ? () => { setTouched(true); setSlots((current) => current.filter((item) => item.key !== slot.key)) } : undefined} />
            ))}
            {slots.length < MAX_CONTESTANTS && <button type="button" className="ctl as-add" onClick={add} title="Add another agent"><Icon name="plus" size={13} /><span>Agent</span></button>}
          </div>
            <Menu placement="top-start" width={280} trigger={<button type="button" className="ctl" title="What the agents may do"><Icon name="shield" size={14} /><span>{level?.label ?? 'Permissions'}</span><Icon name="chevron-down" size={12} className="ctl-chev" /></button>}>
              {(close) => accessLevels.map((item) => <MenuItem key={item.id} label={item.label} description={item.description} checked={item.id === access} onClick={() => { setAccess(item.id); close() }} />)}
            </Menu>
            <span className="grow" />
            <button type="submit" className="send-round" aria-label="Start the arena" title={problem || 'Start (Enter)'} disabled={busy || !!problem}>
              {busy ? <span className="spinner" style={{ borderColor: 'transparent', borderTopColor: 'currentColor' }} /> : <Icon name="arrow-up" size={17} strokeWidth={2.1} />}
            </button>
          </div>
        </form>
        <div className="composer-context">{strip}</div>

        <p className={`as-note ${(info && !isRepo && !loading) || error ? 'is-warn' : ''}`}>
          {error ? error
            : info && !isRepo && !loading ? `${folder} is not a git repository. Pick the repo’s folder.`
            : isRepo && info ? `Each agent gets its own copy from the last commit on ${info.branch ?? 'HEAD'}${dirty > 0 ? `. Your ${dirty} uncommitted ${dirty === 1 ? 'change stays' : 'changes stay'} out` : ''}.`
            : ''}
        </p>

        {(past?.length ?? 0) > 0 && (
          <section className="as-past">
            <h2 className="as-past-title">Past arenas</h2>
            {past!.slice(0, 6).map((arena) => <PastRow key={arena.id} arena={arena} />)}
          </section>
        )}
      </div>
    </div>
  )
}

function SlotRow({ index, slot, origin, machine, machines, pathOn, home, onChange, onRemove }: {
  index: number; slot: Slot; origin: string; machine: string; machines: Device[]; pathOn: (deviceId: string) => string; home?: string; onChange: (next: Partial<Slot>) => void; onRemove?: () => void
}) {
  const settings: ComposerSettings = { deviceId: machine, agent: slot.agent, model: slot.model, effort: slot.effort, fast: slot.fast, mode: '', cwd: pathOn(machine) }
  const device = machines.find((item) => item.id === machine)
  return (
    <>
      {index > 0 && <span className="as-vs">vs</span>}
      <span className="as-racer">
        <AgentPicker settings={settings} onSettings={(next) => onChange({ agent: next.agent, model: next.model, effort: next.effort, fast: next.fast })} />
        {machines.length > 1 && (
          <Menu placement="bottom-start" width={260} trigger={<button type="button" className={`ctl as-machine ${machine === origin ? 'is-origin' : ''}`} title={`Runs on ${device?.name ?? 'this machine'}`} aria-label="Machine this agent runs on">{machine === origin ? <OsMark os={device?.os} size={14} /> : <><OsMark os={device?.os} size={14} /><span>{device?.name}</span></>}</button>}>
            {(close) => machines.map((item) => <MenuItem key={item.id} icon={<OsMark os={item.os} size={16} />} label={item.name} description={tildePath(pathOn(item.id), home)} checked={item.id === machine} onClick={() => { onChange({ deviceId: item.id === machines[0].id ? '' : item.id }); close() }} />)}
          </Menu>
        )}
        {onRemove && <button type="button" className="as-remove" aria-label={`Remove agent ${index + 1}`} onClick={onRemove}><Icon name="close" size={12} /></button>}
      </span>
    </>
  )
}

function PastRow({ arena }: { arena: Arena }) {
  const winner = arena.contestants.find((c) => c.n === arena.winner)
  const status = arena.status === 'finished' ? (winner ? `${agentInfo(winner.agent).name} won` : 'Pick a winner') : arena.status === 'preparing' ? 'Starting' : 'Running'
  return (
    <Link to={`/arena/${arena.id}`} className="as-past-row">
      <span className="as-marks">{arena.contestants.map((c) => <AgentMark key={c.n} agent={c.agent} size={15} />)}</span>
      <span className="as-past-name">{arena.title}</span>
      <span className="as-past-meta">{status} · {relativeTime(arena.createdAt)}</span>
    </Link>
  )
}
