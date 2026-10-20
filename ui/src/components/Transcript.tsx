import { useState } from 'react'
import { formatDuration } from '../agents'
import type { Thread, ThreadMessage, ToolFile } from '../types'
import Icon, { type IconName } from './Icon'
import Markdown from './Markdown'
import { localTarget, usePreviewLink } from '../previews'

// Segment is one visual unit of the conversation. Consecutive agent steps
// (thoughts and tool calls) collapse into a "Worked for …" block, the way
// Devin shows them; user and assistant text, plans, approvals and errors
// stand on their own.
type Segment =
  | { kind: 'message'; message: ThreadMessage }
  | { kind: 'steps'; id: string; steps: ThreadMessage[]; durationMs: number }

export function segment(messages: ThreadMessage[]): Segment[] {
  const out: Segment[] = []
  let steps: ThreadMessage[] = []
  const flush = (after?: ThreadMessage) => {
    if (!steps.length) return
    const first = steps[0]
    const last = steps[steps.length - 1]
    const measured = Math.max(1000, (after?.at ?? last.updatedAt) - first.at)
    out.push({ kind: 'steps', id: first.id, steps, durationMs: after?.role === 'assistant' && after.durationMs ? after.durationMs : measured })
    steps = []
  }
  for (const message of messages) {
    if (message.role === 'tool' || message.role === 'thought') { steps.push(message); continue }
    flush(message)
    out.push({ kind: 'message', message })
  }
  flush()
  return out
}

export default function Transcript({
  thread,
  messages,
  expandAll,
  onApprove,
  actions,
}: {
  thread: Thread
  messages: ThreadMessage[]
  expandAll: boolean
  onApprove: (approvalId: string, optionId: string) => Promise<void>
  actions?: MessageActions
}) {
  const segments = segment(messages)
  const running = thread.status === 'working' || thread.status === 'starting'
  const last = segments[segments.length - 1]
  return (
    <>
      {segments.map((item, index) => {
        if (item.kind === 'steps') {
          const live = running && index === segments.length - 1
          return <Steps key={item.id} steps={item.steps} durationMs={item.durationMs} live={live} forceOpen={expandAll} />
        }
        return <MessageView key={item.message.id} message={item.message} onApprove={onApprove} actions={actions} busy={running} streaming={running && index === segments.length - 1} />
      })}
      {running && (!last || (last.kind === 'message' && !(last.message.role === 'assistant' && last.message.text))) && (
        <div className="msg-status"><Icon name="chevron" size={15} /><span className="shimmer">{thread.status === 'starting' ? `Starting ${thread.deviceName}…` : last?.kind === 'message' && last.message.role === 'assistant' && last.message.text ? 'Finishing up in the background' : 'Thinking…'}</span></div>
      )}
      {thread.status === 'error' && thread.error && !messages.some((message) => message.role === 'error') && <div className="msg-error">{thread.error}</div>}
    </>
  )
}

export interface MessageActions {
  onEdit: (text: string) => void
  onRetry: (text: string) => void
  onFork?: (messageId: string) => void
  onAnswer: (questionId: string, answers: string[], text?: string) => Promise<void>
}

function MessageView({ message, onApprove, actions, busy, streaming }: { message: ThreadMessage; onApprove: (approvalId: string, optionId: string) => Promise<void>; actions?: MessageActions; busy: boolean; streaming?: boolean }) {
  if (message.role === 'user') {
    return (
      <div className="msg-user" data-user-message={message.id}>
        <div className="msg-user-inner">
          <div className={`msg-user-bubble ${message.queued ? 'is-queued' : ''}`}>{message.text}</div>
          {message.queued ? (
            <div className="msg-actions msg-actions-user is-visible"><span className="msg-queued"><span className="spinner" />Queued, sends when the current step finishes</span></div>
          ) : actions && (
            <div className="msg-actions msg-actions-user">
              <CopyButton text={message.text} />
              <ActionButton icon="edit" label="Edit" onClick={() => actions.onEdit(message.text)} />
              <ActionButton icon="rotate" label="Retry" disabled={busy} onClick={() => actions.onRetry(message.text)} />
            </div>
          )}
        </div>
      </div>
    )
  }
  if (message.role === 'assistant') {
    return (
      <div className="msg-agent-wrap">
        <div className="msg-agent"><Markdown text={message.text} streaming={streaming} /></div>
        {actions && message.text && !streaming && (
          <div className="msg-actions">
            <CopyButton text={message.text} />
            {actions.onFork && <ActionButton icon="git-fork" label="Continue in new session" onClick={() => actions.onFork!(message.id)} />}
            {message.durationMs ? <span className="msg-meta">{formatDuration(message.durationMs)}</span> : null}
          </div>
        )}
      </div>
    )
  }
  if (message.role === 'plan' && message.plan) return <PlanCard plan={message.plan} />
  if (message.role === 'approval' && message.approval) return <ApprovalCard message={message} onApprove={onApprove} />
  if (message.role === 'question' && message.question) return <QuestionCard message={message} onAnswer={actions?.onAnswer} />
  if (message.role === 'error') return <div className="msg-error" role="alert">{message.text}</div>
  if (message.role === 'status') return <div className="msg-status"><Icon name="info" size={16} />{message.text}</div>
  return null
}

