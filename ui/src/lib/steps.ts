// Turns the flat message list of a session into what the transcript shows:
// messages that stand on their own, and "work" blocks, the agent's tool loop
// folded into one-line steps. Pure, so it can be checked without React.

import type { IconName } from '../components/Icon'
import type { ThreadMessage, ThreadStatus, ToolAgent } from '../types'

export type StepState = 'running' | 'done' | 'error' | 'stopped'
export type ExploreKind = 'read' | 'search' | 'list'

// ToolInfo is how one tool call reads as a single line.
export interface ToolInfo {
  icon: IconName
  verb: string // "Read"
  verbing: string // "Reading"
  target: string // "auth.go"
  mono: boolean // the target is code (a command, a pattern)
  hint: string // the full path or command, for a tooltip
  explore?: ExploreKind
  detail: 'command' | 'diff' | 'text' | 'none'
  add: number
  del: number
}

export interface AgentInfo {
  label: string // "Explore", "Hume"
  role: string // Codex role, shown next to a nickname
  task: string
  result: string
  tools: number
  durationMs: number
}

export type StepItem =
  | { kind: 'thought'; id: string; text: string; ms: number; at: number }
  | { kind: 'note'; id: string; text: string; at: number; updatedAt: number }
  | { kind: 'tool'; id: string; msg: ThreadMessage; info: ToolInfo; state: StepState; ms: number }
  | { kind: 'explore'; id: string; items: ToolItem[]; label: string; icon: IconName; state: StepState }
  | { kind: 'agent'; id: string; msg: ThreadMessage; info: AgentInfo; children: StepItem[]; state: StepState; startedAt: number; endedAt: number }
  | { kind: 'agents'; id: string; items: AgentItem[]; state: StepState }

export type ToolItem = Extract<StepItem, { kind: 'tool' }>
export type AgentItem = Extract<StepItem, { kind: 'agent' }>

export interface Work {
  kind: 'work'
  id: string
  items: StepItem[]
  steps: number
  agents: number
  add: number
  del: number
  startedAt: number
  endedAt: number
  durationMs: number
}

export type Segment = { kind: 'message'; message: ThreadMessage } | Work

// --- describing a tool call ---

