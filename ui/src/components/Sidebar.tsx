import { useMemo, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { agentInfo, isUnread, relativeTime, threadStatusLabel } from '../agents'
import { patchThread, useTerminals, useThreads, usePref } from '../store'
import { settingsSections } from '../settings'
import { useShell } from '../shell'
import type { FleetSession, Thread } from '../types'
import Icon, { type IconName } from './Icon'
import { AppIcon } from './Logo'
import { ContextMenu, Menu, MenuItem, MenuLabel, MenuSeparator, Submenu, SwitchMark } from './Menu'
import { TerminalMenuItems, ThreadMenuItems } from './SessionActions'
import UpdateNotice from './UpdateNotice'
import { GuardrailNotices, ScheduledGroup } from './Scheduled'
import { handedToMe, inScope, needsYou, useScope, useTeam } from '../teams'

export const docsURL = 'https://github.com/ErzenXz/overseer#readme'

export interface SessionRow {
  key: string
  kind: 'thread' | 'terminal'
  title: string
  to: string
  status: string
  statusText: string
  tone: string
  machine: string
  agent: string
  createdAt: number
  updatedAt: number
  unread: boolean
  pr?: Thread['pr']
  active: boolean
  pinned: boolean
  archived: boolean
  folder: string
  thread?: Thread
  session?: FleetSession
}

type Sort = 'updated' | 'created' | 'name' | 'status'
type Filter = 'all' | 'active' | 'unread' | 'prs' | 'agents' | 'terminals' | 'archived'
type Group = 'none' | 'folder' | 'machine' | 'agent' | 'status'
type Property = 'status' | 'time' | 'pr' | 'machine' | 'agent'

const sortLabels: Record<Sort, string> = { updated: 'Last updated', created: 'Created', name: 'Name', status: 'Status' }
const filterLabels: Record<Filter, string> = { all: 'All sessions', active: 'Active', unread: 'Unread', prs: 'With pull request', agents: 'Agent sessions', terminals: 'Terminals', archived: 'Archived' }
const groupLabels: Record<Group, string> = { none: 'None', folder: 'Folders', machine: 'Machines', agent: 'Agents', status: 'Status' }
const propertyLabels: Record<Property, string> = { status: 'Status', time: 'Last updated', pr: 'Pull request', machine: 'Machine', agent: 'Agent' }
const defaultProps: Record<Property, boolean> = { status: true, time: true, pr: true, machine: true, agent: false }
const statusRank: Record<string, number> = { waiting: 0, working: 1, starting: 1, error: 2, idle: 3, stopped: 4, exited: 5 }

export function threadRow(thread: Thread, path: string): SessionRow {
  const label = threadStatusLabel(thread)
  return {
    key: thread.id,
    kind: 'thread',
    title: thread.title || 'Untitled session',
    to: `/sessions/${thread.id}`,
    status: thread.status,
    statusText: label.text,
    tone: label.tone,
    machine: thread.deviceName,
    agent: agentInfo(thread.agent).name,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    unread: isUnread(thread),
    pr: thread.pr,
    active: path === `/sessions/${thread.id}`,
    pinned: !!thread.pinned,
    archived: !!thread.archived,
    folder: thread.folder ?? '',
    thread,
  }
}

export function terminalRow(session: FleetSession, path: string, search: string): SessionRow {
  const to = `/machines/${session.deviceId}?tab=terminal&session=${encodeURIComponent(session.name)}`
  return {
    key: `${session.deviceId}:${session.name}`,
    kind: 'terminal',
    title: session.name,
    to,
    status: session.status,
    statusText: session.status === 'working' ? 'Running' : session.status === 'exited' ? 'Ended' : '',
    tone: session.status === 'working' ? 'working' : '',
    machine: session.deviceName,
    agent: session.kind && session.kind !== 'shell' ? agentInfo(session.kind).name : 'Terminal',
    createdAt: session.createdAt,
    updatedAt: session.lastActivity,
    unread: false,
    pinned: false,
    archived: false,
    folder: '',
    session,
    active: `${path}${search}`.includes(`/machines/${session.deviceId}`) && search.includes(`session=${encodeURIComponent(session.name)}`),
  }
}

export default function Sidebar({ onSearch, onClose }: { onSearch: () => void; onClose: () => void }) {
  const location = useLocation()
  const inSettings = location.pathname.startsWith('/settings')
  return (
    <aside className="sidebar" aria-label="Sidebar">
      <Rail onSearch={onSearch} />
      <div className="sidebar-panel">
        {inSettings ? <SettingsNav onClose={onClose} /> : <AppNav onClose={onClose} />}
      </div>
    </aside>
  )
}

// SidebarHead tops the settings panel: back to the app, and hide the panel.
function SidebarHead({ onClose }: { onClose: () => void }) {
  const { toggleSidebar, mobile } = useShell()
  return (
    <div className="sidebar-head">
      <Link to="/" className="workspace-btn" style={{ fontWeight: 400, color: 'var(--text-2)' }}>
        <Icon name="arrow-left" size={18} />
        <span>Back to app</span>
      </Link>
      <span className="flex-1" />
      <button className="icon-btn" aria-label="Hide sidebar" title="Hide sidebar (⌘B)" onClick={mobile ? onClose : toggleSidebar}><Icon name="panel-left" size={19} /></button>
    </div>
  )
}

// The rail: the app's sections as icons down the left edge, so the panel
// beside it only has to list sessions. Each icon names itself on hover.
const railMain: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/sessions', label: 'Sessions', icon: 'message' },
  { to: '/automations', label: 'Automations', icon: 'automation' },
  { to: '/review', label: 'Review', icon: 'pull-request' },
  { to: '/arena', label: 'Agent Arena', icon: 'zap' },
  { to: '/machines', label: 'Machines', icon: 'monitor' },
  { to: '/mission', label: 'Mission control', icon: 'grid' },
]
const railMore: { to: string; label: string; icon: IconName }[] = [
  { to: '/skills', label: 'Skills & plugins', icon: 'sparkles' },
  { to: '/projects', label: 'Projects', icon: 'book' },
  { to: '/customize', label: 'Customize', icon: 'customize' },
]

