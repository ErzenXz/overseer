import { useCallback, useEffect, useRef, useState } from 'react'
import type { Device } from '../types'
import Icon from './Icon'

// Files attached in the composer are uploaded to the machine the agent runs
// on (<folder>/.overseer/uploads), so the agent can read them by path.

export interface Attachment {
  id: string
  name: string
  file: File
  status: 'uploading' | 'done' | 'error'
  // path is where the file landed on the machine (set when done).
  path?: string
  error?: string
}

const MAX_FILE = 25 * 1024 * 1024
const MAX_IMAGE = 20 * 1024 * 1024 // what the agent accepts as a native image
const MAX_FILES = 10
// Image types every agent adapter accepts natively; others go in as paths.
const NATIVE_IMAGE = /\.(png|jpe?g|gif|webp)$/i

export const isNativeImage = (item: Attachment) => !!item.path && NATIVE_IMAGE.test(item.path)

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`

// uniqueName keeps the file's own name readable but never overwrites an earlier
// attachment (screenshots are all called "image.png").
function uniqueName(file: File) {
  const raw = file.name || 'pasted-image'
  const dot = raw.lastIndexOf('.')
  let stem = dot > 0 ? raw.slice(0, dot) : raw
  let ext = dot > 0 ? raw.slice(dot) : ''
  if (!ext && file.type.startsWith('image/')) ext = `.${file.type.slice(6).replace('jpeg', 'jpg').replace(/\+.*/, '')}`
  stem = stem.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^[-.]+|-+$/g, '').slice(0, 60) || 'file'
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  return `${stem}-${tag}${ext.replace(/[^\p{L}\p{N}.]+/gu, '')}`
}

const hasFiles = (event: DragEvent) => !!event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files')

export function useAttachments({ device, cwd, enabled }: { device?: Device; cwd: string; enabled: boolean }) {
  const [items, setItems] = useState<Attachment[]>([])
  const [notice, setNotice] = useState('')
  const [dragging, setDragging] = useState(false)
  // Uploads read the machine and folder as they are right now.
  const target = useRef({ device, cwd })
  target.current = { device, cwd }
  const count = useRef(0)
  const seq = useRef(0)

  const patch = (id: string, next: Partial<Attachment>) => setItems((current) => current.map((item) => item.id === id ? { ...item, ...next } : item))

  const send = useCallback(async (item: Attachment) => {
    const { device: machine, cwd: folder } = target.current
    const fail = (error: string) => setItems((current) => current.map((it) => it.id === item.id ? { ...it, status: 'error', error } : it))
    if (!machine) return fail('Choose a machine first')
    if (!machine.online) return fail(`${machine.name} is offline`)
    const limit = item.file.type.startsWith('image/') && NATIVE_IMAGE.test(item.name) ? MAX_IMAGE : MAX_FILE
    if (item.file.size > limit) return fail(`Too large (max ${mb(limit)})`)
    const dir = `${folder.replace(/\/+$/, '') || '~'}/.overseer/uploads`
    try {
      const form = new FormData()
      form.append('file', item.file, item.name)
      const res = await fetch(`/api/devices/${machine.id}/fs/upload?dir=${encodeURIComponent(dir)}`, { method: 'POST', body: form })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: '' })) as { error?: string }
        return fail(res.status === 503 ? `${machine.name} is offline` : res.status === 413 ? `Too large (max ${mb(MAX_FILE)})` : body.error || 'Upload failed')
      }
      // The machine reports where it saved the file ("~" expanded).
      const saved = await res.json().catch(() => ({})) as { path?: string }
      setItems((current) => current.map((it) => it.id === item.id ? { ...it, status: 'done', path: saved.path || `${dir}/${item.name}`, error: undefined } : it))
    } catch {
      fail('Network error')
    }
  }, [])

  const add = useCallback((files: File[]) => {
    if (!files.length) return
    setNotice('')
    const room = MAX_FILES - count.current
    if (files.length > room) setNotice(`Attach up to ${MAX_FILES} files per message`)
    const fresh: Attachment[] = files.slice(0, Math.max(0, room)).map((file) => ({ id: `a${++seq.current}`, name: uniqueName(file), file, status: 'uploading' }))
    if (!fresh.length) return
    count.current += fresh.length
    setItems((current) => [...current, ...fresh])
    fresh.forEach((item) => { send(item) })
  }, [send])

  const remove = (id: string) => { count.current = Math.max(0, count.current - 1); setItems((current) => current.filter((item) => item.id !== id)) }
  const retry = (id: string) => {
    const item = items.find((it) => it.id === id)
    if (!item) return
    patch(id, { status: 'uploading', error: undefined })
    send(item)
  }
  const clear = useCallback(() => { count.current = 0; setItems([]) }, [])

  // Attachments live on one machine; switching machines drops them.
  const deviceId = device?.id
  useEffect(() => { clear(); setNotice('') }, [deviceId, clear])

  // Files dropped anywhere on the page attach, as long as a composer is mounted.
  // The window listeners also keep the browser from navigating to a dropped file.
  const depth = useRef(0)
  useEffect(() => {
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth.current++
      if (enabled) setDragging(true)
    }
    const onOver = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault() // required for drop to fire
      if (event.dataTransfer) event.dataTransfer.dropEffect = enabled ? 'copy' : 'none'
    }
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setDragging(false)
    }
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth.current = 0
      setDragging(false)
      if (!enabled || !event.dataTransfer) return
      const files: File[] = []
      let folders = 0
      // Folders show up as files too; skip them (entries must be read now).
      Array.from(event.dataTransfer.items).forEach((entry) => {
        if (entry.kind !== 'file') return
        const file = entry.getAsFile()
        if (!file) return
        if (entry.webkitGetAsEntry?.()?.isDirectory) folders++
        else files.push(file)
      })
      add(files)
      if (folders) setNotice(files.length ? 'Folders were skipped' : 'Folders can’t be attached. Drop files instead.')
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [enabled, add])

  return {
    items,
    notice,
    enabled,
    dragging: dragging && enabled,
    add,
    remove,
    retry,
    clear,
    uploading: items.some((item) => item.status === 'uploading'),
    failed: items.some((item) => item.status === 'error'),
  }
}

// Thumb previews an image from the local file, so nothing is downloaded again.
function Thumb({ file }: { file: File }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    const url = URL.createObjectURL(file)
    setSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  return src ? <img className="attachment-thumb" src={src} alt="" /> : <Icon name="image" size={14} />
}

export function AttachmentChips({ items, onRemove, onRetry }: { items: Attachment[]; onRemove: (id: string) => void; onRetry: (id: string) => void }) {
  if (!items.length) return null
  return (
    <div className="composer-attachments">
      {items.map((item) => (
        <span key={item.id} className={`attachment-chip ${item.status === 'error' ? 'is-error' : ''}`} title={item.error ? `${item.file.name}: ${item.error}` : item.file.name}>
          {item.status === 'uploading' ? <span className="spinner" aria-label="Uploading" />
            : item.status === 'error' ? <Icon name="alert" size={14} />
            : item.file.type.startsWith('image/') ? <Thumb file={item.file} /> : <Icon name="file" size={14} />}
          <span className="attachment-name">{item.file.name || item.name}</span>
          {item.error && <span className="attachment-error">{item.error}</span>}
          {item.status === 'error' && <button type="button" aria-label={`Retry ${item.file.name}`} title="Retry" onClick={() => onRetry(item.id)}><Icon name="refresh" size={12} /></button>}
          <button type="button" aria-label={`Remove ${item.file.name}`} title="Remove" onClick={() => onRemove(item.id)}><Icon name="close" size={12} /></button>
        </span>
      ))}
    </div>
  )
}

export function DropOverlay() {
  return <div className="composer-drop" aria-hidden="true"><Icon name="upload" size={18} />Drop to attach</div>
}
