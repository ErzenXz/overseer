import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAgentCatalog } from '../agents'
import { useTabAttention } from '../attention'
import { notificationsAllowed, registerNotificationWorker, showNotice } from '../notify'
import { ShellContext, SidebarToggle, useMediaQuery } from '../shell'
import { useHubStream, usePref, useThreads } from '../store'
import { useHandoffNotices } from '../teams'
import type { ThreadStatus } from '../types'
import CommandPalette from './CommandPalette'
import Sidebar from './Sidebar'
import { ScheduleWatcher } from './Scheduled'
import ShortcutsHelp from './ShortcutsHelp'
import { useShortcuts } from '../lib/useShortcuts'
import { GO } from '../lib/shortcuts'
import { ContinueInHost } from './ContinueIn'

export default function Layout() {
  useAgentCatalog() // new agents from the hub re-render everything that names them
  const mobile = useMediaQuery('(max-width: 1023px)')
  const [collapsed, setCollapsed] = usePref('sidebar.collapsed', false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [ownHeader, setOwnHeader] = useState(0)
  const [toastText, setToastText] = useState('')
  const [theme] = usePref<'system' | 'light' | 'dark'>('theme', 'system')
  const location = useLocation()
  const navigate = useNavigate()
  useHubStream()
  const chord = useShortcuts({ openHelp: useCallback(() => setHelpOpen(true), []) })
  useThreadNotifications()
  useTabAttention()

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

  useHandoffNotices(toast, useCallback((id: string) => { window.focus(); navigate(`/sessions/${id}`) }, [navigate]))

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
        {helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}
        {chord && (
          <div className="chord-hint" role="status">
            <span className="chord-lead">Go to</span>
            {GO.map((item) => <span key={item.key} className="chord-item"><kbd>{item.key.toUpperCase()}</kbd>{item.label}</span>)}
          </div>
        )}
        {toastText && <div className="toast" role="status">{toastText}</div>}
        <ScheduleWatcher />
        <ContinueInHost />
      </div>
    </ShellContext.Provider>
  )
}

// A session that keeps waiting gets at most two gentle reminders: one after
// five minutes and one after thirty.
const REMINDER_AFTER = [5 * 60_000, 30 * 60_000]

function waitedText(ms: number) {
  const minutes = Math.round(ms / 60_000)
  return minutes < 90 ? `${minutes} minutes` : `${Math.round(minutes / 60)} hours`
}

// useThreadNotifications raises a desktop or phone notification when a session
// you are not looking at finishes or starts waiting for approval, and nudges
// again if it is still waiting later. Tapping one opens the session.
function useThreadNotifications() {
  const { value: threads } = useThreads()
  const [enabled] = usePref('notify.enabled', false)
  const [onDone] = usePref('notify.done', true)
  const [onApproval] = usePref('notify.approval', true)
  const navigate = useNavigate()
  const seen = useRef<Map<string, ThreadStatus> | null>(null)
  const waits = useRef(new Map<string, { since: number; sent: number }>())
  const latest = useRef({ threads, enabled, onApproval })
  latest.current = { threads, enabled, onApproval }
  const open = useCallback((id: string) => { window.focus(); navigate(`/sessions/${id}`) }, [navigate])

  // The service worker tells the page where to go when a notification is tapped.
  useEffect(() => {
    registerNotificationWorker()
    if (!('serviceWorker' in navigator)) return
    const onMessage = (event: MessageEvent) => {
      const url = event.data?.type === 'overseer:open' ? event.data.url : null
      if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')) navigate(url)
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [navigate])

  useEffect(() => {
    if (!threads) return
    const previous = seen.current
    seen.current = new Map(threads.map((thread) => [thread.id, thread.status]))
    // Remember when each wait began: now for one we just saw start, otherwise
    // when the session last changed.
    const now = Date.now()
    for (const thread of threads) {
      if (thread.status !== 'waiting' || thread.archived) { waits.current.delete(thread.id); continue }
      if (waits.current.has(thread.id)) continue
      const before = previous?.get(thread.id)
      waits.current.set(thread.id, { since: before && before !== 'waiting' ? now : Math.min(now, thread.updatedAt * 1000), sent: 0 })
    }
    if (!previous || !enabled || !notificationsAllowed()) return
    for (const thread of threads) {
      const before = previous.get(thread.id)
      if (!before || before === thread.status) continue
      const watching = document.visibilityState === 'visible' && location.pathname === `/sessions/${thread.id}`
      if (watching) continue
      const finished = onDone && (before === 'working' || before === 'starting') && (thread.status === 'idle' || thread.status === 'error')
      const waiting = onApproval && thread.status === 'waiting'
      if (!finished && !waiting) continue
      showNotice(thread.title, waiting ? `Needs your approval on ${thread.deviceName}` : thread.status === 'error' ? `Failed on ${thread.deviceName}` : `Finished on ${thread.deviceName}`, thread.id, `/sessions/${thread.id}`, () => open(thread.id))
    }
  }, [threads, enabled, onDone, onApproval, open])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const { threads, enabled, onApproval } = latest.current
      if (!threads || !enabled || !onApproval || !notificationsAllowed()) return
      const now = Date.now()
      for (const thread of threads) {
        const wait = waits.current.get(thread.id)
        if (!wait || thread.status !== 'waiting') continue
        const elapsed = now - wait.since
        const due = REMINDER_AFTER.filter((ms) => elapsed >= ms).length
        if (due <= wait.sent) continue
        if (document.visibilityState === 'visible' && location.pathname === `/sessions/${thread.id}`) continue
        wait.sent = due // a long wait found late gets one reminder, not two
        showNotice(thread.title, `Still waiting for you on ${thread.deviceName} (${waitedText(elapsed)})`, thread.id, `/sessions/${thread.id}`, () => open(thread.id), true)
      }
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [open])
}
