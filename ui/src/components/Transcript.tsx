import { useMemo, useState } from 'react'
import { formatDuration } from '../agents'
import { buildSegments, currentActivity } from '../lib/steps'
import { useNow } from '../lib/useNow'
import type { Thread, ThreadMessage } from '../types'
import { Diff } from './Diff'
import Icon, { type IconName } from './Icon'
import Markdown from './Markdown'
import { AgentErrorContext, ErrorMessage } from './AgentAccess'
import { ActivityLine, WorkBlock } from './Work'

export { Diff }

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
  const running = thread.status === 'working' || thread.status === 'starting'
  const active = running || thread.status === 'waiting'
  const segments = useMemo(() => buildSegments(messages, active), [messages, active])
  // The block being worked on: the last one, unless an answer follows it.
  let liveIndex = -1
  for (let i = segments.length - 1; i >= 0 && active; i--) {
    const seg = segments[i]
    if (seg.kind === 'work') { liveIndex = i; break }
    if (seg.message.role !== 'approval' && seg.message.role !== 'question' && seg.message.role !== 'plan') break
  }
  const now = useNow(running)
  const activity = running ? currentActivity(segments, thread.status, thread.deviceName, now) : null
  const errorScope = useMemo(() => ({ threadId: thread.id, agent: thread.agent, deviceId: thread.deviceId, deviceName: thread.deviceName }), [thread.id, thread.agent, thread.deviceId, thread.deviceName])
  return (
    <AgentErrorContext.Provider value={errorScope}>
      {segments.map((item, index) => {
        if (item.kind === 'work') return <WorkBlock key={item.id} work={item} live={index === liveIndex} waiting={thread.status === 'waiting'} forceOpen={expandAll} />
        const before = segments[index - 1]
        if (item.message.role === 'error' && before?.kind !== 'work' && before?.message.role === 'error' && before.message.text === item.message.text) return null
        return <MessageView key={item.message.id} message={item.message} onApprove={onApprove} actions={actions} busy={running} streaming={running && index === segments.length - 1} />
      })}
      {activity && <ActivityLine activity={activity} />}
      {thread.status === 'error' && thread.error && !messages.some((message) => message.role === 'error') && <ErrorMessage text={thread.error} />}
    </AgentErrorContext.Provider>
  )
}

export interface MessageActions {
  onEdit: (text: string) => void
  onRetry: (text: string) => void
  onFork?: (messageId: string) => void
  onContinueIn?: (messageId: string) => void
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
            {actions.onContinueIn && <ActionButton icon="arrow-up-right" label="Continue in another agent" onClick={() => actions.onContinueIn!(message.id)} />}
            {message.durationMs ? <span className="msg-meta">{formatDuration(message.durationMs)}</span> : null}
          </div>
        )}
      </div>
    )
  }
  if (message.role === 'plan' && message.plan) return <PlanCard plan={message.plan} />
  if (message.role === 'approval' && message.approval) return <ApprovalCard message={message} onApprove={onApprove} />
  if (message.role === 'question' && message.question) return <QuestionCard message={message} onAnswer={actions?.onAnswer} />
  if (message.role === 'error') return <ErrorMessage text={message.text} />
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
    <div className="approval approval-pending question-card" role="alert">
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
    <div className={`approval ${resolved ? '' : 'approval-pending'}`} role={resolved ? undefined : 'alert'}>
      <div className="approval-title">
        <Icon name={resolved ? (resolved.kind.startsWith('reject') ? 'close' : 'check') : 'shield'} size={18} className={resolved ? 'text-muted' : 'text-warning'} />
        {resolved ? <span className="text-muted">{approval.answeredBy ? `${resolved.kind.startsWith('reject') ? 'Rejected' : 'Approved'} by ${approval.answeredBy}` : resolved.kind.startsWith('reject') ? 'Rejected' : 'Allowed'}: {approval.title}</span> : <span>Allow the agent to {lowerFirst(approval.title)}?</span>}
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