function Rail({ onSearch }: { onSearch: () => void }) {
  const navigate = useNavigate()
  const [, setTheme] = usePref<'system' | 'light' | 'dark'>('theme', 'system')
  const logout = async () => {
    try { await api.post('/api/logout') } finally { window.location.assign('/login') }
  }
  return (
    <nav className="rail" aria-label="Main">
      <Menu
        placement="right-start"
        width={250}
        trigger={<button className="rail-logo" aria-label="Overseer menu"><AppIcon size={26} /></button>}
      >
        {(close) => (
          <>
            <MenuItem icon="settings" label="Settings" to="/settings" onClick={close} />
            <MenuItem icon="user-plus" label="Add a machine" to="/machines?add=1" onClick={close} />
            <MenuItem icon="terminal" label="New terminal" onClick={() => { close(); navigate('/?mode=terminal') }} />
            <MenuItem icon="star" label="Agent Wrapped" to="/wrapped" onClick={close} />
            <Submenu icon="sun" label="Theme">
              <MenuItem icon="monitor" label="System" onClick={() => { setTheme('system'); close() }} />
              <MenuItem icon="sun" label="Light" onClick={() => { setTheme('light'); close() }} />
              <MenuItem icon="moon" label="Dark" onClick={() => { setTheme('dark'); close() }} />
            </Submenu>
            <MenuSeparator />
            <MenuItem icon="logout" label="Log out" onClick={logout} />
          </>
        )}
      </Menu>
      <NavLink to="/" end className="rail-btn rail-new" aria-label="New session" data-tip="New session"><Icon name="plus" size={19} /></NavLink>
      <div className="rail-group">
        {railMain.map((item) => <NavLink key={item.to} to={item.to} end={item.end} className="rail-btn" aria-label={item.label} data-tip={item.label}><Icon name={item.icon} size={19} /></NavLink>)}
      </div>
      <span className="rail-sep" />
      <div className="rail-group">
        {railMore.map((item) => <NavLink key={item.to} to={item.to} className="rail-btn" aria-label={item.label} data-tip={item.label}><Icon name={item.icon} size={19} /></NavLink>)}
      </div>
      <span className="flex-1" />
      <div className="rail-group">
        <button className="rail-btn" aria-label="Search" data-tip="Search  ⌘K" onClick={onSearch}><Icon name="search" size={19} /></button>
        <Notifications />
        <Menu
          placement="right-start"
          width={250}
          trigger={<button className="rail-btn" aria-label="Help" data-tip="Help"><Icon name="help" size={19} /></button>}
        >
          {(close) => (
            <>
              <MenuItem icon="book" label="Documentation" href={docsURL} onClick={close} />
              <MenuItem icon="keyboard" label="Keyboard shortcuts" to="/settings/shortcuts" onClick={close} />
              <MenuItem icon="github" label="Report an issue" href="https://github.com/ErzenXz/overseer/issues/new" onClick={close} />
            </>
          )}
        </Menu>
        <NavLink to="/settings" className="rail-btn" aria-label="Settings" data-tip="Settings"><Icon name="settings" size={19} /></NavLink>
      </div>
    </nav>
  )
}

