import { useState } from 'react'
import { agentUpdatesResource, setAutoUpdate, summarize, updateAgents, useAgentUpdates, type AgentUpdate } from '../agentUpdates'
import { usePref } from '../store'
import { useTeam } from '../teams'
import Icon, { AgentMark } from './Icon'
import { Switch } from './Menu'
import Modal from './Modal'

// AgentUpdateNotice is the second card at the bottom of the sidebar: newer
// versions of the agent CLIs are out for machines you have. It opens a dialog
// that updates them, and never touches an agent that is mid-session.
export default function AgentUpdateNotice() {
  const data = useAgentUpdates()
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = usePref('agentUpdates.dismissed', '')
  const items = data?.items ?? []
  const summary = summarize(items)
  // A dismissal covers exactly the versions it was made for.
  const signature = items.filter((item) => item.state === 'available').map((item) => `${item.deviceId}:${item.agent}@${item.latest}`).sort().join(',')
  const hidden = summary?.kind === 'available' && signature === dismissed
  if (!summary || hidden) return open ? <AgentUpdateDialog onClose={() => setOpen(false)} /> : null
  const active = summary.kind === 'working' || summary.kind === 'waiting'
  return (
    <>
      <div className="update-notice-wrap update-notice-stacked">
        <div className="update-notice">
          <button type="button" className="update-notice-main" onClick={() => setOpen(true)} aria-haspopup="dialog">
            {summary.kind === 'working' ? <span className="spinner" /> : summary.kind === 'done' ? <span className="update-done"><Icon name="check" size={12} /></span> : <span className={`update-dot ${summary.kind === 'failed' ? 'update-dot-bad' : ''} ${summary.kind === 'waiting' ? 'update-dot-wait' : ''}`} />}
            <span className="update-notice-text">
              <span className="update-notice-title">{summary.title}</span>
              <span className="update-notice-sub">{summary.sub}</span>
            </span>
          </button>
          {!active && (
            <button type="button" className="icon-btn icon-btn-sm update-notice-x" aria-label="Hide" title="Hide" onClick={() => { if (summary.kind === 'available') setDismissed(signature); else setOpen(false) }}>
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
      </div>
      {open && <AgentUpdateDialog onClose={() => setOpen(false)} />}
    </>
  )
}

function AgentUpdateDialog({ onClose }: { onClose: () => void }) {
  const data = useAgentUpdates()
  const team = useTeam()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const items = data?.items ?? []
  const startable = items.filter((item) => item.state === 'available' || item.state === 'failed')
  const run = async (target?: { deviceId: string; agent: string }) => {
    setError('')
    setBusy(true)
    try { await updateAgents(target) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not start the update') }
    setBusy(false)
  }
  const toggleAuto = async (value: boolean) => {
    setError('')
    try { await setAutoUpdate(value) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not change the setting') }
  }
  const waiting = items.some((item) => item.busy > 0 && item.state !== 'updated')
  return (
    <Modal
      title="Agent updates"
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Close</button>
          {team.isOwner && <button className="btn-primary" disabled={busy || startable.length === 0} onClick={() => run()}>{startable.length > 1 ? `Update all (${startable.length})` : 'Update'}</button>}
        </>
      }
    >
      <p className="update-lede">Each agent updates itself with its own updater, on the machine it runs on. An agent that has a session running is never touched: its update waits until that session finishes.</p>
      {error && <p className="update-error" role="alert">{error}</p>}
      {items.length === 0 && <p className="update-empty">Every agent is up to date.</p>}
      <div className="au-list">
        {items.map((item) => <Row key={`${item.deviceId}:${item.agent}`} item={item} owner={team.isOwner} onRun={() => run({ deviceId: item.deviceId, agent: item.agent })} disabled={busy} />)}
      </div>
      {waiting && <p className="hint mt-3">Waiting updates start by themselves as soon as the sessions end.</p>}
      <div className="au-auto">
        <span><b>Update automatically</b><span>Install new versions in the background when no session is using that agent.</span></span>
        <Switch checked={!!data?.auto} onChange={toggleAuto} label="Update agents automatically" disabled={!team.isOwner} />
      </div>
    </Modal>
  )
}

function Row({ item, owner, onRun, disabled }: { item: AgentUpdate; owner: boolean; onRun: () => void; disabled: boolean }) {
  const detail = item.state === 'queued'
    ? `Waiting for ${item.busy} running ${item.busy === 1 ? 'session' : 'sessions'}`
    : item.state === 'updating' ? 'Updating…'
    : item.state === 'updated' ? `Now on ${item.current}`
    : item.state === 'failed' ? (item.message || 'The update failed')
    : item.busy > 0 ? `${item.busy} running ${item.busy === 1 ? 'session' : 'sessions'}: it will wait for ${item.busy === 1 ? 'it' : 'them'}`
    : `${item.current} → ${item.latest}`
  return (
    <div className="au-row">
      <span className="au-mark"><AgentMark agent={item.agent} size={18} /></span>
      <span className="au-text">
        <b>{item.name} <span className="au-machine">on {item.deviceName}</span></b>
        <span className={item.state === 'failed' ? 'au-bad' : undefined}>{detail}</span>
      </span>
      {item.state === 'updating' && <span className="spinner" />}
      {item.state === 'updated' && <span className="badge badge-green"><Icon name="check" size={12} />Updated</span>}
      {item.state === 'queued' && <span className="badge badge-amber">Queued</span>}
      {(item.state === 'available' || item.state === 'failed') && owner && <button className="btn btn-sm btn-outline" disabled={disabled} onClick={onRun}>{item.state === 'failed' ? 'Retry' : item.busy > 0 ? 'Update when idle' : 'Update'}</button>}
    </div>
  )
}

export { agentUpdatesResource }
