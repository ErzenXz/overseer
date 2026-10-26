import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../api'
import { agentInfo } from '../agents'
import {
  agentLabel, checkPassed, cleanUpArena, costOf, elapsedMs, finishedWell, fmtCost, fmtTime, fmtTokens, forgetArena, highlights, highlightText, isFinal, isLive, modelLabel,
  patchUrl, pickWinner, shareText, stopArena, totalTokens, tweetUrl, useArena, type Arena, type ArenaContestant, type Highlight,
} from '../arena'
import { canvasBlob, renderArenaCard } from '../arenaCard'
import { ActivityLine } from '../components/Work'
import Icon, { AgentMark } from '../components/Icon'
import Markdown from '../components/Markdown'
import { Menu, MenuItem } from '../components/Menu'
import Modal from '../components/Modal'
import { buildSegments, currentActivity } from '../lib/steps'
import { useNow } from '../lib/useNow'
import { mockEnabled } from '../mock'
import { isMockArenaThread, mockArenaStream } from '../mockArena'
import { useShell } from '../shell'
import { openThreadStream, useDevices, type StreamEvent } from '../store'
import type { Thread, ThreadMessage } from '../types'
import { tildePath, useFolderInfo } from '../where'
import ArenaSetupPage from './ArenaSetupPage'

// /arena sets one up; /arena/<id> is the race: a column per contestant while
// they work, a scoreboard when they are done, then the choice of what to keep.
export default function ArenaRoot() {
  const { id } = useParams()
  return id ? <ArenaView id={id} /> : <ArenaSetupPage />
}

const short = (commit: string) => commit.slice(0, 7)
const repoName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path

function ArenaView({ id }: { id: string }) {
  const { arena, error, set, refresh } = useArena(id)
  const navigate = useNavigate()
  const { toast } = useShell()
  const [pick, setPick] = useState<number | null>(null)
  const [share, setShare] = useState(false)
  const [cleanup, setCleanup] = useState(false)
  const [forget, setForget] = useState(false)
  const [stopping, setStopping] = useState(false)
  const { value: devices } = useDevices()

  if (!arena) {
    return (
      <div className="main-scroll"><div className="page ar-page">
        {error ? <div className="empty-state"><h2>Arena not found</h2><p>{error}</p><Link to="/arena" className="btn btn-dark">New arena</Link></div> : <div className="skeleton h-40" />}
      </div></div>
    )
  }

  const finished = arena.status === 'finished'
  const device = devices?.find((item) => item.id === arena.deviceId)
  const winner = arena.contestants.find((c) => c.n === arena.winner)
  const stop = async () => {
    setStopping(true)
    try { set(await stopArena(arena.id)) } catch (cause) { toast(cause instanceof Error ? cause.message : 'Could not stop') }
    setStopping(false)
  }
  const doneCount = arena.contestants.filter(isFinal).length
  return (
    <div className="main-scroll">
      <div className="page ar-page">
        <Link to="/arena" className="ar-back"><Icon name="arrow-left" size={14} />Arena</Link>
        <div className="ar-head">
          <div className="min-w-0">
            <h1 className="page-title ar-title">{arena.title}</h1>
            <p className="ar-sub">
              {arena.contestants.length} agents · {repoName(arena.cwd)} on {arena.deviceName || device?.name} · from {arena.baseBranch || short(arena.baseCommit)}
              {!finished && <> · {doneCount} of {arena.contestants.length} done</>}
            </p>
          </div>
          <div className="ar-head-actions">
            {!finished && <button type="button" className="btn btn-ghost btn-sm" disabled={stopping} onClick={stop}><Icon name="stop" size={14} />Stop all</button>}
            {finished && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShare(true)}><Icon name="external" size={14} />Share</button>}
            <Menu placement="bottom-end" width={220} trigger={<button type="button" className="icon-btn" aria-label="More"><Icon name="more" size={18} /></button>}>
              {(close) => (
                <>
                  <MenuItem icon="refresh" label="Refresh" onClick={() => { close(); refresh() }} />
                  <MenuItem icon="trash" label="Forget this arena" danger onClick={() => { close(); setForget(true) }} />
                </>
              )}
            </Menu>
          </div>
        </div>

        <p className="ar-task" title={arena.prompt}>{arena.prompt}</p>
        {(arena.dirtyAtStart ?? 0) > 0 && (
          <p className="ar-note">Your {arena.dirtyAtStart} uncommitted {arena.dirtyAtStart === 1 ? 'change was' : 'changes were'} not copied. Every agent started from the last commit.</p>
        )}

        {winner && <WinnerBanner arena={arena} winner={winner} onCleanup={() => setCleanup(true)} />}

        <Lineup arena={arena} finished={finished} onPick={(n) => setPick(n)} />
      </div>

      {pick !== null && arena.contestants.find((c) => c.n === pick) && (
        <PickModal arena={arena} c={arena.contestants.find((c) => c.n === pick)!} onClose={() => setPick(null)} onDone={(next) => { set(next); setPick(null) }} />
      )}
      {share && <ShareModal arena={arena} onClose={() => setShare(false)} />}
      {cleanup && <CleanupModal arena={arena} onClose={() => setCleanup(false)} onDone={(next) => { set(next); setCleanup(false); toast('Removed the extra copies') }} />}
      {forget && (
        <Modal title="Forget this arena?" onClose={() => setForget(false)} footer={
          <>
            <button className="btn btn-outline" onClick={() => setForget(false)}>Cancel</button>
            <button className="btn btn-danger" onClick={async () => { await forgetArena(arena.id).catch(() => {}); navigate('/arena') }}>Forget</button>
          </>
        }>
          <p className="ar-modal-text">This removes the arena from Overseer. The sessions, and any copies and branches still on your machines, are not touched. Use Clean up first to remove those.</p>
        </Modal>
      )}
    </div>
  )
}

