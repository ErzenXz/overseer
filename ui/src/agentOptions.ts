import { useEffect, useState } from 'react'
import { api } from './api'
import type { Access, AgentOptions, DeviceAgent, ModeKind } from './types'

// Built-in options per agent. The hub replaces these with what each CLI
// reports on the machine (GET /api/devices/{id}/agents/{agent}/options); these
// keep the composer useful when discovery is unavailable.
const claudeEfforts = [
  { id: 'low', label: 'Low', description: 'Quick answers, least thinking' },
  { id: 'medium', label: 'Medium', description: 'Balanced' },
  { id: 'high', label: 'High', description: 'Thinks longer on hard problems' },
  { id: 'max', label: 'Max', description: 'Deepest reasoning, slowest' },
]

const builtin: Record<string, Omit<AgentOptions, 'agent' | 'source'>> = {
  claude: {
    models: [
      { id: '', label: 'Default', description: 'Whatever Claude Code is set to', default: true },
      { id: 'opus', label: 'Opus', description: 'Most capable for complex work' },
      { id: 'sonnet', label: 'Sonnet', description: 'Fast and capable for everyday work' },
      { id: 'haiku', label: 'Haiku', description: 'Fastest for quick tasks', efforts: [] },
    ],
    efforts: claudeEfforts,
    fast: { label: 'Fast mode', description: 'Faster output on supported models; uses more of your plan' },
    modes: [
      { id: 'default', label: 'Ask before edits', description: 'Asks before changing files or running commands', kind: 'ask' },
      { id: 'acceptEdits', label: 'Accept edits', description: 'Edits files freely, asks before commands', kind: 'edits' },
      { id: 'plan', label: 'Plan', description: 'Explores and proposes a plan, changes nothing', kind: 'plan' },
      { id: 'auto', label: 'Auto', description: 'Claude decides what is safe to run', kind: 'auto' },
      { id: 'bypassPermissions', label: 'Full access', description: 'Never asks. Only on machines you trust', kind: 'full' },
    ],
    defaultMode: 'default',
  },
  codex: {
    models: [
      { id: '', label: 'Default', description: 'Whatever Codex is set to', default: true },
    ],
    efforts: [
      { id: 'minimal', label: 'Minimal', description: 'Fastest, least reasoning' },
      { id: 'low', label: 'Low', description: 'Light reasoning' },
      { id: 'medium', label: 'Medium', description: 'Balanced' },
      { id: 'high', label: 'High', description: 'Most reasoning for hard problems' },
    ],
    fast: { label: 'Fast', description: 'Priority processing; uses more of your plan' },
    modes: [
      { id: 'read-only', label: 'Read only', description: 'Reads and answers, never writes', kind: 'readonly' },
      { id: 'plan', label: 'Plan', description: 'Proposes a plan before doing anything', kind: 'plan' },
      { id: 'on-request', label: 'Ask for approval', description: 'Works in the folder, asks before anything else', kind: 'ask' },
      { id: 'auto', label: 'Auto', description: 'Works in the folder; reviews risky steps itself', kind: 'auto' },
      { id: 'full-access', label: 'Full access', description: 'No sandbox, never asks. Only on machines you trust', kind: 'full' },
    ],
    defaultMode: 'on-request',
  },
}

const acpDefault: Omit<AgentOptions, 'agent' | 'source'> = {
  models: [{ id: '', label: 'Default', description: 'The agent’s own default', default: true }],
  efforts: [],
  modes: [{ id: 'default', label: 'Default', description: 'The agent asks when it needs permission', kind: 'ask' }],
  defaultMode: 'default',
}

export function builtinOptions(agent: string): AgentOptions {
  return { agent, source: 'builtin', ...(builtin[agent] ?? acpDefault) }
}

// accessForKind keeps the older `access` field meaningful for hubs and views
// that predate agent-specific modes.
export function accessForKind(kind: ModeKind | undefined): Access {
  if (kind === 'readonly' || kind === 'plan') return 'ask'
  if (kind === 'full') return 'full'
  if (kind === 'auto') return 'auto'
  return 'edits'
}

export function modeOf(options: AgentOptions, id: string | undefined) {
  return options.modes.find((mode) => mode.id === id) ?? options.modes.find((mode) => mode.id === options.defaultMode) ?? options.modes[0]
}

// effectiveModel is the model that will actually run: the chosen one, or the
// agent's own default when nothing is chosen.
export function effectiveModel(options: AgentOptions, model: string) {
  return options.models.find((item) => item.id === model) ?? options.models.find((item) => item.default) ?? options.models[0]
}

export function effortsFor(options: AgentOptions, model: string) {
  const allowed = effectiveModel(options, model)?.efforts
  return allowed ? options.efforts.filter((effort) => allowed.includes(effort.id)) : options.efforts
}

const cache = new Map<string, { at: number; value: AgentOptions }>()
const TTL = 5 * 60_000

// useAgentOptions returns what the agent supports on that machine, starting
// from the built-in table and upgrading when the hub answers.
export function useAgentOptions(deviceId: string, agent: string): AgentOptions {
  const key = `${deviceId}:${agent}`
  const [options, setOptions] = useState<AgentOptions>(() => cache.get(key)?.value ?? builtinOptions(agent))
  useEffect(() => {
    let alive = true
    const hit = cache.get(key)
    setOptions(hit?.value ?? builtinOptions(agent))
    if (!deviceId || (hit && Date.now() - hit.at < TTL)) return
    api.get<AgentOptions>(`/api/devices/${encodeURIComponent(deviceId)}/agents/${encodeURIComponent(agent)}/options`)
      .then((value) => {
        if (!value?.modes?.length) return
        cache.set(key, { at: Date.now(), value })
        if (alive) setOptions(value)
      })
      .catch(() => { /* older hub or offline machine: keep the built-in table */ })
    return () => { alive = false }
  }, [key, deviceId, agent])
  return options
}

// useAgentsOn caches which agent CLIs exist on a machine, and whether each is
// signed in. refreshAgents re-checks (after a sign-in, say) and updates every
// view that shows the machine.
const agentCache = new Map<string, DeviceAgent[]>()
const agentListeners = new Set<(deviceId: string, items: DeviceAgent[]) => void>()

export async function refreshAgents(deviceId: string): Promise<DeviceAgent[]> {
  const items = await api.get<DeviceAgent[]>(`/api/devices/${deviceId}/agents?refresh=1`)
  agentCache.set(deviceId, items)
  agentListeners.forEach((listener) => listener(deviceId, items))
  return items
}

export function useAgentsOn(deviceId: string) {
  const [agents, setAgents] = useState<DeviceAgent[] | null>(() => agentCache.get(deviceId) ?? null)
  useEffect(() => {
    if (!deviceId) return
    let alive = true
    setAgents(agentCache.get(deviceId) ?? null)
    const listener = (id: string, items: DeviceAgent[]) => { if (alive && id === deviceId) setAgents(items) }
    agentListeners.add(listener)
    api.get<DeviceAgent[]>(`/api/devices/${deviceId}/agents`).then((items) => {
      agentCache.set(deviceId, items)
      if (alive) setAgents(items)
    }).catch(() => { if (alive) setAgents([]) })
    return () => { alive = false; agentListeners.delete(listener) }
  }, [deviceId])
  return agents
}
