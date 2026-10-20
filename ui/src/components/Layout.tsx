import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAgentCatalog } from '../agents'
import { ShellContext, SidebarToggle, useMediaQuery } from '../shell'
import { useHubStream, usePref, useThreads } from '../store'
import type { ThreadStatus } from '../types'
import CommandPalette from './CommandPalette'
import Sidebar from './Sidebar'

export default function Layout() {
  useAgentCatalog() // new agents from the hub re-render everything that names them
  const mobile = useMediaQuery('(max-width: 1023px)')
  const [collapsed, setCollapsed] = usePref('sidebar.collapsed', false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [ownHeader, setOwnHeader] = useState(0)
  const [toastText, setToastText] = useState('')
  const [theme] = usePref<'system' | 'light' | 'dark'>('theme', 'system')
  const location = useLocation()
  const navigate = useNavigate()
  useHubStream()
  useThreadNotifications()

  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => { setMobileOpen(false) }, [location.pathname, location.search])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      const typing = (event.target as HTMLElement)?.closest?.('input, textarea, [contenteditable], .xterm, .vnc-screen')
      if (mod && event.key.toLowerCase() === 'k') { event.preventDefault(); setPaletteOpen((open) => !open) }
      else if (mod && event.key.toLowerCase() === 'b' && !typing) { event.preventDefault(); if (mobile) setMobileOpen((open) => !open); else setCollapsed(!collapsed) }
      else if (mod && event.shiftKey && event.key.toLowerCase() === 'o') { event.preventDefault(); navigate('/') }
      else if (!mod && event.key === '/' && !typing && location.pathname.startsWith('/settings')) {
        event.preventDefault()
        document.querySelector<HTMLInputElement>('.settings-search input')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [collapsed, mobile, navigate, setCollapsed, location.pathname])

  const toast = useCallback((text: string) => {
    setToastText(text)
    window.setTimeout(() => setToastText((current) => (current === text ? '' : current)), 2600)
  }, [])

  const shell = {
    collapsed,
    mobile,
    openSidebar: () => (mobile ? setMobileOpen(true) : setCollapsed(false)),
    toggleSidebar: () => (mobile ? setMobileOpen((open) => !open) : setCollapsed(!collapsed)),
    ownHeader,
    setOwnHeader,
    toast,
  }
  const hidden = mobile ? !mobileOpen : collapsed

  return (
    <ShellContext.Provider value={shell}>
      <div className={`app-frame ${collapsed && !mobile ? 'sidebar-collapsed' : ''} ${mobileOpen ? 'sidebar-open' : ''}`}>
        <a href="#main" className="skip-link">Skip to content</a>
        {mobile && mobileOpen && <button className="sidebar-scrim" aria-label="Close sidebar" onClick={() => setMobileOpen(false)} />}
        <Sidebar onSearch={() => setPaletteOpen(true)} onClose={() => setMobileOpen(false)} />
        <div className="app-main">
          {hidden && ownHeader === 0 && <div className="topbar"><SidebarToggle /></div>}
          <main id="main" className="flex min-h-0 flex-1 flex-col" tabIndex={-1}>
            <Outlet />
          </main>
        </div>
        {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
        {toastText && <div className="toast" role="status">{toastText}</div>}
      </div>
    </ShellContext.Provider>
  )
}

// useThreadNotifications raises a desktop notification when a session you are
// not looking at finishes or starts waiting for approval.
function useThreadNotifications() {
  const { value: threads } = useThreads()
  const [enabled] = usePref('notify.enabled', false)
  const [onDone] = usePref('notify.done', true)
  const [onApproval] = usePref('notify.approval', true)
  const navigate = useNavigate()
  const seen = useRef<Map<string, ThreadStatus> | null>(null)
  useEffect(() => {
    if (!threads) return
    const previous = seen.current
    seen.current = new Map(threads.map((thread) => [thread.id, thread.status]))
    if (!previous || !enabled || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    for (const thread of threads) {
      const before = previous.get(thread.id)
      if (!before || before === thread.status) continue
      const watching = document.visibilityState === 'visible' && location.pathname === `/sessions/${thread.id}`
      if (watching) continue
      const finished = onDone && (before === 'working' || before === 'starting') && (thread.status === 'idle' || thread.status === 'error')
      const waiting = onApproval && thread.status === 'waiting'
      if (!finished && !waiting) continue
      const note = new Notification(thread.title, { body: waiting ? `Needs your approval on ${thread.deviceName}` : thread.status === 'error' ? `Failed on ${thread.deviceName}` : `Finished on ${thread.deviceName}`, tag: thread.id })
      note.onclick = () => { window.focus(); navigate(`/sessions/${thread.id}`) }
    }
  }, [threads, enabled, onDone, onApproval, navigate])
}