// ---- live thread ----

// useLive follows one contestant's session: its steps while it works, its
// answer after. The socket closes once the contestant is final and loaded.
function useLive(threadId: string | undefined, final: boolean) {
  const [thread, setThread] = useState<Thread | null>(null)
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [loaded, setLoaded] = useState(false)
  const stop = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (!threadId) return
    setThread(null)
    setMessages([])
    setLoaded(false)
    const onEvent = (event: StreamEvent) => {
      if (event.type === 'snapshot') {
        setThread(event.thread)
        setMessages([...event.messages].sort((a, b) => a.seq - b.seq))
        setLoaded(true)
      } else if (event.type === 'thread') setThread(event.thread)
      else if (event.type === 'message') {
        setMessages((current) => {
          const index = current.findIndex((message) => message.id === event.message.id)
          if (index === -1) return [...current, event.message].sort((a, b) => a.seq - b.seq)
          const next = current.slice()
          next[index] = event.message
          return next
        })
      }
    }
    stop.current = mockEnabled && isMockArenaThread(threadId) ? mockArenaStream(threadId, onEvent) : openThreadStream(threadId, onEvent, () => {})
    return () => { stop.current?.(); stop.current = null }
  }, [threadId])
  useEffect(() => {
    if (final && loaded) { stop.current?.(); stop.current = null }
  }, [final, loaded])
  return { thread, messages, loaded }
}

function finalAnswer(messages: ThreadMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role === 'user' && !message.queued) break
    if (message.role === 'assistant' && message.text.trim()) return message.text
  }
  return ''
}

// ---- the lineup: one row per agent ----

function Lineup({ arena, finished, onPick }: { arena: Arena; finished: boolean; onPick: (n: number) => void }) {
  const tags = finished ? highlights(arena) : new Map<number, Highlight[]>()
  return (
    <section className="ar-lineup" aria-label="Agents">
      <div className="ar-row ar-row-head" aria-hidden="true">
        <span>Agent</span><span>Time</span><span>Changes</span>{arena.check ? <span>Check</span> : <span />}<span>Cost</span><span />
      </div>
      {arena.contestants.map((c) => <Racer key={c.n} arena={arena} c={c} tags={tags.get(c.n) ?? []} canPick={finished && c.state === 'done' && !c.removed} onPick={() => onPick(c.n)} />)}
    </section>
  )
}

