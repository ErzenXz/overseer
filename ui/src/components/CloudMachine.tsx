import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../api'
import {
  cloudMachinesResource, formatElapsed, formatPrice, STAGES, typicalJoinMinutes, useCloudMachines,
  type CloudCreateInput, type CloudMachine, type CloudOptions, type CloudOverview, type CloudProvider, type CloudProviderId,
} from '../cloud'
import { devicesResource } from '../store'
import type { Device } from '../types'
import Icon from './Icon'
import { Switch } from './Menu'
import Modal from './Modal'

// One-click cloud machine: connect a provider, pick a size, and the hub
// creates the server, installs the agent on it and waits for it to join.

// Simple stand-ins for the providers' marks.
export function ProviderMark({ id, size = 20 }: { id: CloudProviderId; size?: number }) {
  return id === 'hetzner' ? (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="cl-mark"><rect width="24" height="24" rx="5.5" fill="#d50c2d" /><path d="M7.5 6.5v11M16.5 6.5v11M7.5 12h9" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" /></svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="cl-mark"><circle cx="12" cy="12" r="12" fill="#0080ff" /><path d="M12 18.5v-3.4h-3.4v3.4H12zM8.6 15.1v-2.4H6.2v2.4h2.4zM12 18.5v-2.6a4.4 4.4 0 1 0-4.4-4.4h-2A6.4 6.4 0 1 1 12 18.5z" fill="#fff" /></svg>
  )
}

const errorText = (cause: unknown, fallback: string) => (cause instanceof Error ? cause.message : fallback)

// Which sizes a region offers, and the region a visitor most likely wants.
function preferredRegion(options: CloudOptions): string {
  let zone = ''
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch { /* keep the provider default */ }
  const wants = zone.startsWith('America/') ? ['ash', 'nyc3', 'hil', 'sfo3', 'tor1']
    : zone.startsWith('Asia/') || zone.startsWith('Australia/') ? ['sin', 'sgp1', 'syd1', 'blr1'] : []
  return wants.find((id) => options.regions.some((region) => region.id === id)) ?? options.defaultRegion
}

const tailnetAddress = (value: string) => {
  try {
    const url = new URL(value)
    const host = url.hostname
    const m = host.match(/^100\.(\d+)\.\d+\.\d+$/)
    return (!!m && Number(m[1]) >= 64 && Number(m[1]) <= 127) || host.endsWith('.ts.net') || host.toLowerCase().startsWith('[fd7a:115c:a1e0:') || host.toLowerCase().startsWith('fd7a:115c:a1e0:')
  } catch { return false }
}

export function CloudMachineModal({ onClose }: { onClose: () => void }) {
  const [overview, setOverview] = useState<CloudOverview | null>(null)
  const [error, setError] = useState('')
  const [providerId, setProviderId] = useState<CloudProviderId>('hetzner')
  const [createdId, setCreatedId] = useState('')
  const { value: machines } = useCloudMachines()

  const load = useCallback(async () => {
    try {
      const data = await api.get<CloudOverview>('/api/cloud')
      setOverview(data)
      setProviderId((current) => data.providers.find((item) => item.id === current && item.connected)?.id ?? data.providers.find((item) => item.connected)?.id ?? current)
      setError('')
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 403 ? 'Only an owner of this hub can add cloud machines.' : errorText(cause, 'Could not load cloud settings'))
    }
  }, [])
  useEffect(() => { load() }, [load])

  const created = machines?.find((item) => item.id === createdId)
  const provider = overview?.providers.find((item) => item.id === providerId)

  return (
    <Modal title={created ? `Creating ${created.name}` : 'New cloud machine'} onClose={onClose} wide>
      {error ? <p className="text-sm text-danger">{error}</p> : !overview ? <div className="grid place-items-center py-10"><span className="spinner" /></div> : created ? (
        <>
          <CloudCard machine={created} onDeleted={onClose} />
          <div className="modal-foot">
            <button className="btn btn-outline" onClick={onClose}>{created.stage === 'joined' ? 'Done' : 'Keep going in the background'}</button>
          </div>
        </>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted">A fresh Ubuntu server with git, tmux, Node, the GitHub CLI and the Overseer agent. It joins this hub on its own and appears in Machines.</p>
          <div className="cl-providers" role="radiogroup" aria-label="Provider">
            {overview.providers.map((item) => (
              <button key={item.id} type="button" role="radio" aria-checked={providerId === item.id} className="cl-provider" onClick={() => setProviderId(item.id)}>
                <ProviderMark id={item.id} size={26} />
                <span className="cl-provider-text"><b>{item.name}</b><span>{item.connected ? `Connected ${item.tokenHint ?? ''}` : 'Not connected'}</span></span>
                {item.connected && <Icon name="check" size={16} className="cl-provider-check" />}
              </button>
            ))}
          </div>
          {provider && !provider.connected && <ConnectForm provider={provider} onConnected={load} />}
          {provider?.connected && <CreateForm overview={overview} provider={provider} onDisconnected={load} onCreated={(machine) => { setCreatedId(machine.id); cloudMachinesResource.refresh() }} onCancel={onClose} />}
        </>
      )}
    </Modal>
  )
}

