// DEV-ONLY MOCK for cloud machines and automation recipes (demo mode).
// Hetzner is connected, DigitalOcean is not, one cloud machine is joining
// (it moves through the steps while you watch) and recipe links can be
// imported. Nothing here reaches a cloud provider.

import type { CloudMachine, CloudOptions, CloudOverview, CloudProvider, CloudProviderId, CloudStage } from './cloud'
import { checkRecipe, decodeRecipeJSON, recipeWarnings } from './recipes'
import type { Device, Stats } from './types'

const now = () => Math.floor(Date.now() / 1000)
const GB = 1024 ** 3

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const fail = (message: string, status = 400) => reply({ error: message }, status)

const providers: Record<CloudProviderId, CloudProvider> = {
  hetzner: { id: 'hetzner', name: 'Hetzner Cloud', connected: true, tokenHint: '…a1b2', tokenUrl: 'https://docs.hetzner.com/cloud/api/getting-started/generating-api-token/', consoleUrl: 'https://console.hetzner.cloud/', currency: 'EUR' },
  digitalocean: { id: 'digitalocean', name: 'DigitalOcean', connected: false, tokenUrl: 'https://docs.digitalocean.com/reference/api/create-personal-access-token/', consoleUrl: 'https://cloud.digitalocean.com/droplets', currency: 'USD' },
}

const hetznerRegions = [['fsn1', 'Falkenstein, DE'], ['nbg1', 'Nuremberg, DE'], ['hel1', 'Helsinki, FI'], ['ash', 'Ashburn, US'], ['hil', 'Hillsboro, US'], ['sin', 'Singapore, SG']] as const
const eu = ['fsn1', 'nbg1', 'hel1']
const priceMap = (ids: readonly string[], price: number) => Object.fromEntries(ids.map((id) => [id, price]))

const options: Record<CloudProviderId, CloudOptions> = {
  hetzner: {
    currency: 'EUR', live: true, defaultRegion: 'fsn1', defaultSize: 'cx22',
    regions: hetznerRegions.map(([id, name]) => ({ id, name })),
    sizes: [
      { id: 'cx22', name: 'CX22', cpus: 2, memoryGb: 4, diskGb: 40, prices: priceMap(eu, 4.59) },
      { id: 'cpx21', name: 'CPX21', cpus: 3, memoryGb: 4, diskGb: 80, prices: { ...priceMap(eu, 9.49), ash: 11.99, hil: 11.99, sin: 12.49 } },
      { id: 'cx32', name: 'CX32', cpus: 4, memoryGb: 8, diskGb: 80, prices: priceMap(eu, 7.59) },
      { id: 'cx42', name: 'CX42', cpus: 8, memoryGb: 16, diskGb: 160, prices: priceMap(eu, 15.99) },
    ],
  },
  digitalocean: {
    currency: 'USD', live: true, defaultRegion: 'nyc3', defaultSize: 's-2vcpu-4gb',
    regions: [['nyc3', 'New York 3'], ['sfo3', 'San Francisco 3'], ['ams3', 'Amsterdam 3'], ['fra1', 'Frankfurt 1'], ['lon1', 'London 1'], ['sgp1', 'Singapore 1']].map(([id, name]) => ({ id, name })),
    sizes: [
      { id: 's-1vcpu-2gb', name: 's-1vcpu-2gb', cpus: 1, memoryGb: 2, diskGb: 50, prices: priceMap(['nyc3', 'sfo3', 'ams3', 'fra1', 'lon1', 'sgp1'], 12) },
      { id: 's-2vcpu-2gb', name: 's-2vcpu-2gb', cpus: 2, memoryGb: 2, diskGb: 60, prices: priceMap(['nyc3', 'sfo3', 'ams3', 'fra1', 'lon1', 'sgp1'], 18) },
      { id: 's-2vcpu-4gb', name: 's-2vcpu-4gb', cpus: 2, memoryGb: 4, diskGb: 80, prices: priceMap(['nyc3', 'sfo3', 'ams3', 'fra1', 'lon1', 'sgp1'], 24) },
      { id: 's-4vcpu-8gb', name: 's-4vcpu-8gb', cpus: 4, memoryGb: 8, diskGb: 160, prices: priceMap(['nyc3', 'sfo3', 'ams3', 'fra1', 'lon1', 'sgp1'], 48) },
    ],
  },
}

