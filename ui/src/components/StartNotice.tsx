import type { NewThread } from '../store'
import Icon from './Icon'

// What happened to a start request, in plain words. The key is the request's
// idempotency key: Retry reuses it, so the session can never start twice.
export interface StartAttempt {
  key: string
  input: NewThread
  machine: string
  phase: 'sending' | 'checking' | 'failed' | 'unknown'
  message?: string
}

export default function StartNotice({ attempt, onRetry, onDiscard }: { attempt: StartAttempt; onRetry: () => void; onDiscard: () => void }) {
  const { phase, machine, message } = attempt
  if (phase === 'sending') return null
  if (phase === 'checking') {
    return <div className="start-note" role="status"><span className="spinner" />Checking whether it started…</div>
  }
  const detail = message ? `${message.charAt(0).toUpperCase()}${message.slice(1)}${/[.!?]$/.test(message) ? '' : '.'}` : ''
  return (
    <div className={`start-note ${phase === 'unknown' ? 'is-unknown' : 'is-failed'}`} role="alert">
      <Icon name="alert" size={16} />
      <div className="min-w-0 flex-1">
        {phase === 'failed' ? (
          <>
            <p className="start-note-title">Didn’t start</p>
            <p>Nothing is running on {machine}. {detail}</p>
          </>
        ) : (
          <>
            <p className="start-note-title">Start status unknown</p>
            <p>The hub could not be reached, so it is unclear whether this started on {machine}. Retry sends the same request, so it can’t run twice.</p>
          </>
        )}
      </div>
      <div className="start-note-actions">
        <button type="button" className="btn btn-sm btn-dark" onClick={onRetry}>Retry</button>
        {phase === 'unknown' && <button type="button" className="btn btn-sm btn-outline" onClick={onDiscard} title="Forget this request. Check the machine first: it may already be running.">Start over</button>}
      </div>
    </div>
  )
}
