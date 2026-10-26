import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { api, wsURL } from '../api'
import { mockEnabled } from '../mock'
import type { DesktopInfo } from '../types'
import DesktopSetup from './DesktopSetup'
import Icon from './Icon'
import { Menu, MenuItem, MenuLabel, MenuSeparator, Switch } from './Menu'

type RFBInstance = {
  scaleViewport: boolean
  resizeSession: boolean
  viewOnly: boolean
  clipViewport: boolean
  qualityLevel: number
  compressionLevel: number
  showDotCursor: boolean
  sendCredentials: (credentials: { username?: string; password?: string }) => void
  sendCtrlAltDel: () => void
  sendKey: (keysym: number, code: string | null, down?: boolean) => void
  clipboardPasteFrom: (text: string) => void
  disconnect: () => void
  focus: () => void
  addEventListener: (type: string, listener: (event: CustomEvent) => void) => void
}

type State = 'probing' | 'unavailable' | 'connecting' | 'credentials' | 'connected' | 'disconnected' | 'error'

// VncViewer shows a machine's desktop through the hub's VNC tunnel. The
// browser speaks RFB (noVNC) over /api/ws/desktop; the device agent dials its
// own 127.0.0.1 VNC port, so nothing is exposed on the network.
export default function VncViewer({ deviceId, deviceName, compact }: { deviceId: string; deviceName: string; compact?: boolean }) {
  const screen = useRef<HTMLDivElement>(null)
  const rfb = useRef<RFBInstance | null>(null)
  const [info, setInfo] = useState<DesktopInfo | null>(null)
  const [state, setState] = useState<State>('probing')
  const [message, setMessage] = useState('')
  const [needs, setNeeds] = useState<string[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [viewOnly, setViewOnly] = useState(false)
  const [scale, setScale] = useState(true)
  const [quality, setQuality] = useState(6)
  const [attempt, setAttempt] = useState(0)
  const [desktopName, setDesktopName] = useState('')

  useEffect(() => {
    let alive = true
    setState('probing')
    api.get<DesktopInfo>(`/api/devices/${deviceId}/desktop`).then((next) => {
      if (!alive) return
      setInfo(next)
      if (next.user) setUsername((current) => current || next.user!)
      setState(next.available ? 'connecting' : 'unavailable')
    }).catch((cause) => {
      if (!alive) return
      setInfo({ available: false, port: 0, reason: cause instanceof Error ? cause.message : 'Desktop is unavailable' })
      setState('unavailable')
    })
    return () => { alive = false }
  }, [deviceId, attempt])

  useEffect(() => {
    if (!info?.available || mockEnabled || !screen.current) return
    let disposed = false
    let instance: RFBInstance | null = null
    setState('connecting')
    import('@novnc/novnc/lib/rfb').then((module) => {
      if (disposed || !screen.current) return
      const RFB = (module as unknown as { default: new (target: HTMLElement, url: string, options?: object) => RFBInstance }).default
      const url = `${wsURL('/api/ws/desktop')}?device=${encodeURIComponent(deviceId)}&port=${info.port}`
      instance = new RFB(screen.current, url, { wsProtocols: ['binary'], shared: true })
      instance.scaleViewport = scale
      instance.resizeSession = false
      instance.viewOnly = viewOnly
      instance.qualityLevel = quality
      instance.compressionLevel = 2
      instance.showDotCursor = true
      instance.addEventListener('connect', () => { setState('connected'); setMessage('') })
      instance.addEventListener('disconnect', (event) => {
        setState(event.detail?.clean ? 'disconnected' : 'error')
        setMessage(event.detail?.clean ? 'Disconnected.' : 'The connection to the desktop dropped.')
      })
      instance.addEventListener('credentialsrequired', (event) => {
        setNeeds(event.detail?.types ?? ['password'])
        setState('credentials')
      })
      instance.addEventListener('securityfailure', (event) => {
        setState('error')
        setMessage(event.detail?.reason || 'Authentication failed. Check the VNC password.')
      })
      instance.addEventListener('desktopname', (event) => setDesktopName(event.detail?.name ?? ''))
      instance.addEventListener('clipboard', (event) => {
        const text = event.detail?.text
        if (text) navigator.clipboard?.writeText(text).catch(() => {})
      })
      rfb.current = instance
    }).catch(() => {
      setState('error')
      setMessage('Could not load the VNC client.')
    })
    return () => {
      disposed = true
      try { instance?.disconnect() } catch { /* already closed */ }
      rfb.current = null
    }
  }, [info, deviceId, attempt]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (rfb.current) rfb.current.viewOnly = viewOnly }, [viewOnly])
  useEffect(() => { if (rfb.current) rfb.current.scaleViewport = scale }, [scale])
  useEffect(() => { if (rfb.current) rfb.current.qualityLevel = quality }, [quality])

  const sendCredentials = (event: FormEvent) => {
    event.preventDefault()
    rfb.current?.sendCredentials({ username: username || undefined, password })
    setState('connecting')
  }

  const pasteClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) rfb.current?.clipboardPasteFrom(text)
    } catch { /* clipboard permission denied */ }
  }, [])

  const fullscreen = () => {
    const node = screen.current?.parentElement?.parentElement
    if (!node) return
    if (document.fullscreenElement) document.exitFullscreen()
    else node.requestFullscreen?.()
  }

  const connected = state === 'connected' || (mockEnabled && info?.available)
  return (
    <div className="vnc-shell">
      <div className="vnc-bar">
        <span className="status">
          <span className={`dot ${connected ? 'dot-green' : state === 'connecting' || state === 'probing' ? 'dot-amber dot-pulse' : ''}`} />
          {connected ? (desktopName || `${deviceName} desktop`) : state === 'probing' ? 'Looking for a desktop…' : state === 'connecting' ? 'Connecting…' : state === 'credentials' ? 'Sign in to the desktop' : state === 'unavailable' ? 'No desktop' : 'Disconnected'}
          {connected && info?.port ? <span className="text-faint">· :{info.port}</span> : null}
        </span>
        {!compact && <span className="mr-1 flex items-center gap-2 text-[13px] text-muted">View only <Switch checked={viewOnly} label="View only" onChange={setViewOnly} /></span>}
        <button className="icon-btn" title="Paste your clipboard into the desktop" aria-label="Paste clipboard" disabled={!connected} onClick={pasteClipboard}><Icon name="clipboard" size={17} /></button>
        <Menu placement="bottom-end" width={260} trigger={<button className="icon-btn" aria-label="Desktop options" disabled={!connected}><Icon name="keyboard" size={17} /></button>}>
          {(close) => (
            <>
              <MenuLabel>Send keys</MenuLabel>
              <MenuItem label="Ctrl + Alt + Del" onClick={() => { rfb.current?.sendCtrlAltDel(); close() }} />
              <MenuItem label="Escape" onClick={() => { rfb.current?.sendKey(0xff1b, 'Escape'); close() }} />
              <MenuItem label="Tab" onClick={() => { rfb.current?.sendKey(0xff09, 'Tab'); close() }} />
              <MenuSeparator />
              <MenuLabel>Quality</MenuLabel>
              {[{ v: 2, l: 'Fast' }, { v: 6, l: 'Balanced' }, { v: 9, l: 'Sharp' }].map((item) => <MenuItem key={item.v} label={item.l} checked={quality === item.v} onClick={() => { setQuality(item.v); close() }} />)}
              <MenuSeparator />
              <MenuItem label="Fit to window" checked={scale} onClick={() => { setScale(!scale); close() }} />
              {compact && <MenuItem label="View only" checked={viewOnly} onClick={() => { setViewOnly(!viewOnly); close() }} />}
            </>
          )}
        </Menu>
        <button className="icon-btn" title="Reconnect" aria-label="Reconnect" onClick={() => setAttempt((value) => value + 1)}><Icon name="refresh" size={17} /></button>
        <button className="icon-btn" title="Full screen" aria-label="Full screen" onClick={fullscreen}><Icon name="maximize" size={17} /></button>
      </div>
      <div className="vnc-screen" onClick={() => rfb.current?.focus()}>
        <div ref={screen} />
        {mockEnabled && info?.available && <MockDesktop name={deviceName} />}
        {state === 'unavailable' && <DesktopSetup deviceId={deviceId} deviceName={deviceName} info={info} onCheck={() => setAttempt((value) => value + 1)} onReady={() => setAttempt((value) => value + 1)} />}
        {state === 'credentials' && (
          <div className="vnc-overlay">
            <form onSubmit={sendCredentials} className="w-full max-w-[300px] text-left">
              <h3 className="text-center">Sign in to {deviceName}</h3>
              <p className="mx-auto text-center">{needs.includes('username') ? (info?.os === 'darwin' ? 'Use the name and password you sign in to this Mac with.' : 'The desktop asked for your account name and password.') : 'The desktop asked for its VNC password.'} It goes straight to the machine and isn’t saved.</p>
              {needs.includes('username') && <input className="input mt-4" placeholder="Account name" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} />}
              <input className="input mt-3" type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
              <button className="btn btn-dark mt-4 w-full">Connect</button>
            </form>
          </div>
        )}
        {(state === 'error' || state === 'disconnected') && !mockEnabled && (
          <div className="vnc-overlay">
            <div>
              <h3>{state === 'error' ? 'Couldn’t show the desktop' : 'Disconnected'}</h3>
              <p>{message}</p>
              <button className="btn btn-sm btn-outline mt-4" onClick={() => setAttempt((value) => value + 1)}>Reconnect</button>
            </div>
          </div>
        )}
        {(state === 'probing' || (state === 'connecting' && !mockEnabled)) && <div className="vnc-overlay"><span className="spinner" /></div>}
      </div>
    </div>
  )
}

