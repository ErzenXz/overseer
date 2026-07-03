import { NavLink, Outlet } from 'react-router-dom'
import { api } from '../api'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive
      ? 'bg-sky-500/10 text-sky-400'
      : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
  }`

export default function Layout({ version }: { version: string }) {
  const logout = async () => {
    await api.post('/api/logout')
    location.href = '/login'
  }

  return (
    <div className="flex h-full">
      <aside className="flex w-52 shrink-0 flex-col border-r border-slate-800 bg-slate-900/40 p-4">
        <div className="mb-8 flex items-center gap-2.5 px-1">
          <Eye />
          <span className="text-lg font-semibold tracking-tight text-slate-100">
            Overseer
          </span>
        </div>
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
        <div className="mt-auto flex flex-col gap-2 px-1">
          <button
            onClick={logout}
            className="text-left text-sm text-slate-500 hover:text-slate-300"
          >
            Log out
          </button>
          {version && <span className="text-xs text-slate-600">v{version}</span>}
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
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
