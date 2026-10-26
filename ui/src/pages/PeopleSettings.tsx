import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api'
import { relativeTime } from '../agents'
import { Avatar } from '../components/Presence'
import Icon from '../components/Icon'
import { Menu, MenuItem, MenuSeparator } from '../components/Menu'
import Modal from '../components/Modal'
import { useShell } from '../shell'
import { refreshTeam, useTeam, type Person } from '../teams'

const fail = (cause: unknown) => (cause instanceof Error ? cause.message : 'That didn’t work')

// Owner-only settings pages say so to everyone else.
export function OwnerOnly({ children }: { children: ReactNode }) {
  const team = useTeam()
  if (!team.loaded) return <p className="tm-hint">Loading…</p>
  if (!team.isOwner) return <div className="settings-group mt-5"><p className="tm-empty">Only an owner can change this. Ask one of the owners if you need something different.</p></div>
  return <>{children}</>
}

interface Invite {
  id: string
  label?: string
  createdBy: string
  createdAt: number
  expiresAt: number
  status: 'pending' | 'used' | 'expired' | 'revoked'
  usedBy?: string
}

function daysLeft(unix: number) {
  const days = Math.max(0, Math.ceil((unix - Date.now() / 1000) / 86400))
  return days <= 1 ? 'Expires today' : `Expires in ${days} days`
}