function Racer({ arena, c, tags, canPick, onPick }: { arena: Arena; c: ArenaContestant; tags: Highlight[]; canPick: boolean; onPick: () => void }) {
  const [open, setOpen] = useState(false)
  const final = isFinal(c)
  const { thread: live, messages, loaded } = useLive(c.threadId, final)
  const running = isLive(c) || c.state === 'checking' || c.state === 'preparing'
  const now = useNow(running)
  const thread = live ?? c.thread
  const segments = useMemo(() => buildSegments(messages, !final), [messages, final])
  const activity = c.state === 'running' && thread ? currentActivity(segments, thread.status, c.deviceName, now) : null
  const answer = final ? finalAnswer(messages) : ''
  const waiting = thread?.status === 'waiting' && c.state === 'running'
  const won = arena.winner === c.n
  const passed = checkPassed(arena, c)
  const tokens = totalTokens({ ...c, thread })
  const cost = costOf({ ...c, thread })
  const sameMachine = c.deviceId === arena.deviceId
  const tag = (name: Highlight) => tags.includes(name) && <span className="ar-tag">{highlightText[name].toLowerCase()}</span>
  const status = waiting ? <span className="ar-live is-warn">Needs your approval · <Link to={`/sessions/${c.threadId}`} className="link">open</Link></span>
    : c.state === 'preparing' ? <span className="ar-live">Making its own copy…</span>
    : c.state === 'checking' ? <span className="ar-live">Running {arena.check}…</span>
    : c.state === 'running' ? (activity ? <ActivityLine activity={activity} /> : <span className="ar-live">Working…</span>)
    : c.state === 'failed' ? <span className="ar-live is-bad">{c.error || 'Stopped before finishing'}</span>
    : null
  return (
    <div className={`ar-racer ${won ? 'is-winner' : ''} ${open ? 'is-open' : ''}`}>
      <div className="ar-row">
        <button type="button" className="ar-who" onClick={() => setOpen(!open)} aria-expanded={open}>
          <AgentMark agent={c.agent} size={18} />
          <span className="min-w-0">
            <span className="ar-name">{agentLabel(c.agent)}{won && <span className="ar-won-tag">Winner</span>}</span>
            <span className="ar-model">{[modelLabel(c) || agentInfo(c.agent).vendor, !sameMachine ? c.deviceName : ''].filter(Boolean).join(' · ')}</span>
          </span>
          <Icon name="chevron-down" size={13} className="ar-chev" />
        </button>
        <span className="ar-cell" data-label="Time">{c.state === 'failed' ? <span className="ar-no">failed</span> : <>{fmtTime(elapsedMs(c, now))}{tag('fastest')}</>}</span>
        <span className="ar-cell" data-label="Changes">{c.stats ? (c.stats.files === 0 ? <span className="ar-muted">none</span> : <><b className="ar-add">+{c.stats.additions}</b> <b className="ar-del">−{c.stats.deletions}</b>{tag('smallest')}</>) : running ? null : <span className="ar-muted">–</span>}</span>
        <span className="ar-cell" data-label="Check">{arena.check ? (passed === undefined ? (running ? null : <span className="ar-muted">–</span>) : passed ? <span className="ar-pass"><Icon name="check" size={13} />passed</span> : <span className="ar-no"><Icon name="close" size={13} />failed</span>) : null}</span>
        <span className="ar-cell" data-label="Cost">{cost > 0 ? fmtCost(cost) : tokens > 0 ? fmtTokens(tokens) : <span className="ar-muted">–</span>}{tag('cheapest')}</span>
        <span className="ar-cell ar-act">{canPick && <button type="button" className={`btn btn-sm ${won ? 'btn-ghost' : finishedWell(arena, c) ? 'btn-outline' : 'btn-ghost'}`} onClick={onPick}>{won ? 'Change' : 'Pick'}</button>}</span>
      </div>
      {status && <div className="ar-status">{status}</div>}
      {open && (
        <div className="ar-detail">
          {answer ? <div className="ar-answer"><Markdown text={answer} /></div> : final && loaded ? <p className="ar-muted">It did not write a final message.</p> : !final ? <p className="ar-muted">The answer shows here when it finishes.</p> : null}
          {c.check && (c.check.output || c.check.error) && (
            <div className="ar-out"><div className="ar-out-cmd">{arena.check} · exit {c.check.exitCode}</div><pre>{c.check.error || c.check.output}</pre></div>
          )}
          <div className="ar-detail-foot">
            {c.stats && c.stats.files > 0 && <span className="ar-muted">{c.stats.files} file{c.stats.files === 1 ? '' : 's'} changed{tokens > 0 ? ` · ${fmtTokens(tokens)} tokens` : ''}</span>}
            <span className="grow" />
            {c.removed && <span className="ar-muted">Copy removed</span>}
            {c.threadId && <Link to={`/sessions/${c.threadId}`} className="btn btn-ghost btn-sm">Open session<Icon name="arrow-up-right" size={14} /></Link>}
          </div>
        </div>
      )}
    </div>
  )
}

