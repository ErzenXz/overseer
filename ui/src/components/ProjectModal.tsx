import { FormEvent, useMemo, useState } from 'react'
import { api } from '../api'
import type { Device, Project } from '../types'
import Modal from './Modal'

export default function ProjectModal({
  devices,
  project,
  onClose,
  onSaved,
}: {
  devices: Device[]
  project?: Project
  onClose: () => void
  onSaved: (project: Project) => void
}) {
  const online = useMemo(() => devices.filter((device) => device.online), [devices])
  const firstDevice = online[0]?.id ?? devices[0]?.id ?? ''
  const [name, setName] = useState(project?.name ?? '')
  const [deviceId, setDeviceId] = useState(project?.deviceId ?? firstDevice)
  const [path, setPath] = useState(project?.path ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim() || !deviceId || !path.trim()) return
    setSaving(true)
    setError('')
    try {
      const body = { name: name.trim(), deviceId, path: path.trim() }
      const saved = project
        ? await api.patch<Project>(`/api/projects/${project.id}`, body)
        : await api.post<Project>('/api/projects', body)
      window.dispatchEvent(new Event('liveagent:projects-changed'))
      onSaved(saved)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save project')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={project ? 'Edit project' : 'Add a project'} onClose={onClose}>
      <form onSubmit={save} className="space-y-5">
        <label className="block">
          <span className="field-label">Project name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            maxLength={80}
            placeholder="Storefront"
            className="field-input mt-2"
          />
        </label>

        <label className="block">
          <span className="field-label">Run on</span>
          <select value={deviceId} onChange={(event) => setDeviceId(event.target.value)} className="field-input mt-2">
            {devices.map((device) => (
              <option key={device.id} value={device.id} className="bg-zinc-900">
                {device.name} {device.online ? '· online' : '· offline'}
              </option>
            ))}
          </select>
          <span className="mt-2 block text-xs text-zinc-600">fx sends commands only to this machine for this project.</span>
        </label>

        <label className="block">
          <span className="field-label">Working directory</span>
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="/Users/you/Projects/storefront"
            className="field-input mt-2 font-mono text-xs"
          />
        </label>

        {error && <p className="rounded-lg border border-rose-400/20 bg-rose-400/[0.07] px-3 py-2 text-sm text-rose-200">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-white/[0.07] pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving || !name.trim() || !deviceId || !path.trim()} className="btn-primary">
            {saving ? 'Saving…' : project ? 'Save changes' : 'Add project'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
