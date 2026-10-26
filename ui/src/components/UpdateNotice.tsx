import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import type { ReleaseNotes, UpdateNotes } from '../types'
import { updateResource, useUpdateNotice, type UpdateNotice as Notice } from '../updates'
import Icon from './Icon'
import Modal from './Modal'

const REPO = 'https://github.com/ErzenXz/overseer'
const CHANGELOG = 'https://overseer.sh/changelog/'

// UpdateNotice is the small card at the bottom of the sidebar: a newer release
// is out, or the hub just moved to one. It opens the "What's new" dialog.
export default function UpdateNotice() {
  const notice = useUpdateNotice()
  const [open, setOpen] = useState(false)
  // Keep the dialog (and its install progress) through the notice changing
  // underneath it, e.g. when the hub restarts.
  const kept = useRef<Notice | null>(null)
  if (notice) kept.current = notice
  const shown = notice ?? (open ? kept.current : null)
  if (!shown) return null

  const close = () => {
    setOpen(false)
    if (shown.kind === 'updated') shown.dismiss() // seeing the notes counts as seen
  }
  const title = shown.installing ? `Installing ${shown.version}…` : shown.kind === 'updated' ? `Updated to ${shown.version}` : 'Update available'
  const sub = shown.installing ? 'Overseer will restart' : shown.kind === 'updated' ? 'See what’s new' : `${shown.version} · See what’s new`
  return (
    <>
      {notice && (
        <div className="update-notice-wrap">
          <div className="update-notice">
            <button type="button" className="update-notice-main" onClick={() => setOpen(true)} aria-haspopup="dialog">
              {shown.installing ? <span className="spinner" /> : <span className="update-dot" />}
              <span className="update-notice-text">
                <span className="update-notice-title">{title}</span>
                <span className="update-notice-sub">{sub}</span>
              </span>
            </button>
            {!shown.installing && (
              <button type="button" className="icon-btn icon-btn-sm update-notice-x" aria-label={shown.kind === 'updated' ? 'Dismiss' : `Hide until the next release`} title={shown.kind === 'updated' ? 'Dismiss' : 'Later'} onClick={shown.dismiss}>
                <Icon name="close" size={14} />
              </button>
            )}
          </div>
        </div>
      )}
      {open && <UpdateDialog notice={shown} onClose={close} onLater={() => { setOpen(false); shown.dismiss() }} />}
    </>
  )
}

function UpdateDialog({ notice, onClose, onLater }: { notice: Notice; onClose: () => void; onLater: () => void }) {
  const { status } = notice
  const available = notice.kind === 'available'
  const [notes, setNotes] = useState<UpdateNotes | null>(null)
  const [failed, setFailed] = useState(false)
  const [starting, setStarting] = useState(false)
  const [message, setMessage] = useState('')
  const installing = starting || notice.installing

  useEffect(() => {
    let alive = true
    api.get<UpdateNotes>('/api/updates/notes').then((next) => { if (alive) setNotes(next) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [])

  // After starting an install the hub restarts into the new version; poll
  // until it answers as that version, then reload into it.
  const from = useRef(status.currentVersion)
  useEffect(() => {
    if (!installing) return
    const started = Date.now()
    const timer = window.setInterval(() => {
      updateResource.refresh()
      const next = updateResource.get()
      if (next && next.currentVersion !== from.current) { window.clearInterval(timer); location.reload(); return }
      if (next && !next.applying && next.error) {
        window.clearInterval(timer)
        setStarting(false)
        setMessage(next.error)
      } else if (Date.now() - started > 3 * 60_000) {
        window.clearInterval(timer)
        setStarting(false)
        setMessage('This is taking longer than expected. Check Settings → General.')
      }
    }, 2000)
    return () => window.clearInterval(timer)
  }, [installing])

  const install = async () => {
    setMessage('')
    setStarting(true)
    try {
      await api.post('/api/updates/install')
    } catch (error) {
      setStarting(false)
      setMessage(error instanceof Error ? error.message : 'Could not start the update')
    }
  }

  const entries: ReleaseNotes[] = available ? notes?.newer ?? [] : notes?.current ? [notes.current] : []
  const loading = !notes && !failed
  const footer = available ? (
    <>
      <button className="btn-secondary" onClick={onLater} disabled={installing}>Later</button>
      {status.managed ? (
        <button className="btn-primary" onClick={install} disabled={installing}>{installing ? 'Installing…' : 'Install update'}</button>
      ) : (
        <Link to="/settings/general" className="btn-primary" onClick={onClose}>How to update</Link>
      )}
    </>
  ) : (
    <button className="btn-primary" onClick={onClose}>Got it</button>
  )

  return (
    <Modal title={available ? `Overseer ${notice.version} is available` : `Updated to ${notice.version}`} onClose={onClose} wide footer={footer}>
      <p className="update-lede">
        {installing
          ? `Installing ${notice.version}. Overseer restarts when it’s done and this page reloads.`
          : available
            ? `You’re on ${notice.current}.${status.managed ? '' : ' This hub doesn’t update itself; Settings → General explains how.'}`
            : 'Overseer updated itself. Here’s what came with it.'}
      </p>
      {message && <p className="update-error" role="alert">{message}</p>}
      <div className="update-notes">
        {loading && <><div className="skeleton update-skel" /><div className="skeleton update-skel" style={{ width: '70%' }} /><div className="skeleton update-skel" style={{ width: '85%' }} /></>}
        {!loading && entries.length === 0 && (
          <p className="update-empty">The release notes aren’t available right now. Read them in the <a href={CHANGELOG} target="_blank" rel="noreferrer">changelog</a>.</p>
        )}
        {entries.map((entry) => <Entry key={entry.version} entry={entry} showVersion={entries.length > 1 || available} />)}
        {entries.length > 0 && <p className="update-more"><a href={CHANGELOG} target="_blank" rel="noreferrer">Full changelog<Icon name="arrow-up-right" size={13} /></a></p>}
      </div>
    </Modal>
  )
}

function Entry({ entry, showVersion }: { entry: ReleaseNotes; showVersion: boolean }) {
  return (
    <section className="update-entry">
      {showVersion && (
        <header className="update-entry-head">
          <h3>{entry.version}</h3>
          {entry.date && <time>{entry.date}</time>}
        </header>
      )}
      {entry.intro && <p className="update-intro">{inline(entry.intro)}</p>}
      {entry.groups.filter((group) => group.items.length > 0).map((group) => (
        <div key={group.title} className="update-group">
          <h4 className={`update-tag update-tag-${group.title.toLowerCase()}`}>{group.title}</h4>
          <ul>{group.items.map((item, index) => <li key={index}>{inline(item)}</li>)}</ul>
        </div>
      ))}
    </section>
  )
}

// **bold**, `code` and [links](url) are all the changelog uses. Relative
// links point at the repository.
function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={index}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={index}>{part.slice(1, -1)}</code>
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (link) {
      const href = /^https?:\/\//.test(link[2]) ? link[2] : `${REPO}/blob/main/${link[2]}`
      return <a key={index} href={href} target="_blank" rel="noreferrer">{link[1]}</a>
    }
    return <Fragment key={index}>{part}</Fragment>
  })
}
