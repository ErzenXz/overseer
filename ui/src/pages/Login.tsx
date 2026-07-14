import { FormEvent, useState } from 'react'
import { api } from '../api'

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
    <div className="flex min-h-full items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="surface w-full max-w-sm rounded-2xl p-8"
      >
        <div className="mb-2 flex items-center gap-3">
          <svg width="28" height="28" viewBox="0 0 100 100" aria-hidden>
            <circle cx="50" cy="50" r="42" className="fill-lime-300" />
            <circle cx="50" cy="50" r="18" className="fill-zinc-950" />
            <circle cx="50" cy="50" r="8" className="fill-lime-100" />
          </svg>
          <h1 className="text-xl font-semibold text-zinc-100">Overseer</h1>
        </div>
        <p className="mb-6 text-sm text-zinc-400">
          {setupDone
            ? 'Enter your password to access your fleet.'
            : 'Welcome! Choose an admin password to protect your hub.'}
        </p>
        <label className="mb-1 block text-sm font-medium text-zinc-300">
          Password
        </label>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={setupDone ? undefined : 8}
          required
          className="mb-4 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none focus:border-lime-500"
        />
        {!setupDone && (
          <>
            <label className="mb-1 block text-sm font-medium text-zinc-300">
              Confirm password
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              className="mb-4 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none focus:border-lime-500"
            />
            <p className="mb-4 text-xs text-zinc-500">
              At least 8 characters. This is the only account — keep it safe.
            </p>
          </>
        )}
        {error && <p className="mb-4 text-sm text-rose-400">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="btn-primary w-full"
        >
          {busy ? 'Please wait…' : setupDone ? 'Log in' : 'Set password & start'}
        </button>
      </form>
    </div>
  )
}
