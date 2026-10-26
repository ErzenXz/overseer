import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { agentInfo } from '../agents'
import { refreshAgents, useAgentsOn } from '../agentOptions'
import { classifyAgentError, loginCommand, startLogin } from '../lib/agentAuth'
import { sendPrompt, terminalsResource } from '../store'
import { applySharedLogin, isSharedAgent, sharedLoginsResource } from '../sharedLogins'
import type { DeviceAgent } from '../types'
import Icon, { AgentMark } from './Icon'
import Modal from './Modal'
import Terminal from './Terminal'
import { openContinueIn } from './ContinueIn'

// --- the sign-in dialog ---

// SignInDialog runs an agent's own sign-in in a terminal on the machine, right
// where the person is, and notices on its own when it worked.
export function SignInDialog({ deviceId, deviceName, agent, onClose, onSignedIn }: {
  deviceId: string
  deviceName: string
  agent: string
  onClose: () => void
  onSignedIn?: () => void
}) {
  const info = agentInfo(agent)
  const { value: sharedList } = sharedLoginsResource.use()
  const shared = isSharedAgent(agent) ? sharedList?.items.find((item) => item.agent === agent) : undefined
  const [mode, setMode] = useState<'choose' | 'terminal'>('choose')
  const [session, setSession] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [applying, setApplying] = useState(false)
  const started = useRef(false)
  const terminal = !shared || mode === 'terminal'

  useEffect(() => {
    if (!terminal || started.current) return
    started.current = true
    startLogin(deviceId, agent).then((name) => { setSession(name); terminalsResource.refresh() }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not start the sign-in'))
  }, [deviceId, agent, terminal])

  const useShared = async () => {
    setError('')
    setApplying(true)
    try {
      const [result] = await applySharedLogin(agent as 'claude' | 'codex', [deviceId], true)
      if (result?.state === 'ok') { setDone(true); onSignedIn?.() } else setError(result?.message || 'It didn’t work. Sign in on this machine instead.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'It didn’t work') }
    setApplying(false)
  }

  // Re-check every few seconds; the CLI knows when the login went through.
  useEffect(() => {
    if (!session || done) return
    let alive = true
    const timer = window.setInterval(() => {
      refreshAgents(deviceId).then((items) => {
        if (alive && items.find((item) => item.id === agent)?.auth === 'ok') { setDone(true); onSignedIn?.() }
      }).catch(() => {})
    }, 3000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [session, done, deviceId, agent, onSignedIn])

  return (
    <Modal
      wide
      title={`Sign in to ${info.name}`}
      onClose={onClose}
      footer={<button className="btn btn-dark" onClick={onClose}>{done ? 'Done' : 'Close'}</button>}
    >
      <div className="aa-dialog">
        {!done && !terminal ? (
          <div className="aa-choose">
            <button type="button" className="aa-choice" disabled={applying} onClick={useShared}>
              <span className="aa-choice-icon"><Icon name="key" size={18} /></span>
              <span><b>Use your shared sign-in</b><span>{shared!.account ? `${shared!.account} · ` : ''}the one saved in Settings → Sign-ins. One click, no browser.</span></span>
              {applying ? <span className="spinner" /> : <Icon name="chevron" size={16} />}
            </button>
            <button type="button" className="aa-choice" disabled={applying} onClick={() => setMode('terminal')}>
              <span className="aa-choice-icon"><Icon name="terminal" size={18} /></span>
              <span><b>Sign in on {deviceName}</b><span>Run {info.name}’s own sign-in in a terminal here.</span></span>
              <Icon name="chevron" size={16} />
            </button>
            {error && <p className="text-[13px] text-danger">{error}</p>}
          </div>
        ) : done ? (
          <div className="aa-success"><span className="aa-check"><Icon name="check" size={20} /></span><p className="font-medium text-ink">Signed in to {info.name} on {deviceName}</p><p className="text-[13px] text-muted">You can close this and carry on.</p></div>
        ) : (
          <>
            <ol className="aa-steps">
              <li>Follow what the terminal below asks: open the link and enter the code if it shows one.</li>
              <li>Approve the sign-in in your browser, on any device.</li>
              <li>This window notices when it worked.</li>
            </ol>
            <div className="aa-terminal">
              {error ? <p className="p-4 text-[13px] text-danger">{error}</p> : session ? <Terminal key={session} deviceId={deviceId} session={session} /> : <div className="grid h-full place-items-center"><span className="spinner" /></div>}
            </div>
            <p className="hint mt-2 font-mono">{loginCommand(agent)}</p>
          </>
        )}
      </div>
    </Modal>
  )
}

// A button that opens the sign-in dialog.
export function SignInButton({ deviceId, deviceName, agent, label = 'Sign in', primary, onSignedIn }: {
  deviceId: string
  deviceName: string
  agent: string
  label?: string
  primary?: boolean
  onSignedIn?: () => void
}) {
  const [open, setOpen] = useState(false)
  if (!loginCommand(agent)) return null
  return (
    <>
      <button type="button" className={`btn btn-sm ${primary ? 'btn-dark' : 'btn-outline'}`} onClick={() => setOpen(true)}>{label}</button>
      {open && <SignInDialog deviceId={deviceId} deviceName={deviceName} agent={agent} onClose={() => setOpen(false)} onSignedIn={onSignedIn} />}
    </>
  )
}

// --- before a session starts ---

// AuthNotice sits above the composer when the chosen agent is installed on the
// chosen machine but signed out, so the failure never reaches a session.
export function AuthNotice({ deviceId, deviceName, agent }: { deviceId: string; deviceName: string; agent: string }) {
  const agents = useAgentsOn(deviceId)
  const state = agents?.find((item) => item.id === agent)
  if (!state?.installed || state.auth !== 'signed-out') return null
  // With nothing ready on the machine the onboarding card covers this.
  if (!agents?.some((item) => item.id !== 'acp' && item.installed && item.auth !== 'signed-out')) return null
  return (
    <div className="aa-notice" role="status">
      <span className="aa-notice-mark"><AgentMark agent={agent} size={17} /></span>
      <p><b>{agentInfo(agent).name}</b> isn’t signed in on {deviceName}. Sign in once and it works from then on.</p>
      <SignInButton deviceId={deviceId} deviceName={deviceName} agent={agent} primary />
    </div>
  )
}

// Onboarding fills a new session page when no agent on the machine is ready:
// each agent that is installed shows whether it is signed in, with one action.
export function AgentOnboarding({ deviceId, deviceName }: { deviceId: string; deviceName: string }) {
  const agents = useAgentsOn(deviceId)
  if (!agents) return null
  const ready = agents.some((item) => item.id !== 'acp' && item.installed && item.auth !== 'signed-out')
  if (ready) return null
  const installed = agents.filter((item) => item.id !== 'acp' && item.installed)
  return (
    <section className="aa-onboard" aria-label="Get an agent ready">
      <h2>Get an agent ready on {deviceName}</h2>
      <p>{installed.length ? 'Sign in to one of these and you can start your first session.' : 'No coding agent is installed here yet. Install one, then sign in.'}</p>
      <div className="aa-rows">
        {installed.map((item) => <AgentRow key={item.id} deviceId={deviceId} deviceName={deviceName} state={item} />)}
        {installed.length === 0 && (
          <div className="aa-row">
            <span className="aa-row-text"><b>Install an agent</b><span>Claude Code, Codex and Gemini each take one command.</span></span>
            <Link className="btn btn-sm btn-dark" to={`/machines/${deviceId}?tab=agents`}>Install agents</Link>
          </div>
        )}
      </div>
    </section>
  )
}

function AgentRow({ deviceId, deviceName, state }: { deviceId: string; deviceName: string; state: DeviceAgent }) {
  const info = agentInfo(state.id)
  return (
    <div className="aa-row">
      <span className="aa-row-mark"><AgentMark agent={state.id} size={20} /></span>
      <span className="aa-row-text"><b>{info.name}</b><span>{state.auth === 'ok' ? `Signed in${state.account ? (state.account.includes('@') ? ` as ${state.account}` : ` with ${state.account}`) : ''}` : state.auth === 'signed-out' ? 'Not signed in' : 'Installed'}</span></span>
      {state.auth === 'signed-out' && <SignInButton deviceId={deviceId} deviceName={deviceName} agent={state.id} primary />}
    </div>
  )
}

// --- when a session fails ---

export interface AgentErrorScope { threadId: string; agent: string; deviceId: string; deviceName: string }
export const AgentErrorContext = createContext<AgentErrorScope | null>(null)

// ErrorMessage renders an agent's failure: a plain explanation and the one
// action that fixes it for the cases we recognise, the raw text under
// “Details”, and the old red box for anything else.
export function ErrorMessage({ text }: { text: string }) {
  const scope = useContext(AgentErrorContext)
  const [details, setDetails] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [resumed, setResumed] = useState(false)
  const kind = classifyAgentError(text)
  if (!scope || kind === 'other') return <div className="msg-error" role="alert">{text}</div>
  const name = agentInfo(scope.agent).name
  const copy = {
    auth: { title: `${name} needs you to sign in`, body: `It isn’t signed in on ${scope.deviceName}, or its sign-in expired. Sign in once, then pick up where it stopped.` },
    limit: { title: `${name} hit a usage limit`, body: 'Wait for the limit to reset, or hand this session to another agent and keep going.' },
    network: { title: `${name} couldn’t reach its service`, body: `Check ${scope.deviceName}’s internet connection, then try again.` },
  }[kind]
  return (
    <div className="aa-error" role="alert">
      <span className="aa-error-icon"><Icon name={kind === 'auth' ? 'lock' : kind === 'limit' ? 'clock' : 'plug'} size={17} /></span>
      <div className="aa-error-body">
        <p className="aa-error-title">{copy.title}</p>
        <p className="aa-error-text">{kind === 'auth' && signedIn ? 'Signed in. The session can pick up where it stopped.' : copy.body}</p>
        <div className="aa-error-actions">
          {kind === 'auth' && !signedIn && <SignInButton deviceId={scope.deviceId} deviceName={scope.deviceName} agent={scope.agent} primary onSignedIn={() => setSignedIn(true)} />}
          {kind === 'auth' && signedIn && <button type="button" className="btn btn-sm btn-dark" disabled={resumed} onClick={() => { setResumed(true); sendPrompt(scope.threadId, 'Please continue where you left off.').catch(() => setResumed(false)) }}>{resumed ? 'Resuming…' : 'Resume session'}</button>}
          {kind === 'limit' && <button type="button" className="btn btn-sm btn-dark" onClick={() => openContinueIn(scope.threadId)}>Continue in another agent</button>}
          <button type="button" className="aa-details-toggle" onClick={() => setDetails(!details)}>{details ? 'Hide details' : 'Details'}</button>
        </div>
        {details && <pre className="aa-error-raw">{text}</pre>}
      </div>
    </div>
  )
}
