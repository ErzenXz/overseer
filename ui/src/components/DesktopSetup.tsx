import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { terminalsResource } from '../store'
import type { DesktopInfo } from '../types'
import Icon from './Icon'
import Terminal from './Terminal'

const POLL_MS = 3000
const GIVE_UP_MS = 10 * 60 * 1000

// DesktopSetup is the Desktop tab's empty state: one button that installs and
// starts a VNC server in a visible terminal on the machine, then watches for
// it to come up. The commands come from the hub, never from the browser.
export default function DesktopSetup({ deviceId, deviceName, info, onCheck, onReady }: { deviceId: string; deviceName: string; info: DesktopInfo | null; onCheck: () => void; onReady: () => void }) {
  const setup = info?.setup
  const [session, setSession] = useState('')
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const [waited, setWaited] = useState(false)
  const [copied, setCopied] = useState(false)
  const ready = useRef(onReady)
  ready.current = onReady

  // While the setup terminal runs, look for the VNC server every few seconds
  // and hand over to the live desktop as soon as it answers.
  useEffect(() => {
    if (!session) return
    let alive = true
    const started = Date.now()
    setWaited(false)
    const timer = window.setInterval(async () => {
      if (Date.now() - started > GIVE_UP_MS) { window.clearInterval(timer); if (alive) setWaited(true); return }
      try {
        const next = await api.get<DesktopInfo>(`/api/devices/${deviceId}/desktop`)
        if (alive && next.available) { window.clearInterval(timer); ready.current() }
      } catch { /* machine busy or reconnecting: keep looking */ }
    }, POLL_MS)
    return () => { alive = false; window.clearInterval(timer) }
  }, [session, deviceId])

  const start = async () => {
    if (!setup?.command) return
    const name = `desktop-setup-${Date.now().toString().slice(-5)}`
    setStarting(true)
    setError('')
    try {
      await api.post(`/api/devices/${deviceId}/sessions`, { name, command: setup.command, kind: 'setup' })
      terminalsResource.refresh()
      setSession(name)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start setup')
    } finally {
      setStarting(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText((setup?.steps ?? []).join('\n'))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch { /* clipboard blocked */ }
  }

  if (session) {
    return (
      <div className="vnc-overlay">
        <div className="vnc-setup">
          <h3 className="flex items-center justify-center gap-2">{waited ? 'Still not up' : <><span className="spinner" />Setting up the desktop</>}</h3>
          <p>{waited ? 'The desktop didn’t come up in ten minutes. Check the terminal for errors, or try again.' : setup?.needsAdmin ? 'Type your password in the terminal if it asks. This switches to the desktop when it’s ready.' : 'This switches to the desktop when it’s ready.'}</p>
          <div className="vnc-setup-term"><Terminal key={session} deviceId={deviceId} session={session} onExit={() => terminalsResource.refresh()} /></div>
          <div className="vnc-setup-actions">
            <button className="btn btn-sm btn-outline" onClick={onCheck}>Check now</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setSession('')}>Back</button>
          </div>
        </div>
      </div>
    )
  }

  if (!setup) {
    return (
      <div className="vnc-overlay">
        <div>
          <Icon name="presentation" size={30} className="mx-auto mb-4 text-[#777]" />
          <h3>No desktop on {deviceName} yet</h3>
          <p>{info?.reason || 'Start a VNC server on this machine, listening on 127.0.0.1:5900.'}</p>
          <p>Overseer tunnels it through the agent connection, so it never needs to be reachable from the network.</p>
          <button className="btn btn-sm btn-outline mt-4" onClick={onCheck}>Check again</button>
        </div>
      </div>
    )
  }

  return (
    <div className="vnc-overlay">
      <div className="vnc-setup">
        <Icon name="presentation" size={30} className="mx-auto mb-4 text-[#777]" />
        <h3>{setup.supported ? `Set up remote desktop on ${deviceName}` : `No desktop on ${deviceName} yet`}</h3>
        <p>{setup.summary}</p>
        {setup.supported ? (
          <>
            {setup.notes && setup.notes.length > 0 && <ul className="vnc-setup-notes">{setup.notes.map((note) => <li key={note}>{note}</li>)}</ul>}
            {error && <p className="vnc-setup-error">{error}</p>}
            <div className="vnc-setup-actions">
              <button className="btn btn-dark" onClick={start} disabled={starting}>{starting ? <span className="spinner" /> : <Icon name="monitor" size={16} />}Set up remote desktop</button>
              <button className="btn btn-sm btn-ghost" onClick={onCheck}>Check again</button>
            </div>
            <details className="vnc-setup-details">
              <summary>Show me the commands</summary>
              <pre>{(setup.steps ?? []).join('\n')}</pre>
              <button className="btn btn-sm btn-outline" onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={14} />{copied ? 'Copied' : 'Copy'}</button>
              <p>These run in a terminal on {deviceName}, so you can watch them and answer prompts. The server only listens on localhost.</p>
            </details>
            {setup.manual && setup.manual.length > 0 && (
              <details className="vnc-setup-details">
                <summary>Prefer to do it by hand</summary>
                <ol>{setup.manual.map((step) => <li key={step}>{step}</li>)}</ol>
              </details>
            )}
          </>
        ) : (
          <>
            {setup.manual && setup.manual.length > 0 && <ol className="vnc-setup-steps">{setup.manual.map((step) => <li key={step}>{step}</li>)}</ol>}
            <div className="vnc-setup-actions"><button className="btn btn-sm btn-outline" onClick={onCheck}>Check again</button></div>
          </>
        )}
      </div>
    </div>
  )
}
