import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { usePref, useThreads } from '../store'
import { fireAction, GO, PANELS } from './shortcuts'

// useShortcuts wires the shortcut list to the app. It never fires while you are
// typing in a field (except the ones with a modifier), and the "g then …"
// jumps time out after a moment. Returns whether a jump is waiting for its
// second key, so the app can show what's on offer.
export function useShortcuts({ openHelp }: { openHelp: () => void }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { value: threads } = useThreads()
  const [theme, setTheme] = usePref<'system' | 'light' | 'dark'>('theme', 'system')
  const [chord, setChord] = useState(false)
  const timer = useRef(0)
  const state = useRef({ location, threads, theme })
  state.current = { location, threads, theme }

  useEffect(() => {
    const stopChord = () => { window.clearTimeout(timer.current); setChord(false) }
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      const { location, threads, theme } = state.current
      const mod = event.metaKey || event.ctrlKey
      const target = event.target as HTMLElement | null
      const typing = !!target?.closest?.('input, textarea, select, [contenteditable="true"], .xterm, .vnc-screen')
      const key = event.key.toLowerCase()
      const go = (to: string) => { event.preventDefault(); stopChord(); navigate(to) }

      // Esc leaves a text box, so the one-key shortcuts work again.
      if (key === 'escape' && typing && !mod && !event.altKey && !target?.closest('[role="dialog"], [role="menu"], .popover')) {
        if (target instanceof HTMLElement && !target.closest('.xterm, .vnc-screen')) target.blur()
        return
      }

      // Chord second key.
      if (chord && !mod && !event.altKey) {
        const hit = GO.find((item) => item.key === key)
        stopChord()
        if (hit) { event.preventDefault(); navigate(hit.to) }
        return
      }

      if (mod && !event.shiftKey && !event.altKey && key === 'j') return go('/sessions')
      if (mod && !event.shiftKey && !event.altKey && key === ',') return go('/settings')
      if (mod && !event.altKey && key === '/') { event.preventDefault(); openHelp(); return }
      if (mod && event.shiftKey && !event.altKey && key === 'l') {
        event.preventDefault()
        const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
        setTheme(dark ? 'light' : 'dark')
        return
      }
      if (mod && event.shiftKey && !event.altKey && key === 'p') { event.preventDefault(); fireAction({ name: 'panel', tab: 'toggle' }); return }
      if (mod && !event.shiftKey && !event.altKey && key === '.') { event.preventDefault(); fireAction({ name: 'stop' }); return }

      // Answer what an agent is asking, without the mouse.
      if (mod && !event.altKey && (key === 'enter' || (event.shiftKey && key === 'backspace'))) {
        const reject = key === 'backspace'
        const box = target?.closest('textarea') as HTMLTextAreaElement | null
        if (box && box.value.trim() && !reject) return // that is "send"
        const buttons = document.querySelectorAll<HTMLButtonElement>('.approval-pending .approval-actions button')
        const button = reject ? [...buttons].find((item) => /reject|deny|no/i.test(item.textContent ?? '')) : buttons[0]
        if (button && !button.disabled) { event.preventDefault(); button.click() }
        return
      }

      // Alt+1…6 pick a workspace tab, Alt+0 closes it. Alt+↑/↓ move between sessions.
      if (event.altKey && !mod) {
        const digit = /^Digit(\d)$/.exec(event.code)?.[1]
        if (digit !== undefined) {
          const index = Number(digit)
          if (index === 0) { event.preventDefault(); fireAction({ name: 'panel', tab: 'close' }) }
          else if (index <= PANELS.length) { event.preventDefault(); fireAction({ name: 'panel', tab: PANELS[index - 1] }) }
          return
        }
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          const list = (threads ?? []).filter((thread) => !thread.archived).sort((a, b) => b.updatedAt - a.updatedAt)
          if (!list.length) return
          const current = list.findIndex((thread) => `/sessions/${thread.id}` === location.pathname)
          const next = event.key === 'ArrowDown' ? (current + 1) % list.length : (current <= 0 ? list.length : current) - 1
          event.preventDefault()
          navigate(`/sessions/${list[next].id}`)
        }
        return
      }

      if (typing || mod || event.altKey) return

      if (key === 'g' && !event.shiftKey) {
        event.preventDefault()
        setChord(true)
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setChord(false), 1800)
        return
      }
      if (event.key === '?') { event.preventDefault(); openHelp(); return }
      if (event.key === '/' && !location.pathname.startsWith('/settings')) {
        const box = document.querySelector<HTMLTextAreaElement>('.composer textarea')
        if (box) { event.preventDefault(); box.focus() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); window.clearTimeout(timer.current) }
  }, [chord, navigate, openHelp, setTheme])

  return chord
}