function ConnectForm({ provider, onConnected }: { provider: CloudProvider; onConnected: () => void }) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.put(`/api/cloud/providers/${provider.id}`, { token: token.trim() })
      setToken('')
      onConnected()
    } catch (cause) {
      setError(errorText(cause, 'Could not connect'))
    }
    setBusy(false)
  }
  return (
    <form onSubmit={submit} className="cl-section">
      <label className="label" htmlFor="cl-token">{provider.name} API token</label>
      <input id="cl-token" className="input input-mono" type="password" autoComplete="off" spellCheck={false} required value={token} onChange={(event) => setToken(event.target.value)} placeholder="Paste a token with read and write access" />
      <p className="hint">
        <a className="link" href={provider.tokenUrl} target="_blank" rel="noreferrer">How to create a token on {provider.name}</a>. It is checked once, then kept on this hub only: it is never shown again and never sent to the new server.
      </p>
      {error && <p className="mt-3 text-[13px] text-danger">{error}</p>}
      <div className="modal-foot">
        <button className="btn btn-dark" disabled={busy || token.trim().length < 20}>{busy && <span className="spinner" />}Connect {provider.name}</button>
      </div>
    </form>
  )
}

function CreateForm({ overview, provider, onCreated, onDisconnected, onCancel }: {
  overview: CloudOverview
  provider: CloudProvider
  onCreated: (machine: CloudMachine) => void
  onDisconnected: () => void
  onCancel: () => void
}) {
  const [options, setOptions] = useState<CloudOptions | null>(null)
  const [loadError, setLoadError] = useState('')
  const [form, setForm] = useState({
    name: '', region: '', size: '', sshKey: '', closeSsh: false, claude: true, codex: false, gemini: false, tailscaleKey: '', hubUrl: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }))

  useEffect(() => {
    let alive = true
    setOptions(null)
    setLoadError('')
    api.get<CloudOptions>(`/api/cloud/providers/${provider.id}/options`)
      .then((next) => {
        if (!alive) return
        setOptions(next)
        setForm((current) => ({ ...current, region: preferredRegion(next), size: next.defaultSize }))
      })
      .catch((cause) => { if (alive) setLoadError(errorText(cause, 'Could not load sizes')) })
    return () => { alive = false }
  }, [provider.id])

  const sizes = useMemo(() => (options?.sizes ?? []).filter((size) => size.prices[form.region] !== undefined), [options, form.region])
  const size = sizes.find((item) => item.id === form.size) ?? sizes[0]
  const price = size ? size.prices[form.region] : 0
  const currency = options?.currency ?? provider.currency
  useEffect(() => { if (size && size.id !== form.size) set('size', size.id) }, [size, form.size])

  const hub = overview.hub
  const needsTailscale = hub.kind !== 'public'
  const usingTailscale = needsTailscale || form.tailscaleKey.trim() !== ''
  const hubAddress = form.hubUrl.trim() || (hub.kind === 'tailnet' ? hub.url : '')
  const reachProblem = !hub.agentBinary ? `This hub has no Linux agent to give the new server. ${hub.agentBinaryMessage ?? ''}`
    : needsTailscale && !form.tailscaleKey.trim() ? 'Add a Tailscale auth key to continue.'
      : needsTailscale && !tailnetAddress(hubAddress) ? 'Enter the hub’s address on your tailnet (100.x.y.z or a .ts.net name).'
        : ''
  const ready = !!options && !!size && form.name.trim() !== '' && !reachProblem

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!ready || !size) return
    setBusy(true)
    setError('')
    const body: CloudCreateInput = {
      provider: provider.id, name: form.name.trim(), region: form.region, size: size.id, sshKey: form.sshKey.trim(), closeSsh: form.closeSsh,
      tools: { claude: form.claude, codex: form.codex, gemini: form.gemini }, tailscaleKey: form.tailscaleKey.trim(), hubUrl: usingTailscale ? hubAddress : '',
    }
    try {
      onCreated(await api.post<CloudMachine>('/api/cloud/machines', body, 120000))
    } catch (cause) {
      setError(errorText(cause, 'Could not create the server'))
      setBusy(false)
    }
  }

  const disconnect = async () => {
    if (!confirm(`Forget the ${provider.name} token on this hub? Servers it created stay; you can connect again later.`)) return
    try { await api.del(`/api/cloud/providers/${provider.id}`); onDisconnected() } catch (cause) { setError(errorText(cause, 'Could not disconnect')) }
  }

  if (loadError) return <p className="cl-section text-[13px] text-danger">{provider.name}: {loadError}</p>
  if (!options) return <div className="grid place-items-center py-10"><span className="spinner" /></div>

  return (
    <form onSubmit={submit} className="cl-section space-y-4">
      <div><label className="label" htmlFor="cl-name">Name</label><input id="cl-name" className="input" required maxLength={60} value={form.name} onChange={(event) => set('name', event.target.value)} placeholder="Build box" /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="label" htmlFor="cl-region">Region</label>
          <select id="cl-region" className="select w-full" value={form.region} onChange={(event) => set('region', event.target.value)}>
            {options.regions.map((region) => <option key={region.id} value={region.id}>{region.name} ({region.id})</option>)}
          </select>
        </div>
        <div><label className="label" htmlFor="cl-size">Size</label>
          <select id="cl-size" className="select w-full" value={size?.id ?? ''} onChange={(event) => set('size', event.target.value)}>
            {sizes.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.cpus} vCPU · {item.memoryGb} GB · {formatPrice(item.prices[form.region], currency)}/mo</option>)}
          </select>
        </div>
      </div>
      {!options.live && <p className="hint">{provider.name} could not be asked for current prices, so these are estimates.</p>}

      <div>
        <span className="label">Agent CLIs to install</span>
        <div className="cl-checks">
          {([['claude', 'Claude Code'], ['codex', 'Codex'], ['gemini', 'Gemini CLI']] as const).map(([key, label]) => (
            <label key={key} className="cl-check"><input type="checkbox" checked={form[key]} onChange={(event) => set(key, event.target.checked)} />{label}</label>
          ))}
        </div>
        <p className="hint">You sign in to each one on the machine afterwards. Skip them all to install later from Setup.</p>
      </div>

      <div>
        <label className="label" htmlFor="cl-ssh">SSH public key <span className="text-faint">(optional)</span></label>
        <textarea id="cl-ssh" className="textarea input-mono" rows={2} spellCheck={false} value={form.sshKey} onChange={(event) => set('sshKey', event.target.value)} placeholder="ssh-ed25519 AAAA… you@laptop" />
        <p className="hint">Lets you ssh in as <code>overseer</code>. Without it, you reach the machine through Overseer only.</p>
      </div>
      <div className="cl-switch-row">
        <div><b>Close SSH too</b><span>No inbound ports at all. The firewall only lets the server dial out.</span></div>
        <Switch checked={form.closeSsh} onChange={(value) => set('closeSsh', value)} label="Close SSH" />
      </div>

      <div className={`cl-reach ${needsTailscale ? 'is-warn' : ''}`}>
        {!needsTailscale ? (
          <p><Icon name="check" size={15} /><span>The server will reach this hub at <code>{hub.url}</code>.</span></p>
        ) : (
          <>
            <p><Icon name="alert" size={15} /><span>{hub.kind === 'tailnet' ? <>This hub address only works inside a Tailscale network.</> : <>This hub is at <code>{hub.url}</code>, which a server in the cloud can’t reach.</>}</span></p>
            <p className="cl-reach-text">Either open Overseer from its public HTTPS address (a domain with <code>--tls-domain</code>, Tailscale Funnel or a tunnel), or let the server join your Tailscale network first and reach the hub there.</p>
          </>
        )}
        <details open={needsTailscale}>
          <summary>{needsTailscale ? 'Join through Tailscale' : 'Join through Tailscale instead'}</summary>
          <div className="space-y-3 pt-3">
            <div><label className="label" htmlFor="cl-ts">Tailscale auth key</label><input id="cl-ts" className="input input-mono" type="password" autoComplete="off" spellCheck={false} value={form.tailscaleKey} onChange={(event) => set('tailscaleKey', event.target.value)} placeholder="tskey-auth-…" />
              <p className="hint">Make it <b>one-off and ephemeral</b> (Tailscale admin, Settings, Keys). It goes into the server’s first-boot script, which {provider.name} keeps, so it should stop working after one use. This hub does not store it.</p></div>
            <div><label className="label" htmlFor="cl-hub">This hub’s address on your tailnet</label><input id="cl-hub" className="input input-mono" value={form.hubUrl} onChange={(event) => set('hubUrl', event.target.value)} placeholder="http://100.64.0.5:4200" />
              {(hub.tailnetCandidates ?? []).length > 0 && <div className="cl-cands">{(hub.tailnetCandidates ?? []).map((address) => <button type="button" key={address} className="chip" onClick={() => set('hubUrl', address)}>{address}</button>)}</div>}
              <p className="hint">The hub machine must be on the same tailnet.</p></div>
          </div>
        </details>
        {reachProblem && <p className="cl-block"><Icon name="alert" size={15} /><span>{reachProblem}</span></p>}
      </div>

      <div className="cl-cost">
        <Icon name="receipt" size={17} />
        <p>This creates a server billed by {provider.name} (about <b>{formatPrice(price, currency)}/month</b>) until you delete it. You can delete it from Machines at any time.</p>
      </div>

      {error && <p className="text-[13px] text-danger">{error}</p>}
      <div className="modal-foot cl-foot">
        <button type="button" className="btn btn-ghost mr-auto" onClick={disconnect}>Disconnect {provider.name}</button>
        <button type="button" className="btn btn-outline" onClick={onCancel}>Cancel</button>
        <button className="btn btn-dark" disabled={!ready || busy}>{busy && <span className="spinner" />}Create server · {formatPrice(price, currency)}/mo</button>
      </div>
    </form>
  )
}

