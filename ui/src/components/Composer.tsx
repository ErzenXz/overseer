import { ClipboardEvent, FormEvent, KeyboardEvent, ReactNode, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { limitTone, limitsFor, resetsIn, usePlanLimits } from '../usageLimits'
import { useAgentOptions } from '../agentOptions'
import type { AgentCommand, Device, FsListing, Thread } from '../types'
import { AgentPicker, ModePicker, nextMode } from './AgentPicker'
import { AttachmentChips, DropOverlay, isNativeImage, useAttachments } from './attachments'
import Icon from './Icon'
import { Menu, MenuItem, MenuSeparator } from './Menu'
import { PickTime, SendLaterItems } from './SendMenu'
import type { LaterChoice } from '../schedule'

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
  target,
  blocked,
  initialText = '',
  agentOptional,
  draft,
  commands,
  usage,
  onCompact,
  imageSupport,
  onSchedule,
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
  // target sits beside Send: where the message will run (see TargetPicker).
  target?: ReactNode
  // blocked stops sending (the chosen machine is offline) without hiding why.
  blocked?: boolean
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
  // onSchedule adds the Send-later menu: the message is saved and the hub starts it later.
  onSchedule?: (text: string, images: { path: string }[] | undefined, when: LaterChoice) => Promise<void> | void
}) {
  const [text, setText] = useState(initialText)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [listening, setListening] = useState(false)
  const [picking, setPicking] = useState(false)
  const [slashIndex, setSlashIndex] = useState(0)
  const area = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const recognition = useRef<{ stop: () => void } | null>(null)
  const options = useAgentOptions(settings.deviceId, settings.agent)
  const device = devices.find((item) => item.id === settings.deviceId)
  const attach = useAttachments({ device, cwd: settings.cwd, enabled: !!device && !agentOptional })
  // Claude and Codex always take images natively; ACP agents say so when they start.
  const nativeImages = imageSupport || settings.agent === 'claude' || settings.agent === 'codex'
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

  const submit = async (later?: LaterChoice) => {
    if (attach.uploading || sending || blocked) return
    if (attach.failed) { setError('Retry or remove the attachments that failed'); return }
    // Images go to the agent natively; other files are named by path in the text.
    const ready = attach.items.filter((item) => item.status === 'done' && item.path)
    const images = nativeImages ? ready.filter(isNativeImage) : []
    const refs = ready.filter((item) => !images.includes(item)).map((item) => (/\s/.test(item.path ?? '') ? `@"${item.path}"` : `@${item.path}`))
    const value = [text.trim(), refs.join('\n')].filter(Boolean).join('\n\n')
    if (!value && !images.length && !agentOptional) return
    setSending(true)
    setError('')
    try {
      const sent = images.length ? images.map((item) => ({ path: item.path as string })) : undefined
      if (later && onSchedule) await onSchedule(value, sent, later)
      else await onSubmit(value, sent)
      setText('')
      attach.clear()
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

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files)
    if (files.length && attach.enabled) { event.preventDefault(); attach.add(files) }
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

  const hasAttachments = attach.items.length > 0
  const canSend = (agentOptional || !!text.trim() || hasAttachments) && !sending && !attach.uploading && !blocked && !!settings.deviceId
  const stopping = busy && onStop && !text.trim() && !hasAttachments

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
        <AttachmentChips items={attach.items} onRemove={attach.remove} onRetry={attach.retry} />
        {attach.dragging && <DropOverlay />}
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
                <MenuItem icon="paperclip" label={attach.uploading ? 'Uploading…' : 'Attach a file'} disabled={!attach.enabled} onClick={() => { close(); fileInput.current?.click() }} />
                <MenuItem icon="slash" label="Commands" end={<span className="kbd">/</span>} onClick={() => { close(); insert('/', true) }} />
                <MenuSeparator />
                <MenuItem icon="git-branch" label="Work on a new branch" onClick={() => { close(); insert('Do this on a new git branch and commit when done.') }} />
                <MenuItem icon="pull-request" label="Open a PR when done" onClick={() => { close(); insert('When finished, push the branch and open a pull request.') }} />
                {onSchedule && !agentOptional && (
                  <>
                    <MenuSeparator />
                    <SendLaterItems deviceId={settings.deviceId} agent={settings.agent} model={settings.model} disabled={!canSend} close={close} onLater={(choice) => submit(choice)} onPick={() => setPicking(true)} />
                  </>
                )}
              </>
            )}
          </Menu>
          <input ref={fileInput} type="file" multiple hidden onChange={(event) => { attach.add(Array.from(event.target.files ?? [])); event.target.value = '' }} />
          {!agentOptional && (
            <>
              <AgentPicker settings={settings} onSettings={onSettings} lockAgent={lockAgent} />
              <ModePicker settings={settings} onSettings={onSettings} />
            </>
          )}
          <span className="grow" />
          {!agentOptional && <UsageMeter usage={usage} deviceId={settings.deviceId} agent={settings.agent} onCompact={onCompact} />}
          {target}
          {speechSupported && (
            <button type="button" className={`ctl ctl-icon ${listening ? 'recording' : ''}`} aria-label={listening ? 'Stop dictation' : 'Dictate'} title={listening ? 'Stop dictation' : 'Dictate'} onClick={toggleDictation}>
              <Icon name={listening ? 'wave' : 'mic'} size={16} />
            </button>
          )}
          {stopping ? (
            <button type="button" className="send-round" aria-label="Stop the agent" title="Stop" onClick={onStop}><Icon name="stop" size={13} /></button>
          ) : (
            <button type="submit" className="send-round" aria-label="Send" title={attach.uploading ? 'Waiting for uploads' : 'Send (Enter)'} disabled={!canSend}>
              {sending ? <span className="spinner" style={{ borderColor: 'transparent', borderTopColor: 'currentColor' }} /> : <Icon name="arrow-up" size={17} strokeWidth={2.1} />}
            </button>
          )}
        </div>
      </form>
      {picking && <PickTime onClose={() => setPicking(false)} onPick={(at) => { setPicking(false); submit({ kind: 'time', at }) }} />}
      {context && <div className="composer-context">{context}</div>}
      {(error || attach.notice) && <p className="px-4 pt-2 text-[13px] text-danger" role="alert">{error || attach.notice}</p>}
    </div>
  )
}