function Notifications() {
  const { value: threads } = useThreads()
  const team = useTeam()
  const navigate = useNavigate()
  const items = (threads ?? []).filter((thread) => thread.status === 'waiting' || thread.status === 'error' || isUnread(thread)).slice(0, 8)
  const markAll = () => items.forEach((thread) => patchThread(thread.id, { read: true }).catch(() => {}))
  return (
    <Menu
      placement="right-start"
      width={340}
      trigger={
        <button className="rail-btn relative" aria-label={`Notifications${items.length ? ` (${items.length})` : ''}`} data-tip="Notifications">
          <Icon name="bell" size={19} />
          {items.length > 0 && <span className={`rail-badge ${items.some((thread) => thread.status === 'waiting') ? 'is-waiting' : ''}`} />}
        </button>
      }
    >
      {(close) => (
        <>
          <div className="flex items-center justify-between px-[10px] pb-1 pt-2">
            <span className="text-[14px] font-medium">Notifications</span>
            {items.length > 0 && <button className="text-[13px] text-muted hover:text-ink" onClick={markAll}>Mark all as read</button>}
          </div>
          {items.length === 0 ? <p className="menu-empty">You’re all caught up.</p> : items.map((thread) => (
            <MenuItem
              key={thread.id}
              icon={thread.status === 'waiting' ? 'alert' : thread.status === 'error' ? 'alert' : 'check'}
              label={thread.title}
              description={`${handedToMe(thread, team.me) ? `${team.nameOf(thread.handoffBy) || 'Someone'} handed this to you` : thread.status === 'waiting' ? 'Needs your approval' : thread.status === 'error' ? 'Failed' : 'Finished'} · ${thread.deviceName} · ${relativeTime(thread.updatedAt)}`}
              onClick={() => { close(); navigate(`/sessions/${thread.id}`) }}
            />
          ))}
        </>
      )}
    </Menu>
  )
}

