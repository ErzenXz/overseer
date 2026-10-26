import { api } from './api'
import { createResource } from './store'

// Sign-ins shared from one machine to the others: a Claude Code token from
// `claude setup-token`, or Codex's auth.json copied from a signed-in machine.
// The hub keeps the secret and hands it only to machines; the browser never
// sees it again after it is pasted. See shared_logins.go.

export type SharedAgent = 'claude' | 'codex'

export interface SharedLoginApplied {
  deviceId: string
  deviceName: string
  appliedAt: number
  state: 'ok' | 'failed'
  message?: string
}

export interface SharedLogin {
  agent: SharedAgent
  name: string
  kind: 'oauth-token' | 'auth-file'
  account: string
  sourceDevice: string
  createdAt: number
  expiresAt: number
  auto: boolean
  applied: SharedLoginApplied[]
}

export interface ApplyResult {
  deviceId: string
  deviceName: string
  state: 'ok' | 'failed' | 'skipped'
  message?: string
}

export const sharedLoginsResource = createResource<{ items: SharedLogin[] }>('/api/shared-logins', 60_000)

const keep = (next: { items: SharedLogin[] }) => sharedLoginsResource.set(() => ({ items: next.items }))

export async function shareClaudeToken(token: string) {
  keep(await api.post<{ items: SharedLogin[] }>('/api/shared-logins', { agent: 'claude', token: token.trim() }))
}

export async function shareCodexFrom(deviceId: string) {
  keep(await api.post<{ items: SharedLogin[] }>('/api/shared-logins', { agent: 'codex', deviceId }))
}

export async function applySharedLogin(agent: SharedAgent, deviceIds: string[], replace = false) {
  const next = await api.post<{ results: ApplyResult[]; items: SharedLogin[] }>(`/api/shared-logins/${agent}/apply`, { deviceIds, replace })
  keep(next)
  return next.results
}

export async function setSharedAuto(agent: SharedAgent, auto: boolean) {
  keep(await api.put<{ items: SharedLogin[] }>(`/api/shared-logins/${agent}`, { auto }))
}

export async function removeSharedLogin(agent: SharedAgent, fromMachines: boolean) {
  keep(await api.del<{ items: SharedLogin[] }>(`/api/shared-logins/${agent}${fromMachines ? '?devices=1' : ''}`))
}

export const isSharedAgent = (agent: string): agent is SharedAgent => agent === 'claude' || agent === 'codex'
