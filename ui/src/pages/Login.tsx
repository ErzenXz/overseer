import { FormEvent, useState } from 'react'
import { api, ApiError } from '../api'
import Icon from '../components/Icon'
import { AppIcon } from '../components/Logo'
import { mockEnabled } from '../mock'

export default function Login({
  setupDone,
  onSuccess,
}: {
  setupDone: boolean
  onSuccess: () => void
}) {
  // Installers print a link with ?setup=CODE so the one-time code fills itself.
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('setup') ?? '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError('')
    if (!setupDone && password !== confirm) {
      setError('Passwords don’t match.')
      return
    }
    setBusy(true)
    try {
      await api.post(setupDone ? '/api/login' : '/api/setup', setupDone ? { password } : { password, code })
      if (!setupDone) history.replaceState(null, '', location.pathname)
      // A preview link opened while signed out comes back here with
      // ?next=/api/previews/auth?return=…; carry on to the preview.
      const next = new URLSearchParams(location.search).get('next') ?? ''
      if (next.startsWith('/api/previews/auth?')) { location.assign(next); return }
      onSuccess()
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError('Incorrect password. Try again.')
      else if (err instanceof ApiError && err.status === 403) setError('That setup code isn’t right. It’s in the installer output and the hub’s log.')
      else setError(err instanceof ApiError ? err.message : 'Couldn’t reach your hub. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-shell">
      <main className="login-main">
        <div className="login-content">
          <div className="login-brand">
            <AppIcon size={22} />
            <span>Overseer</span>
          </div>
          <h1>{setupDone ? 'Sign in' : 'Create a password'}</h1>
          <p className="login-subtitle">
            {setupDone ? 'Enter your password to continue.' : 'Choose the administrator password for this hub.'}
          </p>
          <form onSubmit={submit} aria-busy={busy}>
            {!setupDone && (
              <div className="login-field">
                <label htmlFor="setup-code">Setup code</label>
                <div className="login-input">
                  <input id="setup-code" name="setup-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="ABCDE-23456" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} required disabled={busy} style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.04em' }} />
                </div>
                <p className="login-help">Shown by the installer and in the hub’s log. It keeps anyone else on your network from claiming this hub first.</p>
              </div>
            )}
            <PasswordField
              id="password"
              label="Password"
              value={password}
              onChange={setPassword}
              autoComplete={setupDone ? 'current-password' : 'new-password'}
              autoFocus={setupDone || !!code}
              minLength={setupDone ? undefined : 8}
              disabled={busy}
            />
            {!setupDone && (
              <PasswordField
                id="confirm-password"
                label="Confirm password"
                value={confirm}
                onChange={setConfirm}
                autoComplete="new-password"
                disabled={busy}
              />
            )}
            {error && <p className="login-error" role="alert">{error}</p>}
            <button type="submit" className="login-submit" disabled={busy}>
              {busy ? (
                <><span className="spinner" />{setupDone ? 'Signing in…' : 'Creating…'}</>
              ) : (
                setupDone ? 'Sign in' : 'Create password'
              )}
            </button>
          </form>
          {mockEnabled && <p className="login-demo">Demo mode · any password works</p>}
        </div>
      </main>
    </div>
  )
}

function PasswordField({ id, label, value, onChange, autoComplete, autoFocus, minLength, disabled }: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: string
  autoFocus?: boolean
  minLength?: number
  disabled: boolean
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="login-field">
      <label htmlFor={id}>{label}</label>
      <div className="login-input">
        <input
          id={id}
          name={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          minLength={minLength}
          required
          disabled={disabled}
          spellCheck={false}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => setVisible(!visible)}
          aria-label={`${visible ? 'Hide' : 'Show'} ${id === 'confirm-password' ? 'confirmation password' : 'password'}`}
          aria-controls={id}
        >
          <Icon name={visible ? 'eye-off' : 'eye'} size={16} />
        </button>
      </div>
    </div>
  )
}
