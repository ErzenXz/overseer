import { Fragment, useRef, useState } from 'react'
import { formatDuration } from '../agents'
import { currentStep, type Activity, type AgentItem, type StepItem, type ToolItem, type Work } from '../lib/steps'
import { useNow } from '../lib/useNow'
import { localTarget, usePreviewLink } from '../previews'
import { Diff } from './Diff'
import Icon, { type IconName } from './Icon'
import Markdown from './Markdown'

// The agent's tool loop, shown quietly: one line per step, folded into a
// single "Worked for …" row once the turn is done, with a live line at the
// bottom while it runs. Subagents get their own rows with nested steps.

const sep = <span className="wk-sep" aria-hidden="true">·</span>

function Stat({ add, del }: { add: number; del: number }) {
  if (!add && !del) return null
  return <span className="wk-stat"><span className="plus">+{add}</span> <span className="minus">−{del}</span></span>
}

export function WorkBlock({ work, live, waiting, forceOpen }: { work: Work; live: boolean; waiting: boolean; forceOpen: boolean }) {
  const [open, setOpen] = useState(false)
  const expanded = open || forceOpen
  // While the agent works, only the latest settled steps show; what it is
  // doing right now lives on the live line below.
  const settled = (item: StepItem) => !(item.kind === 'tool' && item.state === 'running') && !(item.kind === 'explore' && item.state === 'running')
  const shown = expanded ? work.items : live ? work.items.filter(settled).slice(-3) : []
  // The rolling window never shrinks while it runs, so the page doesn't bob.
  const peak = useRef(0)
  peak.current = live && !expanded ? Math.max(peak.current, shown.length) : 0
  const parts = [
    `${work.steps} step${work.steps === 1 ? '' : 's'}`,
    work.agents ? `${work.agents} subagent${work.agents === 1 ? '' : 's'}` : '',
  ].filter(Boolean)
  return (
    <div className="wk">
      <button type="button" className="wk-head" aria-expanded={expanded} onClick={() => setOpen(!open)}>
        <Icon name="chevron" size={14} />
        <span>{live ? (waiting ? 'Waiting for you' : 'Working') : `Worked for ${formatDuration(work.durationMs)}`}</span>
        {parts.map((part) => <Fragment key={part}>{sep}<span>{part}</span></Fragment>)}
        {!live && (work.add > 0 || work.del > 0) && <>{sep}<Stat add={work.add} del={work.del} /></>}
      </button>
      {shown.length > 0 && <Timeline items={shown} className={live && !expanded ? 'is-tail' : ''} rows={peak.current} />}
    </div>
  )
}

function Timeline({ items, className = '', rows }: { items: StepItem[]; className?: string; rows?: number }) {
  return (
    <div className={`wk-list ${className}`} style={rows ? { minHeight: rows * 28 + 4 } : undefined}>
      {items.map((item) => <StepRow key={item.id} item={item} />)}
    </div>
  )
}

function StepRow({ item }: { item: StepItem }) {
  switch (item.kind) {
    case 'thought': return <ThoughtRow item={item} />
    case 'note': return <NoteRow text={item.text} />
    case 'tool': return <ToolRow item={item} />
    case 'explore': return <ExploreRow item={item} />
    case 'agent': return <AgentRow item={item} />
    case 'agents': return <AgentsRow items={item.items} state={item.state} />
  }
}

// --- single steps ---

function Lead({ icon, state }: { icon: IconName; state: string }) {
  return <span className={`wk-ico ${state === 'error' ? 'wk-bad' : ''}`}>{state === 'running' ? <span className="spinner" /> : <Icon name={icon} size={15} />}</span>
}

