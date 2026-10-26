import { useMemo } from 'react'
import { createResource } from './store'
import type { Device } from './types'

// Cloud machines: servers this hub created at Hetzner Cloud or DigitalOcean.
// Provider API tokens stay on the hub; the browser only ever sees a masked
// hint of one.

export type CloudProviderId = 'hetzner' | 'digitalocean'

export interface CloudProvider {
  id: CloudProviderId
  name: string
  connected: boolean
  tokenHint?: string
  tokenUrl: string
  consoleUrl: string
  currency: string
}

export interface CloudHub {
  url: string
  kind: 'public' | 'private' | 'local' | 'tailnet'
  tailnetCandidates: string[]
  agentBinary: boolean
  agentBinaryMessage?: string
}

export interface CloudOverview {
  providers: CloudProvider[]
  hub: CloudHub
}

export interface CloudRegion { id: string; name: string }

export interface CloudSize {
  id: string
  name: string
  cpus: number
  memoryGb: number
  diskGb: number
  prices: Record<string, number>
}

export interface CloudOptions {
  currency: string
  regions: CloudRegion[]
  sizes: CloudSize[]
  defaultRegion: string
  defaultSize: string
  live: boolean
}

export type CloudStage = 'creating' | 'booting' | 'installing' | 'joined' | 'failed'

export interface CloudMachine {
  id: string
  provider: CloudProviderId
  providerName: string
  name: string
  region: string
  size: string
  currency: string
  priceMonthly: number
  ipv4?: string
  deviceId?: string
  deviceGone?: boolean
  stage: CloudStage
  error?: string
  closeSsh: boolean
  tailnet: boolean
  createdAt: number
  joinedAt?: number
  consoleUrl: string
}

export interface CloudCreateInput {
  provider: CloudProviderId
  name: string
  region: string
  size: string
  sshKey: string
  closeSsh: boolean
  tools: { claude: boolean; codex: boolean; gemini: boolean }
  tailscaleKey: string
  hubUrl: string
}

export const cloudMachinesResource = createResource<CloudMachine[]>('/api/cloud/machines', 8000)
export const useCloudMachines = () => cloudMachinesResource.use()

// Cloud machines by the id of the device they became, for badges in Machines.
export function useCloudByDevice(devices?: Device[] | null) {
  const { value } = useCloudMachines()
  return useMemo(() => {
    const map = new Map<string, CloudMachine>()
    for (const machine of value ?? []) if (machine.deviceId && !machine.deviceGone) map.set(machine.deviceId, machine)
    return map
  }, [value, devices])
}

export function formatPrice(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 }).format(amount)
  } catch {
    return `${amount} ${currency}`
  }
}

export const STAGES: Array<{ id: Exclude<CloudStage, 'failed'>; label: string; detail: string }> = [
  { id: 'creating', label: 'Creating', detail: 'The provider is building the server' },
  { id: 'booting', label: 'Booting', detail: 'Starting Ubuntu' },
  { id: 'installing', label: 'Installing', detail: 'Tools, then the Overseer agent' },
  { id: 'joined', label: 'Joined', detail: 'It shows up in Machines' },
]

export function formatElapsed(seconds: number) {
  const s = Math.max(0, Math.floor(seconds))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

// A fixed, honest estimate: most servers join in two to four minutes.
export const typicalJoinMinutes = '2-4'