function AppNav({ onClose }: { onClose: () => void }) {
  const location = useLocation()
  const { value: threads, error: threadsError } = useThreads()
  const { value: terminals } = useTerminals()
  const [sort, setSort] = usePref<Sort>('sidebar.sort', 'updated')
  const [filter, setFilter] = usePref<Filter>('sidebar.filter', 'all')
  const [group, setGroup] = usePref<Group>('sidebar.group', 'none')
  const [props, setProps] = usePref<Record<Property, boolean>>('sidebar.props', defaultProps)
  const [compact, setCompact] = usePref('sidebar.compact', false)
  const [showTerminals] = usePref('sidebar.terminals', false)
  const team = useTeam()
  const [scope, setScope] = useScope(team.multi)
  // Waiting on you, or handed to you and not opened yet: shown under Needs you.
  const inNeeds = (row: SessionRow) => row.status === 'waiting' || !!(row.thread && handedToMe(row.thread, team.me))
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [recentOpen, setRecentOpen] = useState(true)
  const [scrolled, setScrolled] = useState(false)

  const rows = useMemo(() => {
    const threadRows = (threads ?? []).filter((thread) => inScope(thread, scope, team.me)).map((thread) => threadRow(thread, location.pathname))
    // Terminal sessions that belong to a thread (its Shell tab) stay hidden.
    const owned = new Set((threads ?? []).map((thread) => `${thread.deviceId}:${thread.terminal}`))
    const terminalRows = showTerminals ? (terminals ?? []).filter((session) => !owned.has(`${session.deviceId}:${session.name}`)).map((session) => terminalRow(session, location.pathname, location.search)) : []
    let all = [...threadRows, ...terminalRows]
    // Archived sessions only show in the Archived view.
    all = filter === 'archived' ? all.filter((row) => row.archived) : all.filter((row) => !row.archived)
    if (filter === 'active') all = all.filter((row) => ['working', 'starting', 'waiting'].includes(row.status))
    if (filter === 'unread') all = all.filter((row) => row.unread)
    if (filter === 'prs') all = all.filter((row) => row.pr)
    if (filter === 'agents') all = all.filter((row) => row.kind === 'thread')
    if (filter === 'terminals') all = all.filter((row) => row.kind === 'terminal')
    all.sort((a, b) => {
      if (sort === 'name') return a.title.localeCompare(b.title)
      if (sort === 'created') return b.createdAt - a.createdAt
      if (sort === 'status') return (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) || b.updatedAt - a.updatedAt
      return b.updatedAt - a.updatedAt
    })
    return all
  }, [threads, terminals, filter, sort, location.pathname, location.search, showTerminals, scope, team.me])

  const groups = useMemo(() => {
    // Pinned sessions get their own section above, whatever the grouping.
    const rest = rows.filter((row) => !row.pinned && !inNeeds(row))
    const head: { key: string; label: string; rows: SessionRow[] }[] = []
    if (group === 'none') return [{ key: 'all', label: '', rows: rest }]
    const buckets = new Map<string, SessionRow[]>()
    for (const row of rest) {
      const label = group === 'folder' ? row.folder || 'No folder' : group === 'machine' ? row.machine : group === 'agent' ? row.agent : row.statusText || (row.status === 'idle' ? 'Done' : row.status === 'exited' ? 'Ended' : 'Other')
      buckets.set(label, [...(buckets.get(label) ?? []), row])
    }
    const entries = [...buckets.entries()]
    if (group === 'folder') entries.sort(([a], [b]) => (a === 'No folder' ? 1 : b === 'No folder' ? -1 : a.localeCompare(b)))
    return [...head, ...entries.map(([label, items]) => ({ key: label, label, rows: items }))]
  }, [rows, group])

  // Sessions stopped on a question for you sit above everything, whatever the
  // filter, so one can't hide below the fold.
  const needsRows = useMemo(() => (threads ?? []).filter((thread) => needsYou(thread, scope, team.me)).sort((a, b) => a.updatedAt - b.updatedAt).map((thread) => threadRow(thread, location.pathname)), [threads, location.pathname, scope, team.me])
  const pinnedRows = rows.filter((row) => row.pinned && !inNeeds(row))
  const [pinnedOpen, setPinnedOpen] = usePref('sidebar.pinnedOpen', true)
  const visibleProps = Object.values(props).filter(Boolean).length
  const customized = sort !== 'updated' || filter !== 'all' || group !== 'none' || compact
  const unreadCount = (threads ?? []).filter(isUnread).length
  const markAllRead = () => (threads ?? []).filter(isUnread).forEach((thread) => patchThread(thread.id, { read: true }).catch(() => {}))

  return (
    <>
      <PanelHead onClose={onClose} scope={team.multi ? scope : null} setScope={setScope} customized={customized} unreadCount={unreadCount} markAllRead={markAllRead}
        sort={sort} setSort={setSort} filter={filter} setFilter={setFilter} group={group} setGroup={setGroup}
        props={props} setProps={setProps} visibleProps={visibleProps} compact={compact} setCompact={setCompact} />
      <div className={`sidebar-scroll ${scrolled ? 'scrolled' : ''}`} onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}>
      <section className={`sessions-block ${compact ? 'sessions-compact' : ''}`} aria-label="Sessions">
        <div className="sessions-scroll">
          <GuardrailNotices />
          {needsRows.length > 0 && filter !== 'archived' && (
            <>
              <div className="sessions-sub sessions-sub-inline sessions-needs"><span><Icon name="alert" size={16} />Needs you<span className="count">{needsRows.length}</span></span></div>
              {needsRows.map((row) => <SessionLink key={row.key} row={row} props={props} />)}
            </>
          )}
          {filter !== 'archived' && <ScheduledGroup />}
          {pinnedRows.length > 0 && filter !== 'archived' && (
            <>
              <div className="sessions-sub sessions-sub-inline">
                <button onClick={() => setPinnedOpen(!pinnedOpen)} aria-expanded={pinnedOpen}><Icon name="pin" size={16} />Pinned</button>
              </div>
              {pinnedOpen && pinnedRows.map((row) => <SessionLink key={row.key} row={row} props={props} />)}
            </>
          )}
        <div className="sessions-sub sessions-sub-inline">
          <button onClick={() => setRecentOpen(!recentOpen)} aria-expanded={recentOpen}>
            <Icon name="clock" size={17} />
            {group === 'none' ? (filter === 'all' ? 'Recent' : filterLabels[filter]) : `By ${groupLabels[group].toLowerCase()}`}
          </button>
        </div>
          {threadsError && !threads && <p className="sidebar-message">Couldn’t load sessions.</p>}
          {threads === null && !threadsError && [0, 1, 2, 3].map((index) => <div key={index} className="mx-3 my-3 h-9 skeleton" />)}
          {recentOpen && threads && rows.length === 0 && <p className="sidebar-message">{filter === 'all' ? 'No sessions yet. Start one above.' : 'Nothing matches this filter.'}</p>}
          {recentOpen && groups.map((bucket) => (
            <div key={bucket.key}>
              {bucket.label && (
                <button className="session-group-btn" onClick={() => setCollapsedGroups({ ...collapsedGroups, [bucket.key]: !collapsedGroups[bucket.key] })} aria-expanded={!collapsedGroups[bucket.key]}>
                  <Icon name={collapsedGroups[bucket.key] ? 'chevron' : 'chevron-down'} size={13} />
                  <span className="truncate">{bucket.label}</span>
                  <span className="count">{bucket.rows.length}</span>
                </button>
              )}
              {!collapsedGroups[bucket.key] && bucket.rows.map((row) => <SessionLink key={row.key} row={row} props={props} />)}
            </div>
          ))}
        </div>
      </section>
      </div>
      <SidebarFoot />
    </>
  )
}

