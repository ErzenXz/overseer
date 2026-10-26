import { useState } from 'react'
import { relativeTime } from '../agents'
import { handOff, useTeam } from '../teams'
import { useShell } from '../shell'
import type { Thread } from '../types'
import Modal from './Modal'
import { Avatar } from './Presence'

// "Hand off to…": pick a teammate and add a note. They get the session in
// their Needs you group and a notice.
export function HandOffDialog({ thread, onClose, onDone }: { thread: Thread; onClose: () => void; onDone?: (thread: Thread) => void }) {
  const team = useTeam()
  const { toast } = useShell()
  const mates = team.people.filter((person) => person.id !== team.me?.id)
  const [to, setTo] = useState(() => (mates.length === 1 ? mates[0].id : ''))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!to || busy) return
    setBusy(true)
    setError('')
    try {
      const updated = await handOff(thread.id, to, note.trim())
      toast(`Handed off to ${team.nameOf(to)}`)
      onDone?.(updated)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Couldn’t hand it off')
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Hand off to…"
      onClose={onClose}
      footer={(
        <>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-dark" disabled={!to || busy} onClick={submit}>{busy && <span className="spinner" />}Hand off</button>
        </>
      )}
    >
      <p className="tm-hint">“{thread.title}” moves to their Needs you list, and they get a notice.</p>
      {mates.length === 0 ? <p className="tm-hint">There’s nobody else on this hub yet. Invite someone in Settings → People.</p> : (
        <div className="tm-pick" role="radiogroup" aria-label="Hand off to">
          {mates.map((person) => (
            <button key={person.id} type="button" role="radio" aria-checked={to === person.id} className="tm-pick-row" onClick={() => setTo(person.id)}>
              <Avatar id={person.id} name={person.name} size={28} />
              <span className="tm-pick-main"><span className="tm-pick-name">{person.name}</span><span className="tm-pick-sub">{person.role === 'owner' ? 'Owner' : 'Member'}{person.lastSeen ? ` · seen ${relativeTime(person.lastSeen)}` : ''}</span></span>
              <span className="tm-radio" aria-hidden />
            </button>
          ))}
        </div>
      )}
      <label className="field-label mt-4 block" htmlFor="tm-note">Note <span className="text-faint">(optional)</span></label>
      <textarea id="tm-note" className="textarea mt-1.5" style={{ minHeight: 84 }} maxLength={500} placeholder="What should they pick up? Where did you leave off?" value={note} onChange={(event) => setNote(event.target.value)} />
      {error && <p className="mt-2 text-[13px] text-danger" role="alert">{error}</p>}
    </Modal>
  )
}

// The line under the header: who passed the session on, and why.
export function HandoffBanner({ thread }: { thread: Thread }) {
  const team = useTeam()
  if (!thread.handoffAt || !team.multi) return null
  const by = team.find(thread.handoffBy)
  const to = team.find(thread.assignee)
  const toMe = !!team.me && thread.assignee === team.me.id
  const fromMe = !!team.me && thread.handoffBy === team.me.id
  const who = fromMe ? 'You' : team.nameOf(thread.handoffBy) || 'Someone'
  return (
    <div className="tm-handoff" role="note">
      {by && <Avatar id={by.id} name={by.name} size={26} />}
      <div className="tm-handoff-main">
        <p className="tm-handoff-title">
          Handed off by {who}{toMe ? ' to you' : to ? ` to ${to.name}` : ''}
          <span className="tm-handoff-time">{relativeTime(thread.handoffAt)}</span>
        </p>
        {thread.handoffNote && <p className="tm-handoff-note">{thread.handoffNote}</p>}
      </div>
    </div>
  )
}
