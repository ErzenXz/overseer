import { useEffect, useState } from 'react'
import { api } from '../api'
import { useHubEvents } from '../hooks'
import Modal from './Modal'

export default function AddDeviceModal({ onClose }: { onClose: () => void }) {
  const [command, setCommand] = useState('')
  const [windowsCommand, setWindowsCommand] = useState('')
  const [platform, setPlatform] = useState<'unix' | 'windows'>('unix')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [joined, setJoined] = useState(false)

  useEffect(() => {
    api
      .post<{ command: string; windowsCommand: string }>('/api/enroll-tokens')
      .then((r) => {
        setCommand(r.command)
        setWindowsCommand(r.windowsCommand)
      })
      .catch((e) => setError(e.message))
  }, [])

  // The modal celebrates live when the new device connects.
  useHubEvents((e) => {
    if (e.type === 'device.online') setJoined(true)
  })

  const copy = async () => {
    await navigator.clipboard.writeText(activeCommand)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const activeCommand = platform === 'windows' ? windowsCommand : command

  return (
    <Modal title="Add a device" onClose={onClose}>
      <p className="mb-4 text-sm text-zinc-400">
        Paste this on the device you want to add. It installs the agent,
        connects it to this hub, and keeps it running in the background.
      </p>
      {error ? (
        <p className="text-sm text-rose-400">{error}</p>
      ) : (
        <>
          <div className="mb-3 inline-flex rounded-lg border border-zinc-700 bg-zinc-950 p-1">
            <button
              type="button"
              onClick={() => setPlatform('unix')}
              className={`rounded-md px-3 py-1.5 text-sm transition ${
                platform === 'unix'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Linux / macOS
            </button>
            <button
              type="button"
              onClick={() => setPlatform('windows')}
              className={`rounded-md px-3 py-1.5 text-sm transition ${
                platform === 'windows'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Windows
            </button>
          </div>
          <div className="mb-4 flex items-stretch gap-2">
            <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-zinc-700 bg-zinc-950 p-3 font-mono text-[13px] text-emerald-300">
              {activeCommand || 'Generating…'}
            </code>
            <button
              onClick={copy}
              disabled={!activeCommand}
              className="shrink-0 rounded-lg border border-zinc-700 px-3 text-sm text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-50"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </>
      )}
      <p className="mb-4 text-xs text-zinc-500">
        The link is single-use and expires in 15 minutes. Generate a new one
        per device.
      </p>
      {joined ? (
        <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
          <span className="text-sm font-medium text-emerald-300">
            Device connected
          </span>
          <button
            onClick={onClose}
            className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-400"
          >
            See it
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <span className="h-2 w-2 animate-pulse rounded-full bg-lime-400" />
          Waiting for the device to join…
        </div>
      )}
    </Modal>
  )
}
