import { useCallback, useEffect, useRef, useState } from 'react'
import { api, formatBytes } from '../api'
import { relativeTime } from '../agents'
import type { FsListing } from '../types'
import Icon from './Icon'

export default function FileBrowser({ deviceId, initialPath = '~', compact }: { deviceId: string; initialPath?: string; compact?: boolean }) {
  const [listing, setListing] = useState<FsListing | null>(null)
  const [path, setPath] = useState(initialPath)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async (next: string) => {
    setError('')
    try {
      const result = await api.get<FsListing>(`/api/devices/${deviceId}/fs?path=${encodeURIComponent(next)}`)
      setListing(result)
      setPath(result.path)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not list this folder')
    }
  }, [deviceId])

  useEffect(() => { load(initialPath) }, [load, initialPath])

  const join = (name: string) => `${(listing?.path ?? path).replace(/\/$/, '')}/${name}`
  const up = () => listing && load(listing.path.replace(/\/[^/]+\/?$/, '') || '/')
  const download = (name: string) => window.open(`/api/devices/${deviceId}/fs/download?path=${encodeURIComponent(join(name))}`, '_blank')

  const upload = async (file: File) => {
    if (!listing) return
    setUploading(true)
    setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/devices/${deviceId}/fs/upload?dir=${encodeURIComponent(listing.path)}`, { method: 'POST', body: form })
      if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error)
      load(listing.path)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const entries = (listing?.entries ?? [])
    .filter((entry) => showHidden || !entry.name.startsWith('.'))
    .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))

  return (
    <div className={`flex h-full min-h-0 flex-col ${compact ? '' : 'p-6'}`}>
      <div className={`flex items-center gap-2 ${compact ? 'border-b border-line px-3 py-2' : 'mb-4'}`}>
        <button className="icon-btn" onClick={up} disabled={!listing || listing.path === '/'} aria-label="Up one folder"><Icon name="arrow-up" size={17} /></button>
        <form className="min-w-0 flex-1" onSubmit={(event) => { event.preventDefault(); load(path) }}>
          <input className="input input-mono" style={{ height: 32 }} value={path} onChange={(event) => setPath(event.target.value)} aria-label="Path" />
        </form>
        <button className={`icon-btn ${showHidden ? 'icon-btn-active' : ''}`} onClick={() => setShowHidden(!showHidden)} aria-label="Show hidden files" title="Show hidden files"><Icon name={showHidden ? 'eye' : 'eye-off'} size={17} /></button>
        <button className="icon-btn" onClick={() => listing && load(listing.path)} aria-label="Refresh"><Icon name="refresh" size={17} /></button>
        <button className="btn btn-sm btn-outline" onClick={() => fileInput.current?.click()} disabled={uploading || !listing}><Icon name="upload" size={15} />{uploading ? 'Uploading…' : 'Upload'}</button>
        <input ref={fileInput} type="file" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(file); event.target.value = '' }} />
      </div>
      {error && <p className="mx-3 mb-2 rounded-lg bg-[var(--red-bg)] px-3 py-2 text-[13px] text-danger">{error}</p>}
      <div className={`min-h-0 flex-1 overflow-y-auto ${compact ? '' : 'card'}`}>
        <table className="table">
          <thead><tr><th>Name</th><th style={{ width: 90 }}>Size</th>{!compact && <th style={{ width: 140 }}>Modified</th>}<th style={{ width: 44 }} /></tr></thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.name} className={entry.dir ? 'cursor-pointer' : ''} onClick={() => entry.dir && load(join(entry.name))}>
                <td style={{ height: 40 }}><span className="flex items-center gap-2.5 text-ink"><Icon name={entry.dir ? 'folder' : 'file'} size={16} className="text-muted" /><span className="truncate">{entry.name}</span></span></td>
                <td style={{ height: 40 }} className="data-number text-muted">{entry.dir ? '—' : formatBytes(entry.size)}</td>
                {!compact && <td style={{ height: 40 }} className="text-muted">{relativeTime(entry.modTime)}</td>}
                <td style={{ height: 40 }}>{!entry.dir && <button className="icon-btn icon-btn-sm" aria-label={`Download ${entry.name}`} onClick={(event) => { event.stopPropagation(); download(entry.name) }}><Icon name="download" size={15} /></button>}</td>
              </tr>
            ))}
            {listing && entries.length === 0 && <tr><td colSpan={4} className="text-center text-muted">Empty folder</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