function ActionButton({ icon, label, onClick, disabled }: { icon: IconName; label: string; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="msg-action" aria-label={label} title={label} onClick={onClick} disabled={disabled}><Icon name={icon} size={15} /></button>
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button type="button" className="msg-action" aria-label={copied ? 'Copied' : 'Copy'} title={copied ? 'Copied' : 'Copy'} onClick={() => {
      navigator.clipboard?.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500) }).catch(() => {})
    }}>
      <Icon name={copied ? 'check' : 'copy'} size={15} />
    </button>
  )
}

// QuestionCard answers an agent's multiple-choice question (Claude
// AskUserQuestion, Codex requestUserInput) without typing.
function QuestionCard({ message, onAnswer }: { message: ThreadMessage; onAnswer?: (questionId: string, answers: string[], text?: string) => Promise<void> }) {
  const question = message.question!
  const [picked, setPicked] = useState<string[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const answered = question.answered
  const submit = async (answers: string[], free?: string) => {
    if (!onAnswer) return
    setBusy(true)
    try { await onAnswer(question.id, answers, free) } finally { setBusy(false) }
  }
  if (answered) {
    const labels = question.options.filter((option) => answered.includes(option.id)).map((option) => option.label)
    const extra = answered.filter((value) => !question.options.some((option) => option.id === value))
    return (
      <div className="approval">
        <div className="approval-title"><Icon name="message" size={17} className="text-muted" /><span className="text-muted">{question.text}</span></div>
        <div className="mt-2 text-[14px]">{[...labels, ...extra].join(', ')}</div>
      </div>
    )
  }
  return (
    <div className="approval question-card" role="alert">
      <div className="approval-title"><Icon name="message" size={17} className="text-[var(--blue)]" /><span>{question.text}</span></div>
      <div className="question-options">
        {question.options.map((option) => {
          const on = picked.includes(option.id)
          return (
            <button
              key={option.id}
              type="button"
              className="question-option"
              aria-pressed={on}
              disabled={busy}
              onClick={() => (question.multiple ? setPicked(on ? picked.filter((id) => id !== option.id) : [...picked, option.id]) : submit([option.id]))}
            >
              <span className="question-option-label">{option.label}</span>
              {option.description && <span className="question-option-desc">{option.description}</span>}
            </button>
          )
        })}
      </div>
      {(question.allowText || question.multiple) && (
        <form className="question-free" onSubmit={(event) => { event.preventDefault(); if (picked.length || text.trim()) submit(picked, text.trim() || undefined) }}>
          {question.allowText && <input className="input" value={text} onChange={(event) => setText(event.target.value)} placeholder="Or type your own answer" disabled={busy} />}
          <button className="btn btn-sm btn-dark" disabled={busy || (!picked.length && !text.trim())}>{busy && <span className="spinner" />}Answer</button>
        </form>
      )}
    </div>
  )
}

function Steps({ steps, durationMs, live, forceOpen }: { steps: ThreadMessage[]; durationMs: number; live: boolean; forceOpen: boolean }) {
  const [open, setOpen] = useState(false)
  const expanded = open || forceOpen || live
  const shown = live && !open && !forceOpen ? steps.slice(-3) : steps
  const files = steps.flatMap((step) => step.tool?.files ?? [])
  const additions = files.reduce((sum, file) => sum + (file.additions ?? 0), 0)
  const deletions = files.reduce((sum, file) => sum + (file.deletions ?? 0), 0)
  return (
    <div className="worked">
      <button className="worked-toggle" aria-expanded={expanded} onClick={() => setOpen(!open)}>
        <Icon name="chevron" size={15} />
        {live ? <span className="shimmer">Working… {steps.length} step{steps.length === 1 ? '' : 's'}</span> : <span>Worked for {formatDuration(durationMs)}</span>}
        {!live && files.length > 0 && <span className="text-[13.5px]"><span className="plus">+{additions}</span> <span className="minus">−{deletions}</span></span>}
      </button>
      {expanded && (
        <div className="worked-body">
          {live && steps.length > shown.length && <button className="step text-muted hover:text-ink" onClick={() => setOpen(true)}><span className="step-icon"><Icon name="more" size={16} /></span>{steps.length - shown.length} earlier steps</button>}
          {shown.map((step) => <StepView key={step.id} step={step} />)}
        </div>
      )}
    </div>
  )
}

const toolIcons: Record<string, IconName> = { bash: 'terminal', read: 'file', edit: 'edit', write: 'edit', grep: 'search', glob: 'search', webfetch: 'globe', websearch: 'globe', mcp: 'layers', todo: 'list-checks' }

function StepView({ step }: { step: ThreadMessage }) {
  const [open, setOpen] = useState(false)
  const openPreview = usePreviewLink()
  if (step.role === 'thought') {
    return (
      <div className="step">
        <span className="step-icon"><Icon name="brain" size={16} /></span>
        <div className="step-main step-thought">{step.text || '…'}</div>
      </div>
    )
  }
  const tool = step.tool
  if (!tool) return null
  const hasDetail = !!(tool.output || tool.files?.some((file) => file.diff) || (tool.input && tool.name === 'bash'))
  // A dev server announcing itself ("Local: http://localhost:5173/").
  const served = localTarget(tool.output?.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d{2,5}(?:\/[^\s]*)?/)?.[0])
  return (
    <div className="step">
      <span className="step-icon">
        {tool.status === 'running' ? <span className="spinner" /> : tool.status === 'error' ? <Icon name="alert" size={16} className="text-danger" /> : <Icon name={toolIcons[tool.name] ?? 'wrench'} size={16} />}
      </span>
      <div className="step-main">
        <div className="step-title">
          <button onClick={() => hasDetail && setOpen(!open)} aria-expanded={hasDetail ? open : undefined} disabled={!hasDetail}>
            <span className={tool.status === 'running' ? 'shimmer' : ''}>{tool.title}</span>
            {tool.input && tool.name === 'bash' && <code>{tool.input}</code>}
            {hasDetail && <Icon name={open ? 'chevron-down' : 'chevron'} size={13} className="text-faint" />}
          </button>
          {served && openPreview && <button type="button" className="step-preview" onClick={() => openPreview(served.port, served.path)}><Icon name="globe" size={13} />Preview :{served.port}</button>}
          {tool.files?.map((file) => <span key={file.path} className="text-[13px]"><span className="plus">+{file.additions ?? 0}</span> <span className="minus">−{file.deletions ?? 0}</span></span>)}
        </div>
        {open && tool.files?.filter((file) => file.diff).map((file) => <Diff key={file.path} file={file} />)}
        {open && tool.output && <pre className="step-out">{tool.output}</pre>}
      </div>
    </div>
  )
}