function SessionLink({ row, props }: { row: SessionRow; props: Record<Property, boolean> }) {
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const meta: React.ReactNode[] = []
  if (props.status && row.statusText) meta.push(<span key="s" className={row.tone}>{row.tone === 'working' ? <span className="shimmer">{row.statusText}</span> : row.statusText}</span>)
  if (props.time && !(props.status && row.tone === 'ok')) meta.push(<span key="t">{relativeTime(row.updatedAt)}</span>)
  if (props.machine) meta.push(<span key="m" className="truncate">{row.machine}</span>)
  if (props.agent) meta.push(<span key="a">{row.agent}</span>)
  if (props.pr && row.pr) meta.push(<span key="p" className="pr"><Icon name={row.pr.state === 'merged' ? 'git-merge' : 'pull-request'} size={14} />1</span>)
  const items = (close: () => void) => row.thread
    ? <ThreadMenuItems thread={row.thread} close={close} onRename={() => setRenaming(true)} />
    : row.session ? <TerminalMenuItems session={row.session} close={close} /> : null
  const stop = (event: React.MouseEvent) => { event.preventDefault(); event.stopPropagation() }
  const rename = (value: string) => {
    setRenaming(false)
    const title = value.trim()
    if (row.thread && title && title !== row.thread.title) patchThread(row.thread.id, { title }).catch(() => {})
  }

  return (
    <div className={`session-row-wrap ${menuAt ? 'menu-open' : ''} ${row.status === 'waiting' ? 'needs-you' : ''}`} onContextMenu={(event) => { event.preventDefault(); setMenuAt({ x: event.clientX, y: event.clientY }) }}>
      <Link to={row.to} className="session-row" aria-current={row.active ? 'page' : undefined} onClick={(event) => { if (renaming) event.preventDefault() }}>
        <span className="session-row-lead">
          {row.kind === 'terminal' ? <Icon name="terminal" size={13} /> : row.pinned ? <Icon name="pin" size={12} /> : row.status === 'error' ? <span className="dot dot-red" style={{ width: 6, height: 6 }} /> : row.status === 'waiting' ? <span className="dot dot-amber" style={{ width: 6, height: 6 }} /> : <span className="tiny-dot" />}
        </span>
        <span className="session-row-body">
          {renaming ? (
            <input
              className="session-rename"
              autoFocus
              defaultValue={row.title}
              aria-label="Session name"
              onFocus={(event) => event.currentTarget.select()}
              onClick={stop}
              onBlur={(event) => rename(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') rename(event.currentTarget.value)
                if (event.key === 'Escape') setRenaming(false)
              }}
            />
          ) : <span className="session-row-title">{row.title}</span>}
          {meta.length > 0 && (
            <span className="session-row-meta">
              {meta.map((node, index) => <span key={index} className="contents">{index > 0 && <span className="sep">·</span>}{node}</span>)}
            </span>
          )}
        </span>
        {row.unread && <span className="session-row-unread" aria-label="Unread" />}
      </Link>
      {!renaming && (
        <span className="session-row-actions" onClick={stop}>
          {row.thread && (
            <>
              <button className="icon-btn icon-btn-sm" aria-label={row.pinned ? 'Unpin' : 'Pin'} title={row.pinned ? 'Unpin' : 'Pin to top'} onClick={(event) => { stop(event); patchThread(row.thread!.id, { pinned: !row.pinned }).catch(() => {}) }}><Icon name={row.pinned ? 'pin-off' : 'pin'} size={15} /></button>
              <button className="icon-btn icon-btn-sm" aria-label={row.archived ? 'Unarchive' : 'Archive'} title={row.archived ? 'Unarchive' : 'Archive'} onClick={(event) => { stop(event); patchThread(row.thread!.id, { archived: !row.archived, pinned: false }).catch(() => {}) }}><Icon name={row.archived ? 'unarchive' : 'archive'} size={15} /></button>
            </>
          )}
          <Menu placement="bottom-start" width={250} trigger={<button className="icon-btn icon-btn-sm" aria-label="Session actions" title="More"><Icon name="more" size={15} /></button>}>
            {items}
          </Menu>
        </span>
      )}
      {menuAt && <ContextMenu at={menuAt} onClose={() => setMenuAt(null)}>{items}</ContextMenu>}
    </div>
  )
}

