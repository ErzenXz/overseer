import { FormEvent, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import Icon from '../components/Icon'
import { AppIcon } from '../components/Logo'

// /invite/<token>: the page an invite link opens. The person picks a name and
// a password and joins as a member.
export default function AcceptInvite({ onSuccess }: { onSuccess: () => void }) {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const [state, setState] = useState<'checking' | 'ok' | 'gone'>('checking')
  const [invitedBy, setInvitedBy] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [visible, setVisible] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    api.get<{ valid: boolean; invitedBy?: string }>(`/api/invites/${encodeURIComponent(token)}`)
      .then((res) => { if (alive) { setInvitedBy(res.invitedBy ?? ''); setState('ok') } })
      .catch((cause) => { if (alive) { if (cause instanceof ApiError && cause.status === 429) { setError(cause.message); setState('ok') } else setState('gone') } })
    return () => { alive = false }
  }, [token])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setError('')
    if (password !== confirm) { setError('Passwords don’t match.'); return }
    setBusy(true)
    try {
      await api.post(`/api/invites/${encodeURIComponent(token)}/accept`, { name: name.trim(), password })
      navigate('/', { replace: true })
      onSuccess()
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) setState('gone')
      else setError(cause instanceof ApiError ? cause.message : 'Couldn’t reach your hub. Try again.')
      setBusy(false)
    }
  }

  return (
    <div className="login-shell">
      <main className="login-main">
        <div className="login-content">
          <div className="login-brand"><AppIcon size={22} /><span>Overseer</span></div>
          {state === 'checking' && <div className="mt-10 flex justify-center"><span className="spinner" /></div>}
          {state === 'gone' && (
            <>
              <h1>This invite doesn’t work</h1>
              <p className="login-subtitle">The link has expired, was already used, or was revoked. Ask whoever invited you for a new one.</p>
              <a className="login-submit tm-login-link" href="/">Go to sign in</a>
            </>
          )}
          {state === 'ok' && (
            <>
              <h1>Join this hub</h1>
              <p className="login-subtitle">{invitedBy ? `${invitedBy} invited you.` : 'You were invited.'} Pick a name and a password.</p>
              <form onSubmit={submit} aria-busy={busy}>
                <div className="login-field">
                  <label htmlFor="invite-name">Your name</label>
                  <div className="login-input"><input id="invite-name" name="name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="username" maxLength={32} required autoFocus disabled={busy} /></div>
                  <p className="login-help">Teammates see this on your sessions and approvals. You also sign in with it.</p>
                </div>
                <div className="login-field">
                  <label htmlFor="invite-password">Password</label>
                  <div className="login-input">
                    <input id="invite-password" name="password" type={visible ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} required disabled={busy} spellCheck={false} />
                    <button type="button" onClick={() => setVisible(!visible)} disabled={busy} aria-label={`${visible ? 'Hide' : 'Show'} password`}><Icon name={visible ? 'eye-off' : 'eye'} size={16} /></button>
                  </div>
                </div>
                <div className="login-field">
                  <label htmlFor="invite-confirm">Confirm password</label>
                  <div className="login-input"><input id="invite-confirm" name="confirm" type={visible ? 'text' : 'password'} value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" required disabled={busy} spellCheck={false} /></div>
                </div>
                {error && <p className="login-error" role="alert">{error}</p>}
                <button type="submit" className="login-submit" disabled={busy}>{busy ? <><span className="spinner" />Joining…</> : 'Join'}</button>
              </form>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