// Settings → People: who is on the hub, and how to add more.
export function PeopleSettings() {
  const team = useTeam()
  const { toast } = useShell()
  const [invites, setInvites] = useState<Invite[] | null>(null)
  const [fresh, setFresh] = useState<{ url: string; label: string } | null>(null)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)

  const loadInvites = useCallback(() => {
    if (!team.isOwner) return
    api.get<Invite[]>('/api/invites').then(setInvites).catch(() => setInvites([]))
  }, [team.isOwner])
  useEffect(() => { loadInvites() }, [loadInvites])

  const invite = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const made = await api.post<{ url: string; label?: string }>('/api/invites', { label: label.trim() })
      setFresh({ url: made.url, label: made.label ?? label.trim() })
      setLabel('')
      loadInvites()
    } catch (cause) { toast(fail(cause)) } finally { setBusy(false) }
  }
  const copy = (text: string) => { navigator.clipboard?.writeText(text); toast('Link copied') }
  const revoke = async (item: Invite) => {
    try { await api.del(`/api/invites/${item.id}`); toast('Invite revoked'); loadInvites() } catch (cause) { toast(fail(cause)) }
  }
  const act = (run: () => Promise<unknown>, done: string) => async () => {
    try { await run(); toast(done); refreshTeam() } catch (cause) { toast(fail(cause)) }
  }
  const owners = team.people.filter((person) => person.role === 'owner').length
  const pending = (invites ?? []).filter((item) => item.status === 'pending')

  return (
    <>
      <div className="settings-group mt-5">
        {!team.loaded && <p className="tm-empty">Loading…</p>}
        {team.all.filter((person) => !person.removed).map((person) => {
          const self = person.id === team.me?.id
          const lastOwner = person.role === 'owner' && !person.disabled && owners <= 1
          return (
            <div key={person.id} className={`settings-row tm-row ${person.disabled ? 'tm-off' : ''}`}>
              <Avatar id={person.id} name={person.name} size={34} />
              <span className="settings-row-main min-w-0 flex-1">
                <span className="settings-row-title block truncate">{person.name}{self && <span className="tm-you">You</span>}</span>
                <span className="settings-row-sub block truncate">
                  {person.email ? `${person.email} · ` : ''}{self ? 'Online now' : person.lastSeen ? `Seen ${relativeTime(person.lastSeen)}` : 'Hasn’t signed in yet'}
                </span>
              </span>
              {person.disabled && <span className="badge badge-red">Disabled</span>}
              <span className={`badge ${person.role === 'owner' ? 'badge-amber' : ''}`}>{person.role === 'owner' ? 'Owner' : 'Member'}</span>
              {team.isOwner ? (
                <Menu placement="bottom-end" width={230} trigger={<button className="icon-btn" aria-label={`Actions for ${person.name}`}><Icon name="more" size={18} /></button>}>
                  {(close) => (
                    <>
                      {person.role === 'member'
                        ? <MenuItem icon="shield" label="Make owner" description="Can manage people, updates and tokens" onClick={() => { close(); act(() => api.patch(`/api/users/${person.id}`, { role: 'owner' }), `${person.name} is an owner`)() }} />
                        : <MenuItem icon="user" label="Make member" disabled={lastOwner} description={lastOwner ? 'The hub needs one owner' : undefined} onClick={() => { close(); act(() => api.patch(`/api/users/${person.id}`, { role: 'member' }), `${person.name} is a member`)() }} />}
                      {!self && <MenuItem icon={person.disabled ? 'check' : 'lock'} label={person.disabled ? 'Enable' : 'Disable'} description={person.disabled ? undefined : 'Signs them out and blocks sign-in'} onClick={() => { close(); act(() => api.patch(`/api/users/${person.id}`, { disabled: !person.disabled }), person.disabled ? `${person.name} can sign in again` : `${person.name} is disabled`)() }} />}
                      {!self && <MenuSeparator />}
                      {!self && <MenuItem icon="trash" label="Remove" danger description="Their sessions stay, under their name" onClick={() => {
                        close()
                        if (!confirm(`Remove ${person.name}? They’re signed out and can’t come back unless you invite them again. Their sessions stay.`)) return
                        act(() => api.del(`/api/users/${person.id}`), `${person.name} was removed`)()
                      }} />}
                      {self && <MenuItem icon="key" label="Change password" onClick={() => { close(); setPasswordOpen(true) }} />}
                    </>
                  )}
                </Menu>
              ) : self ? (
                <button className="icon-btn" aria-label="Change password" title="Change password" onClick={() => setPasswordOpen(true)}><Icon name="key" size={18} /></button>
              ) : null}
            </div>
          )
        })}
      </div>

      {team.me && <ProfileCard person={team.me} onPassword={() => setPasswordOpen(true)} />}

      {team.isOwner && (
        <>
          <h2 className="settings-h2">Invite someone</h2>
          <p className="tm-hint">Make a one-time link. They pick a name and password and join as a member. The link works for 7 days.</p>
          <form className="tm-invite-form" onSubmit={invite}>
            <input className="input" placeholder="Who is it for? (optional)" value={label} maxLength={40} onChange={(event) => setLabel(event.target.value)} aria-label="Who is the invite for" />
            <button className="btn btn-dark" disabled={busy}>{busy ? <span className="spinner" /> : <Icon name="user-plus" size={16} />}Create invite link</button>
          </form>
          {fresh && (
            <div className="tm-fresh" role="status">
              <p className="tm-fresh-title">Invite link{fresh.label ? ` for ${fresh.label}` : ''}</p>
              <div className="tm-fresh-link"><code>{fresh.url}</code><button className="btn btn-outline btn-sm" onClick={() => copy(fresh.url)}><Icon name="copy" size={14} />Copy</button></div>
              <p className="tm-fresh-note">Copy it now. It’s shown once and can’t be listed again, but you can revoke it below.</p>
            </div>
          )}
          {pending.length > 0 && (
            <div className="settings-group mt-4">
              {pending.map((item) => (
                <div key={item.id} className="settings-row tm-row" style={{ minHeight: 60 }}>
                  <span className="tile-icon"><Icon name="link" size={17} /></span>
                  <span className="settings-row-main min-w-0 flex-1">
                    <span className="settings-row-title block truncate">{item.label || 'Invite link'}</span>
                    <span className="settings-row-sub block truncate">Made by {item.createdBy || 'an owner'} · {daysLeft(item.expiresAt)}</span>
                  </span>
                  <button className="btn btn-outline btn-sm" onClick={() => revoke(item)}>Revoke</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {passwordOpen && <PasswordDialog onClose={() => setPasswordOpen(false)} />}
    </>
  )
}

// Your own name and email.
function ProfileCard({ person, onPassword }: { person: Person; onPassword: () => void }) {
  const { toast } = useShell()
  const [name, setName] = useState(person.name)
  const [email, setEmail] = useState(person.email ?? '')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setName(person.name); setEmail(person.email ?? '') }, [person.name, person.email])
  const changed = name.trim() !== person.name || email.trim() !== (person.email ?? '')
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!changed || busy) return
    setBusy(true)
    try { await api.patch('/api/me', { name: name.trim(), email: email.trim() }); toast('Saved'); refreshTeam() } catch (cause) { toast(fail(cause)) } finally { setBusy(false) }
  }
  return (
    <>
      <h2 className="settings-h2">Your profile</h2>
      <form className="settings-group tm-profile" onSubmit={save}>
        <label className="tm-field"><span className="field-label">Name</span><input className="input" value={name} maxLength={32} onChange={(event) => setName(event.target.value)} required /></label>
        <label className="tm-field"><span className="field-label">Email <span className="text-faint">(optional)</span></span><input className="input" type="email" value={email} maxLength={120} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
        <div className="tm-profile-actions">
          <button type="button" className="btn btn-outline" onClick={onPassword}><Icon name="key" size={15} />Change password</button>
          <button className="btn btn-dark" disabled={!changed || busy}>{busy && <span className="spinner" />}Save</button>
        </div>
      </form>
    </>
  )
}

function PasswordDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useShell()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await api.post('/api/me/password', { current, password: next })
      toast('Password changed. Other devices were signed out.')
      onClose()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Couldn’t change it')
      setBusy(false)
    }
  }
  return (
    <Modal title="Change password" onClose={onClose}>
      <form onSubmit={submit}>
        <label className="tm-field"><span className="field-label">Current password</span><input className="input" type="password" value={current} onChange={(event) => setCurrent(event.target.value)} autoComplete="current-password" required /></label>
        <label className="tm-field mt-3"><span className="field-label">New password</span><input className="input" type="password" value={next} onChange={(event) => setNext(event.target.value)} autoComplete="new-password" minLength={8} required /></label>
        <p className="tm-hint">At least 8 characters. Your other sessions are signed out.</p>
        {error && <p className="mt-2 text-[13px] text-danger" role="alert">{error}</p>}
        <div className="modal-foot"><button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button><button className="btn btn-dark" disabled={busy || next.length < 8 || !current}>{busy && <span className="spinner" />}Change password</button></div>
      </form>
    </Modal>
  )
}