function SidebarFoot() {
  return <UpdateNotice />
}

// PanelHead tops the sessions panel: its title, new session, how the list is
// shown, list actions, and hiding the panel.
function PanelHead({ onClose, scope, setScope, customized, unreadCount, markAllRead, sort, setSort, filter, setFilter, group, setGroup, props, setProps, visibleProps, compact, setCompact }: {
  onClose: () => void; scope: 'mine' | 'everyone' | null; setScope: (value: 'mine' | 'everyone') => void; customized: boolean; unreadCount: number; markAllRead: () => void
  sort: Sort; setSort: (value: Sort) => void; filter: Filter; setFilter: (value: Filter) => void; group: Group; setGroup: (value: Group) => void
  props: Record<Property, boolean>; setProps: (value: Record<Property, boolean>) => void; visibleProps: number; compact: boolean; setCompact: (value: boolean) => void
}) {
  const { toggleSidebar, mobile } = useShell()
  return (
    <div className="sidebar-head panel-head">
      <Link to="/sessions" className="panel-title">Sessions</Link>
      {scope && (
        <Menu placement="bottom-start" width={200} trigger={<button className="panel-scope" aria-label="Whose sessions">{scope === 'mine' ? 'Mine' : 'Everyone'}<Icon name="chevron-down" size={12} /></button>}>
          {(close) => (
            <>
              <MenuItem label="Everyone" description="Every session on the hub" checked={scope === 'everyone'} onClick={() => { setScope('everyone'); close() }} />
              <MenuItem label="Mine" description="Sessions you started or were handed" checked={scope === 'mine'} onClick={() => { setScope('mine'); close() }} />
            </>
          )}
        </Menu>
      )}
      <span className="flex-1" />
      <Menu
        placement="bottom-start"
        width={300}
        trigger={<button className={`icon-btn ${customized ? 'icon-btn-active' : ''}`} aria-label="View options and actions" title="View options"><Icon name="sliders" size={18} /></button>}
      >
        <MenuLabel>Properties</MenuLabel>
        <Submenu icon="sort" label="Sort" end={sortLabels[sort]}>
          {(Object.keys(sortLabels) as Sort[]).map((key) => <MenuItem key={key} label={sortLabels[key]} checked={sort === key} onClick={() => setSort(key)} />)}
        </Submenu>
        <Submenu icon="filter" label="Filter" end={filter === 'all' ? undefined : filterLabels[filter]}>
          {(Object.keys(filterLabels) as Filter[]).map((key) => <MenuItem key={key} label={filterLabels[key]} checked={filter === key} onClick={() => setFilter(key)} />)}
        </Submenu>
        <Submenu icon="group" label="Group" end={groupLabels[group]}>
          {(Object.keys(groupLabels) as Group[]).map((key) => <MenuItem key={key} label={groupLabels[key]} checked={group === key} onClick={() => setGroup(key)} />)}
        </Submenu>
        <MenuSeparator />
        <Submenu icon="eye" label="Property visibility" end={visibleProps}>
          {(Object.keys(propertyLabels) as Property[]).map((key) => (
            <button key={key} type="button" className="menu-item" role="menuitemcheckbox" aria-checked={props[key]} onClick={() => setProps({ ...props, [key]: !props[key] })}>
              <span className="flex-1">{propertyLabels[key]}</span>
              <SwitchMark checked={props[key]} />
            </button>
          ))}
        </Submenu>
        <button type="button" className="menu-item" role="menuitemcheckbox" aria-checked={compact} onClick={() => setCompact(!compact)}>
          <Icon name="compact" size={18} />
          <span className="flex-1">Compact view</span>
          <SwitchMark checked={compact} />
        </button>
        <MenuSeparator />
        <MenuItem icon="list-bullets" label="View all sessions" to="/sessions" />
        <MenuItem icon="check" label="Mark all as read" disabled={!unreadCount} onClick={markAllRead} />
        <MenuItem icon="refresh" label="Reset view" disabled={!customized} onClick={() => { setSort('updated'); setFilter('all'); setGroup('none'); setCompact(false) }} />
      </Menu>
      <button className="icon-btn" aria-label="Hide sidebar" title="Hide sidebar (⌘B)" onClick={mobile ? onClose : toggleSidebar}><Icon name="panel-left" size={18} /></button>
    </div>
  )
}

