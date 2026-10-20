import { createContext, useContext, useEffect, useState } from 'react'
import { api } from './api'
import type { PortInfo, PreviewConfig } from './types'

// Live previews: dev servers on a machine, served through the hub on their own
// origin (https://5173-erzen-dev.example.com). See docs/agent-sessions-api.md.

let configCache: PreviewConfig | null = null
const configListeners = new Set<(config: PreviewConfig) => void>()

export function setPreviewConfig(config: PreviewConfig) {
  configCache = config
  configListeners.forEach((listener) => listener(config))
}

export function usePreviewConfig() {
  const [config, setConfig] = useState<PreviewConfig | null>(configCache)
  useEffect(() => {
    configListeners.add(setConfig)
    if (!configCache) {
      api.get<PreviewConfig>('/api/previews/config')
        .then(setPreviewConfig)
        .catch(() => setPreviewConfig({ domain: '', source: 'none', hubHost: location.host, secure: location.protocol === 'https:' }))
    }
    return () => { configListeners.delete(setConfig) }
  }, [])
  return config
}

// usePorts lists what is listening on a machine, refreshing every few seconds
// while the view is open so a dev server shows up as soon as it starts.
export function usePorts(deviceId: string, enabled = true) {
  const [ports, setPorts] = useState<PortInfo[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!deviceId || !enabled) return
    let alive = true
    let timer: number | undefined
    const load = () => {
      api.get<PortInfo[]>(`/api/devices/${encodeURIComponent(deviceId)}/ports`)
        .then((items) => { if (alive) { setPorts(items ?? []); setError('') } })
        .catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : 'Could not list ports') })
        .finally(() => { if (alive) timer = window.setTimeout(load, document.hidden ? 15000 : 4000) })
    }
    load()
    return () => { alive = false; window.clearTimeout(timer) }
  }, [deviceId, enabled])
  return { ports, error }
}

// previewHref joins a preview origin with a path typed in the address bar.
export function previewHref(base: string, path: string) {
  if (base.startsWith('blob:')) return base // demo mode's stand-in site
  const clean = path.trim().replace(/^https?:\/\/[^/]+/i, '')
  return base.replace(/\/$/, '') + (clean.startsWith('/') ? clean : `/${clean}`)
}

// localTarget recognises links to a dev server on the agent's machine
// (http://localhost:5173/about) so they can open in the Preview panel.
export function localTarget(href: string | undefined): { port: number; path: string } | null {
  if (!href) return null
  const match = href.match(/^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{2,5})(\/[^\s]*)?$/i)
  if (!match) return null
  const port = Number(match[1])
  if (port < 1 || port > 65535) return null
  return { port, path: match[2] || '/' }
}

export const forwardCommand = (machine: string, port: number) => `overseer forward ${/\s/.test(machine) ? `"${machine}"` : machine} ${port}`

// A session page provides this so localhost links in replies open its panel.
export const PreviewLinkContext = createContext<((port: number, path: string) => void) | null>(null)
export const usePreviewLink = () => useContext(PreviewLinkContext)