// ---- Settings → Activity ----

interface Entry {
  id: number
  at: number
  actor: string
  action: string
  target?: string
  detail?: string
}

const q = (text?: string) => (text ? `“${text}”` : '')

const describe: Record<string, (entry: Entry) => string> = {
  setup: () => 'set up the hub',
  login: () => 'signed in',
  'login.failed': () => 'failed to sign in',
  'invite.create': (e) => `made an invite link${e.target ? ` for ${e.target}` : ''}`,
  'invite.revoke': (e) => `revoked an invite link${e.target ? ` for ${e.target}` : ''}`,
  'invite.accept': (e) => `joined from an invite link`.replace('joined', e.target && e.target !== e.actor ? `joined as ${e.target}` : 'joined'),
  'user.role': (e) => `changed ${e.target}’s role: ${e.detail}`,
  'user.disable': (e) => `disabled ${e.target}`,
  'user.enable': (e) => `enabled ${e.target}`,
  'user.remove': (e) => `removed ${e.target}`,
  'user.rename': (e) => `renamed ${e.target} (${e.detail})`,
  'password.change': () => 'changed their password',
  approval: (e) => `answered an approval in ${q(e.target)}${e.detail ? ` (${e.detail.replace(/_/g, ' ')})` : ''}`,
  'thread.handoff': (e) => `handed off ${q(e.target)} ${e.detail ?? ''}`.trim(),
  'session.start': (e) => `started ${q(e.target)}`,
  'session.stop': (e) => `stopped ${q(e.target)}`,
  'session.delete': (e) => `deleted ${q(e.target)}`,
  'terminal.start': (e) => `opened a terminal${e.target ? ` on ${e.target}` : ''}`,
  'terminal.stop': (e) => `closed terminal ${e.target ?? ''}`.trim(),
  'settings.previews': () => 'changed the previews domain',
  'token.create': () => 'created an API token',
  'token.delete': () => 'revoked an API token',
  'update.install': () => 'installed a software update',
  'update.rollback': () => 'rolled back the software update',
  'update.settings': () => 'changed automatic updates',
  'device.add': () => 'started adding a machine',
  'device.remove': (e) => `removed ${e.target || 'a machine'}`,
}

const iconFor = (action: string) => (
  action.startsWith('login') || action === 'setup' ? 'lock'
    : action.startsWith('invite') || action.startsWith('user') || action === 'password.change' ? 'users'
      : action === 'approval' ? 'shield'
        : action === 'thread.handoff' ? 'arrow-up-right'
          : action.startsWith('session') || action.startsWith('terminal') ? 'terminal'
            : 'sliders'
) as 'lock' | 'users' | 'shield' | 'arrow-up-right' | 'terminal' | 'sliders'

function whenText(unix: number) {
  const date = new Date(unix * 1000)
  const sameDay = new Date().toDateString() === date.toDateString()
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return sameDay ? time : `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`
}

// Settings → Activity: who did what, newest first. Owners only.
export function ActivitySettings() {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [next, setNext] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (before: number) => {
    setLoading(true)
    try {
      const page = await api.get<{ entries: Entry[]; next: number }>(`/api/audit?limit=30${before ? `&before=${before}` : ''}`)
      setEntries((current) => (before ? [...(current ?? []), ...page.entries] : page.entries))
      setNext(page.next)
      setError('')
    } catch (cause) { setError(fail(cause)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load(0) }, [load])

  return (
    <>
      <p className="tm-hint">Sign-ins, invites, role changes, approvals, hand-offs, sessions and settings changes. Only owners can see this.</p>
      <div className="settings-group mt-5">
        {entries === null && !error && <p className="tm-empty">Loading…</p>}
        {error && <p className="tm-empty text-danger">{error}</p>}
        {entries?.length === 0 && <p className="tm-empty">Nothing has happened yet.</p>}
        {entries?.map((entry) => {
          const text = (describe[entry.action] ?? (() => entry.action))(entry)
          return (
            <div key={entry.id} className="settings-row tm-row tm-log" style={{ minHeight: 52 }}>
              <span className="tile-icon"><Icon name={iconFor(entry.action)} size={16} /></span>
              <span className="settings-row-main min-w-0 flex-1"><span className="tm-log-text"><strong>{entry.actor || 'Someone'}</strong> {text}</span></span>
              <time className="tm-log-time" dateTime={new Date(entry.at * 1000).toISOString()}>{whenText(entry.at)}</time>
            </div>
          )
        })}
      </div>
      {next > 0 && <div className="tm-more"><button className="btn btn-outline" disabled={loading} onClick={() => load(next)}>{loading && <span className="spinner" />}Show older</button></div>}
    </>
  )
}
