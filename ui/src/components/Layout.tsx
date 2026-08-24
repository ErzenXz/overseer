import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { api } from '../api'
import type { Project } from '../types'

const links = [
  { to: '/code', label: 'Code', icon: 'compose' },
  { to: '/fleet', label: 'Fleet', icon: 'grid' },
  { to: '/agents', label: 'Agent runs', icon: 'pulse' },
  { to: '/setup', label: 'Set up nodes', icon: 'spark' },
  { to: '/settings', label: 'Settings', icon: 'sliders' },
]

export default function Layout({ version }: { version: string }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [mobileOpen, setMobileOpen] = useState(false)

  const loadProjects = useCallback(async () => {
    try {
      setProjects(await api.get<Project[]>('/api/projects'))
    } catch {
      /* preserve the current project rail during a short disconnect */
    }
  }, [])

  useEffect(() => {
    loadProjects()
    const timer = window.setInterval(loadProjects, 15_000)
    window.addEventListener('liveagent:projects-changed', loadProjects)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('liveagent:projects-changed', loadProjects)
    }
  }, [loadProjects])

  const logout = async () => {
    await api.post('/api/logout')
    window.location.assign('/login')
  }

  return (
    <div className="app-frame">
      <a href="#main-content" className="skip-link">Skip to content</a>

      <div className="mobile-bar">
        <button onClick={() => setMobileOpen(true)} aria-label="Open navigation" className="toolbar-button"><MenuIcon /></button>
        <Brand />
        <span className="ml-auto flex items-center gap-1.5 text-[10px] text-zinc-500"><span className="node-dot node-dot-online" />online</span>
      </div>

      {mobileOpen && <button className="sidebar-scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}

      <aside className={`app-sidebar ${mobileOpen ? 'app-sidebar-open' : ''}`}>
        <div className="sidebar-head">
          <Brand />
          <span className="rounded border border-white/[0.08] px-1.5 py-0.5 font-mono text-[9px] text-zinc-600">fx</span>
          <button onClick={() => setMobileOpen(false)} className="ml-auto text-zinc-600 hover:text-white lg:hidden" aria-label="Close navigation">×</button>
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === '/code'}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) => `sidebar-link ${isActive ? 'sidebar-link-active' : ''}`}
            >
              <NavIcon name={link.icon} />
              <span>{link.label}</span>
            </NavLink>
          ))}
        </nav>

        <section className="sidebar-projects">
          <div className="sidebar-section-title">
            <span>Projects</span>
            <NavLink to="/code?new=1" onClick={() => setMobileOpen(false)} aria-label="Add project" className="sidebar-add">+</NavLink>
          </div>
          <div className="space-y-0.5">
            {projects.map((project) => (
              <NavLink
                key={project.id}
                to={`/code/${project.id}`}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) => `project-link ${isActive ? 'project-link-active' : ''}`}
              >
                <FolderIcon />
                <span className="truncate">{project.name}</span>
              </NavLink>
            ))}
            {projects.length === 0 && <p className="px-2 py-3 text-xs leading-5 text-zinc-700">No projects yet</p>}
          </div>
        </section>

        <footer className="sidebar-footer">
          <div className="operator-avatar">LA</div>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-zinc-300">Personal fleet</p>
            <p className="font-mono text-[9px] text-zinc-700">{version || 'development'}</p>
          </div>
          <button onClick={logout} className="ml-auto text-[11px] text-zinc-600 hover:text-zinc-200">Log out</button>
        </footer>
      </aside>

      <main id="main-content" className="app-content"><Outlet /></main>
    </div>
  )
}

function Brand() {
  return (
    <NavLink to="/code" className="flex items-center gap-2 text-zinc-100">
      <span className="brand-mark"><span>⌁</span></span>
      <span className="text-sm font-semibold tracking-[-0.025em]">LiveAgent</span>
    </NavLink>
  )
}

function MenuIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" /></svg>
}

function FolderIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11Z" /></svg>
}

function NavIcon({ name }: { name: string }) {
  const common = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 } as const
  if (name === 'compose') return <svg {...common} aria-hidden><path d="M13.5 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-7.5M16.5 3.5l4 4L11 17l-4.5 1 1-4.5 9-10Z" /></svg>
  if (name === 'pulse') return <svg {...common} aria-hidden><path d="M3 12h4l2.2-6 4.2 12 2.3-6H21" /></svg>
  if (name === 'spark') return <svg {...common} aria-hidden><path d="m12 3 1.2 4.1L17 9l-3.8 1.9L12 15l-1.2-4.1L7 9l3.8-1.9L12 3ZM5 16l.7 2.3L8 19.5l-2.3 1.2L5 23l-.7-2.3L2 19.5l2.3-1.2L5 16Z" /></svg>
  if (name === 'sliders') return <svg {...common} aria-hidden><path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h7M15 18h5" /><circle cx="16" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="13" cy="18" r="2" /></svg>
  return <svg {...common} aria-hidden><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
}