// --- progress ---

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

// Steps for one machine: Creating, Booting, Installing, Joined.
export function CloudProgress({ machine }: { machine: CloudMachine }) {
  const live = machine.stage !== 'joined' && machine.stage !== 'failed'
  const now = useNow(live)
  const elapsed = (machine.stage === 'joined' && machine.joinedAt ? machine.joinedAt : now) - machine.createdAt
  const failed = machine.stage === 'failed'
  // The step a failure stopped at is not tracked separately: show every step
  // as done up to "creating" and mark the whole run as failed.
  const current = STAGES.findIndex((item) => item.id === machine.stage)
  useEffect(() => {
    if (!live) return
    const timer = window.setInterval(() => { cloudMachinesResource.refresh(); devicesResource.refresh() }, 3000)
    return () => window.clearInterval(timer)
  }, [live])
  const slow = machine.stage === 'booting' && elapsed > 300
  return (
    <div className="cl-progress">
      <ol className="cl-steps" aria-label="Progress">
        {STAGES.map((step, index) => {
          const state = failed ? 'idle' : index < current || machine.stage === 'joined' ? 'done' : index === current ? 'now' : 'idle'
          return (
            <li key={step.id} data-state={state}>
              <span className="cl-step-dot">{state === 'done' ? <Icon name="check" size={12} strokeWidth={2.4} /> : state === 'now' ? <span className="cl-spin" /> : null}</span>
              <span className="cl-step-text"><b>{step.label}</b><span>{step.detail}</span></span>
            </li>
          )
        })}
      </ol>
      <p className="cl-elapsed">{machine.stage === 'joined' ? `Joined after ${formatElapsed(elapsed)}.` : failed ? `Stopped after ${formatElapsed(elapsed)}.` : `${formatElapsed(elapsed)} so far. Usually ${typicalJoinMinutes} minutes.`}</p>
      {slow && <p className="cl-note">It is taking longer than usual. If this goes on, the server may not be able to reach this hub.</p>}
      {failed && (
        <div className="cl-fail" role="alert">
          <Icon name="alert" size={16} />
          <div><b>It didn’t finish.</b><p>{machine.error || 'Something went wrong while setting up the server.'}</p></div>
        </div>
      )}
    </div>
  )
}

