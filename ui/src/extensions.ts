import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import type { ExtInventory, ExtItem } from './types'

// Skills, plugins and the rest of what extends each agent on a machine.
const base = (deviceId: string) => `/api/devices/${encodeURIComponent(deviceId)}`

export function useExtensions(deviceId: string, cwd: string) {
  const [data, setData] = useState<ExtInventory | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const load = useCallback(async (refresh = false) => {
    if (!deviceId) return
    setLoading(true)
    setError('')
    try {
      const query = new URLSearchParams()
      if (cwd) query.set('cwd', cwd)
      if (refresh) query.set('refresh', '1')
      setData(await api.get<ExtInventory>(`${base(deviceId)}/extensions${query.size ? `?${query}` : ''}`))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Couldn’t read this machine')
    } finally {
      setLoading(false)
    }
  }, [deviceId, cwd])
  useEffect(() => { setData(null); load() }, [load])
  return { data, error, loading, reload: load, setData }
}

export const extensionsApi = {
  item: (deviceId: string, key: string) => api.get<{ item: ExtItem; content?: string; frontmatter?: Record<string, unknown> }>(`${base(deviceId)}/extensions/item?key=${encodeURIComponent(key)}`),
  toggle: (deviceId: string, key: string, enabled: boolean) => api.post<{ item: ExtItem; note?: string }>(`${base(deviceId)}/extensions/toggle`, { key, enabled }),
  uninstall: (deviceId: string, key: string) => api.post<{ ok: boolean; note?: string }>(`${base(deviceId)}/extensions/uninstall`, { key }),
  install: (deviceId: string, body: { agent: string; id: string; scope: 'user' | 'project' | 'local'; cwd?: string; acceptCommand?: string }) =>
    api.post<{ item?: ExtItem; note?: string; needsApproval?: { command: string; sha: string } }>(`${base(deviceId)}/extensions/install`, body),
  catalog: (deviceId: string, agent: string) => api.get<{ entries: import('./types').CatalogPlugin[] }>(`${base(deviceId)}/extensions/catalog?agent=${encodeURIComponent(agent)}`),
  createSkill: (deviceId: string, body: { name: string; description: string; body?: string; scope: 'user' | 'project'; cwd?: string; agents: string[] }) => api.post<{ item: ExtItem }>(`${base(deviceId)}/skills`, body),
  share: (deviceId: string, key: string, agents: string[]) => api.post<{ item: ExtItem }>(`${base(deviceId)}/skills/share`, { key, agents }),
}

export const kindLabels: Record<string, string> = {
  skill: 'Skill', plugin: 'Plugin', marketplace: 'Marketplace', command: 'Command', subagent: 'Subagent',
  rule: 'Rules', hook: 'Hook', extension: 'Extension', mcp_server: 'MCP server', output_style: 'Output style',
}

export const scopeLabels: Record<string, string> = {
  user: 'User', project: 'Project', local: 'Local', plugin: 'Plugin', managed: 'Managed', system: 'System', builtin: 'Built-in', synced: 'Synced', session: 'Session',
}

// Read-only items: set by an admin, the system, a sync, or their plugin.
export const isReadOnly = (item: ExtItem) => !!item.lockedBy || ['managed', 'system', 'builtin', 'synced'].includes(item.scope)