function ToolRow({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false)
  const openPreview = usePreviewLink()
  const { info, state, msg } = item
  const detail = info.detail !== 'none'
  const running = state === 'running'
  // A dev server announcing itself ("Local: http://localhost:5173/").
  const served = localTarget(msg.tool?.output?.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d{2,5}(?:\/[^\s]*)?/)?.[0])
  const line = (
    <>
      <Lead icon={info.icon} state={state} />
      <span className="wk-text" title={info.hint !== info.target ? info.hint : undefined}>
        <span className={running ? 'wk-verb shimmer' : 'wk-verb'}>{running ? info.verbing : info.verb}</span>
        {info.target && <>{' '}{info.mono ? <code className="wk-code">{info.target}</code> : <span className="wk-target">{info.target}</span>}</>}
      </span>
      <span className="wk-tail">
        <Stat add={info.add} del={info.del} />
        {state === 'error' && <span className="wk-bad">Failed</span>}
        {state === 'done' && info.icon === 'terminal' && item.msg.tool?.output !== undefined && <Icon name="check" size={13} className="wk-ok" />}
        {state === 'done' && info.icon === 'terminal' && item.ms >= 3000 && <span className="wk-time">{formatDuration(item.ms)}</span>}
        {detail && <Icon name="chevron" size={12} className="wk-chev" />}
      </span>
    </>
  )
  return (
    <div className="wk-step" data-state={state}>
      {detail ? <button type="button" className="wk-row" aria-expanded={open} onClick={() => setOpen(!open)}>{line}</button> : <div className="wk-row">{line}</div>}
      {served && openPreview && <button type="button" className="step-preview wk-preview" onClick={() => openPreview(served.port, served.path)}><Icon name="globe" size={13} />Preview :{served.port}</button>}
      {open && <ToolDetail item={item} />}
    </div>
  )
}

const OUTPUT_CAP = 12000

function ToolDetail({ item }: { item: ToolItem }) {
  const { info, msg } = item
  const tool = msg.tool!
  const output = (tool.output ?? '').length > OUTPUT_CAP ? tool.output!.slice(0, OUTPUT_CAP) + '\n…' : tool.output ?? ''
  const diffs = (tool.files ?? []).filter((file) => file.diff)
  return (
    <div className="wk-detail">
      {diffs.map((file) => <Diff key={file.path} file={file} />)}
      {info.detail === 'command' && <pre className="wk-pre"><span className="wk-prompt">$ </span>{info.hint}{output && '\n\n'}{output}</pre>}
      {info.detail !== 'command' && output && <pre className="wk-pre">{output}</pre>}
      {info.detail === 'text' && !output && tool.input && <pre className="wk-pre">{tool.input}</pre>}
    </div>
  )
}

function ExploreRow({ item }: { item: Extract<StepItem, { kind: 'explore' }> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="wk-step" data-state={item.state}>
      <button type="button" className="wk-row" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Lead icon={item.icon} state={item.state} />
        <span className="wk-text"><span className={item.state === 'running' ? 'wk-verb shimmer' : 'wk-verb'}>{item.label}</span></span>
        <span className="wk-tail">
          {item.items.some((entry) => entry.state === 'error') && <span className="wk-bad">Failed</span>}
          <Icon name="chevron" size={12} className="wk-chev" />
        </span>
      </button>
      {open && <div className="wk-nest">{item.items.map((entry) => <ToolRow key={entry.id} item={entry} />)}</div>}
    </div>
  )
}

function ThoughtRow({ item }: { item: Extract<StepItem, { kind: 'thought' }> }) {
  const [open, setOpen] = useState(false)
  const has = item.text.trim().length > 0
  const label = item.ms >= 2000 ? `Thought for ${formatDuration(item.ms)}` : 'Thought'
  const line = <><Lead icon="brain" state="done" /><span className="wk-text"><span className="wk-verb">{label}</span></span>{has && <span className="wk-tail"><Icon name="chevron" size={12} className="wk-chev" /></span>}</>
  return (
    <div className="wk-step">
      {has ? <button type="button" className="wk-row" aria-expanded={open} onClick={() => setOpen(!open)}>{line}</button> : <div className="wk-row">{line}</div>}
      {open && <div className="wk-detail"><p className="wk-thought">{item.text}</p></div>}
    </div>
  )
}