// A static stand-in so the desktop tab can be judged in the dev mock.
function MockDesktop({ name }: { name: string }) {
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: 'linear-gradient(135deg,#2b3a55 0%,#4a3b5c 55%,#6b4a4a 100%)' }}>
      <div className="flex h-6 items-center gap-4 bg-black/30 px-3 text-[11px] text-white/85 backdrop-blur"><span>●</span><span>Finder</span><span>File</span><span>Edit</span><span>View</span><span className="ml-auto">{name}</span></div>
      <div className="absolute left-[6%] top-[12%] w-[52%] overflow-hidden rounded-lg shadow-2xl" style={{ background: '#1d1d1d' }}>
        <div className="flex h-6 items-center gap-1.5 bg-[#2c2c2c] px-2"><span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" /><span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" /><span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" /><span className="ml-2 text-[10px] text-white/60">zsh — codex-harness</span></div>
        <pre className="p-3 font-mono text-[10.5px] leading-[1.6] text-[#d6d6d6]">{`$ cargo test --all
running 44 tests
............................................
test result: ok. 44 passed; 0 failed

$ codex-harness acp --listen stdio
ready · mcp: 2 servers · computer-use: on
▌`}</pre>
      </div>
      <div className="absolute right-[6%] top-[22%] w-[40%] overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex h-6 items-center gap-1.5 bg-[#ececec] px-2"><span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" /><span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" /><span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" /><span className="mx-auto rounded bg-white px-6 text-[9.5px] text-[#666]">localhost:3000</span></div>
        <div className="space-y-2 p-4"><div className="h-3 w-1/2 rounded bg-[#e6e6e6]" /><div className="h-2 w-5/6 rounded bg-[#efefef]" /><div className="h-2 w-2/3 rounded bg-[#efefef]" /><div className="mt-3 h-16 rounded bg-[#f3f3f3]" /><div className="h-6 w-24 rounded bg-[#2a2a2a]" /></div>
      </div>
      <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-2 rounded-2xl bg-white/20 px-3 py-2 backdrop-blur">{['#4f8df7', '#e26d5a', '#2a2a2a', '#28c840', '#a77ef2'].map((color) => <span key={color} className="h-8 w-8 rounded-lg" style={{ background: color }} />)}</div>
    </div>
  )
}
