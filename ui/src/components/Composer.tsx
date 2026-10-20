import { ClipboardEvent, FormEvent, KeyboardEvent, ReactNode, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useAgentOptions } from '../agentOptions'
import type { AgentCommand, Device, FsListing, Thread } from '../types'
import { AgentPicker, ModePicker, nextMode } from './AgentPicker'
import Icon from './Icon'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from './Menu'

export interface ComposerSettings {
  deviceId: string
  agent: string
  model: string
  effort: string
  fast: boolean
  // mode is the agent's own mode id (see AgentOptions.modes); '' = its default.
  mode: string
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

export { useAgentsOn } from '../agentOptions'

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
  draft,
  commands,
  usage,
  onCompact,
  imageSupport,
}: {
  placeholder: string
  devices: Device[]
  settings: ComposerSettings
  onSettings: (next: ComposerSettings) => void
  onSubmit: (text: string, images?: { path: string }[]) => Promise<void> | void
  busy?: boolean
  onStop?: () => void
  lockAgent?: boolean
  autoFocus?: boolean
  // context renders a strip attached under the box (machine, folder…).
  context?: ReactNode
  initialText?: string
  // agentOptional hides the agent, model and access controls (terminal mode).
  agentOptional?: boolean
  // draft replaces the text (Edit on a message); id changes for every request.
  draft?: { text: string; id: number }
  // commands are the agent's own slash commands, shown before the built-ins.
  commands?: AgentCommand[]
  usage?: Thread['usage']
  onCompact?: () => void
  // imageSupport sends pasted or attached images to the agent natively.
  imageSupport?: boolean
}) {
  const [text, setText] = useState(initialText)
  const [images, setImages] = useState<{ path: string; name: string }[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [listening, setListening] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [slashIndex, setSlashIndex] = useState(0)
  const area = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const recognition = useRef<{ stop: () => void } | null>(null)
  const options = useAgentOptions(settings.deviceId, settings.agent)
  const device = devices.find((item) => item.id === settings.deviceId)
  const speechSupported = typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)
  const slashQuery = /^\/[\w:-]*$/.test(text) ? text.slice(1).toLowerCase() : null
  // The agent's own commands run natively ("/review"); built-ins expand to prompts.
  const allCommands = [
    ...(commands ?? []).map((command) => ({ id: command.name, label: `/${command.name}`, text: `/${command.name} `, description: command.description, native: true })),
    ...slashCommands.filter((command) => !(commands ?? []).some((native) => native.name === command.id)).map((command) => ({ ...command, native: false })),
  ]
  const slashMatches = slashQuery === null ? [] : allCommands.filter((command) => command.id.toLowerCase().startsWith(slashQuery))

  useEffect(() => { setText(initialText) }, [initialText])
  useEffect(() => {
    if (!draft) return
    setText(draft.text)
    window.setTimeout(() => { area.current?.focus(); const end = draft.text.length; area.current?.setSelectionRange(end, end) }, 0)
  }, [draft?.id]) // eslint-disable-line react-hooks/exhaustive-deps
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
      await onSubmit(value, images.length ? images.map(({ path }) => ({ path })) : undefined)
      setText('')
      setImages([])
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

  // /compact is a real action on agents that support it, not prompt text.
  const pick = (command: { id: string; text: string }) => {
    if (command.id === 'compact' && onCompact) { setText(''); onCompact(); return }
    insert(command.text, true)
  }

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Tab' && event.shiftKey && !agentOptional) {
      event.preventDefault()
      onSettings({ ...settings, mode: nextMode(options, settings.mode) })
      return
    }
    if (slashMatches.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setSlashIndex((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + slashMatches.length) % slashMatches.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        pick(slashMatches[slashIndex])
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
      const path = `${dir}/${file.name || 'pasted.png'}`
      if (imageSupport && (file.type.startsWith('image/') || !file.name)) setImages((current) => [...current, { path, name: file.name || 'pasted.png' }])
      else insert(`@${path}`)
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
  const stopping = busy && onStop && !text.trim()

  return (
    <div className={`composer-wrap ${context ? 'has-context' : ''}`}>
      <form className="composer" onSubmit={(event: FormEvent) => { event.preventDefault(); submit() }}>
        {slashMatches.length > 0 && (
          <div className="composer-suggest" role="listbox" aria-label="Commands">
            {slashMatches.map((command, index) => (
              <button key={command.id} type="button" role="option" aria-selected={index === slashIndex} className="composer-suggest-item" onMouseEnter={() => setSlashIndex(index)} onClick={() => pick(command)}>
                <span className="font-mono">{command.label}</span><span className="min-w-0 flex-1 truncate text-muted">{command.description}</span>{command.native && <span className="composer-suggest-tag">agent</span>}
              </button>
            ))}
          </div>
        )}
        {images.length > 0 && (
          <div className="composer-attachments">
            {images.map((image) => (
              <span key={image.path} className="attachment-chip">
                <Icon name="image" size={14} />{image.name}
                <button type="button" aria-label={`Remove ${image.name}`} onClick={() => setImages((current) => current.filter((item) => item.path !== image.path))}><Icon name="close" size={12} /></button>
              </span>
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
              <AgentPicker settings={settings} onSettings={onSettings} lockAgent={lockAgent} />
              <ModePicker settings={settings} onSettings={onSettings} />
            </>
          )}
          <span className="grow" />
          {usage?.contextWindow && usage.contextTokens ? <ContextMeter used={usage.contextTokens} total={usage.contextWindow} onCompact={onCompact} /> : null}
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
      {context && <div className="composer-context">{context}</div>}
      {error && <p className="px-4 pt-2 text-[13px] text-danger" role="alert">{error}</p>}
    </div>
  )
}

// ContextMeter shows how full the agent's context window is; clicking it
// compacts the conversation when the agent supports that.
function ContextMeter({ used, total, onCompact }: { used: number; total: number; onCompact?: () => void }) {
  const ratio = Math.min(1, used / total)
  const r = 7
  const circumference = 2 * Math.PI * r
  const label = `${Math.round(used / 1000)}k of ${Math.round(total / 1000)}k tokens of context used${onCompact ? '. Click to compact' : ''}`
  return (
    <button type="button" className={`ctl ctl-icon context-meter ${ratio > 0.8 ? 'is-full' : ''}`} title={label} aria-label={label} onClick={onCompact} disabled={!onCompact}>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="2" />
        <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={`${circumference * ratio} ${circumference}`} strokeLinecap="round" transform="rotate(-90 9 9)" />
      </svg>
    </button>
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