// A machine's card: summary, progress and what you can do with it.
export function CloudCard({ machine, onDeleted }: { machine: CloudMachine; onDeleted?: () => void }) {
  const [deleting, setDeleting] = useState(false)
  return (
    <div className="cl-card">
      <div className="cl-card-head">
        <ProviderMark id={machine.provider} size={28} />
        <div className="min-w-0 flex-1">
          <div className="cl-card-title">{machine.name}</div>
          <div className="cl-card-sub">{machine.providerName} · {machine.size} · {machine.region} · {formatPrice(machine.priceMonthly, machine.currency)}/month{machine.ipv4 ? ` · ${machine.ipv4}` : ''}</div>
        </div>
      </div>
      {machine.deviceGone ? (
        <div className="cl-fail"><Icon name="alert" size={16} /><div><b>Removed from Machines, but the server still exists.</b><p>{machine.providerName} keeps billing until you delete it.</p></div></div>
      ) : <CloudProgress machine={machine} />}
      <div className="cl-card-actions">
        <a className="btn btn-sm btn-outline" href={machine.consoleUrl} target="_blank" rel="noreferrer"><Icon name="external" size={14} />Open in {machine.providerName}</a>
        {machine.stage !== 'joined' || machine.deviceGone ? <button className="btn btn-sm btn-outline cl-danger" onClick={() => setDeleting(true)}><Icon name="trash" size={14} />Delete server</button> : null}
      </div>
      {deleting && <CloudDeleteDialog machine={machine} onClose={() => setDeleting(false)} onDeleted={() => { setDeleting(false); onDeleted?.() }} />}
    </div>
  )
}

