import { useEffect } from 'react'
import { api } from './api'
import { createResource } from './store'

// Updating the agent CLIs (Claude Code, Codex, Gemini CLI, OpenCode) on the
// machines. The hub finds the newer releases, never touches an agent that has
// a session running, and runs each agent's own updater. See agent_updates.go.

export type AgentUpdateState = 'available' | 'updating' | 'queued' | 'failed' | 'updated'

export interface AgentUpdate {
  deviceId: string
  deviceName: string
  agent: string
  name: string
  current: string
  latest: string
  state: AgentUpdateState
  // Sessions of this agent running on the machine; the update waits for them.
  busy: number
  message?: string
  updatedAt?: number
  // Set when updating needs a person (a Linux package and a password): the
  // command to run in a terminal on that machine.
  command?: string
}

export interface AgentUpdates {
  auto: boolean
  checkedAt: number
  items: AgentUpdate[]
}

export const agentUpdatesResource = createResource<AgentUpdates>('/api/agent-updates', 5 * 60_000)

// While anything is on its way, look every few seconds so the card follows it.
export function useAgentUpdates() {
  const { value } = agentUpdatesResource.use()
  const working = !!value?.items.some((item) => item.state === 'updating' || item.state === 'queued')
  useEffect(() => {
    if (!working) return
    const timer = window.setInterval(() => agentUpdatesResource.refresh(), 3000)
    return () => window.clearInterval(timer)
  }, [working])
  return value
}

export async function updateAgents(target: { deviceId?: string; agent?: string; recheck?: boolean } = {}) {
  const next = await api.post<AgentUpdates>('/api/agent-updates', target)
  agentUpdatesResource.set(() => next)
}

export async function setAutoUpdate(auto: boolean) {
  const next = await api.put<AgentUpdates>('/api/agent-updates/settings', { auto })
  agentUpdatesResource.set(() => next)
}

// What the card says. null means nothing to show.
export function summarize(items: AgentUpdate[]): { kind: 'available' | 'working' | 'waiting' | 'failed' | 'done'; title: string; sub: string } | null {
  if (items.length === 0) return null
  const names = (list: AgentUpdate[]) => {
    const unique = [...new Set(list.map((item) => item.name))]
    return unique.length > 2 ? `${unique.slice(0, 2).join(', ')} +${unique.length - 2}` : unique.join(' and ')
  }
  const machines = (list: AgentUpdate[]) => {
    const count = new Set(list.map((item) => item.deviceId)).size
    return count === 1 ? list[0].deviceName : `${count} machines`
  }
  const by = (state: AgentUpdateState) => items.filter((item) => item.state === state)
  const updating = by('updating'), queued = by('queued'), failed = by('failed'), available = by('available'), updated = by('updated')
  if (updating.length) return { kind: 'working', title: 'Updating agents…', sub: `${names(updating)} on ${machines(updating)}` }
  if (queued.length) return { kind: 'waiting', title: 'Waiting for running sessions', sub: `${names(queued)} updates when they finish` }
  if (available.length) return { kind: 'available', title: available.length === 1 ? 'Agent update available' : `${available.length} agent updates`, sub: `${names(available)} on ${machines(available)}` }
  if (failed.length) return { kind: 'failed', title: 'An agent update failed', sub: `${names(failed)} on ${machines(failed)}` }
  if (updated.length) return { kind: 'done', title: 'Agents updated', sub: `${names(updated)} on ${machines(updated)}` }
  return null
}