interface Sim { machine: CloudMachine; startedAt: number; timeline: [number, number, number]; failAt?: string }
let sims: Sim[] | null = null
let sequence = 1

// Seconds until each stage: booting, installing, joined. The first machine is
// slow enough to watch; ?cloudfail=1 makes new ones fail like an unreachable hub.
const demoTimeline: [number, number, number] = [6, 16, 52]

function start(): Sim[] {
  if (sims) return sims
  const joined: CloudMachine = {
    id: 'cm_runner', provider: 'hetzner', providerName: 'Hetzner Cloud', name: 'cloud-runner', region: 'fsn1', size: 'cx22', currency: 'EUR', priceMonthly: 4.59,
    ipv4: '203.0.113.20', deviceId: 'cloud-runner', stage: 'joined', closeSsh: false, tailnet: false, createdAt: now() - 86400 * 3, joinedAt: now() - 86400 * 3 + 170,
    consoleUrl: 'https://console.hetzner.cloud/',
  }
  const building: CloudMachine = {
    id: 'cm_build', provider: 'hetzner', providerName: 'Hetzner Cloud', name: 'Build box', region: 'nbg1', size: 'cx32', currency: 'EUR', priceMonthly: 7.59,
    stage: 'creating', closeSsh: false, tailnet: false, createdAt: now(), consoleUrl: 'https://console.hetzner.cloud/',
  }
  sims = [
    { machine: joined, startedAt: Date.now() - 86400 * 3000, timeline: [0, 0, 0] },
    { machine: building, startedAt: Date.now(), timeline: demoTimeline },
  ]
  return sims
}

function advance(sim: Sim) {
  const m = sim.machine
  if (m.stage === 'joined' || m.stage === 'failed') return
  const age = (Date.now() - sim.startedAt) / 1000
  const [booting, installing, joined] = sim.timeline
  let stage: CloudStage = 'creating'
  if (age >= joined) stage = 'joined'
  else if (age >= installing) stage = 'installing'
  else if (age >= booting) stage = 'booting'
  if (sim.failAt && age >= installing + 4) {
    m.stage = 'failed'
    m.error = sim.failAt
    return
  }
  m.stage = stage
  if (stage !== 'creating') m.ipv4 = '198.51.100.' + (40 + sequence)
  if (stage === 'joined') { m.deviceId = `cloud-${m.id}`; m.joinedAt = now() }
}

const stats = (cpuPercent: number, cores: number, memUsed: number, memTotal: number, diskUsed: number, diskTotal: number): Stats => ({
  cpuPercent, cpuCores: cores, load1: 0.2, load5: 0.2, load15: 0.1, memUsed, memTotal, swapUsed: 0, swapTotal: 0, diskUsed, diskTotal,
  netRxBytes: 3 * GB, netTxBytes: 1 * GB, processCount: 112, uptimeSec: 86400,
})

function cloudDevice(sim: Sim): Device {
  const m = sim.machine
  return {
    id: m.deviceId!, name: m.name, hostname: m.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), os: 'linux', arch: 'amd64', isHub: false,
    createdAt: m.joinedAt ?? now(), lastSeen: now() - 3, online: true, tmux: true, agentVersion: '1.4.2', platform: 'Ubuntu', platformVersion: '24.04',
    kernelVersion: '6.8.0-45-generic', stats: stats(6, 2, 0.9 * GB, 4 * GB, 6 * GB, 40 * GB),
  }
}

const hubKind = () => (new URLSearchParams(location.search).get('cloudhub') === 'local' ? 'local' : 'public')

