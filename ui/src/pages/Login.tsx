import { FormEvent, useState } from 'react'
import { api, ApiError } from '../api'
import Icon from '../components/Icon'

export default function Login({
  setupDone,
  onSuccess,
}: {
  setupDone: boolean
  onSuccess: () => void
}) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [invalidField, setInvalidField] = useState<'password' | 'confirm-password' | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError('')
    setInvalidField(null)
    if (!setupDone && password !== confirm) {
      setError('Your passwords don’t match. Please try again.')
      setInvalidField('confirm-password')
      return
    }
    setBusy(true)
    try {
      await api.post(setupDone ? '/api/login' : '/api/setup', { password })
      onSuccess()
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('That password isn’t correct. Please try again.')
        setInvalidField('password')
      } else {
        setError(err instanceof ApiError ? err.message : 'We couldn’t reach your hub. Check your connection and try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-shell">
      <header className="login-header">
        <span className="login-wordmark"><Icon name="fleet" size={20} />Overseer</span>
        <a href="https://github.com/ErzenXz/overseer#readme" target="_blank" rel="noreferrer">Documentation<Icon name="arrow" size={14} className="-rotate-45" /></a>
      </header>
      <main className="login-main">
        <div className="login-content">
          <section className="login-panel" aria-labelledby="login-heading">
            <div className="login-intro">
              <span className="login-mark"><Icon name="fleet" size={24} /></span>
              <h1 id="login-heading">{setupDone ? 'Welcome back' : 'Your workspace starts here'}</h1>
              <p>{setupDone ? 'Sign in to your Overseer workspace.' : 'Create an administrator password to get started.'}</p>
            </div>
            <form onSubmit={submit} aria-busy={busy}>
              <PasswordField
                id="password"
                label={setupDone ? 'Password' : 'Create password'}
                value={password}
                onChange={setPassword}
                autoComplete={setupDone ? 'current-password' : 'new-password'}
                autoFocus
                minLength={setupDone ? undefined : 8}
                hint={setupDone ? undefined : 'Use at least 8 characters.'}
                disabled={busy}
                invalid={invalidField === 'password'}
                error={!!error}
              />
              {!setupDone && <PasswordField id="confirm-password" label="Confirm password" value={confirm} onChange={setConfirm} autoComplete="new-password" disabled={busy} invalid={invalidField === 'confirm-password'} error={!!error} />}
              {error && <div id="login-error" className="login-error" role="alert"><Icon name="alert" size={15} /><p>{error}</p></div>}
              <button type="submit" disabled={busy} className="login-submit">
                {busy ? <><span className="spinner" />{setupDone ? 'Signing in…' : 'Creating workspace…'}</> : <>{setupDone ? 'Sign in' : 'Create workspace'}<Icon name="arrow" size={16} /></>}
              </button>
            </form>
            <div className="login-card-footer"><Icon name="lock" size={13} /><span>{setupDone ? 'Use the password set by your administrator.' : 'This password gives access to your entire hub.'}</span></div>
          </section>
          {setupDone ? <details className="login-help"><summary>Trouble signing in?<Icon name="chevron" size={12} /></summary><p>Ask the person who set up this hub for access. Overseer uses one administrator password, not an email account.</p></details> : <p className="login-setup-note">Keep this password somewhere safe.<br />You’ll use it whenever you sign in to this hub.</p>}
        </div>
      </main>
      <footer className="login-footer"><Icon name="monitor" size={13} />Your workspace. Self-hosted.</footer>
    </div>
  )
}

function PasswordField({ id, label, value, onChange, autoComplete, autoFocus, minLength, hint, disabled, invalid, error }: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: string
  autoFocus?: boolean
  minLength?: number
  hint?: string
  disabled: boolean
  invalid: boolean
  error: boolean
}) {
  const [visible, setVisible] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const descriptions = [hint && `${id}-hint`, capsLock && `${id}-caps`, error && 'login-error'].filter(Boolean).join(' ')
  return <div className="login-field">
    <label htmlFor={id}>{label}</label>
    <div className={`login-input ${invalid ? 'login-input-invalid' : ''}`}>
      <input id={id} name={id} type={visible ? 'text' : 'password'} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autoComplete} autoFocus={autoFocus} minLength={minLength} required disabled={disabled} aria-invalid={invalid || undefined} aria-describedby={descriptions || undefined} placeholder={id === 'confirm-password' ? 'Enter your password again' : 'Enter your password'} onKeyDown={(event) => setCapsLock(event.getModifierState('CapsLock'))} onKeyUp={(event) => setCapsLock(event.getModifierState('CapsLock'))} onBlur={() => setCapsLock(false)} spellCheck={false} />
      <button type="button" disabled={disabled} onClick={() => setVisible(!visible)} aria-label={`${visible ? 'Hide' : 'Show'} ${id === 'confirm-password' ? 'confirmation password' : 'password'}`} aria-controls={id}><Icon name={visible ? 'eye-off' : 'eye'} size={17} /></button>
    </div>
    {hint && <p className="login-field-hint" id={`${id}-hint`}>{hint}</p>}
    {capsLock && <p className="login-field-hint" id={`${id}-caps`} role="status">Caps Lock is on</p>}
  </div>
}