// ContextMeter shows how full the agent's context window is; clicking it
// compacts the conversation when the agent supports that.
// UsageMeter is the ring by the send button. It opens a popover with how
// full the context window is, this session's tokens, and the plan's rolling
// limits for this agent on this machine. Compacting is an explicit button
// inside, never a side effect of clicking the ring.
function UsageMeter({ usage, deviceId, agent, onCompact }: { usage?: Thread['usage']; deviceId: string; agent: string; onCompact?: () => void }) {
  const { accounts } = usePlanLimits()
  const plan = limitsFor(accounts, deviceId, agent)
  const windows = plan?.windows ?? []
  const context = usage?.contextWindow && usage.contextTokens ? { used: usage.contextTokens, total: usage.contextWindow } : null
  if (!context && !windows.length) return null
  // With no session yet the ring only shows up when a plan limit is getting high.
  if (!context && Math.max(...windows.map((item) => item.usedPercent)) < 60) return null
  // The ring shows context when known, else the tightest plan window.
  const ratio = context ? Math.min(1, context.used / context.total) : Math.min(1, Math.max(...windows.map((item) => item.usedPercent)) / 100)
  const r = 7
  const circumference = 2 * Math.PI * r
  const k = (n: number) => `${n >= 10_000 ? Math.round(n / 1000) : (n / 1000).toFixed(1)}k`
  const label = context ? `${Math.round(ratio * 100)}% of context used` : `${Math.round(ratio * 100)}% of plan limit used`
  return (
    <Menu
      placement="top-end"
      width={300}
      trigger={
        <button type="button" className={`ctl ctl-icon context-meter ${ratio > 0.8 ? 'is-full' : ''}`} title={label} aria-label={`Usage: ${label}`}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="2" />
            <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={`${circumference * ratio} ${circumference}`} strokeLinecap="round" transform="rotate(-90 9 9)" />
          </svg>
        </button>
      }
    >
      {(close) => (
        <div className="usage-pop">
          {context && (
            <section>
              <div className="usage-pop-row"><span className="usage-pop-title">Context</span><span>{k(context.used)} / {k(context.total)}</span></div>
              <Meter percent={(context.used / context.total) * 100} />
              <p className="usage-pop-note">{Math.round((context.used / context.total) * 100)}% of the context window is in use.</p>
            </section>
          )}
          {usage && (usage.inputTokens || usage.outputTokens) ? (
            <section>
              <div className="usage-pop-row"><span className="usage-pop-title">This session</span><span>{k(usage.inputTokens + usage.outputTokens)} tokens{usage.costUsd ? ` · $${usage.costUsd.toFixed(2)}` : ''}</span></div>
            </section>
          ) : null}
          {windows.length > 0 && (
            <section>
              <div className="usage-pop-row"><span className="usage-pop-title">Plan limits</span><span>{plan?.plan || ''}</span></div>
              {windows.map((item) => (
                <div key={item.id} className="usage-pop-limit">
                  <div className="usage-pop-row"><span>{item.label}</span><span>{Math.round(item.usedPercent)}%{item.resetsAt ? ` · resets ${resetsIn(item.resetsAt)}` : ''}</span></div>
                  <Meter percent={item.usedPercent} />
                </div>
              ))}
            </section>
          )}
          <div className="usage-pop-foot">
            {onCompact && context && <button type="button" className="btn btn-outline btn-sm" onClick={() => { close(); onCompact() }}><Icon name="compress" size={14} />Compact</button>}
            <Link to="/settings/usage" className="usage-pop-link" onClick={close}>All usage<Icon name="arrow-up-right" size={13} /></Link>
          </div>
        </div>
      )}
    </Menu>
  )
}

export function Meter({ percent }: { percent: number }) {
  const value = Math.max(0, Math.min(100, percent))
  return <div className={`meter ${limitTone(percent)}`} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${value}%` }} /></div>
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
