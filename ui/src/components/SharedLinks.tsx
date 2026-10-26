import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { timeAgo } from '../api'
import { sharesApi, type ShareLink } from '../share'
import { useShell } from '../shell'
import Icon from './Icon'

function expiry(link: ShareLink): string {
  if (link.expired) return 'Expired'
  if (!link.expiresAt) return 'Never expires'
  const hours = Math.max(1, Math.round((link.expiresAt - Date.now() / 1000) / 3600))
  return hours < 48 ? `Expires in ${hours} hour${hours === 1 ? '' : 's'}` : `Expires in ${Math.round(hours / 24)} days`
}

// Settings → Shared links: every link made from the share dialog, with the
// one thing you can do to it, turn it off.
export default function SharedLinks() {
  const { toast } = useShell()
  const [links, setLinks] = useState<ShareLink[] | null>(null)
  const [error, setError] = useState('')
  const refresh = useCallback(() => sharesApi.list().then((list) => { setLinks(list); setError('') }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Couldn’t load links')), [])
  useEffect(() => { refresh() }, [refresh])

  const revoke = async (link: ShareLink) => {
    if (!confirm(`Turn off this link to “${link.title}”? Anyone who has it will see that it expired.`)) return
    try { await sharesApi.revoke(link.id); setLinks((list) => list?.filter((item) => item.id !== link.id) ?? list); toast('Link turned off') }
    catch (cause) { toast(cause instanceof Error ? cause.message : 'Couldn’t turn it off') }
  }

  return (
    <>
      <p className="hint mt-5">Links open without a login and only show the one session. The full link is shown once, when you create it, so it can’t be listed here. Turn off a link and it stops working at once.</p>
      <div className="settings-group mt-5">
        {links === null && !error && <p className="p-5 text-[13.5px] text-muted">Loading…</p>}
        {error && <p className="p-5 text-[13.5px] text-danger">{error}</p>}
        {links?.length === 0 && <p className="p-5 text-[13.5px] text-muted">No shared links yet. Open a session’s menu and choose Share…</p>}
        {links?.map((link) => (
          <div key={link.id} className="settings-row sh-row" style={{ minHeight: 68 }}>
            <span className="tile-icon"><Icon name={link.mode === 'live' ? 'radio' : 'history'} size={18} /></span>
            <span className="settings-row-main min-w-0 flex-1">
              <Link to={`/sessions/${link.threadId}`} className="settings-row-title block truncate hover:underline">{link.title || 'Untitled session'}</Link>
              <span className="settings-row-sub block">
                <span>{link.mode === 'live' ? 'Live' : 'Replay'}</span>
                <span className="sh-dotsep">Created {timeAgo(link.createdAt)}</span>
                <span className="sh-dotsep">{link.views} view{link.views === 1 ? '' : 's'}</span>
                <span className={`sh-dotsep ${link.expired ? 'text-warning' : ''}`}>{expiry(link)}</span>
                {!link.hideNames && <span className="sh-dotsep">Names shown</span>}
              </span>
            </span>
            <button className="btn btn-outline btn-sm" onClick={() => revoke(link)}>Revoke</button>
          </div>
        ))}
      </div>
    </>
  )
}
