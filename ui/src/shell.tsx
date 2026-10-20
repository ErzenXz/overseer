import { createContext, useContext, useEffect, useState } from 'react'
import Icon from './components/Icon'

// Shell state shared between the sidebar and pages: pages that draw their own
// header register here so the layout doesn't add a second one.
interface ShellState {
  collapsed: boolean
  mobile: boolean
  openSidebar: () => void
  toggleSidebar: () => void
  ownHeader: number
  setOwnHeader: (fn: (count: number) => number) => void
  toast: (text: string) => void
}

export const ShellContext = createContext<ShellState>({
  collapsed: false,
  mobile: false,
  openSidebar: () => {},
  toggleSidebar: () => {},
  ownHeader: 0,
  setOwnHeader: () => {},
  toast: () => {},
})

export const useShell = () => useContext(ShellContext)

export function useOwnHeader() {
  const { setOwnHeader } = useShell()
  useEffect(() => {
    setOwnHeader((count) => count + 1)
    return () => setOwnHeader((count) => count - 1)
  }, [setOwnHeader])
}

// SidebarToggle shows only when the sidebar is hidden (collapsed or mobile).
export function SidebarToggle() {
  const { collapsed, mobile, openSidebar } = useShell()
  if (!collapsed && !mobile) return null
  return (
    <button className="icon-btn" onClick={openSidebar} aria-label="Show sidebar" title="Show sidebar (⌘B)">
      <Icon name="panel-left" size={18} />
    </button>
  )
}

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => setMatches(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [query])
  return matches
}
