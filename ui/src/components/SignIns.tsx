import { useState } from 'react'
import { agentInfo, relativeTime } from '../agents'
import { useAgentsOn } from '../agentOptions'
import { applySharedLogin, removeSharedLogin, setSharedAuto, shareClaudeToken, shareCodexFrom, sharedLoginsResource, type SharedAgent, type SharedLogin } from '../sharedLogins'
import { useShell } from '../shell'
import { useDevices } from '../store'
import type { Device } from '../types'
import Icon, { AgentMark } from './Icon'
import { Menu, MenuItem, Switch } from './Menu'

// Settings → Sign-ins: one sign-in for Claude Code and one for Codex, used on
// every machine. Each agent's own headless path is the only one used.
export default function SignInsSettings() {
  const { value } = sharedLoginsResource.use()
  const items = value?.items ?? []
  return (
    <div className="si2">
      {(['claude', 'codex'] as SharedAgent[]).map((agent) => <AgentCard key={agent} agent={agent} shared={items.find((item) => item.agent === agent)} loading={!value} />)}
    </div>
  )
}

function AgentCard({ agent, shared, loading }: { agent: SharedAgent; shared?: SharedLogin; loading: boolean }) {
  const info = agentInfo(agent)
  return (
    <section className="si2-card">
      <header className="si2-head">
        <span className="si2-mark"><AgentMark agent={agent} size={20} /></span>
        <div className="min-w-0 flex-1">
          <h3>{info.name}</h3>
          <p>{shared ? describe(shared) : agent === 'claude' ? 'Not shared yet. Use a long-lived token on every machine.' : 'Not shared yet. Copy a signed-in machine’s sign-in to the others.'}</p>
        </div>
        {shared && <RemoveMenu agent={agent} />}
      </header>
      {loading ? <div className="si2-body"><span className="spinner" /></div> : shared ? <Shared shared={shared} /> : agent === 'claude' ? <ShareClaude /> : <ShareCodex />}
    </section>
  )
}

// An email reads "as you@…"; a method such as ChatGPT or API key reads "with".
const signedAs = (account?: string) => (account ? (account.includes('@') ? ` as ${account}` : ` with ${account}`) : '')

function describe(shared: SharedLogin) {
  const who = shared.account ? `${shared.account} · ` : ''
  const from = shared.sourceDevice ? `from ${shared.sourceDevice} · ` : ''
  const expires = shared.expiresAt ? ` · expires ${new Date(shared.expiresAt * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}` : ''
  return `${who}${from}shared ${relativeTime(shared.createdAt)}${expires}`
}

function ShareClaude() {
  const { toast } = useShell()
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setError('')
    setBusy(true)
    try { await shareClaudeToken(token); setToken(''); toast('Claude Code sign-in saved') } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the token') }
    setBusy(false)
  }
  return (
    <div className="si2-body">
      <ol className="si2-steps">
        <li>On a computer with a browser, run <button type="button" className="si2-code" onClick={() => { navigator.clipboard?.writeText('claude setup-token'); toast('Command copied') }}>claude setup-token<Icon name="copy" size={13} /></button> and approve it in the browser.</li>
        <li>Paste the token it prints here. It starts with <code>sk-ant-oat</code>.</li>
      </ol>
      <form className="si2-paste" onSubmit={(event) => { event.preventDefault(); if (token.trim()) save() }}>
        <input className="input" type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-oat01-…" value={token} onChange={(event) => setToken(event.target.value)} aria-label="Claude Code token" />
        <button className="btn btn-dark" disabled={busy || !token.trim()}>{busy ? 'Saving…' : 'Save'}</button>
      </form>
      {error && <p className="si2-error" role="alert">{error}</p>}
      <p className="si2-note">The token lasts a year and works for your Claude Pro, Max, Team or Enterprise plan. It can only run the model, so Remote Control and claude.ai connectors still need a normal sign-in. Overseer keeps it on your hub and never shows it again.</p>
    </div>
  )
}