// NoteRow is the agent's narration between steps ("Let me check the tests").
function NoteRow({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 220 || text.split('\n').length > 3
  const parts = text.split(/(`[^`\n]+`)/g)
  const body = parts.map((part, index) => (part.startsWith('`') && part.endsWith('`') && part.length > 2 ? <code key={index} className="wk-code">{part.slice(1, -1)}</code> : <Fragment key={index}>{part}</Fragment>))
  return (
    <div className="wk-step">
      {long ? (
        <button type="button" className={`wk-note ${open ? '' : 'is-clamped'}`} aria-expanded={open} onClick={() => setOpen(!open)}>{body}</button>
      ) : (
        <p className="wk-note">{body}</p>
      )}
    </div>
  )
}

// --- subagents ---

function countSteps(items: StepItem[]): number {
  return items.reduce((sum, item) => sum + (item.kind === 'tool' ? 1 : item.kind === 'explore' ? item.items.length : item.kind === 'agent' ? 1 : item.kind === 'agents' ? item.items.length : 0), 0)
}

function AgentRow({ item }: { item: AgentItem }) {
  const [open, setOpen] = useState(false)
  const running = item.state === 'running'
  const now = useNow(running)
  const { info } = item
  const elapsed = running ? now - item.startedAt : info.durationMs || item.endedAt - item.startedAt
  const steps = info.tools || countSteps(item.children)
  const step = running ? currentStep(item.children) : null
  const failed = item.state === 'error'
  return (
    <div className="wk-step wk-agent" data-state={item.state}>
      <button type="button" className="wk-row" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={`wk-ico ${failed ? 'wk-bad' : ''}`}><Icon name="bot" size={15} /></span>
        <span className="wk-text">
          <span className="wk-agent-name">{info.label}</span>
          {info.role && <span className="wk-role">{info.role}</span>}
          {info.task && <span className="wk-target">{info.task}</span>}
        </span>
        <span className="wk-tail">
          {running && <span className="spinner" />}
          {item.state === 'done' && <Icon name="check" size={13} className="wk-ok" />}
          {failed && <span className="wk-bad">Failed</span>}
          {item.state === 'stopped' && <span className="wk-time">Stopped</span>}
          <span className="wk-time">{elapsed >= 1000 ? formatDuration(elapsed) : ''}{!running && steps > 0 ? `${elapsed >= 1000 ? ' · ' : ''}${steps} step${steps === 1 ? '' : 's'}` : ''}</span>
          <Icon name="chevron" size={12} className="wk-chev" />
        </span>
      </button>
      {running && !open && (
        <div className="wk-agent-now" aria-hidden="true">
          {step ? <><span className="wk-verb shimmer">{step.verb}</span>{step.target && <>{' '}{step.mono ? <code className="wk-code">{step.target}</code> : <span className="wk-target">{step.target}</span>}</>}</> : <span className="wk-verb shimmer">Thinking…</span>}
        </div>
      )}
      {open && (
        <div className="wk-nest wk-agent-body">
          {item.children.length > 0 ? <Timeline items={item.children} /> : running ? <p className="wk-note">Starting…</p> : null}
          {info.result && <div className="wk-result"><Markdown text={info.result} /></div>}
        </div>
      )}
    </div>
  )
}

function AgentsRow({ items, state }: { items: AgentItem[]; state: string }) {
  const running = state === 'running'
  const [open, setOpen] = useState<boolean | null>(null)
  const expanded = open ?? running
  const active = items.filter((item) => item.state === 'running').length
  const now = useNow(running)
  const first = Math.min(...items.map((item) => item.startedAt))
  const last = Math.max(...items.map((item) => item.endedAt))
  const total = running ? now - first : last - first
  return (
    <div className="wk-step wk-agents" data-state={state}>
      <button type="button" className="wk-row" aria-expanded={expanded} onClick={() => setOpen(!expanded)}>
        <span className="wk-ico"><Icon name="bot" size={15} /></span>
        <span className="wk-text">
          <span className={running ? 'wk-verb shimmer' : 'wk-verb'}>{items.length} subagents{running ? ' running' : ''}</span>
        </span>
        <span className="wk-tail">
          {running ? <span className="wk-time">{items.length - active} of {items.length} done</span> : <span className="wk-time">{formatDuration(total)}</span>}
          <Icon name="chevron" size={12} className="wk-chev" />
        </span>
      </button>
      {expanded && <div className="wk-nest wk-agents-list">{items.map((item) => <AgentRow key={item.id} item={item} />)}</div>}
    </div>
  )
}

// --- live line ---

export function ActivityLine({ activity }: { activity: Activity }) {
  const now = useNow(true)
  const elapsed = now - activity.since
  const plain = activity.kind === 'thinking' || activity.kind === 'starting'
  return (
    <div className="wk-live" role="status">
      <span className="wk-pulse" aria-hidden="true" />
      <span className="wk-live-text">
        <span className="shimmer">{activity.verb}</span>
        {activity.kind === 'agents' && <span className="wk-sep" aria-hidden="true"> · </span>}
        {!plain && activity.target && <>{' '}{activity.mono ? <code className="wk-code">{activity.target}</code> : <span className="wk-target">{activity.target}</span>}</>}
        {activity.more > 0 && <span className="wk-more"> +{activity.more} more</span>}
      </span>
      {activity.kind !== 'starting' && elapsed >= 1000 && <span className="wk-time" aria-hidden="true">{sep}{formatDuration(elapsed)}</span>}
    </div>
  )
}