// Machines page: servers still being set up, failed ones, and ones that were
// removed from Machines but still bill. Renders nothing when there are none.
export function CloudStatus() {
  const { value } = useCloudMachines()
  const open = (value ?? []).filter((item) => item.stage !== 'joined' || item.deviceGone)
  if (open.length === 0) return null
  return (
    <section className="cl-status" aria-label="Cloud servers">
      <h2 className="page-section-title">Cloud servers</h2>
      <div className="cl-status-list">{open.map((machine) => <CloudCard key={machine.id} machine={machine} />)}</div>
    </section>
  )
}

export function CloudBadge({ machine }: { machine: CloudMachine }) {
  return (
    <span className="badge cl-badge" title={`${machine.providerName} server ${machine.size} in ${machine.region}, ${formatPrice(machine.priceMonthly, machine.currency)} a month`}>
      <ProviderMark id={machine.provider} size={12} />{machine.size} · {formatPrice(machine.priceMonthly, machine.currency)}/mo
    </span>
  )
}

// --- deleting ---

// Type the machine's name to delete its server. Used on its own for servers
// that never joined, and from the remove dialog.
export function CloudDeleteDialog({ machine, onClose, onDeleted }: { machine: CloudMachine; onClose: () => void; onDeleted: () => void }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.post(`/api/cloud/machines/${machine.id}/delete`, { confirmName: typed.trim() }, 120000)
      cloudMachinesResource.refresh()
      devicesResource.refresh()
      onDeleted()
    } catch (cause) {
      setError(errorText(cause, 'Could not delete the server'))
      setBusy(false)
    }
  }
  return (
    <Modal title={`Delete ${machine.name} on ${machine.providerName}?`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-muted">This permanently deletes the server and everything on it, and removes it from Machines. It stops billing right away. It can’t be undone.</p>
        <div><label className="label" htmlFor="cl-confirm">Type <b className="cl-confirm-name">{machine.name}</b> to confirm</label><input id="cl-confirm" className="input" autoComplete="off" value={typed} onChange={(event) => setTyped(event.target.value)} /></div>
        {error && <p className="text-[13px] text-danger">{error}</p>}
        <div className="modal-foot">
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" disabled={busy || typed.trim() !== machine.name}>{busy && <span className="spinner" />}Delete server</button>
        </div>
      </form>
    </Modal>
  )
}

