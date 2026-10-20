import { ClipboardEvent, FormEvent, KeyboardEvent, ReactNode, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { accessLevels, agentCatalog, agentInfo } from '../agents'
import type { Access, Device, DeviceAgent, FsListing } from '../types'
import Icon, { AgentMark } from './Icon'
import { Menu, MenuItem, MenuLabel, MenuSeparator, Submenu } from './Menu'

export interface ComposerSettings {
  deviceId: string
  agent: string
  model: string
  access: Access
  cwd: string
}

export const slashCommands: { id: string; label: string; text: string; description: string }[] = [
  { id: 'plan', label: '/plan', text: 'Make a plan first and wait for my go-ahead before changing anything: ', description: 'Plan before editing' },
  { id: 'review', label: '/review', text: 'Review the uncommitted changes in this repo for bugs and risky edits. List concrete issues with file:line.', description: 'Review local changes' },
  { id: 'test', label: '/test', text: 'Run the test suite, fix what fails, and tell me what you changed.', description: 'Run and fix tests' },
  { id: 'pr', label: '/pr', text: 'Commit the current work on a new branch, push it, and open a pull request with a clear description.', description: 'Open a pull request' },
  { id: 'explain', label: '/explain', text: 'Explain how this codebase is structured and where the main entry points are.', description: 'Tour the codebase' },
  { id: 'fixci', label: '/fix-ci', text: 'Find the failing CI checks on the current branch, reproduce them locally, and fix them.', description: 'Fix failing CI' },
]

// useAgentsOn caches which agent CLIs exist on a machine.
const agentCache = new Map<string, DeviceAgent[]>()
export function useAgentsOn(deviceId: string) {
  const [agents, setAgents] = useState<DeviceAgent[] | null>(() => agentCache.get(deviceId) ?? null)
  useEffect(() => {
    if (!deviceId) return
    let alive = true
    setAgents(agentCache.get(deviceId) ?? null)
    api.get<DeviceAgent[]>(`/api/devices/${deviceId}/agents`).then((items) => {
      agentCache.set(deviceId, items)
      if (alive) setAgents(items)
    }).catch(() => { if (alive) setAgents([]) })
    return () => { alive = false }
  }, [deviceId])
  return agents
}

export default function Composer({
  placeholder,
  devices,
  settings,
  onSettings,
  onSubmit,
  busy,
  onStop,
  lockAgent,
  autoFocus,
  context,
  initialText = '',
  agentOptional,
}: {
  placeholder: string
  devices: Device[]
  settings: ComposerSettings
  onSettings: (next: ComposerSettings) => void
  onSubmit: (text: string) => Promise<void> | void
  busy?: boolean
  onStop?: () => void
  lockAgent?: boolean
  autoFocus?: boolean
  // context renders a strip attached above the box (machine, folder…).
  context?: ReactNode
  initialText?: string
  // agentOptional hides the agent, model and access controls (terminal mode).
  agentOptional?: boolean
}) {
  const [text, setText] = useState(initialText)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [listening, setListening] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [slashIndex, setSlashIndex] = useState(0)
  const area = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const recognition = useRef<{ stop: () => void } | null>(null)
  const agents = useAgentsOn(settings.deviceId)
  const device = devices.find((item) => item.id === settings.deviceId)
  const agent = agentInfo(settings.agent)
  const model = agent.models.find((item) => item.id === settings.model)?.label ?? (settings.model || 'Default')
  const access = accessLevels.find((item) => item.id === settings.access) ?? accessLevels[2]
  const speechSupported = typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)
  const slashQuery = /^\/[\w-]*$/.test(text) ? text.slice(1).toLowerCase() : null
  const slashMatches = slashQuery === null ? [] : slashCommands.filter((command) => command.id.startsWith(slashQuery) || command.label.slice(1).startsWith(slashQuery))

  useEffect(() => { setText(initialText) }, [initialText])
  useEffect(() => { setSlashIndex(0) }, [slashQuery])
  useEffect(() => {
    const node = area.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(240, node.scrollHeight)}px`
  }, [text])
  useEffect(() => () => recognition.current?.stop(), [])

  const submit = async () => {
    const value = text.trim()
    if ((!value && !agentOptional) || sending) return
    setSending(true)
    setError('')
    try {
      await onSubmit(value)
      setText('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not send')
    } finally {
      setSending(false)
    }
  }

  const insert = (snippet: string, replace = false) => {
    setText((current) => (replace || !current ? snippet : `${current.trimEnd()}\n${snippet}`))
    window.setTimeout(() => { area.current?.focus(); const end = area.current?.value.length ?? 0; area.current?.setSelectionRange(end, end) }, 0)
  }

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashMatches.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setSlashIndex((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + slashMatches.length) % slashMatches.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        insert(slashMatches[slashIndex].text, true)
        return
      }
      if (event.key === 'Escape') { setText(''); return }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  // Files go to the machine the agent runs on, so the agent can read them.
  const upload = async (file: File) => {
    if (!device) return
    setUploading(true)
    setError('')
    try {
      const dir = `${settings.cwd || '~'}/.overseer/uploads`
      const form = new FormData()
      form.append('file', file, file.name || `pasted-${Date.now()}.png`)
      const res = await fetch(`/api/devices/${device.id}/fs/upload?dir=${encodeURIComponent(dir)}`, { method: 'POST', body: form })
      if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error)
      insert(`@${dir}/${file.name || 'pasted.png'}`)
    } catch (cause) {
      setError(cause instanceof Error ? `Upload failed: ${cause.message}` : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const file = Array.from(event.clipboardData.files)[0]
    if (file) { event.preventDefault(); upload(file) }
  }

  const toggleDictation = () => {
    if (listening) { recognition.current?.stop(); return }
    const Ctor = (window as unknown as { SpeechRecognition?: new () => SpeechLike; webkitSpeechRecognition?: new () => SpeechLike }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition: new () => SpeechLike }).webkitSpeechRecognition
    const rec = new Ctor()
    rec.continuous = true
    rec.interimResults = false
    rec.onresult = (event) => {
      const said = Array.from(event.results).slice(event.resultIndex).map((result) => result[0].transcript).join(' ')
      setText((current) => `${current}${current && !current.endsWith(' ') ? ' ' : ''}${said.trim()}`)
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    recognition.current = rec
    rec.start()
    setListening(true)
  }

  const canSend = (agentOptional || !!text.trim()) && !sending && !!settings.deviceId
  const installed = (id: string) => agents?.find((item) => item.id === id)
  const stopping = busy && onStop && !text.trim()

  return (
    <div className={`composer-wrap ${context ? 'has-context' : ''}`}>
      {context && <div className="composer-context">{context}</div>}
      <form className="composer" onSubmit={(event: FormEvent) => { event.preventDefault(); submit() }}>
        {slashMatches.length > 0 && (
          <div className="composer-suggest" role="listbox" aria-label="Commands">
            {slashMatches.map((command, index) => (
              <button key={command.id} type="button" role="option" aria-selected={index === slashIndex} className="composer-suggest-item" onMouseEnter={() => setSlashIndex(index)} onClick={() => insert(command.text, true)}>
                <span className="font-mono">{command.label}</span><span className="text-muted">{command.description}</span>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={area}
          rows={1}
          value={text}
          autoFocus={autoFocus}
          placeholder={placeholder}
          aria-label="Message"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKey}
          onPaste={onPaste}
        />
        <div className="composer-bar">
          <Menu
            placement="top-start"
            width={250}
            trigger={<button type="button" className="ctl ctl-icon" aria-label="Add" title="Add"><Icon name="plus" size={17} /></button>}
          >
            {(close) => (
              <>
                <MenuItem icon="paperclip" label={uploading ? 'Uploading…' : 'Attach a file'} disabled={!device || uploading} onClick={() => { close(); fileInput.current?.click() }} />
                <MenuItem icon="slash" label="Commands" end={<span className="kbd">/</span>} onClick={() => { close(); insert('/', true) }} />
                <MenuSeparator />
                <MenuItem icon="git-branch" label="Work on a new branch" onClick={() => { close(); insert('Do this on a new git branch and commit when done.') }} />
                <MenuItem icon="pull-request" label="Open a PR when done" onClick={() => { close(); insert('When finished, push the branch and open a pull request.') }} />
              </>
            )}
          </Menu>
          <input ref={fileInput} type="file" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(file); event.target.value = '' }} />
          {!agentOptional && (
            <>
              <Menu
                placement="top-start"
                width={250}
                trigger={<button type="button" className="ctl" disabled={lockAgent} title={lockAgent ? 'The agent is fixed for this session' : 'Choose agent'}><AgentMark agent={settings.agent} size={15} /><span>{agent.name}</span>{!lockAgent && <Icon name="chevron-down" size={12} className="ctl-chev" />}</button>}
              >
                {(close) => {
                  const ready = agentCatalog.filter((item) => agents === null || installed(item.id)?.installed)
                  const missing = agents === null ? [] : agentCatalog.filter((item) => !installed(item.id)?.installed)
                  const pick = (id: string) => { onSettings({ ...settings, agent: id, model: '' }); close() }
                  return (
                    <>
                      {ready.map((item) => <MenuItem key={item.id} icon={<AgentMark agent={item.id} size={16} />} label={item.name} end={installed(item.id)?.version} checked={settings.agent === item.id} onClick={() => pick(item.id)} />)}
                      {missing.length > 0 && (
                        <Submenu icon="more" label="Not installed" width={240}>
                          {missing.map((item) => <MenuItem key={item.id} icon={<AgentMark agent={item.id} size={16} />} label={item.name} checked={settings.agent === item.id} onClick={() => pick(item.id)} />)}
                        </Submenu>
                      )}
                    </>
                  )
                }}
              </Menu>
              {agent.models.length > 1 && (
                <Menu
                  placement="top-start"
                  width={220}
                  trigger={<button type="button" className="ctl" title="Choose model"><span>{model}</span><Icon name="chevron-down" size={12} className="ctl-chev" /></button>}
                >
                  {(close) => agent.models.map((item) => (
                    <MenuItem key={item.id || 'default'} label={item.label} end={item.id ? undefined : 'CLI default'} checked={settings.model === item.id} onClick={() => { onSettings({ ...settings, model: item.id }); close() }} />
                  ))}
                </Menu>
              )}
              <Menu
                placement="top-start"
                width={290}
                trigger={<button type="button" className="ctl" title="Access level"><Icon name={settings.access === 'ask' ? 'eye' : settings.access === 'full' ? 'zap' : 'shield'} size={14} /><span>{access.label}</span><Icon name="chevron-down" size={12} className="ctl-chev" /></button>}
              >
                {(close) => accessLevels.map((item) => (
                  <MenuItem key={item.id} label={item.label} description={item.description} checked={item.id === settings.access} onClick={() => { onSettings({ ...settings, access: item.id }); close() }} />
                ))}
              </Menu>
            </>
          )}
          <span className="grow" />
          {speechSupported && (
            <button type="button" className={`ctl ctl-icon ${listening ? 'recording' : ''}`} aria-label={listening ? 'Stop dictation' : 'Dictate'} title={listening ? 'Stop dictation' : 'Dictate'} onClick={toggleDictation}>
              <Icon name={listening ? 'wave' : 'mic'} size={16} />
            </button>
          )}
          {stopping ? (
            <button type="button" className="send-round" aria-label="Stop the agent" title="Stop" onClick={onStop}><Icon name="stop" size={13} /></button>
          ) : (
            <button type="submit" className="send-round" aria-label="Send" title="Send (Enter)" disabled={!canSend}>
              {sending ? <span className="spinner" style={{ borderColor: 'transparent', borderTopColor: 'currentColor' }} /> : <Icon name="arrow-up" size={17} strokeWidth={2.1} />}
            </button>
          )}
        </div>
      </form>
      {error && <p className="px-4 pt-2 text-[13px] text-danger" role="alert">{error}</p>}
    </div>
  )
}

interface SpeechLike {
  continuous: boolean
  interimResults: boolean
  onresult: (event: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string } }> }) => void
  onend: () => void
  onerror: () => void
  start: () => void
  stop: () => void
}

// ContextStrip sits on top of the composer on the new-session page: where the
// agent will run (machine) and in which folder.
export function ContextStrip({ devices, settings, onSettings, recents, hideFolder }: { devices: Device[]; settings: ComposerSettings; onSettings: (next: ComposerSettings) => void; recents: string[]; hideFolder?: boolean }) {
  const device = devices.find((item) => item.id === settings.deviceId)
  return (
    <>
      <Menu
        placement="bottom-start"
        width={270}
        trigger={<button type="button" className="ctx-btn" title="Machine"><Icon name="monitor" size={15} /><span>{device?.name ?? 'Choose machine'}</span><Icon name="chevron-down" size={12} className="ctl-chev" /></button>}
      >
        {(close) => (
          <>
            <MenuLabel>Run on</MenuLabel>
            {devices.length === 0 && <p className="menu-empty">No machines yet.</p>}
            {devices.map((item) => (
              <MenuItem key={item.id} icon={<span className={`dot ${item.online ? 'dot-green' : ''}`} style={{ margin: '0 5px' }} />} label={item.name} end={item.online ? (item.isHub ? 'hub' : item.os) : 'offline'} disabled={!item.online} checked={item.id === settings.deviceId} onClick={() => { onSettings({ ...settings, deviceId: item.id, cwd: '' }); close() }} />
            ))}
          </>
        )}
      </Menu>
      {!hideFolder && (
        <>
          <span className="ctx-sep">/</span>
          <Menu
            placement="bottom-start"
            width={360}
            trigger={<button type="button" className="ctx-btn" title={settings.cwd || 'Home folder'}><Icon name="folder" size={15} /><span>{settings.cwd ? shortPath(settings.cwd) : 'Home'}</span><Icon name="chevron-down" size={12} className="ctl-chev" /></button>}
          >
            {(close) => (
              <>
                {recents.length > 0 && (
                  <>
                    <MenuLabel>Recent</MenuLabel>
                    {recents.map((folder) => <MenuItem key={folder} icon="folder" label={folder} checked={folder === settings.cwd} onClick={() => { onSettings({ ...settings, cwd: folder }); close() }} />)}
                    <MenuSeparator />
                  </>
                )}
                <MenuLabel>Browse {devices.find((item) => item.id === settings.deviceId)?.name ?? ''}</MenuLabel>
                <FolderPicker deviceId={settings.deviceId} value={settings.cwd} onPick={(cwd) => { onSettings({ ...settings, cwd }); close() }} />
              </>
            )}
          </Menu>
        </>
      )}
    </>
  )
}

export function shortPath(path: string) {
  const parts = path.replace(/\/+$/, '').split('/')
  return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : path
}

// FolderPicker browses the machine's filesystem through the hub.
export function FolderPicker({ deviceId, value, onPick, disabled }: { deviceId: string; value: string; onPick: (path: string) => void; disabled?: boolean }) {
  const [path, setPath] = useState(value || '~')
  const [listing, setListing] = useState<FsListing | null>(null)
  const [error, setError] = useState('')
  const load = async (next: string) => {
    setError('')
    try {
      const result = await api.get<FsListing>(`/api/devices/${deviceId}/fs?path=${encodeURIComponent(next)}`)
      setListing(result)
      setPath(result.path)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not list folder')
    }
  }
  useEffect(() => { if (deviceId) load(value || '~') }, [deviceId]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!deviceId) return <p className="menu-empty">Choose a machine first.</p>
  const dirs = (listing?.entries ?? []).filter((entry) => entry.dir && !entry.name.startsWith('.'))
  const parent = path.replace(/\/[^/]+\/?$/, '') || '/'
  return (
    <div className="p-1">
      <form className="flex gap-2 p-1" onSubmit={(event) => { event.preventDefault(); load(path) }}>
        <input className="input input-mono" style={{ height: 32 }} value={path} onChange={(event) => setPath(event.target.value)} aria-label="Folder path" disabled={disabled} />
      </form>
      {error && <p className="px-2 py-1 text-[12.5px] text-danger">{error}</p>}
      <div className="menu-scroll" style={{ maxHeight: 240 }}>
        {listing && listing.path !== '/' && <MenuItem icon="arrow-up" label=".." onClick={() => load(parent)} />}
        {dirs.map((entry) => <MenuItem key={entry.name} icon="folder" label={entry.name} onClick={() => load(`${listing!.path.replace(/\/$/, '')}/${entry.name}`)} />)}
        {listing && dirs.length === 0 && <p className="menu-empty">No sub-folders.</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-line p-2">
        <button type="button" className="btn btn-sm btn-dark" disabled={disabled} onClick={() => onPick(listing?.path ?? path)}>Use this folder</button>
      </div>
    </div>
  )
}
