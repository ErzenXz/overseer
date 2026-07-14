import { useCallback, useEffect, useRef, useState } from 'react'
import { api, formatBytes } from '../api'
import type { FsListing } from '../types'

export default function FileBrowser({ deviceId }: { deviceId: string }) {
  const [listing, setListing] = useState<FsListing | null>(null)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(
    async (path: string) => {
      setError('')
      try {
        setListing(
          await api.get<FsListing>(
            `/api/devices/${deviceId}/fs?path=${encodeURIComponent(path)}`,
          ),
        )
      } catch (e) {
        setError(e instanceof Error ? e.message : 'failed to list directory')
      }
    },
    [deviceId],
  )

  useEffect(() => {
    load('~')
  }, [load])

  const up = () => {
    if (!listing) return
    const parent = listing.path.replace(/\/[^/]+\/?$/, '') || '/'
    load(parent)
  }

  const download = (name: string) => {
    const path = `${listing?.path}/${name}`
    window.open(
      `/api/devices/${deviceId}/fs/download?path=${encodeURIComponent(path)}`,
      '_blank',
    )
  }

  const upload = async (file: File) => {
    if (!listing) return
    setUploading(true)
    setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(
        `/api/devices/${deviceId}/fs/upload?dir=${encodeURIComponent(listing.path)}`,
        { method: 'POST', body: form },
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(data.error)
      }
      load(listing.path)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={up}
          disabled={!listing || listing.path === '/'}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
        >
          ↑ Up
        </button>
        <code className="flex-1 truncate rounded-lg bg-zinc-900 px-3 py-1.5 font-mono text-sm text-zinc-300">
          {listing?.path ?? '…'}
        </code>
        <button
          onClick={() => fileInput.current?.click()}
          disabled={uploading || !listing}
          className="btn-primary"
        >
          {uploading ? 'Uploading…' : 'Upload here'}
        </button>
        <input
          ref={fileInput}
          type="file"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) upload(f)
            e.target.value = ''
          }}
        />
      </div>

      {error && <p className="mb-3 text-sm text-rose-400">{error}</p>}

      <div className="surface min-h-0 flex-1 overflow-y-auto rounded-xl">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-zinc-900 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="w-28 px-4 py-2 font-medium">Size</th>
              <th className="w-40 px-4 py-2 font-medium">Modified</th>
              <th className="w-24 px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {listing?.entries.map((e) => (
              <tr
                key={e.name}
                className="border-t border-zinc-800/60 hover:bg-zinc-900/60"
              >
                <td
                  className={`px-4 py-2 font-mono text-[13px] ${
                    e.dir ? 'cursor-pointer text-lime-300' : 'text-zinc-300'
                  }`}
                  onClick={() => e.dir && load(`${listing.path}/${e.name}`)}
                >
                  {e.dir ? '📁 ' : ''}
                  {e.name}
                </td>
                <td className="px-4 py-2 text-zinc-500">
                  {e.dir ? '—' : formatBytes(e.size)}
                </td>
                <td className="px-4 py-2 text-zinc-500">
                  {new Date(e.modTime * 1000).toLocaleString()}
                </td>
                <td className="px-4 py-2 text-right">
                  {!e.dir && (
                    <button
                      onClick={() => download(e.name)}
                      className="text-xs text-zinc-400 hover:text-lime-300"
                    >
                      Download
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {listing && listing.entries.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">
                  Empty directory
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
