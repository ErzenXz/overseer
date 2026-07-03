import { useEffect, useState } from 'react'
import { api } from '../api'
import { useHubEvents } from '../hooks'
import Modal from './Modal'

export default function AddDeviceModal({ onClose }: { onClose: () => void }) {
  const [command, setCommand] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [joined, setJoined] = useState(false)

  useEffect(() => {
    api
      .post<{ command: string }>('/api/enroll-tokens')
      .then((r) => setCommand(r.command))
      .catch((e) => setError(e.message))
  }, [])

  // The modal celebrates live when the new device connects.
  useHubEvents((e) => {
    if (e.type === 'device.online') setJoined(true)
  })

  const copy = async () => {
    await navigator.clipboard.writeText(command)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Modal title="Add a device" onClose={onClose}>
      <p className="mb-4 text-sm text-slate-400">
        Paste this on any <span className="text-slate-200">Linux or macOS</span>{' '}
        machine. It installs the agent, connects it to this hub, and keeps it
        running in the background.
      </p>
      {error ? (
        <p className="text-sm text-rose-400">{error}</p>
      ) : (
        <div className="mb-4 flex items-stretch gap-2">
          <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-[13px] text-emerald-300">
            {command || 'Generating…'}
          </code>
          <button
            onClick={copy}
            disabled={!command}
            className="shrink-0 rounded-lg border border-slate-700 px-3 text-sm text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      )}
      <p className="mb-4 text-xs text-slate-500">
        The link is single-use and expires in 15 minutes. Generate a new one
        per device.
      </p>
      {joined ? (
        <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
          <span className="text-sm font-medium text-emerald-300">
            ✓ Device connected!
          </span>
          <button
            onClick={onClose}
            className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-400"
          >
            See it
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span className="h-2 w-2 animate-pulse rounded-full bg-sky-400" />
          Waiting for the device to join…
        </div>
      )}
    </Modal>
  )
}
