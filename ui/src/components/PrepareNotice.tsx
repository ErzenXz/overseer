import { prepareAction } from '../github'
import type { GitPrepareResult } from '../types'
import Icon from './Icon'

// What is happening while a machine gets a GitHub repo and branch ready, in
// plain words, with a way out. A clone can take minutes, so it can be stopped.
export interface PrepareState {
  phase: 'planning' | 'working' | 'failed'
  repo: string
  branch: string
  machine: string
  action?: GitPrepareResult['action']
  message?: string
}

export default function PrepareNotice({ prep, onCancel, onDismiss }: { prep: PrepareState; onCancel: () => void; onDismiss: () => void }) {
  if (prep.phase === 'failed') {
    const detail = prep.message ? `${prep.message.charAt(0).toUpperCase()}${prep.message.slice(1)}` : ''
    return (
      <div className="start-note is-failed" role="alert">
        <Icon name="alert" size={16} />
        <div className="min-w-0 flex-1">
          <p className="start-note-title">Couldn’t get {prep.repo} ready on {prep.machine}</p>
          <p>{detail}{detail && !/[.!?]$/.test(detail) ? '.' : ''} Nothing was started. Press send to try again.</p>
        </div>
        <div className="start-note-actions"><button type="button" className="btn btn-sm btn-outline" onClick={onDismiss}>Dismiss</button></div>
      </div>
    )
  }
  const text = prep.action ? prepareAction[prep.action](prep.action === 'clone' ? prep.repo : prep.branch, prep.machine) : `Looking at ${prep.repo} on ${prep.machine}…`
  return (
    <div className="start-note" role="status">
      <span className="spinner" />
      <div className="min-w-0 flex-1">
        <p className="start-note-title">{text}</p>
        {prep.action === 'clone' && <p>New clones can take a minute or two. The session starts when it is done.</p>}
        {prep.action === 'worktree' && <p>The existing clone on {prep.machine} is left as it is.</p>}
      </div>
      <div className="start-note-actions"><button type="button" className="btn btn-sm btn-outline" onClick={onCancel}>Cancel</button></div>
    </div>
  )
}
