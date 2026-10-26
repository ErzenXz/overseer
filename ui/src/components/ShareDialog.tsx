import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from './Icon'
import { Switch } from './Menu'
import Modal from './Modal'
import { sharesApi, type CreatedShare, type ShareExpiry, type ShareInfo, type ShareMode } from '../share'
import { useShell } from '../shell'
import type { Thread } from '../types'

const expiries: { id: ShareExpiry; label: string }[] = [{ id: '1d', label: '1 day' }, { id: '7d', label: '7 days' }, { id: 'never', label: 'Never' }]

// ShareDialog makes a link to a session: a frozen replay, or a live view.
// The link is shown once; Settings → Shared links turns links off later.
export default function ShareDialog({ thread, onClose }: { thread: Pick<Thread, 'id' | 'title' | 'status'>; onClose: () => void }) {
  const { toast } = useShell()
  const running = thread.status === 'working' || thread.status === 'starting'
  const [mode, setMode] = useState<ShareMode>('replay')
  const [hide, setHide] = useState(true)
  const [expires, setExpires] = useState<ShareExpiry>('7d')
  const [info, setInfo] = useState<ShareInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<CreatedShare | null>(null)
  const [copied, setCopied] = useState(false)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => { sharesApi.info().then(setInfo).catch(() => {}) }, [])
  useEffect(() => { if (created) field.current?.select() }, [created])

  const create = async () => {
    setBusy(true)
    setError('')
    try { setCreated(await sharesApi.create({ threadId: thread.id, mode, hideNames: hide, expires })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Couldn’t create the link') }
    finally { setBusy(false) }
  }
  const copy = () => {
    field.current?.select()
    navigator.clipboard?.writeText(created!.url).then(() => { setCopied(true); toast('Link copied'); window.setTimeout(() => setCopied(false), 1800) }).catch(() => {})
  }
  const host = info ? new URL(info.baseUrl).host : location.host

  return (
    <Modal
      title={created ? 'Link ready' : 'Share session'}
      onClose={onClose}
      footer={created
        ? <button className="btn btn-dark" onClick={onClose}>Done</button>
        : <><button className="btn btn-outline" onClick={onClose}>Cancel</button><button className="btn btn-dark" disabled={busy} onClick={create}>{busy && <span className="spinner" />}Create link</button></>}
    >
      {created ? (
        <div className="sh-dlg">
          <div className="sh-link">
            <input ref={field} className="input input-mono" readOnly value={created.url} aria-label="Share link" onFocus={(event) => event.currentTarget.select()} />
            <button className="btn btn-dark" onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={15} />{copied ? 'Copied' : 'Copy'}</button>
          </div>
          <p className="sh-hint">
            {created.share.mode === 'live' ? 'Live link, view only.' : 'Replay link, frozen as of now.'}{' '}
            {created.share.expiresAt ? `Works until ${new Date(created.share.expiresAt * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.` : 'Never expires.'}{' '}
            You can turn it off any time in <Link className="link" to="/settings/shares" onClick={onClose}>Settings → Shared links</Link>. This is the only time the full link is shown.
          </p>
          {created.private && <Reach host={host} docs={info?.docsUrl} />}
        </div>
      ) : (
        <div className="sh-dlg">
          <p className="sh-lead">Anyone with the link can watch “{thread.title}”. They can’t send messages, approve anything, or see your other sessions.</p>
          <div className="sh-modes" role="radiogroup" aria-label="Kind of link">
            <button type="button" role="radio" aria-checked={mode === 'replay'} className="sh-mode" onClick={() => setMode('replay')}>
              <span className="sh-mode-title"><Icon name="history" size={16} />Replay</span>
              <span className="sh-mode-text">{running ? 'A snapshot of the session as it is right now. What happens next isn’t included.' : 'The session as it is now, with a player to watch it back.'}</span>
            </button>
            <button type="button" role="radio" aria-checked={mode === 'live'} className="sh-mode" onClick={() => setMode('live')}>
              <span className="sh-mode-title"><Icon name="radio" size={16} />Live</span>
              <span className="sh-mode-text">View only. Follows the session in real time, including turns you haven’t sent yet.</span>
            </button>
          </div>
          <div className="sh-opt">
            <span className="sh-opt-main"><span className="sh-opt-title">Hide machine and folder names</span><span className="sh-opt-sub">Shows “the machine” and shortened paths instead.</span></span>
            <Switch checked={hide} onChange={setHide} label="Hide machine and folder names" />
          </div>
          <div className="sh-opt">
            <span className="sh-opt-main"><span className="sh-opt-title">Link expires</span></span>
            <span className="seg" role="radiogroup" aria-label="Expiry">
              {expiries.map((item) => <button key={item.id} type="button" role="radio" aria-checked={expires === item.id} aria-pressed={expires === item.id} onClick={() => setExpires(item.id)}>{item.label}</button>)}
            </span>
          </div>
          {info?.private && <Reach host={host} docs={info.docsUrl} />}
          <p className="sh-hint">Keys and passwords that Overseer recognises are hidden, but look the session over first: anything the agent printed is visible to whoever opens the link.</p>
          {error && <p className="text-[13px] text-danger" role="alert">{error}</p>}
        </div>
      )}
    </Modal>
  )
}

// Reach says, plainly, that a private hub address limits who can open a link.
function Reach({ host, docs }: { host: string; docs?: string }) {
  return (
    <div className="sh-reach" role="note">
      <Icon name="globe" size={16} />
      <p>
        <strong>Only people who can reach this hub can open this link.</strong> Your hub is at {host}, a private address. To share with anyone, give it a public one, like a Cloudflare Tunnel or the built-in HTTPS.{' '}
        <a className="link" href={docs ?? 'https://overseer.sh/docs/remote-access/'} target="_blank" rel="noreferrer">How to set that up</a>
      </p>
    </div>
  )
}
