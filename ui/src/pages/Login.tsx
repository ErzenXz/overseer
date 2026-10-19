import { FormEvent, useState } from 'react'
import { api } from '../api'
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

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!setupDone && password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setBusy(true)
    try {
      await api.post(setupDone ? '/api/login' : '/api/setup', { password })
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-shell">
      <div className="brand"><span className="brand-mark"><Icon name="fleet" size={19} /></span>overseer<span className="brand-period">.</span></div>
      <div className="login-panel">
        <span className="empty-icon"><Icon name="shield" size={25} /></span>
        <h1>{setupDone ? 'Welcome to Overseer' : 'Set up your workspace'}</h1>
        <p>{setupDone ? 'Sign in to your workspace.' : 'Choose an administrator password to get started.'}</p>
      <form
        onSubmit={submit}
        className="w-full"
      >
        <label htmlFor="password" className="mb-2 block field-label">
          Password
        </label>
        <input
          type="password"
          id="password"
          autoComplete={setupDone ? 'current-password' : 'new-password'}
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={setupDone ? undefined : 8}
          required
          className="field-input mb-5"
        />
        {!setupDone && (
          <>
            <label htmlFor="confirm-password" className="mb-2 block field-label">
              Confirm password
            </label>
            <input
              type="password"
              id="confirm-password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              className="field-input mb-4"
            />
            <p className="mb-4 text-xs text-muted">
              At least 8 characters. This is the only account — keep it safe.
            </p>
          </>
        )}
        {error && <p className="mb-4 text-sm text-danger" role="alert">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="btn-primary w-full"
        >
          {busy ? 'Please wait…' : setupDone ? 'Log in' : 'Set password & start'}
        </button>
      </form>
      </div>
      <footer className="page-footnote mt-0"><Icon name="shield" size={13} />Self-hosted. Private by design.</footer>
    </div>
  )
}