function ShareCodex() {
  const devices = (useDevices().value ?? []).filter((device) => device.online)
  const { toast } = useShell()
  const [deviceId, setDeviceId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const share = async () => {
    setError('')
    setBusy(true)
    try { await shareCodexFrom(deviceId); toast('Codex sign-in saved') } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not copy the sign-in') }
    setBusy(false)
  }
  return (
    <div className="si2-body">
      <p className="si2-text">Pick a machine where Codex is signed in. Overseer copies its sign-in file (<code>~/.codex/auth.json</code>), the way Codex’s own docs describe for machines without a browser.</p>
      <div className="si2-paste">
        <select className="input" value={deviceId} onChange={(event) => setDeviceId(event.target.value)} aria-label="Machine to copy from">
          <option value="">Choose a machine…</option>
          {devices.map((device) => <CodexOption key={device.id} device={device} />)}
        </select>
        <button className="btn btn-dark" disabled={busy || !deviceId} onClick={share}>{busy ? 'Copying…' : 'Share this sign-in'}</button>
      </div>
      {error && <p className="si2-error" role="alert">{error}</p>}
      <CodexWarning />
    </div>
  )
}

function CodexOption({ device }: { device: Device }) {
  const agents = useAgentsOn(device.id)
  const codex = agents?.find((item) => item.id === 'codex')
  if (!codex?.installed) return null
  return <option value={device.id} disabled={codex.auth === 'signed-out'}>{device.name}{codex.auth === 'ok' ? `  ·  signed in${signedAs(codex.account)}` : codex.auth === 'signed-out' ? '  ·  not signed in' : ''}</option>
}

function CodexWarning() {
  return (
    <div className="si2-warn">
      <Icon name="alert" size={16} />
      <p><b>The same Codex sign-in on several machines can sign one of them out.</b> Codex renews its sign-in while it works, and a renewal on one machine can make the copy on another stop working. If that happens, sign that machine in on its own with a device code, or use an API key for machines that run unattended.</p>
    </div>
  )
}

function Shared({ shared }: { shared: SharedLogin }) {
  const devices = useDevices().value ?? []
  const { toast } = useShell()
  const toggleAuto = async (value: boolean) => {
    try { await setSharedAuto(shared.agent, value) } catch (cause) { toast(cause instanceof Error ? cause.message : 'Could not change it') }
  }
  return (
    <div className="si2-body">
      <div className="si2-machines">
        {devices.map((device) => <MachineRow key={device.id} device={device} shared={shared} />)}
      </div>
      <div className="si2-auto">
        <span><b>Use it on new machines</b><span>When a machine joins with {agentInfo(shared.agent).name} installed and not signed in, it gets this sign-in. A machine that is already signed in is never changed.</span></span>
        <Switch checked={shared.auto} onChange={toggleAuto} label={`Use the ${agentInfo(shared.agent).name} sign-in on new machines`} />
      </div>
      {shared.agent === 'codex' && <CodexWarning />}
    </div>
  )
}

function MachineRow({ device, shared }: { device: Device; shared: SharedLogin }) {
  const agents = useAgentsOn(device.online ? device.id : '')
  const { toast } = useShell()
  const [busy, setBusy] = useState(false)
  const state = agents?.find((item) => item.id === shared.agent)
  const applied = shared.applied.find((item) => item.deviceId === device.id)
  const run = async (replace: boolean) => {
    setBusy(true)
    try {
      const [result] = await applySharedLogin(shared.agent, [device.id], replace)
      if (result?.state === 'ok') toast(`${agentInfo(shared.agent).name} is signed in on ${device.name}`)
      else if (result) toast(result.message || 'It didn’t work')
    } catch (cause) { toast(cause instanceof Error ? cause.message : 'Could not apply it') }
    setBusy(false)
  }
  let status: string
  if (!device.online) status = 'Offline'
  else if (!agents) status = 'Checking…'
  else if (!state?.installed) status = 'Not installed'
  else if (applied?.state === 'failed') status = applied.message || 'Didn’t work last time'
  else if (applied && state.auth === 'ok') status = 'Using the shared sign-in'
  else if (state.auth === 'ok') status = `Signed in${signedAs(state.account)} on its own`
  else if (state.auth === 'signed-out') status = 'Not signed in'
  else status = 'Installed'
  const canApply = device.online && !!state?.installed && !(applied && state.auth === 'ok')
  return (
    <div className="si2-row">
      <span className="si2-row-text"><b>{device.name}</b><span className={applied?.state === 'failed' ? 'si2-bad' : undefined}>{status}</span></span>
      {busy ? <span className="spinner" /> : canApply && (
        state!.auth === 'ok'
          ? <button className="btn btn-sm btn-outline" title="Replace this machine’s own sign-in" onClick={() => { if (confirm(`Replace the ${agentInfo(shared.agent).name} sign-in on ${device.name} with the shared one?`)) run(true) }}>Replace</button>
          : <button className="btn btn-sm btn-dark" onClick={() => run(false)}>Use it here</button>
      )}
      {applied && state?.auth === 'ok' && <span className="badge badge-green"><Icon name="check" size={12} />Shared</span>}
    </div>
  )
}

function RemoveMenu({ agent }: { agent: SharedAgent }) {
  const { toast } = useShell()
  const remove = async (fromMachines: boolean) => {
    try { await removeSharedLogin(agent, fromMachines); toast('Removed') } catch (cause) { toast(cause instanceof Error ? cause.message : 'Could not remove it') }
  }
  return (
    <Menu placement="bottom-end" width={290} trigger={<button className="icon-btn" aria-label="More"><Icon name="more" size={18} /></button>}>
      {(close) => (
        <>
          <MenuItem icon="trash" label="Stop sharing" description="Machines keep the sign-in they have" onClick={() => { close(); remove(false) }} />
          <MenuItem icon="trash" label="Stop sharing and sign machines out" description="Removes it where Overseer put it" danger onClick={() => { close(); if (confirm('Sign the machines that use this sign-in out?')) remove(true) }} />
        </>
      )}
    </Menu>
  )
}
