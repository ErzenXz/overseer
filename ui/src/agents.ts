import { useEffect, useSyncExternalStore } from 'react'
import { api } from './api'
import type { Access, Thread, ThreadStatus } from './types'

// The coding agents Overseer can drive on a machine. `models` are the values
// passed through to the CLI's --model flag; an empty value means "the CLI's
// own default".
export interface AgentInfo {
  id: string
  name: string
  vendor: string
  protocol: 'native' | 'acp'
  install: string
  login?: string
  models: { id: string; label: string }[]
  description?: string
  icon?: string
  website?: string
  source?: 'builtin' | 'registry' | 'custom'
  bins?: string[]
}

export const agentCatalog: AgentInfo[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    vendor: 'Anthropic',
    protocol: 'native',
    install: 'npm install -g @anthropic-ai/claude-code',
    login: 'claude',
    models: [
      { id: '', label: 'Default' },
      { id: 'opus', label: 'Claude Opus' },
      { id: 'sonnet', label: 'Claude Sonnet' },
      { id: 'haiku', label: 'Claude Haiku' },
    ],
  },
  {
    id: 'codex',
    name: 'Codex',
    vendor: 'OpenAI',
    protocol: 'native',
    install: 'npm install -g @openai/codex',
    login: 'codex login',
    models: [{ id: '', label: 'Default' }],
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    vendor: 'Google',
    protocol: 'acp',
    install: 'npm install -g @google/gemini-cli',
    login: 'gemini',
    models: [{ id: '', label: 'Default' }, { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' }, { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }],
  },
  { id: 'opencode', name: 'OpenCode', vendor: 'SST', protocol: 'acp', install: 'npm install -g opencode-ai', login: 'opencode auth login', models: [{ id: '', label: 'Default' }] },
  { id: 'goose', name: 'Goose', vendor: 'Block', protocol: 'acp', install: 'curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash', login: 'goose configure', models: [{ id: '', label: 'Default' }] },
  { id: 'copilot', name: 'Copilot CLI', vendor: 'GitHub', protocol: 'acp', install: 'npm install -g @github/copilot', login: 'copilot', models: [{ id: '', label: 'Default' }] },
  { id: 'cursor', name: 'Cursor Agent', vendor: 'Cursor', protocol: 'acp', install: 'curl https://cursor.com/install -fsS | bash', login: 'cursor-agent login', models: [{ id: '', label: 'Default' }] },
]

// The hub's catalog adds every agent in the ACP registry plus the user's own
// (GET /api/agents/catalog). `agentCatalog` is updated in place so existing
// lookups see new agents; useAgentCatalog re-renders when it changes.
let catalogVersion = 0
let catalogLoad: Promise<void> | null = null
const catalogListeners = new Set<() => void>()

interface CatalogAgent {
  id: string
  name: string
  vendor?: string
  description?: string
  icon?: string
  website?: string
  protocol: 'native' | 'acp'
  source: 'builtin' | 'registry' | 'custom'
  bins?: string[]
  install?: string
  login?: string
}

export function loadAgentCatalog(force = false) {
  if (catalogLoad && !force) return catalogLoad
  catalogLoad = api.get<CatalogAgent[]>('/api/agents/catalog')
    .then((items) => {
      if (!Array.isArray(items) || !items.length) return
      const builtins = new Map(agentCatalog.filter((agent) => agent.source !== 'registry' && agent.source !== 'custom').map((agent) => [agent.id, agent]))
      const next: AgentInfo[] = items.filter((item) => item.id !== 'acp').map((item) => {
        const known = builtins.get(item.id)
        return known
          ? { ...known, description: item.description ?? known.description, website: item.website ?? known.website, source: 'builtin', bins: item.bins }
          : { id: item.id, name: item.name, vendor: item.vendor ?? '', protocol: item.protocol, install: item.install ?? '', login: item.login, models: [{ id: '', label: 'Default' }], description: item.description, icon: item.icon, website: item.website, source: item.source, bins: item.bins }
      })
      agentCatalog.splice(0, agentCatalog.length, ...next)
      catalogVersion++
      catalogListeners.forEach((listener) => listener())
    })
    .catch(() => { catalogLoad = null /* older hub: keep the built-in list */ })
  return catalogLoad
}

export function useAgentCatalog() {
  useEffect(() => { loadAgentCatalog() }, [])
  useSyncExternalStore((listener) => { catalogListeners.add(listener); return () => catalogListeners.delete(listener) }, () => catalogVersion)
  return agentCatalog
}

export function agentInfo(id: string): AgentInfo {
  return agentCatalog.find((agent) => agent.id === id) ?? { id, name: id === 'acp' ? 'Custom ACP agent' : id || 'Agent', vendor: '', protocol: 'acp', install: '', models: [{ id: '', label: 'Default' }] }
}

export const accessLevels: { id: Access; label: string; description: string }[] = [
  { id: 'ask', label: 'Ask', description: 'Read-only. Plans and answers, never edits.' },
  { id: 'edits', label: 'Accept edits', description: 'Edits files freely, asks before commands.' },
  { id: 'auto', label: 'Auto', description: 'The agent decides when to ask.' },
  { id: 'full', label: 'Full access', description: 'No prompts. Only for trusted machines.' },
]

export const statusText: Record<ThreadStatus, string> = {
  starting: 'Starting',
  working: 'Working',
  waiting: 'Needs input',
  idle: 'Done',
  error: 'Failed',
  stopped: 'Stopped',
}

export function threadStatusLabel(thread: Thread): { text: string; tone: 'ok' | 'working' | 'warn' | 'err' | '' } {
  if (thread.status === 'waiting') return { text: 'Needs approval', tone: 'warn' }
  if (thread.status === 'working' || thread.status === 'starting') return { text: thread.status === 'starting' ? 'Starting' : 'Working', tone: 'working' }
  if (thread.status === 'error') return { text: 'Failed', tone: 'err' }
  if (thread.pr && thread.pr.state === 'open' && thread.pr.checks !== 'failing') return { text: 'PR is ready', tone: 'ok' }
  if (thread.pr && thread.pr.state === 'merged') return { text: 'Merged', tone: '' }
  return { text: '', tone: '' }
}

export function isUnread(thread: Thread) {
  return thread.updatedAt > thread.lastReadAt && thread.status !== 'working' && thread.status !== 'starting'
}

export function relativeTime(unixSec: number): string {
  if (!unixSec) return 'never'
  const s = Math.max(0, Math.floor(Date.now() / 1000 - unixSec))
  if (s < 45) return 'just now'
  if (s < 90) return '1 minute ago'
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`
  if (s < 5400) return '1 hour ago'
  if (s < 86400) return `${Math.round(s / 3600)} hours ago`
  if (s < 86400 * 2) return 'yesterday'
  if (s < 86400 * 30) return `${Math.round(s / 86400)} days ago`
  if (s < 86400 * 60) return '1 month ago'
  if (s < 86400 * 365) return `${Math.round(s / (86400 * 30))} months ago`
  return `${Math.round(s / (86400 * 365))}y ago`
}

export function shortTime(unixSec: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - unixSec))
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d`
  if (s < 86400 * 365) return `${Math.round(s / (86400 * 30))}mo`
  return `${Math.round(s / (86400 * 365))}y`
}

export function formatDuration(ms: number): string {
  const total = Math.max(1, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  if (m === 0) return `${s}s`
  if (m < 60) return `${m}m ${s}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export function untilTime(unixSec: number): string {
  const s = Math.floor(unixSec - Date.now() / 1000)
  if (s <= 60) return 'in a minute'
  if (s < 3600) return `in ${Math.round(s / 60)} minutes`
  if (s < 86400) return `in ${Math.round(s / 3600)} hours`
  return `in ${Math.round(s / 86400)} days`
}
