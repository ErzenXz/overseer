import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api, timeAgo } from '../api'
import { useHubEvents, usePoll } from '../hooks'
import type { Device, FleetSession } from '../types'
import Icon, { type IconName } from './Icon'
import LaunchSessionModal from './LaunchSessionModal'
import Modal from './Modal'
import { settingsSections } from '../settings'

const links: { to: string; label: string; icon: IconName }[] = [
  { to: '/code', label: 'Projects', icon: 'folder' },
  { to: '/fleet', label: 'Machines', icon: 'monitor' },
  { to: '/setup', label: 'Machine setup', icon: 'setup' },
]

export default function Layout({ version }: { version: string }) {
  const [sessions, setSessions] = useState<FleetSession[] | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [loadError, setLoadError] = useState('')
  const [showLaunch, setShowLaunch] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const [settingsQuery, setSettingsQuery] = useState('')
  const location = useLocation()
  const navigate = useNavigate()
  const menuButton = useRef<HTMLButtonElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const sidebar = useRef<HTMLElement>(null)
  const requestId = useRef(0)
  const load = useCallback(async () => {
    const request = ++requestId.current
    try {
      const [nextSessions, nextDevices] = await Promise.all([
        api.get<FleetSession[]>('/api/agents'), api.get<Device[]>('/api/devices'),
      ])
      if (request !== requestId.current) return
      setSessions(nextSessions); setDevices(nextDevices); setLoadError('')
    } catch {
      if (request === requestId.current) setLoadError('Could not refresh sessions.')
    }
  }, [])
  usePoll(load, 8000)
  useEffect(() => () => { requestId.current++ }, [])
  useHubEvents((event) => { if (['sessions.changed', 'device.online', 'device.offline'].includes(event.type)) load() })
  useEffect(() => { if (searchOpen) searchInput.current?.focus() }, [searchOpen])
  useEffect(() => { setMobileOpen(false) }, [location.pathname, location.search])
  useEffect(() => {
    if (!mobileOpen) return
    sidebar.current?.querySelector<HTMLElement>('a')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMobileOpen(false); menuButton.current?.focus() }
      if (event.key === 'Tab') {
        const nodes = Array.from(sidebar.current?.querySelectorAll<HTMLElement>('a, button, input') ?? []).filter((node) => node.getClientRects().length)
        const first = nodes[0], last = nodes[nodes.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileOpen])
  const logout = async () => {
    try { await api.post('/api/logout'); window.location.assign('/login') }
    catch { setLogoutError('Could not sign out. Try again.') }
  }
  const requestedSession = new URLSearchParams(location.search).get('session')
  const inSettings = location.pathname === '/settings'
  const settingsSection = new URLSearchParams(location.search).get('section')
  const section = location.pathname.startsWith('/devices/') ? requestedSession || 'Machine details' : [...links, { to: '/setup', label: 'Machine setup' }, { to: '/settings', label: 'Settings' }].find((link) => location.pathname.startsWith(link.to))?.label ?? 'Sessions'
  const recent = [...(sessions ?? [])].sort((a, b) => b.lastActivity - a.lastActivity).filter((session) => `${session.name} ${session.deviceName} ${session.kind}`.toLowerCase().includes(query.trim().toLowerCase()))
  const newSession = () => { setMobileOpen(false); setShowLaunch(true) }

  return (
    <div className={`app-frame ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <a href="#main-content" className="skip-link">Skip to content</a>
      {mobileOpen && <button className="sidebar-scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
      <aside ref={sidebar} className={`app-sidebar ${mobileOpen ? 'app-sidebar-open' : ''}`}>
        <div className="session-sidebar-head">
          <NavLink to="/agents" className="session-workspace">{inSettings ? <><Icon name="arrow" size={16} className="rotate-180" /><span>Back to workspace</span></> : <><span className="workspace-avatar">O</span><span>Overseer</span></>}</NavLink>
          {!inSettings && <button className="toolbar-button" aria-label="Search sessions" aria-expanded={searchOpen} onClick={() => { setSearchOpen(!searchOpen); setQuery('') }}><Icon name="search" size={17} /></button>}
          <button className="toolbar-button hidden lg:grid" aria-label="Collapse sidebar" onClick={() => { setCollapsed(true); menuButton.current?.focus() }}><Icon name="panel" size={17} /></button>
          <button onClick={() => setMobileOpen(false)} className="toolbar-button lg:hidden" aria-label="Close navigation"><Icon name="close" size={17} /></button>
        </div>
        {inSettings ? <div className="settings-sidebar">
          <label className="session-search"><Icon name="search" size={15} /><input value={settingsQuery} onChange={(event) => setSettingsQuery(event.target.value)} placeholder="Search settings…" aria-label="Search settings" /></label>
          <nav aria-label="Settings navigation">
            <p className="sidebar-group-label">Workspace</p>
            <Link to="/settings" className={`sidebar-link ${!settingsSection ? 'sidebar-link-active' : ''}`} aria-current={!settingsSection ? 'page' : undefined}>Overview</Link>
            <div className="settings-nav-tree">{settingsSections.filter((item) => `${item.title} ${item.description}`.toLowerCase().includes(settingsQuery.toLowerCase().trim())).map((item) => <Link key={item.id} to={`/settings?section=${item.id}`} className={`sidebar-link ${settingsSection === item.id ? 'sidebar-link-active' : ''}`} aria-current={settingsSection === item.id ? 'page' : undefined}><Icon name={item.icon} size={16} />{item.title}</Link>)}</div>
            {settingsQuery && !settingsSections.some((item) => `${item.title} ${item.description}`.toLowerCase().includes(settingsQuery.toLowerCase().trim())) && <p className="session-list-message">No matching settings.</p>}
          </nav>
        </div> : <>
        <nav className="sidebar-nav" aria-label="Main navigation">
          <button className="new-session-button" onClick={newSession}><Icon name="plus" size={19} /><span>New session</span></button>
          {links.map((link) => <NavLink key={link.to} to={link.to} className={({ isActive }) => `sidebar-link ${isActive ? 'sidebar-link-active' : ''}`}><Icon name={link.icon} size={16} /><span>{link.label}</span></NavLink>)}
        </nav>
        <section className="sidebar-sessions" aria-label="Recent sessions">
          <div className="session-list-heading"><NavLink to="/agents">Sessions</NavLink><div className="flex"><button className="toolbar-button" onClick={newSession} aria-label="Create session"><Icon name="plus" size={16} /></button><NavLink to="/agents" className="toolbar-button" aria-label="View all sessions"><Icon name="list" size={16} /></NavLink></div></div>
          {searchOpen && <div className="session-search"><Icon name="search" size={14} /><input ref={searchInput} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a session…" aria-label="Filter sessions" /></div>}
          <div className="session-recent-label"><Icon name="clock" size={14} />Recent</div>
          {loadError && <p className="session-list-message" role="alert">{loadError} <button onClick={load}>Retry</button></p>}
          {sessions === null ? <p className="session-list-message">{loadError ? 'Sessions unavailable.' : 'Loading sessions…'}</p> : recent.length === 0 ? <div className="session-list-empty"><p>{query ? 'No matching sessions' : 'No sessions yet'}</p>{query && <button onClick={() => setQuery('')}>Clear search</button>}</div> : recent.map((session) => {
            const active = location.pathname === `/devices/${session.deviceId}` && requestedSession === session.name
            return <Link key={`${session.deviceId}:${session.name}`} to={`/devices/${session.deviceId}?session=${encodeURIComponent(session.name)}`} aria-current={active ? 'page' : undefined} className={`session-nav-item ${active ? 'session-nav-item-active' : ''}`} title={`${session.name} · ${session.deviceName}`}>
              <Icon name="chevron" size={12} className="session-nav-chevron" />
              <span className="session-nav-text"><span className="session-nav-name">{session.name}</span><span className="session-nav-meta"><span className={`session-status-label session-status-${session.status}`}>{session.status === 'working' ? 'Working' : session.status === 'idle' ? 'Idle' : 'Ended'}</span><span>·</span><span className="truncate">{session.deviceName}</span></span></span>
              <span className={`session-status-dot session-status-${session.status}`} title={`${session.status} · ${timeAgo(session.lastActivity)}`} />
            </Link>
          })}
        </section>
        </>}
        {logoutError && <p className="px-4 text-xs text-danger" role="alert">{logoutError}</p>}
        <footer className="sidebar-footer"><NavLink to="/settings" className="toolbar-button" aria-label="Settings" title="Settings"><Icon name="settings" size={17} /></NavLink><button onClick={logout} className="toolbar-button" aria-label="Log out" title="Log out"><Icon name="logout" size={17} /></button><span className="sidebar-version" title={version || 'Development build'}>Self-hosted</span></footer>
      </aside>
      <div className="app-content"><header className="app-topbar"><button ref={menuButton} onClick={() => { setCollapsed(false); setMobileOpen(window.matchMedia('(max-width: 1023px)').matches) }} aria-label="Open navigation" aria-expanded={mobileOpen} className={`toolbar-button ${collapsed ? '' : 'lg:hidden'}`}><Icon name="panel" size={17} /></button><span className="topbar-title">{section}</span>{inSettings && settingsSection && <><Icon name="chevron" size={12} /><span className="topbar-detail">{settingsSections.find((item) => item.id === settingsSection)?.title}</span></>}</header><main id="main-content" tabIndex={-1} className="main-content"><Outlet /></main></div>
      {showLaunch && (devices.some((device) => device.online) ? <LaunchSessionModal devices={devices} onLaunched={(deviceId, session) => { setShowLaunch(false); load(); navigate(`/devices/${deviceId}?session=${encodeURIComponent(session)}`) }} onClose={() => setShowLaunch(false)} /> : <Modal title="Connect a machine to get started" onClose={() => setShowLaunch(false)}><p className="mb-5 text-sm text-muted">Sessions run on your machines. Bring a device online, then launch your coding agent or terminal here.</p><Link to="/fleet" className="btn-primary" onClick={() => setShowLaunch(false)}>Go to machines<Icon name="arrow" size={15} /></Link></Modal>)}
    </div>
  )
}