const base = (path: string) => path.replace(/\/+$/, '').split('/').pop() || path
const unquote = (text: string) => text.replace(/^(['"`])([\s\S]*)\1$/, '$2')
const clip = (text: string, n: number) => (text.length > n ? text.slice(0, n - 1) + '…' : text)

// cleanCommand drops the shell wrapper Codex adds (`bash -lc '…'`) and a
// leading `cd dir &&`.
export function cleanCommand(raw: string): string {
  let command = raw.trim()
  const wrapped = command.match(/^(?:\S*\/)?(?:ba|z|da)?sh\s+-l?c\s+(['"])([\s\S]*)\1$/)
  if (wrapped) command = wrapped[2].trim()
  return command.replace(/^cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/, '')
}

const readers = new Set(['cat', 'head', 'tail', 'bat', 'less', 'nl'])
const searchers = new Set(['rg', 'grep', 'ag', 'ack'])
const listers = new Set(['ls', 'tree', 'fd', 'find'])

interface Shell { verb: string; verbing: string; target: string; mono: boolean; icon: IconName; explore?: ExploreKind }

// classifyCommand recognises the shell commands that are really reads and
// searches, so they fold like the dedicated tools.
function classifyCommand(command: string): Shell {
  const generic: Shell = { verb: 'Ran', verbing: 'Running', target: clip(command.split('\n')[0], 110), mono: true, icon: 'terminal' }
  if (/&&|;|\n|\|\|/.test(command)) return generic
  const first = command.split('|')[0].trim()
  const words = first.split(/\s+/)
  const bin = (words[0] ?? '').replace(/^.*\//, '')
  const args = words.slice(1).filter((word) => !word.startsWith('-'))
  if (bin === 'git' && words[1] === 'grep' && args[1]) return { verb: 'Searched for', verbing: 'Searching for', target: unquote(args[1]), mono: true, icon: 'search', explore: 'search' }
  if (readers.has(bin) && args.length) return { verb: 'Read', verbing: 'Reading', target: base(unquote(args[args.length - 1])), mono: false, icon: 'file', explore: 'read' }
  if (bin === 'sed' && words.includes('-n') && args.length >= 2) return { verb: 'Read', verbing: 'Reading', target: base(unquote(args[args.length - 1])), mono: false, icon: 'file', explore: 'read' }
  if (searchers.has(bin) && args.length) return { verb: 'Searched for', verbing: 'Searching for', target: unquote(args[0]), mono: true, icon: 'search', explore: 'search' }
  if (bin === 'find' || bin === 'fd') return { verb: 'Searched files', verbing: 'Searching files', target: '', mono: false, icon: 'search', explore: 'search' }
  if (listers.has(bin)) return { verb: 'Listed', verbing: 'Listing', target: args.length ? base(unquote(args[args.length - 1])) : 'the folder', mono: false, icon: 'folder', explore: 'list' }
  return generic
}

const strip = (title: string, ...prefixes: RegExp[]) => prefixes.reduce((text, re) => text.replace(re, ''), title).trim()

export function describeTool(msg: ThreadMessage): ToolInfo {
  const tool = msg.tool
  const files = tool?.files ?? []
  const add = files.reduce((sum, file) => sum + (file.additions ?? 0), 0)
  const del = files.reduce((sum, file) => sum + (file.deletions ?? 0), 0)
  const title = tool?.title ?? ''
  const input = tool?.input ?? ''
  const info = (partial: Partial<ToolInfo> & Pick<ToolInfo, 'icon' | 'verb' | 'verbing' | 'target'>): ToolInfo => ({
    mono: false, hint: partial.target, detail: tool?.output || input ? 'text' : 'none', add, del, ...partial,
  })
  switch (tool?.name) {
    case 'bash': {
      const command = cleanCommand(input) || title
      const shell = classifyCommand(command)
      return info({ ...shell, hint: command, detail: command || tool?.output ? 'command' : 'none' })
    }
    case 'read': {
      const path = input || strip(title, /^Read(ing)?\s+/i)
      return info({ icon: 'file', verb: 'Read', verbing: 'Reading', target: base(path) || 'file', hint: path, explore: 'read' })
    }
    case 'edit':
    case 'write': {
      const wrote = tool.name === 'write'
      const target = files.length > 1 ? `${files.length} files` : base(files[0]?.path ?? (input || strip(title, /^(Edit|Write)(ing)?\s+/i))) || 'files'
      return info({
        icon: 'edit', verb: wrote ? 'Wrote' : 'Edited', verbing: wrote ? 'Writing' : 'Editing', target,
        hint: files.map((file) => file.path).join('\n') || input, detail: files.some((file) => file.diff) ? 'diff' : tool?.output ? 'text' : 'none',
      })
    }
    case 'grep':
      return info({ icon: 'search', verb: 'Searched for', verbing: 'Searching for', target: strip(title, /^Search(ed|ing)?( for)?\s+/i) || input, mono: true, explore: 'search' })
    case 'glob':
      return info({ icon: 'search', verb: 'Searched files', verbing: 'Searching files', target: strip(title, /^(Find|Found|Search(ed|ing)?( for)?)\s+/i) || input, mono: true, explore: 'search' })
    case 'webfetch': {
      const url = input || strip(title, /^Fetch(ed|ing)?\s+/i)
      return info({ icon: 'globe', verb: 'Fetched', verbing: 'Fetching', target: url.replace(/^https?:\/\//, '').replace(/\/$/, ''), hint: url })
    }
    case 'websearch':
      return info({ icon: 'globe', verb: 'Searched the web for', verbing: 'Searching the web for', target: input || '', mono: !!input, explore: undefined })
    case 'mcp':
      return info({ icon: 'plug', verb: 'Used', verbing: 'Using', target: title, hint: input })
    default:
      return info({ icon: 'wrench', verb: '', verbing: '', target: title || tool?.name || 'Step' })
  }
}

const exploreOrder: ExploreKind[] = ['read', 'search', 'list']

// exploreLabel names a folded run of reads and searches: "Read 5 files",
// "Searched 3 times", "Explored 5 files, 2 searches".
export function exploreLabel(items: ToolItem[], running: boolean): string {
  const count: Record<ExploreKind, number> = { read: 0, search: 0, list: 0 }
  for (const item of items) count[item.info.explore ?? 'read']++
  const parts = exploreOrder.filter((kind) => count[kind]).map((kind) => {
    const n = count[kind]
    if (kind === 'read') return `${n} file${n === 1 ? '' : 's'}`
    if (kind === 'search') return `${n} search${n === 1 ? '' : 'es'}`
    return `${n} folder${n === 1 ? '' : 's'}`
  })
  const kinds = exploreOrder.filter((kind) => count[kind])
  if (kinds.length === 1) {
    const verb = { read: running ? 'Reading' : 'Read', search: running ? 'Searching' : 'Searched', list: running ? 'Listing' : 'Listed' }[kinds[0]]
    return kinds[0] === 'search' ? `${verb} ${count.search} time${count.search === 1 ? '' : 's'}` : `${verb} ${parts[0]}`
  }
  return `${running ? 'Exploring' : 'Explored'} ${parts.join(', ')}`
}

// --- building steps ---

function toolState(msg: ThreadMessage, active: boolean): StepState {
  const status = msg.tool?.status
  if (status === 'error') return 'error'
  if (status === 'running') return active ? 'running' : 'stopped'
  return 'done'
}

function agentInfo(msg: ThreadMessage): AgentInfo {
  const agent: ToolAgent = msg.tool?.agent ?? {}
  const label = agent.name || agent.type || 'Subagent'
  return {
    label,
    role: agent.name && agent.type && agent.type !== agent.name ? agent.type : '',
    task: agent.task || msg.tool?.title || '',
    result: agent.result || '',
    tools: agent.tools ?? 0,
    durationMs: agent.durationMs ?? 0,
  }
}

function worstState(states: StepState[]): StepState {
  if (states.includes('running')) return 'running'
  if (states.includes('error')) return 'error'
  if (states.includes('stopped')) return 'stopped'
  return 'done'
}

// foldRuns folds consecutive reads/searches and consecutive subagents.
function foldRuns(items: StepItem[]): StepItem[] {
  const out: StepItem[] = []
  for (const item of items) {
    const prev = out[out.length - 1]
    if (item.kind === 'tool' && item.info.explore) {
      if (prev?.kind === 'tool' && prev.info.explore) {
        out[out.length - 1] = exploreGroup([prev, item])
        continue
      }
      if (prev?.kind === 'explore') { prev.items.push(item); refreshExplore(prev); continue }
    }
    if (item.kind === 'agent') {
      if (prev?.kind === 'agent') {
        out[out.length - 1] = { kind: 'agents', id: prev.id, items: [prev, item], state: worstState([prev.state, item.state]) }
        continue
      }
      if (prev?.kind === 'agents') { prev.items.push(item); prev.state = worstState(prev.items.map((entry) => entry.state)); continue }
    }
    out.push(item)
  }
  return out
}

function exploreGroup(items: ToolItem[]): StepItem {
  const group: Extract<StepItem, { kind: 'explore' }> = { kind: 'explore', id: items[0].id, items, label: '', icon: 'search', state: 'done' }
  refreshExplore(group)
  return group
}

function refreshExplore(group: Extract<StepItem, { kind: 'explore' }>) {
  group.state = worstState(group.items.map((item) => item.state))
  group.label = exploreLabel(group.items, group.state === 'running')
  group.icon = group.items.every((item) => item.info.explore === 'read') ? 'file' : group.items.every((item) => item.info.explore === 'list') ? 'folder' : 'search'
}

interface Ctx { kids: Map<string, ThreadMessage[]>; active: boolean }

function buildItems(messages: ThreadMessage[], ctx: Ctx): StepItem[] {
  const items: StepItem[] = []
  for (const msg of messages) {
    if (msg.role === 'thought') {
      const prev = items[items.length - 1]
      const ms = Math.max(0, msg.updatedAt - msg.at)
      if (prev?.kind === 'thought') {
        prev.text = [prev.text, msg.text].filter(Boolean).join('\n\n')
        prev.ms += ms
        continue
      }
      items.push({ kind: 'thought', id: msg.id, text: msg.text, ms, at: msg.at })
    } else if (msg.role === 'assistant') {
      if (msg.text.trim()) items.push({ kind: 'note', id: msg.id, text: msg.text.trim(), at: msg.at, updatedAt: msg.updatedAt })
    } else if (msg.role === 'tool' && msg.tool) {
      if (msg.tool.agent || msg.tool.name === 'agent') {
        const children = buildItems(ctx.kids.get(msg.id) ?? [], ctx)
        const state = toolState(msg, ctx.active)
        const stamps = flatMessages(ctx.kids.get(msg.id) ?? [], ctx.kids)
        items.push({
          kind: 'agent', id: msg.id, msg, info: agentInfo(msg), children, state,
          startedAt: msg.at, endedAt: Math.max(msg.updatedAt, ...stamps.map((child) => child.updatedAt)),
        })
      } else {
        items.push({ kind: 'tool', id: msg.id, msg, info: describeTool(msg), state: toolState(msg, ctx.active), ms: Math.max(0, msg.updatedAt - msg.at) })
      }
    }
  }
  return foldRuns(items)
}

function flatMessages(messages: ThreadMessage[], kids: Map<string, ThreadMessage[]>): ThreadMessage[] {
  return messages.flatMap((msg) => [msg, ...flatMessages(kids.get(msg.id) ?? [], kids)])
}

function tally(items: StepItem[]): { steps: number; agents: number; add: number; del: number } {
  const sum = { steps: 0, agents: 0, add: 0, del: 0 }
  for (const item of items) {
    if (item.kind === 'tool') { sum.steps++; sum.add += item.info.add; sum.del += item.info.del }
    else if (item.kind === 'explore') { sum.steps += item.items.length }
    else if (item.kind === 'agent' || item.kind === 'agents') {
      for (const agent of item.kind === 'agent' ? [item] : item.items) {
        sum.steps++
        sum.agents++
        const inner = tally(agent.children)
        sum.add += inner.add
        sum.del += inner.del
      }
    }
  }
  return sum
}

// looksLikeNarration tells a short aside ("Let me run the tests") from an
// answer. While a turn runs, the last message can be either, so a short
// plain one stays in the work block instead of flashing up as the answer.
export function looksLikeNarration(text: string): boolean {
  return text.length < 240 && !/\n\s*\n|^\s*([-*#>|]|\d+\.)\s|```/m.test(text)
}

// buildSegments splits a session into messages and work blocks. Inside one
// turn, assistant text that is followed by more steps is narration and joins
// the work block; text after the last step is the answer and stands alone.
// A subagent's own steps (parentId) nest under its row.
export function buildSegments(messages: ThreadMessage[], active: boolean): Segment[] {
  const ids = new Set(messages.map((msg) => msg.id))
  const kids = new Map<string, ThreadMessage[]>()
  const top: ThreadMessage[] = []
  for (const msg of messages) {
    if (msg.parentId && msg.parentId !== msg.id && ids.has(msg.parentId)) {
      const list = kids.get(msg.parentId) ?? []
      list.push(msg)
      kids.set(msg.parentId, list)
    } else top.push(msg)
  }
  const ctx: Ctx = { kids, active }
  const out: Segment[] = []

  const flushTurn = (turn: ThreadMessage[], current: boolean) => {
    let lastStep = -1
    turn.forEach((msg, index) => { if (msg.role === 'tool' || msg.role === 'thought') lastStep = index })
    const tail = turn[turn.length - 1]
    const aside = active && current && lastStep >= 0 && tail?.role === 'assistant' && looksLikeNarration(tail.text)
    let run: ThreadMessage[] = []
    const flushRun = (after?: ThreadMessage) => {
      if (!run.length) return
      const items = buildItems(run, ctx)
      const first = run[0]
      const stamps = flatMessages(run, kids)
      run = []
      if (!items.length) return
      const endedAt = Math.max(...stamps.map((msg) => msg.updatedAt))
      const measured = Math.max(1000, (after && after.role !== 'user' ? after.at : endedAt) - first.at)
      const durationMs = after && (after.role === 'assistant' || after.role === 'status') && after.durationMs ? after.durationMs : measured
      out.push({ kind: 'work', id: first.id, items, ...tally(items), startedAt: first.at, endedAt, durationMs })
    }
    turn.forEach((msg, index) => {
      if (msg.role === 'tool' || msg.role === 'thought') run.push(msg)
      else if (msg.role === 'assistant' && (index < lastStep || (aside && index === turn.length - 1))) run.push(msg)
      else { flushRun(msg); out.push({ kind: 'message', message: msg }) }
    })
    flushRun()
  }

  let turn: ThreadMessage[] = []
  for (const msg of top) {
    if (msg.role === 'user' && !msg.queued) {
      flushTurn(turn, false)
      turn = []
      out.push({ kind: 'message', message: msg })
    } else turn.push(msg)
  }
  flushTurn(turn, true)
  return out
}

// --- the live line ---

export interface Activity {
  kind: 'starting' | 'tool' | 'agents' | 'thinking'
  verb: string
  target: string
  mono: boolean
  since: number
  more: number // other steps running alongside
}

function runningAgents(items: StepItem[]): AgentItem[] {
  return items.flatMap((item) => (item.kind === 'agent' ? [item] : item.kind === 'agents' ? item.items : [])).filter((item) => item.state === 'running')
}

// currentStep is the latest running step inside a subagent (or "Thinking").
export function currentStep(items: StepItem[]): { verb: string; target: string; mono: boolean } | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.kind === 'tool' && item.state === 'running') return { verb: item.info.verbing, target: item.info.target, mono: item.info.mono }
    if (item.kind === 'explore') {
      const live = [...item.items].reverse().find((entry) => entry.state === 'running')
      if (live) return { verb: live.info.verbing, target: live.info.target, mono: live.info.mono }
    }
    if (item.kind === 'agent' && item.state === 'running') return { verb: 'Running', target: item.info.label, mono: false }
  }
  return null
}

// settledAt is when the last step finished, or when the current thought began.
function settledAt(work: Work): number {
  const last = work.items[work.items.length - 1]
  if (!last) return work.startedAt
  switch (last.kind) {
    case 'thought': return last.at
    case 'note': return last.updatedAt
    case 'tool': return last.msg.updatedAt
    case 'explore': return last.items[last.items.length - 1].msg.updatedAt
    case 'agent': return last.endedAt
    case 'agents': return Math.max(...last.items.map((item) => item.endedAt))
  }
}

export function currentActivity(segments: Segment[], status: ThreadStatus, deviceName: string, now: number): Activity | null {
  if (status === 'starting') return { kind: 'starting', verb: `Starting ${deviceName}…`, target: '', mono: false, since: now, more: 0 }
  if (status !== 'working') return null
  const lastIndex = segments.length - 1
  const last = segments[lastIndex]
  let work: Work | undefined
  for (let i = lastIndex; i >= 0; i--) {
    const seg = segments[i]
    if (seg.kind === 'work') { work = seg; break }
    if (seg.kind === 'message' && seg.message.role === 'user') break
  }
  const agents = work ? runningAgents(work.items) : []
  if (agents.length) {
    const newest = [...agents].sort((a, b) => b.endedAt - a.endedAt)[0]
    const step = currentStep(newest.children)
    const what = step ? `${step.verb} ${step.target}`.trim() : 'Thinking…'
    return {
      kind: 'agents',
      verb: `${agents.length} subagent${agents.length === 1 ? '' : 's'} working`,
      target: `${newest.info.label}: ${what}`,
      mono: false,
      since: Math.min(...agents.map((agent) => agent.startedAt)),
      more: 0,
    }
  }
  // The answer is streaming: the text is the activity.
  if (last?.kind === 'message' && last.message.role === 'assistant' && last.message.text) return null
  if (last?.kind === 'message' && (last.message.role === 'approval' || last.message.role === 'question')) return null
  if (work && last === work) {
    // A short line is streaming in: it is the activity.
    const tail = work.items[work.items.length - 1]
    if (tail?.kind === 'note' && now - tail.updatedAt < 1500) return null
    const running = work.items.flatMap((item) => (item.kind === 'explore' ? item.items : item.kind === 'tool' ? [item] : [])).filter((item) => item.state === 'running')
    const tool = running[running.length - 1]
    if (tool) return { kind: 'tool', verb: tool.info.verbing, target: tool.info.target, mono: tool.info.mono, since: tool.msg.at, more: running.length - 1 }
    return { kind: 'thinking', verb: 'Thinking…', target: '', mono: false, since: settledAt(work), more: 0 }
  }
  const user = [...segments].reverse().find((seg) => seg.kind === 'message' && seg.message.role === 'user')
  return { kind: 'thinking', verb: 'Thinking…', target: '', mono: false, since: user?.kind === 'message' ? user.message.at : now, more: 0 }
}