export function cloudRoute(method: string, path: string, body: Record<string, unknown>, devices: Device[]): Response | null {
  if (path === '/api/recipes/inspect' && method === 'POST') {
    try {
      const checked = checkRecipe(decodeRecipeJSON(String(body.data ?? '')))
      if (!checked.recipe) return fail(checked.error ?? 'Not a valid recipe', 422)
      return reply({ recipe: checked.recipe, warnings: recipeWarnings(checked.recipe) })
    } catch (cause) {
      return fail(cause instanceof Error ? cause.message : 'Not a valid recipe', 422)
    }
  }

  if (method === 'GET' && path === '/api/devices') {
    const extra = start().filter((sim) => { advance(sim); return sim.machine.stage === 'joined' && sim.machine.deviceId && !sim.machine.deviceGone }).map(cloudDevice)
    return reply([...devices, ...extra])
  }

  // Removing a cloud machine from Machines leaves its server behind.
  const removed = path.match(/^\/api\/devices\/(cloud-[^/]+|cloud-runner)$/)
  if (method === 'DELETE' && removed) {
    const sim = start().find((item) => item.machine.deviceId === removed[1])
    if (sim) sim.machine.deviceGone = true
    return reply({ ok: true })
  }

  if (!path.startsWith('/api/cloud')) return null

  if (method === 'GET' && path === '/api/cloud') {
    const kind = hubKind()
    const overview: CloudOverview = {
      providers: Object.values(providers),
      hub: kind === 'public'
        ? { url: 'https://hub.example.com', kind: 'public', tailnetCandidates: [], agentBinary: true }
        : { url: location.origin, kind: 'local', tailnetCandidates: ['http://100.64.12.7:4200'], agentBinary: true },
    }
    return reply(overview)
  }

  const provider = path.match(/^\/api\/cloud\/providers\/([^/]+)(\/options)?$/)
  if (provider) {
    const id = provider[1] as CloudProviderId
    if (!providers[id]) return fail('unknown provider', 404)
    if (method === 'PUT') {
      const token = String(body.token ?? '').trim()
      if (token.length < 20) return fail(`That doesn’t look like an API token. Copy the whole token from ${providers[id].name}.`)
      providers[id] = { ...providers[id], connected: true, tokenHint: `…${token.slice(-4)}` }
      return reply({ providers: Object.values(providers) })
    }
    if (method === 'DELETE') {
      if (start().some((sim) => sim.machine.provider === id)) return fail(`Delete this hub’s ${providers[id].name} servers first; the token is needed to delete them.`, 409)
      providers[id] = { ...providers[id], connected: false, tokenHint: undefined }
      return reply({ providers: Object.values(providers) })
    }
    if (method === 'GET' && provider[2]) return providers[id].connected ? reply(options[id]) : fail(`Connect ${providers[id].name} first.`, 409)
  }

  if (method === 'GET' && path === '/api/cloud/machines') {
    return reply(start().map((sim) => { advance(sim); return sim.machine }))
  }

  if (method === 'POST' && path === '/api/cloud/machines') {
    const id = String(body.provider ?? '') as CloudProviderId
    const p = providers[id]
    if (!p?.connected) return fail(`Connect ${p?.name ?? 'a provider'} first.`, 409)
    if (hubKind() !== 'public' && !String(body.tailscaleKey ?? '')) return fail(`This hub is at ${location.origin}, which a cloud server can’t reach. Open Overseer from its public HTTPS address, or add a Tailscale auth key and the hub’s Tailscale address.`, 422)
    const size = options[id].sizes.find((item) => item.id === body.size)
    const price = size?.prices[String(body.region)]
    if (!size || price === undefined) return fail('That size isn’t available in that region. Pick another.')
    sequence += 1
    const machine: CloudMachine = {
      id: `cm_${sequence}`, provider: id, providerName: p.name, name: String(body.name ?? '').trim() || 'cloud', region: String(body.region), size: size.id,
      currency: options[id].currency, priceMonthly: price, stage: 'creating', closeSsh: !!body.closeSsh, tailnet: !!body.tailscaleKey, createdAt: now(), consoleUrl: p.consoleUrl,
    }
    const failing = new URLSearchParams(location.search).get('cloudfail') === '1'
    start().push({ machine, startedAt: Date.now(), timeline: [4, 10, 34], failAt: failing ? 'Failed while installing Node.js. Log: /var/log/overseer-bootstrap.log' : undefined })
    return reply(machine)
  }

  const del = path.match(/^\/api\/cloud\/machines\/([^/]+)\/delete$/)
  if (method === 'POST' && del) {
    const list = start()
    const index = list.findIndex((sim) => sim.machine.id === del[1])
    if (index < 0) return fail('no such cloud machine', 404)
    if (String(body.confirmName ?? '').trim() !== list[index].machine.name) return fail('Type the machine’s name exactly to confirm.')
    list.splice(index, 1)
    return reply({ ok: true })
  }
  return null
}
