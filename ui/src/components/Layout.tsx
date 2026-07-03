import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { api } from '../api'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive
      ? 'bg-sky-500/10 text-sky-400'
      : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
  }`

export default function Layout({ version }: { version: string }) {
  // drawerOpen only matters on mobile; the sidebar is always visible on md+.
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()

  // Close the drawer whenever the route changes (i.e. after a tap).
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  const logout = async () => {
    await api.post('/api/logout')
    window.location.assign('/login')
  }

  const nav = (
    <nav className="flex flex-col gap-1">
      <NavLink to="/" end className={linkClass}>
        <IconGrid /> Devices
      </NavLink>
      <NavLink to="/agents" className={linkClass}>
        <IconBot /> Agents
      </NavLink>
      <NavLink to="/settings" className={linkClass}>
        <IconGear /> Settings
      </NavLink>
    </nav>
  )

  const brand = (
    <div className="flex items-center gap-2.5">
      <Eye />
      <span className="text-lg font-semibold tracking-tight text-slate-100">
        Overseer
      </span>
    </div>
  )

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Mobile top bar */}
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/60 px-4 py-3 md:hidden">
        {brand}
        <button
          onClick={() => setDrawerOpen(true)}
          className="rounded-lg p-2 text-slate-300 hover:bg-slate-800"
          aria-label="Open menu"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
      </header>

      {/* Desktop sidebar */}
      <aside className="hidden w-52 shrink-0 flex-col border-r border-slate-800 bg-slate-900/40 p-4 md:flex">
        <div className="mb-8 px-1">{brand}</div>
        {nav}
        <Footer version={version} onLogout={logout} />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="absolute left-0 top-0 flex h-full w-64 flex-col border-r border-slate-800 bg-slate-900 p-4 shadow-2xl">
            <div className="mb-8 flex items-center justify-between px-1">
              {brand}
              <button
                onClick={() => setDrawerOpen(false)}
                className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
                aria-label="Close menu"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            {nav}
            <Footer version={version} onLogout={logout} />
          </aside>
        </div>
      )}

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}

function Footer({
  version,
  onLogout,
}: {
  version: string
  onLogout: () => void
}) {
  return (
    <div className="mt-auto flex flex-col gap-2 px-1 pt-6">
      <button
        onClick={onLogout}
        className="text-left text-sm text-slate-500 hover:text-slate-300"
      >
        Log out
      </button>
      {version && <span className="text-xs text-slate-600">v{version}</span>}
    </div>
  )
}

function Eye() {
  return (
    <svg width="22" height="22" viewBox="0 0 100 100" aria-hidden>
      <circle cx="50" cy="50" r="42" className="fill-sky-500" />
      <circle cx="50" cy="50" r="18" className="fill-slate-950" />
      <circle cx="50" cy="50" r="8" className="fill-sky-100" />
    </svg>
  )
}

const iconProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

function IconGrid() {
  return (
    <svg {...iconProps} aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}

function IconBot() {
  return (
    <svg {...iconProps} aria-hidden>
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M12 8V4M8 4h8" />
      <circle cx="9" cy="13" r="1" fill="currentColor" />
      <circle cx="15" cy="13" r="1" fill="currentColor" />
      <path d="M9 17h6" />
    </svg>
  )
}

function IconGear() {
  return (
    <svg {...iconProps} aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  )
}