// "Remove machine" for a machine that is a cloud server: remove it from this
// hub, and optionally delete the VM too.
export function CloudRemoveDialog({ device, machine, onClose, onRemoved }: { device: Device; machine: CloudMachine; onClose: () => void; onRemoved: () => void }) {
  const [alsoDelete, setAlsoDelete] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (alsoDelete) await api.post(`/api/cloud/machines/${machine.id}/delete`, { confirmName: typed.trim() }, 120000)
      else await api.del(`/api/devices/${device.id}`)
      cloudMachinesResource.refresh()
      devicesResource.refresh()
      onRemoved()
    } catch (cause) {
      setError(errorText(cause, 'Could not remove the machine'))
      setBusy(false)
    }
  }
  const price = formatPrice(machine.priceMonthly, machine.currency)
  return (
    <Modal title={`Remove ${device.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-muted">This machine is a server on {machine.providerName} ({machine.size}, {price}/month).</p>
        <label className={`cl-choice ${!alsoDelete ? 'is-on' : ''}`}>
          <input type="radio" name="cl-remove" checked={!alsoDelete} onChange={() => setAlsoDelete(false)} />
          <span><b>Remove from Overseer only</b><span>The server keeps running and {machine.providerName} keeps billing you.</span></span>
        </label>
        <label className={`cl-choice ${alsoDelete ? 'is-on' : ''}`}>
          <input type="radio" name="cl-remove" checked={alsoDelete} onChange={() => setAlsoDelete(true)} />
          <span><b>Also delete the VM on {machine.providerName}</b><span>Deletes the server and everything on it. Billing stops.</span></span>
        </label>
        {alsoDelete && <div><label className="label" htmlFor="cl-rm-confirm">Type <b className="cl-confirm-name">{machine.name}</b> to confirm</label><input id="cl-rm-confirm" className="input" autoComplete="off" autoFocus value={typed} onChange={(event) => setTyped(event.target.value)} /></div>}
        {error && <p className="text-[13px] text-danger">{error}</p>}
        <div className="modal-foot">
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className={`btn ${alsoDelete ? 'btn-danger' : 'btn-dark'}`} disabled={busy || (alsoDelete && typed.trim() !== machine.name && typed.trim() !== device.name)}>{busy && <span className="spinner" />}{alsoDelete ? 'Delete server and remove' : 'Remove machine'}</button>
        </div>
      </form>
    </Modal>
  )
}