function SettingsNav({ onClose }: { onClose: () => void }) {
  const team = useTeam()
  const location = useLocation()
  const [query, setQuery] = useState('')
  const [name] = usePref('displayName', 'Overseer')
  const current = location.pathname.split('/')[2] ?? ''
  const match = (id: string) => {
    const section = settingsSections.find((item) => item.id === id)!
    return !query || `${section.title} ${section.description}`.toLowerCase().includes(query.toLowerCase())
  }
  const link = (id: string) => {
    if (!match(id)) return null
    const section = settingsSections.find((item) => item.id === id)!
    return (
      <NavLink key={id} to={`/settings/${id}`} className="nav-item" style={{ height: 40 }} aria-current={current === id ? 'page' : undefined}>
        <Icon name={section.icon} size={18} />{section.title}
      </NavLink>
    )
  }
  const personal = ['preferences', 'shortcuts', 'notifications'].map(link).filter(Boolean)
  const hub = ['general', 'people', ...(team.isOwner ? ['activity'] : []), 'connections', 'chat', 'machines', 'previews', 'shares', 'usage'].map(link).filter(Boolean)
  const products = ['agents', 'automations', 'mcp', 'review'].map(link).filter(Boolean)
  const advanced = ['presets', 'tokens'].map(link).filter(Boolean)
  return (
    <>
      <SidebarHead onClose={onClose} />
      <label className="settings-search">
        <Icon name="search" size={17} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search settings…" aria-label="Search settings" onKeyDown={(event) => { if (event.key === 'Escape') setQuery('') }} />
        <span className="kbd">/</span>
      </label>
      <nav className="settings-nav" aria-label="Settings">
        {personal.length > 0 && <><p className="settings-nav-label">Personal</p>{personal}</>}
        <p className="settings-nav-label">Hub</p>
        <Link to="/settings" className="settings-nav-org" aria-current={current === '' ? 'page' : undefined}>{name || 'Overseer'}</Link>
        <div className="settings-nav-tree">
          {hub}
          {hub.length > 0 && products.length > 0 && <div className="settings-nav-gap" />}
          {products}
          {advanced.length > 0 && <div className="settings-nav-gap" />}
          {advanced}
        </div>
        {query && !settingsSections.some((section) => match(section.id)) && <p className="sidebar-message">No settings match “{query}”.</p>}
      </nav>
      <UpdateNotice />
    </>
  )
}
