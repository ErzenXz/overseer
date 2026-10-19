import { FormEvent, useEffect, useState } from 'react'
import { api } from '../api'
import type { Device, Preset } from '../types'
import Modal from './Modal'
import Icon from './Icon'

// LaunchSessionModal starts a named session (usually a coding agent) on a
// device. Used from both the device page (single device) and the agents page
// (device picker).
export default function LaunchSessionModal({
  devices,
  onLaunched,
  onClose,
}: {
  devices: Device[]
  onLaunched: (deviceId: string, session: string) => void
  onClose: () => void
}) {
  const online = devices.filter((d) => d.online)
  const [deviceId, setDeviceId] = useState(online[0]?.id ?? '')
  const [presets, setPresets] = useState<Preset[]>([])
  const [presetId, setPresetId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [cwd, setCwd] = useState('')
  const [command, setCommand] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get<Preset[]>('/api/presets').then((ps) => {
      setPresets(ps)
      const claude = ps.find((p) => p.kind === 'claude')
      if (claude) selectPreset(claude, ps)
    }).catch(() => setError('Could not load presets. Enter a command below or leave it empty for a shell.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectPreset = (p: Preset, _all?: Preset[]) => {
    setPresetId(p.id)
    setCommand(p.command)
    if (!name || presets.some((x) => name === defaultName(x))) {
      setName(defaultName(p))
    }
  }

  const defaultName = (p: Preset) =>
    p.kind === 'shell' ? 'term-1' : `${p.kind}-${new Date().getMinutes()}${new Date().getSeconds()}`

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!deviceId || !name) return
    setBusy(true)
    const preset = presets.find((p) => p.id === presetId)
    try {
      await api.post(`/api/devices/${deviceId}/sessions`, {
        name,
        cwd,
        command,
        kind: preset?.kind ?? (command ? command.split(/\s+/)[0] : 'shell'),
      })
      onLaunched(deviceId, name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to launch')
      setBusy(false)
    }
  }

  const inputClass =
    'field-input'

  return (
    <Modal title="New session" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        {devices.length <= 1 && online[0] && <div className="launch-machine"><Icon name="monitor" size={16} /><span>{online[0].name}</span><span className="node-dot node-dot-online" /><span className="text-muted">Online</span></div>}
        {devices.length > 1 && (
          <div>
            <label htmlFor="session-device" className="mb-2 block field-label">
              Machine
            </label>
            <select
              id="session-device"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              className={inputClass}
            >
              {online.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.os}/{d.arch})
                </option>
              ))}
            </select>
          </div>
        )}

        <fieldset>
          <legend className="mb-2 field-label">Run with</legend>
          <div className="preset-options">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => selectPreset(p)}
                aria-pressed={presetId === p.id}
                className="preset-option"
              >
                <Icon name={p.kind === 'shell' ? 'terminal' : 'code'} size={18} />
                {p.name}
              </button>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="session-command" className="mb-2 block field-label">
            Command
          </label>
          <input
            id="session-command"
            value={command}
            onChange={(e) => {
              setCommand(e.target.value)
              setPresetId(null)
            }}
            placeholder="Leave empty for a shell"
            className={`${inputClass} font-mono`}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="session-name" className="mb-2 block field-label">
              Session name
            </label>
            <input
              id="session-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              pattern="[a-zA-Z0-9._\-]+"
              title="Letters, digits, dots, dashes, underscores"
              className={`${inputClass} font-mono`}
            />
          </div>
          <div>
            <label htmlFor="session-directory" className="mb-2 block field-label">
              Working directory
            </label>
            <input
              id="session-directory"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="Home directory"
              className={`${inputClass} font-mono`}
            />
          </div>
        </div>

        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-line pt-5 mt-1">
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button
          type="submit"
          disabled={busy || !deviceId}
          className="btn-primary"
        >
          {busy ? 'Starting…' : 'Start session'}
        </button>
        </div>
      </form>
    </Modal>
  )
}
