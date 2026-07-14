import { NavLink, Outlet } from 'react-router-dom'
import { api } from '../api'

const links = [
  { to: '/', label: 'Fleet', end: true, icon: 'grid' },
  { to: '/agents', label: 'Agents', icon: 'pulse' },
  { to: '/setup', label: 'Setup', icon: 'spark' },
  { to: '/settings', label: 'Settings', icon: 'sliders' },
]

export default function Layout({ version }: { version: string }) {
  const logout = async () => {
    await api.post('/api/logout')
    window.location.assign('/login')
  }

  return (
    <div className="flex min-h-full flex-col">
      <a
        href="#main-content"
        className="fixed left-4 top-3 z-[60] -translate-y-20 rounded-md bg-lime-300 px-3 py-2 text-sm font-semibold text-zinc-950 focus:translate-y-0"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-[#0b0d0f]/88 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3 px-4 py-3 sm:px-7">
          <NavLink to="/" className="mr-auto flex items-center gap-2.5 text-zinc-100">
            <Eye />
            <span className="text-base font-semibold tracking-[-0.025em]">Overseer</span>
          </NavLink>

          <nav className="order-3 flex w-full items-center gap-1 overflow-x-auto sm:order-none sm:w-auto" aria-label="Main navigation">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  `flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium ${
                    isActive
                      ? 'bg-white/[0.08] text-white'
                      : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200'
                  }`
                }
              >
                <NavIcon name={link.icon} />
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-1 flex items-center gap-3 border-l border-white/10 pl-4">
            {version && <span className="hidden font-mono text-[10px] text-zinc-600 lg:block">{version}</span>}
            <button onClick={logout} className="text-xs font-medium text-zinc-500 hover:text-zinc-200">
              Log out
            </button>
          </div>
        </div>
      </header>
      <main id="main-content" className="min-h-0 min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  )
}

function Eye() {
  return (
    <span className="grid h-7 w-7 place-items-center rounded-lg bg-lime-300 text-zinc-950 shadow-[0_0_28px_rgba(190,242,100,0.12)]">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M2.7 12s3.3-6 9.3-6 9.3 6 9.3 6-3.3 6-9.3 6-9.3-6-9.3-6Z" />
        <circle cx="12" cy="12" r="2.6" fill="currentColor" />
      </svg>
    </span>
  )
}

function NavIcon({ name }: { name: string }) {
  const common = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 } as const
  if (name === 'pulse') return <svg {...common} aria-hidden><path d="M3 12h4l2.2-6 4.2 12 2.3-6H21" /></svg>
  if (name === 'spark') return <svg {...common} aria-hidden><path d="m12 3 1.2 4.1L17 9l-3.8 1.9L12 15l-1.2-4.1L7 9l3.8-1.9L12 3ZM5 16l.7 2.3L8 19.5l-2.3 1.2L5 23l-.7-2.3L2 19.5l2.3-1.2L5 16Z" /></svg>
  if (name === 'sliders') return <svg {...common} aria-hidden><path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h7M15 18h5" /><circle cx="16" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="13" cy="18" r="2" /></svg>
  return <svg {...common} aria-hidden><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
}