export function Diff({ file }: { file: ToolFile }) {
  const lines = (file.diff ?? '').split('\n')
  return (
    <div className="diff">
      <div className="diff-head">
        <Icon name="file" size={14} />
        <span className="truncate">{file.path}</span>
        <span className="ml-auto"><span className="plus">+{file.additions ?? 0}</span> <span className="minus">−{file.deletions ?? 0}</span></span>
      </div>
      <div className="diff-body">
        {lines.map((line, index) => (
          <div key={index} className={`diff-line ${line.startsWith('@@') ? 'diff-hunk' : line.startsWith('+') ? 'diff-add' : line.startsWith('-') ? 'diff-del' : ''}`}>{line || ' '}</div>
        ))}
      </div>
    </div>
  )
}

export function PlanCard({ plan }: { plan: NonNullable<ThreadMessage['plan']> }) {
  const done = plan.filter((entry) => entry.status === 'completed').length
  return (
    <div className="plan-card">
      <div className="mb-2 flex items-center gap-2 text-[14px] text-muted"><Icon name="list-checks" size={16} />Plan · {done} of {plan.length} done</div>
      {plan.map((entry, index) => (
        <div key={index} className={`plan-item ${entry.status === 'completed' ? 'done' : ''}`}>
          <span className={`plan-check ${entry.status === 'completed' ? 'done' : entry.status === 'in_progress' ? 'active' : ''}`}>{entry.status === 'completed' && <Icon name="check" size={11} strokeWidth={2.4} />}</span>
          <span>{entry.content}</span>
        </div>
      ))}
    </div>
  )
}

function ApprovalCard({ message, onApprove }: { message: ThreadMessage; onApprove: (approvalId: string, optionId: string) => Promise<void> }) {
  const approval = message.approval!
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const resolved = approval.options.find((option) => option.id === approval.resolved)
  const choose = async (optionId: string) => {
    setBusy(optionId)
    setError('')
    try { await onApprove(approval.id, optionId) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not answer') } finally { setBusy('') }
  }
  return (
    <div className="approval" role={resolved ? undefined : 'alert'}>
      <div className="approval-title">
        <Icon name={resolved ? (resolved.kind.startsWith('reject') ? 'close' : 'check') : 'shield'} size={18} className={resolved ? 'text-muted' : 'text-warning'} />
        {resolved ? <span className="text-muted">{resolved.kind.startsWith('reject') ? 'Rejected' : 'Allowed'}: {approval.title}</span> : <span>Allow the agent to {lowerFirst(approval.title)}?</span>}
      </div>
      {approval.detail && !resolved && <div className="approval-detail">{approval.detail}</div>}
      {!resolved && (
        <div className="approval-actions">
          {approval.options.map((option) => (
            <button key={option.id} className={`btn btn-sm ${option.kind === 'allow_once' ? 'btn-dark' : 'btn-outline'}`} disabled={!!busy} onClick={() => choose(option.id)}>
              {busy === option.id && <span className="spinner" />}
              {option.label}
            </button>
          ))}
        </div>
      )}
      {error && <p className="mt-2 text-[13px] text-danger">{error}</p>}
    </div>
  )
}

function lowerFirst(text: string) {
  return text ? text[0].toLowerCase() + text.slice(1) : text
}