// ---- the winner ----

function WinnerBanner({ arena, winner, onCleanup }: { arena: Arena; winner: ArenaContestant; onCleanup: () => void }) {
  const outcome = arena.outcome
  const others = arena.contestants.filter((c) => c.n !== winner.n && c.worktree && !c.removed).length
  return (
    <div className="ar-won" role="status">
      <span className="ar-won-ico"><Icon name={outcome === 'pr' ? 'pull-request' : 'check'} size={18} /></span>
      <div className="min-w-0 flex-1">
        <div className="ar-won-title">{agentLabel(winner.agent)} won</div>
        <div className="ar-won-text">
          {outcome === 'pr' && (arena.outcomeUrl ? <>Pull request opened: <a href={arena.outcomeUrl} target="_blank" rel="noreferrer" className="link">{arena.outcomeUrl.replace(/^https?:\/\//, '')}</a></> : 'Branch pushed.')}
          {outcome === 'applied' && (arena.outcomeNote || 'Applied to your folder.')}
          {outcome === 'kept' && (arena.outcomeNote || `Kept the branch ${winner.branch}.`)}
          {outcome !== 'kept' && arena.outcomeNote && outcome === 'pr' && <> {arena.outcomeNote}</>}
        </div>
      </div>
      {others > 0 && !arena.cleaned && <button type="button" className="btn btn-outline btn-sm" onClick={onCleanup}><Icon name="trash" size={14} />Clean up</button>}
      {arena.cleaned && <span className="ar-muted">Cleaned up</span>}
    </div>
  )
}

type Action = 'pr' | 'apply' | 'keep'

function PickModal({ arena, c, onClose, onDone }: { arena: Arena; c: ArenaContestant; onClose: () => void; onDone: (arena: Arena) => void }) {
  const [busy, setBusy] = useState<Action | null>(null)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const online = useDevices().value?.find((device) => device.id === arena.deviceId)?.online ?? false
  const { entry } = useFolderInfo(arena.deviceId, arena.cwd, online)
  const live = entry?.info?.dirty ?? 0
  const same = c.deviceId === arena.deviceId
  const why = !same ? `${agentLabel(c.agent)} ran on ${c.deviceName}. Open a pull request or download the patch.`
    : live > 0 || dirty ? `Your folder has ${live || 'some'} uncommitted ${live === 1 ? 'change' : 'changes'}. Commit or stash them to apply, or open a pull request.` : ''
  const run = async (action: Action) => {
    setBusy(action)
    setError('')
    try { onDone(await pickWinner(arena.id, c.n, action)) } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409 && action === 'apply') setDirty(true)
      setError(cause instanceof Error ? cause.message : 'That did not work')
      setBusy(null)
    }
  }
  const option = ({ action, icon, title, text, disabled, note }: { action: Action; icon: 'pull-request' | 'download' | 'git-branch'; title: string; text: string; disabled?: boolean; note?: string }) => (
    <button type="button" className="ar-option" disabled={!!busy || disabled} onClick={() => run(action)}>
      <span className="ar-option-ico">{busy === action ? <span className="spinner" /> : <Icon name={icon} size={18} />}</span>
      <span className="min-w-0 flex-1"><span className="ar-option-title">{title}</span><span className="ar-option-text">{note || text}</span></span>
    </button>
  )
  return (
    <Modal title={`Use ${agentLabel(c.agent)}’s result`} onClose={() => { if (!busy) onClose() }}>
      <p className="ar-modal-text">{c.stats && c.stats.files > 0 ? `${c.stats.files} file${c.stats.files === 1 ? '' : 's'} changed, +${c.stats.additions} −${c.stats.deletions}.` : 'It made no changes.'} Pick what happens with them.</p>
      <div className="ar-options">
        {option({ action: 'pr', icon: 'pull-request', title: 'Open a pull request', text: `Pushes ${c.branch} from ${c.deviceName} and opens a pull request with the GitHub CLI.` })}
        {option({ action: 'apply', icon: 'download', title: 'Apply to my folder', text: `Puts the changes into ${tildePath(arena.cwd)} as uncommitted edits.`, disabled: !same || live > 0 || dirty, note: why || undefined })}
        {option({ action: 'keep', icon: 'git-branch', title: 'Keep the branch', text: `Saves the work on ${c.branch} in its own folder on ${c.deviceName}. Nothing else changes.` })}
      </div>
      {error && <p className="ar-err ar-modal-err">{error}</p>}
      <a className="ar-patch" href={patchUrl(arena.id, c.n)} download>
        <Icon name="download" size={14} />Download as a patch
      </a>
    </Modal>
  )
}

function CleanupModal({ arena, onClose, onDone }: { arena: Arena; onClose: () => void; onDone: (arena: Arena) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [also, setAlso] = useState(false)
  const winner = arena.contestants.find((c) => c.n === arena.winner)
  const canAlso = arena.outcome === 'applied' || arena.outcome === 'pr'
  const gone = arena.contestants.filter((c) => c.worktree && !c.removed && (c.n !== arena.winner || (also && canAlso)))
  return (
    <Modal title="Clean up the arena" onClose={() => { if (!busy) onClose() }} footer={
      <>
        <button className="btn btn-outline" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="btn btn-danger" disabled={busy || gone.length === 0} onClick={async () => {
          setBusy(true)
          setError('')
          try { onDone(await cleanUpArena(arena.id, also && canAlso)) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not clean up'); setBusy(false) }
        }}>{busy ? <><span className="spinner" />Removing…</> : `Remove ${gone.length} cop${gone.length === 1 ? 'y' : 'ies'}`}</button>
      </>
    }>
      <p className="ar-modal-text">This deletes these copies of the repo and their branches. It only touches folders Overseer made for this arena. Your own folder{winner && !also ? ` and ${agentLabel(winner.agent)}’s copy` : ''} stay{winner && !also ? '' : 's'} as they are.</p>
      <ul className="ar-gone">
        {gone.map((c) => <li key={c.n}><AgentMark agent={c.agent} size={15} /><span className="ar-gone-name">{agentLabel(c.agent)}</span><code>{c.branch}</code><span className="ar-muted">{c.deviceName}</span></li>)}
        {gone.length === 0 && <li className="ar-muted">Nothing left to remove.</li>}
      </ul>
      {canAlso && winner?.worktree && !winner.removed && (
        <label className="ar-check-row"><input type="checkbox" checked={also} onChange={(event) => setAlso(event.target.checked)} />Also remove {agentLabel(winner.agent)}’s copy ({arena.outcome === 'applied' ? 'its changes are in your folder' : 'its branch is on GitHub'})</label>
      )}
      {error && <p className="ar-err ar-modal-err">{error}</p>}
    </Modal>
  )
}

// ---- sharing ----

function ShareModal({ arena, onClose }: { arena: Arena; onClose: () => void }) {
  const { toast } = useShell()
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let alive = true
    renderArenaCard(arena).then((next) => {
      if (!alive || !host.current) return
      next.className = 'ar-card-img'
      host.current.replaceChildren(next)
      canvas.current = next
      setReady(true)
    })
    return () => { alive = false }
  }, [arena])
  const copy = async () => {
    if (!canvas.current) return
    try {
      const blob = await canvasBlob(canvas.current)
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      toast('Image copied')
    } catch {
      toast('This browser would not copy the image. Download it instead.')
    }
  }
  const download = async () => {
    if (!canvas.current) return
    const url = URL.createObjectURL(await canvasBlob(canvas.current))
    const link = document.createElement('a')
    link.href = url
    link.download = `arena-${arena.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'result'}.png`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 2000)
  }
  return (
    <Modal title="Share result" wide onClose={onClose}>
      <div className="ar-card-host" ref={host}><div className="skeleton ar-card-skel" /></div>
      <p className="ar-share-text">{shareText(arena)}</p>
      <div className="ar-share-actions">
        <button type="button" className="btn btn-dark" disabled={!ready} onClick={copy}><Icon name="copy" size={15} />Copy image</button>
        <button type="button" className="btn btn-outline" disabled={!ready} onClick={download}><Icon name="download" size={15} />Download PNG</button>
        <a className="btn btn-outline" href={tweetUrl(arena)} target="_blank" rel="noreferrer"><Icon name="external" size={15} />Post on X</a>
      </div>
    </Modal>
  )
}
