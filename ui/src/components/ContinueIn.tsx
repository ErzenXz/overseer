import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { agentInfo } from '../agents'
import { useAgentsOn } from '../agentOptions'
import { isHeld, type HeldStart } from '../held'
import type { ContinueLinks, ContinuePreview } from '../schedule'
import { useShell } from '../shell'
import { newRequestId, threadsResource, useThreads } from '../store'
import type { Thread } from '../types'
import { AgentPicker } from './AgentPicker'
import type { ComposerSettings } from './Composer'
import Icon, { AgentMark } from './Icon'
import Modal from './Modal'

// "Continue in…": carry a stuck session on in another agent. The hub writes a
// handoff prompt from the transcript (goal, what was done, files, plan, last
// error); it is shown here to edit before the new session starts.

let request: { threadId: string; messageId?: string } | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

// openContinueIn can be called from any menu; ContinueInHost shows the dialog.
export function openContinueIn(threadId: string, messageId?: string) {
  request = { threadId, messageId }
  emit()
}

export function ContinueInHost() {
  const current = useSyncExternalStore(subscribe, () => request)
  if (!current) return null
  return <ContinueModal key={`${current.threadId}:${current.messageId ?? ''}`} threadId={current.threadId} messageId={current.messageId} onClose={() => { request = null; emit() }} />
}

// A good first pick: the other big agent, else any other installed one.
function suggestAgent(current: string, installed: string[]) {
  const order = current === 'claude' ? ['codex', 'gemini', 'opencode'] : ['claude', 'codex', 'gemini']
  return order.find((id) => id !== current && (installed.length === 0 || installed.includes(id))) ?? installed.find((id) => id !== current) ?? (current === 'claude' ? 'codex' : 'claude')
}

function ContinueModal({ threadId, messageId, onClose }: { threadId: string; messageId?: string; onClose: () => void }) {
  const { value: threads } = useThreads()
  const listed = threads?.find((item) => item.id === threadId)
  const [fetched, setFetched] = useState<Thread | null>(null)
  const [missing, setMissing] = useState(false)
  // The session list may not have it yet (or at all): ask the hub directly.
  useEffect(() => {
    if (listed) return
    let alive = true
    api.get<{ thread: Thread }>(`/api/threads/${encodeURIComponent(threadId)}`).then((data) => { if (alive) setFetched(data.thread) }).catch(() => { if (alive) setMissing(true) })
    return () => { alive = false }
  }, [listed, threadId])
  const thread = listed ?? fetched
  if (!thread) return <Modal title="Continue in another agent" onClose={onClose}><p className="hint">{missing ? 'That session is not available.' : 'Loading…'}</p></Modal>
  return <ContinueForm thread={thread} messageId={messageId} onClose={onClose} />
}

