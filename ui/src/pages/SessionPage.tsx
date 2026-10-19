import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { agentInfo, formatDuration, statusText } from '../agents'
import Composer, { type ComposerSettings } from '../components/Composer'
import FileBrowser from '../components/FileBrowser'
import Icon, { AgentMark } from '../components/Icon'
import { Menu, MenuItem, MenuSeparator } from '../components/Menu'
import Terminal from '../components/Terminal'
import Transcript, { Diff, PlanCard } from '../components/Transcript'
import VncViewer from '../components/VncViewer'
import { SidebarToggle, useOwnHeader, useShell } from '../shell'
import { answerApproval, cancelThread, deleteThread, openThreadStream, patchThread, sendPrompt, threadsResource, useDevices, usePref } from '../store'
import type { Thread, ThreadMessage } from '../types'

type Tab = 'shell' | 'desktop' | 'files' | 'changes' | 'plan'

export default function SessionPage() {
  useOwnHeader()
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { toast, mobile } = useShell()
  const { value: devices } = useDevices()
  const [thread, setThread] = useState<Thread | null>(null)
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [missing, setMissing] = useState(false)
  const [connected, setConnected] = useState(true)
  const [expandAll, setExpandAll] = useState(false)
  const [savedPanel, setSavedPanel] = usePref<Tab | ''>('session.panel', '')
  // On phones the workspace covers the chat, so it never reopens by itself.
  const [mobilePanel, setMobilePanel] = useState<Tab | ''>('')
  const panel = mobile ? mobilePanel : savedPanel
  const setPanel = mobile ? setMobilePanel : setSavedPanel
  const [panelWidth, setPanelWidth] = usePref('session.panelWidth', 46)
  const [renaming, setRenaming] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const scroller = useRef<HTMLDivElement>(null)
  const shell = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setThread(null)
    setMessages([])
    setMissing(false)
    const timeout = window.setTimeout(() => setMissing((current) => current || false), 0)
    const stop = openThreadStream(id, (event) => {
      if (event.type === 'snapshot') {
        setThread(event.thread)
        setMessages([...event.messages].sort((a, b) => a.seq - b.seq))
      } else if (event.type === 'thread') {
        setThread(event.thread)
        threadsResource.set((threads) => threads?.map((item) => item.id === event.thread.id ? event.thread : item) ?? threads)
      } else if (event.type === 'message') {
        setMessages((current) => {
          const index = current.findIndex((message) => message.id === event.message.id)
          if (index === -1) return [...current, event.message].sort((a, b) => a.seq - b.seq)
          const next = current.slice()
          next[index] = event.message
          return next
        })
      }
    }, setConnected)
    api.get(`/api/threads/${encodeURIComponent(id)}`).catch((cause) => { if (cause?.status === 404) setMissing(true) })
    return () => { stop(); window.clearTimeout(timeout) }
  }, [id])

  // Opening a session marks it read, and so does every update seen while open.
  useEffect(() => {
    if (thread && thread.updatedAt > thread.lastReadAt && thread.status !== 'working') patchThread(thread.id, { read: true }).catch(() => {})
  }, [thread?.id, thread?.updatedAt, thread?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the view pinned to the bottom while the agent streams, unless the
  // reader scrolled up.
  useEffect(() => {
    const node = scroller.current
    if (node && atBottom) node.scrollTop = node.scrollHeight
  }, [messages, atBottom])
  const onScroll = () => {
    const node = scroller.current
    if (node) setAtBottom(node.scrollHeight - node.scrollTop - node.clientHeight < 80)
  }

  const settings: ComposerSettings | null = thread && { deviceId: thread.deviceId, agent: thread.agent, model: thread.model ?? '', access: thread.access, cwd: thread.cwd }
  const send = async (text: string) => {
    if (!thread) return
    await sendPrompt(thread.id, text)
    setAtBottom(true)
  }
  const updateSettings = async (next: ComposerSettings) => {
    if (!thread) return
    const patch: Partial<Thread> = {}
    if (next.access !== thread.access) patch.access = next.access
    if (next.model !== (thread.model ?? '')) patch.model = next.model
    if (Object.keys(patch).length) setThread(await patchThread(thread.id, patch))
  }
  const approve = useCallback(async (approvalId: string, optionId: string) => {
    if (thread) await answerApproval(thread.id, approvalId, optionId)
  }, [thread])

  const users = messages.filter((message) => message.role === 'user')
  const changes = useMemo(() => {
    const byPath = new Map<string, NonNullable<NonNullable<ThreadMessage['tool']>['files']>[number]>()
    for (const message of messages) for (const file of message.tool?.files ?? []) {
      const previous = byPath.get(file.path)
      byPath.set(file.path, { path: file.path, additions: (previous?.additions ?? 0) + (file.additions ?? 0), deletions: (previous?.deletions ?? 0) + (file.deletions ?? 0), diff: [previous?.diff, file.diff].filter(Boolean).join('\n') || undefined })
    }
    return [...byPath.values()]
  }, [messages])
  const plan = [...messages].reverse().find((message) => message.role === 'plan')?.plan

  const startResize = (event: React.PointerEvent) => {
    event.preventDefault()
    const total = shell.current?.getBoundingClientRect()
    if (!total) return
    const handle = event.currentTarget as HTMLElement
    handle.classList.add('dragging')
    const move = (moveEvent: PointerEvent) => {
      const pct = ((total.right - moveEvent.clientX) / total.width) * 100
      setPanelWidth(Math.round(Math.min(72, Math.max(28, pct))))
    }
    const up = () => { handle.classList.remove('dragging'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  if (missing && !thread) {
    return (
      <>
        <header className="topbar"><SidebarToggle /></header>
        <div className="empty">
          <span className="empty-icon"><Icon name="message" size={24} /></span>
          <h2>Session not found</h2>
          <p>It may have been deleted, or it lives on a different hub.</p>
          <Link to="/" className="btn btn-dark">New session</Link>
        </div>
      </>
    )
  }

  const running = thread?.status === 'working' || thread?.status === 'starting'
  const device = devices?.find((item) => item.id === thread?.deviceId)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="topbar">
        <SidebarToggle />
        {thread && renaming ? (
          <form onSubmit={(event) => { event.preventDefault(); const value = new FormData(event.currentTarget).get('title') as string; setRenaming(false); if (value.trim() && value !== thread.title) patchThread(thread.id, { title: value.trim() }).then(setThread) }}>
            <input name="title" className="input" style={{ height: 32, width: 360 }} defaultValue={thread.title} autoFocus onBlur={(event) => event.currentTarget.form?.requestSubmit()} onKeyDown={(event) => { if (event.key === 'Escape') setRenaming(false) }} />
          </form>
        ) : (
          <button className="topbar-title hover:text-secondary" onDoubleClick={() => setRenaming(true)} title="Double-click to rename">{thread?.title ?? <span className="skeleton inline-block h-4 w-56" />}</button>
        )}
        {thread?.pr && (
          <a href={thread.pr.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[15px]" style={{ color: 'var(--purple)' }} title="Pull request">
            <Icon name={thread.pr.state === 'merged' ? 'git-merge' : 'pull-request'} size={17} />#{thread.pr.number}
          </a>
        )}
        {thread && running && <span className="badge"><span className="dot dot-blue dot-pulse" />{statusText[thread.status]}</span>}
        {thread?.status === 'waiting' && <span className="badge badge-amber">Needs approval</span>}
        {!connected && <span className="badge badge-amber" title="Reconnecting to the hub">Reconnecting…</span>}
        <div className="topbar-actions">
          {thread && (
            <span className="mr-2 hidden items-center gap-2 text-[13.5px] text-muted md:flex">
              <AgentMark agent={thread.agent} size={15} />{agentInfo(thread.agent).name}
              <span className="text-faint">·</span>
              <Link to={`/machines/${thread.deviceId}`} className="hover:text-ink">{thread.deviceName}</Link>
            </span>
          )}
          <button className={`icon-btn ${expandAll ? 'icon-btn-active' : ''}`} aria-label={expandAll ? 'Collapse steps' : 'Expand all steps'} title={expandAll ? 'Collapse steps' : 'Expand all steps'} onClick={() => setExpandAll(!expandAll)}><Icon name="list-bullets" size={19} /></button>
          <Menu placement="bottom-end" width={250} trigger={<button className="icon-btn" aria-label="Session actions"><Icon name="more" size={19} /></button>}>
            {(close) => thread && (
              <>
                <MenuItem icon="edit" label="Rename" onClick={() => { close(); setRenaming(true) }} />
                <MenuItem icon="link" label="Copy link" onClick={() => { close(); navigator.clipboard?.writeText(location.href); toast('Link copied') }} />
                <MenuItem icon="terminal" label="Open shell" onClick={() => { close(); setPanel('shell') }} />
                <MenuItem icon="presentation" label="Open desktop" onClick={() => { close(); setPanel('desktop') }} />
                {thread.pr && <MenuItem icon="pull-request" label="Open pull request" href={thread.pr.url} onClick={close} />}
                <MenuSeparator />
                <MenuItem icon="stop" label="Stop the agent" disabled={!running} onClick={() => { close(); cancelThread(thread.id) }} />
                <MenuItem icon="trash" label="Delete session" danger onClick={async () => {
                  close()
                  if (!confirm('Delete this session and its history? The agent is stopped.')) return
                  await deleteThread(thread.id)
                  navigate('/')
                }} />
              </>
            )}
          </Menu>
          <button className={`icon-btn ${panel ? 'icon-btn-active' : ''}`} aria-label={panel ? 'Hide workspace' : 'Show workspace'} title="Shell, desktop and files" onClick={() => setPanel(panel ? '' : 'shell')}><Icon name="panel-right" size={19} /></button>
        </div>
      </header>

      <div className="thread-shell" ref={shell}>
        <div className="thread-main">
          <div className="thread-scroll" ref={scroller} onScroll={onScroll}>
            <div className="thread-col">
              {!thread ? (
                <div className="space-y-5 pt-6">{[60, 90, 75].map((width) => <div key={width} className="skeleton h-5" style={{ width: `${width}%` }} />)}</div>
              ) : (
                <Transcript thread={thread} messages={messages} expandAll={expandAll} onApprove={approve} />
              )}
              {thread?.usage && !running && (
                <p className="mt-6 text-center text-[12.5px] text-faint">
                  {Math.round((thread.usage.inputTokens + thread.usage.outputTokens) / 1000)}k tokens{thread.usage.costUsd ? ` · $${thread.usage.costUsd.toFixed(2)}` : ''}
                </p>
              )}
            </div>
          </div>
          {users.length > 1 && !panel && (
            <nav className="thread-minimap" aria-label="Jump to message">
              {users.map((message, index) => (
                <button key={message.id} className={index === users.length - 1 ? 'last' : ''} title={message.text.slice(0, 80)} aria-label={`Message ${index + 1}`} onClick={() => document.querySelector(`[data-user-message="${message.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
              ))}
            </nav>
          )}
          {!atBottom && <button className="jump-latest" onClick={() => setAtBottom(true)}><Icon name="arrow-down" size={14} />Latest</button>}
          <div className="thread-composer">
            {thread && settings && (
              <Composer
                placeholder={running ? 'Send a follow-up — the agent picks it up after this step' : thread.status === 'waiting' ? 'Answer the approval above, or send a message' : 'Ask Overseer to build features, fix bugs, or work on your code'}
                devices={devices ?? []}
                settings={settings}
                onSettings={updateSettings}
                onSubmit={send}
                busy={running}
                onStop={() => cancelThread(thread.id)}
                lockAgent
              />
            )}
            {device && !device.online && <p className="mt-2 text-center text-[13px] text-warning">{device.name} is offline. Messages are sent when it reconnects.</p>}
          </div>
        </div>

        {panel && thread && (
          <>
            <div className="resize-handle hidden lg:block" onPointerDown={startResize} role="separator" aria-orientation="vertical" aria-label="Resize workspace" />
            <aside className="workspace" style={{ width: `${panelWidth}%` }} aria-label="Workspace">
              <div className="workspace-tabs" role="tablist">
                {([['shell', 'terminal', 'Shell'], ['desktop', 'presentation', 'Desktop'], ['files', 'folder', 'Files'], ['changes', 'file-diff', `Changes${changes.length ? ` ${changes.length}` : ''}`], ['plan', 'list-checks', 'Plan']] as const).map(([key, icon, label]) => (
                  <button key={key} role="tab" className="workspace-tab" aria-selected={panel === key} onClick={() => setPanel(key)}><Icon name={icon} size={16} />{label}</button>
                ))}
                <span className="flex-1" />
                <button className="icon-btn" aria-label="Close workspace" onClick={() => setPanel('')}><Icon name="close" size={17} /></button>
              </div>
              <div className="workspace-body">
                {panel === 'shell' && <ThreadShell thread={thread} />}
                {panel === 'desktop' && <VncViewer deviceId={thread.deviceId} deviceName={thread.deviceName} compact />}
                {panel === 'files' && <FileBrowser deviceId={thread.deviceId} initialPath={thread.cwd || '~'} compact />}
                {panel === 'changes' && (
                  <div className="h-full overflow-y-auto p-4">
                    {changes.length === 0 ? <p className="empty-text p-6 text-center">No file changes yet.</p> : changes.map((file) => file.diff ? <Diff key={file.path} file={file} /> : (
                      <div key={file.path} className="diff"><div className="diff-head"><Icon name="file" size={14} /><span className="truncate">{file.path}</span><span className="ml-auto"><span className="plus">+{file.additions ?? 0}</span> <span className="minus">−{file.deletions ?? 0}</span></span></div></div>
                    ))}
                  </div>
                )}
                {panel === 'plan' && (
                  <div className="h-full overflow-y-auto p-4">
                    {plan ? <PlanCard plan={plan} /> : <p className="empty-text p-6 text-center">The agent hasn’t shared a plan in this session.</p>}
                    <TurnSummary messages={messages} />
                  </div>
                )}
              </div>
            </aside>
          </>
        )}
      </div>
    </div>
  )
}

function TurnSummary({ messages }: { messages: ThreadMessage[] }) {
  const turns = messages.filter((message) => message.role === 'user')
  if (!turns.length) return null
  return (
    <div className="mt-4">
      <p className="mb-2 text-[13px] text-muted">Timeline</p>
      {turns.map((turn) => {
        const done = messages.find((message) => message.turn === turn.id && message.durationMs)
        const tools = messages.filter((message) => message.turn === turn.id && message.role === 'tool').length
        return (
          <button key={turn.id} className="list-row rounded-lg" style={{ minHeight: 0, padding: '10px 12px', borderTop: 0 }} onClick={() => document.querySelector(`[data-user-message="${turn.id}"]`)?.scrollIntoView({ behavior: 'smooth' })}>
            <Icon name={done ? 'check' : 'clock'} size={16} className="text-muted" />
            <span className="min-w-0 flex-1"><span className="block truncate text-[14px]">{turn.text}</span><span className="text-[12.5px] text-muted">{tools} steps{done?.durationMs ? ` · ${formatDuration(done.durationMs)}` : ''}</span></span>
          </button>
        )
      })}
    </div>
  )
}

// The Shell tab attaches to a tmux session in the thread's folder, created on
// first open, so you can poke at the same checkout the agent works in.
function ThreadShell({ thread }: { thread: Thread }) {
  const name = thread.terminal || `t-${thread.id}`
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    let alive = true
    setReady(false)
    api.post(`/api/devices/${thread.deviceId}/sessions`, { name, cwd: thread.cwd, kind: 'shell' })
      .catch(() => { /* already exists */ })
      .finally(() => { if (alive) setReady(true) })
    return () => { alive = false }
  }, [thread.deviceId, name, thread.cwd, generation])
  if (!ready) return <div className="grid h-full place-items-center term-host"><span className="spinner" /></div>
  return (
    <div className="flex h-full flex-col">
      {error && <div className="flex items-center gap-3 bg-[var(--amber-bg)] px-4 py-2 text-[13px] text-warning">Shell ended{error !== 'disconnected' ? `: ${error}` : ''}.<button className="underline" onClick={() => { setError(''); setGeneration((value) => value + 1) }}>Restart</button></div>}
      <div className="min-h-0 flex-1"><Terminal key={generation} deviceId={thread.deviceId} session={name} onExit={setError} /></div>
    </div>
  )
}
