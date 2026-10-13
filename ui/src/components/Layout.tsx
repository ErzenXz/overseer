import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { api } from '../api'
import type { Project } from '../types'
import Icon, { type IconName } from './Icon'

const links: { to: string; label: string; icon: IconName }[] = [
  { to: '/fleet', label: 'Overview', icon: 'fleet' },
  { to: '/code', label: 'Projects', icon: 'code' },
  { to: '/agents', label: 'Agent runs', icon: 'activity' },
  { to: '/setup', label: 'Machine setup', icon: 'setup' },
]

export default function Layout({ version }: { version: string }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [mobileOpen, setMobileOpen] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const location = useLocation()
  const menuButton = useRef<HTMLButtonElement>(null)
  const sidebar = useRef<HTMLElement>(null)
  const loadProjects = useCallback(async () => {
    try { setProjects(await api.get<Project[]>('/api/projects')) } catch { /* keep last snapshot */ }
  }, [])

  useEffect(() => {
    loadProjects()
    const timer = window.setInterval(loadProjects, 15_000)
    window.addEventListener('liveagent:projects-changed', loadProjects)
    return () => { window.clearInterval(timer); window.removeEventListener('liveagent:projects-changed', loadProjects) }
  }, [loadProjects])
  useEffect(() => { setMobileOpen(false) }, [location.pathname, location.search])
  useEffect(() => {
    if (!mobileOpen) return
    sidebar.current?.querySelector<HTMLElement>('a')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMobileOpen(false); menuButton.current?.focus() }
      if (event.key === 'Tab') {
        const nodes = Array.from(sidebar.current?.querySelectorAll<HTMLElement>('a, button') ?? []).filter((node) => node.getClientRects().length)
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
  const section = location.pathname.startsWith('/devices/') ? 'Device details' : [...links, { to: '/settings', label: 'Settings' }].find((link) => location.pathname.startsWith(link.to))?.label ?? 'Overview'

  return (
    <div className="app-frame">
      <a href="#main-content" className="skip-link">Skip to content</a>
      {mobileOpen && <button className="sidebar-scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
      <aside ref={sidebar} className={`app-sidebar ${mobileOpen ? 'app-sidebar-open' : ''}`}>
        <div className="sidebar-head"><NavLink to="/fleet" className="brand"><span className="brand-mark"><Icon name="fleet" size={17} /></span>overseer<span className="brand-period">.</span></NavLink><button onClick={() => setMobileOpen(false)} className="toolbar-button ml-auto lg:hidden" aria-label="Close navigation"><Icon name="close" /></button></div>
        <div className="workspace-label"><span className="workspace-avatar">P</span><div><strong>Personal workspace</strong><span>Self-hosted fleet</span></div></div>
        <nav className="sidebar-nav" aria-label="Main navigation"><p className="sidebar-section-title">Workspace</p>{links.map((link) => <NavLink key={link.to} to={link.to} className={({ isActive }) => `sidebar-link ${isActive ? 'sidebar-link-active' : ''}`}><Icon name={link.icon} /><span>{link.label}</span></NavLink>)}</nav>
        <section className="sidebar-projects"><div className="sidebar-section-title"><span>Projects</span><NavLink to="/code?new=1" aria-label="Add project" className="sidebar-add"><Icon name="plus" size={14} /></NavLink></div>{projects.map((project) => <NavLink key={project.id} to={`/code/${project.id}`} className={({ isActive }) => `project-link ${isActive ? 'project-link-active' : ''}`}><Icon name="folder" size={15} /><span className="truncate">{project.name}</span></NavLink>)}{projects.length === 0 && <NavLink to="/code?new=1" className="empty-project-link"><Icon name="plus" size={14} /> Create a project</NavLink>}</section>
        <div className="sidebar-bottom"><NavLink to="/settings" className={({ isActive }) => `sidebar-link ${isActive ? 'sidebar-link-active' : ''}`}><Icon name="settings" /><span>Settings</span></NavLink></div>
        {logoutError && <p className="px-4 text-xs text-rose-300" role="alert">{logoutError}</p>}
        <footer className="sidebar-footer"><span className="operator-avatar">O</span><div className="min-w-0"><p className="text-xs font-medium text-zinc-200">Local administrator</p><p className="mt-1 truncate font-mono text-[10px] text-zinc-500">{version || 'Development'}</p></div><button onClick={logout} className="toolbar-button ml-auto" aria-label="Log out" title="Log out"><Icon name="logout" size={16} /></button></footer>
      </aside>
      <div className="app-content"><header className="app-topbar"><button ref={menuButton} onClick={() => setMobileOpen(true)} aria-label="Open navigation" aria-expanded={mobileOpen} className="toolbar-button lg:hidden"><Icon name="menu" /></button><span className="hidden sm:inline">Workspace</span><span className="hidden text-zinc-600 sm:inline">/</span><span className="text-zinc-200">{section}</span><span className="topbar-private"><Icon name="shield" size={13} /> Private workspace</span></header><main id="main-content" tabIndex={-1} className="main-content"><Outlet /></main></div>
    </div>
  )
}