function ContinueForm({ thread, messageId, onClose }: { thread: Thread; messageId?: string; onClose: () => void }) {
  const navigate = useNavigate()
  const { toast } = useShell()
  const installed = useAgentsOn(thread.deviceId)
  const ids = useMemo(() => (installed ?? []).filter((item) => item.installed).map((item) => item.id), [installed])
  const [settings, setSettings] = useState<ComposerSettings>({ deviceId: thread.deviceId, agent: suggestAgent(thread.agent, []), model: '', effort: '', fast: false, mode: '', cwd: thread.cwd })
  const [picked, setPicked] = useState(false)
  const [preview, setPreview] = useState<ContinuePreview | null>(null)
  const [prompt, setPrompt] = useState('')
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const key = useRef(newRequestId())

  // Once the machine's agents are known, move off the guess if it is not there.
  useEffect(() => {
    if (picked || !installed) return
    const next = suggestAgent(thread.agent, ids)
    if (next !== settings.agent) setSettings((current) => ({ ...current, agent: next, model: '', effort: '', fast: false, mode: '' }))
  }, [installed]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    api.post<ContinuePreview>(`/api/threads/${encodeURIComponent(thread.id)}/continue/preview`, { agent: settings.agent, messageId })
      .then((value) => { if (!alive) return; setPreview(value); setPrompt((current) => (dirty && current ? current : value.prompt)) })
      .catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : 'Could not read the session') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [thread.id, messageId, settings.agent]) // eslint-disable-line react-hooks/exhaustive-deps

  const name = agentInfo(settings.agent).name
  const start = async () => {
    if (!prompt.trim() || starting) return
    setStarting(true)
    setError('')
    try {
      const reply = await api.post<Thread | HeldStart>(`/api/threads/${encodeURIComponent(thread.id)}/continue`, {
        prompt, agent: settings.agent, model: settings.model || undefined, effort: settings.effort || undefined, fast: settings.fast || undefined, mode: settings.mode || undefined,
        title: preview?.title, messageId, clientRequestId: key.current,
      }, 30_000)
      if (isHeld(reply)) { toast(reply.message || 'Held by your guardrail until the limit resets'); onClose(); return }
      threadsResource.refresh()
      onClose()
      navigate(`/sessions/${reply.id}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start the new session')
      setStarting(false)
    }
  }
  const stats = preview?.stats
  const facts = stats ? [
    `${stats.turns} ${stats.turns === 1 ? 'turn' : 'turns'}`,
    stats.files ? `${stats.files} ${stats.files === 1 ? 'file' : 'files'} changed` : stats.diffStat ? 'git changes' : '',
    stats.planTotal ? `plan ${stats.planDone}/${stats.planTotal}` : '',
    stats.lastError ? 'last error included' : '',
  ].filter(Boolean) : []
  return (
    <Modal
      title="Continue in another agent"
      onClose={onClose}
      wide
      footer={(
        <>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-dark" onClick={start} disabled={!prompt.trim() || loading || starting}>{starting && <span className="spinner" />}Start in {name}</button>
        </>
      )}
    >
      <div className="sc-editor">
        <div className="sc-cont-head">
          <span className="sc-cont-from"><AgentMark agent={thread.agent} size={15} />{agentInfo(thread.agent).name}</span>
          <Icon name="arrow" size={15} className="text-faint" />
          <AgentPicker settings={settings} onSettings={(next) => { setPicked(true); setSettings(next) }} />
        </div>
        <p className="sc-where"><Icon name="monitor" size={14} />Same machine and folder · {thread.deviceName} · {thread.cwd}</p>
        <label className="sc-field">
          <span>Handoff prompt{facts.length > 0 && <em className="sc-facts">{facts.join(' · ')}</em>}</span>
          {loading && !prompt ? <div className="skeleton sc-prompt-skel" /> : (
            <textarea className="textarea sc-prompt sc-prompt-tall" value={prompt} onChange={(event) => { setPrompt(event.target.value); setDirty(true) }} rows={14} spellCheck={false} aria-label="Handoff prompt" />
          )}
        </label>
        <p className="hint">Built from the conversation so far. Edit anything before {name} starts; the original session stays as it is.</p>
        {error && <p className="text-[13px] text-danger" role="alert">{error}</p>}
      </div>
    </Modal>
  )
}

// ContinueChips link a session to the one it continued from and the ones it
// was continued in.
export function ContinueChips({ threadId, version }: { threadId: string; version?: number }) {
  const [links, setLinks] = useState<ContinueLinks | null>(null)
  useEffect(() => {
    let alive = true
    api.get<ContinueLinks>(`/api/threads/${encodeURIComponent(threadId)}/continue`).then((value) => { if (alive) setLinks(value) }).catch(() => { if (alive) setLinks(null) })
    return () => { alive = false }
  }, [threadId, version])
  useEffect(() => { setLinks(null) }, [threadId])
  if (!links || (!links.from && links.to.length === 0)) return null
  return (
    <div className="sc-chips" aria-label="Continued sessions">
      {links.from && (
        <Link to={`/sessions/${links.from.id}`} className="sc-chip" title={links.from.title}>
          <Icon name="arrow-left" size={13} />Continued from<AgentMark agent={links.from.agent} size={13} /><span className="truncate">{links.from.title}</span>
        </Link>
      )}
      {links.to.map((item) => (
        <Link key={item.id} to={`/sessions/${item.id}`} className="sc-chip" title={item.title}>
          <Icon name="arrow" size={13} />Continued in<AgentMark agent={item.agent} size={13} /><span className="truncate">{item.title}</span>
        </Link>
      ))}
    </div>
  )
}
