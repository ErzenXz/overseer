import { cloneElement, ReactElement, ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import Icon, { type IconName } from './Icon'

export type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end' | 'right-start' | 'left-start'

// Submenu panels float on their own; clicks and scrolls inside one belong to
// the menu that opened it.
const inMenuLayer = (target: EventTarget | null) => target instanceof Element && !!target.closest('[data-menu-layer]')

// Menu owns its open state and closes on outside click, Escape, or when an
// item calls close(). The trigger must be a single element that accepts
// onClick and aria-expanded. The panel renders in a fixed layer on <body>, so
// scrolling containers (like the sidebar) can never clip it.
export function Menu({
  trigger,
  children,
  placement = 'bottom-start',
  className = '',
  width,
  onOpenChange,
}: {
  trigger: ReactElement<{ onClick?: (event: React.MouseEvent) => void; 'aria-expanded'?: boolean; 'aria-haspopup'?: string }>
  children: ReactNode | ((close: () => void) => ReactNode)
  placement?: Placement
  className?: string
  width?: number
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: 'hidden' })
  const anchor = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const change = useRef(onOpenChange)
  change.current = onOpenChange

  // Position against the trigger, flipping or scrolling to stay on screen.
  const place = useCallback(() => {
    const a = anchor.current?.getBoundingClientRect()
    const node = panel.current
    if (!a || !node) return
    const margin = 8
    const gap = 6
    const vw = window.innerWidth
    const vh = window.innerHeight
    const w = node.offsetWidth
    const h = node.scrollHeight
    let next = placement
    const above = a.top - gap - margin
    const below = vh - a.bottom - gap - margin
    if (next.startsWith('top') && h > above && below > above) next = next.replace('top', 'bottom') as Placement
    else if (next.startsWith('bottom') && h > below && above > below) next = next.replace('bottom', 'top') as Placement
    const css: React.CSSProperties = {}
    let left: number
    let top: number
    if (next === 'right-start' || next === 'left-start') {
      left = next === 'right-start' ? a.right + gap : a.left - gap - w
      if (left + w > vw - margin) left = a.left - gap - w
      if (left < margin) left = Math.min(vw - margin - w, a.right + gap)
      top = Math.min(a.top - 7, vh - margin - h)
      top = Math.max(margin, top)
      if (h > vh - margin * 2) css.maxHeight = vh - margin * 2
    } else {
      left = next.endsWith('end') ? a.right - w : a.left
      left = Math.max(margin, Math.min(left, vw - margin - w))
      const room = next.startsWith('top') ? above : below
      const height = Math.min(h, Math.max(160, room))
      if (h > room) css.maxHeight = Math.max(160, room)
      top = next.startsWith('top') ? a.top - gap - height : a.bottom + gap
    }
    setStyle({ ...css, left, top, overflowY: css.maxHeight ? 'auto' : undefined })
  }, [placement])

  useLayoutEffect(() => {
    if (!open) { setStyle({ visibility: 'hidden' }); return }
    place()
    // Content can grow after opening (a folder list loading); stay anchored.
    const observer = new ResizeObserver(() => place())
    if (panel.current) observer.observe(panel.current)
    return () => observer.disconnect()
  }, [open, place])

  useEffect(() => {
    change.current?.(open)
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (!anchor.current?.contains(target) && !panel.current?.contains(target) && !inMenuLayer(target)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const items = Array.from(panel.current?.querySelectorAll<HTMLElement>(':scope > .menu-item:not(:disabled), :scope > * > .menu-item:not(:disabled)') ?? [])
        if (!items.length) return
        event.preventDefault()
        const index = items.indexOf(document.activeElement as HTMLElement)
        const next = event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length
        items[next]?.focus()
      }
    }
    // Scrolling anything but the menu itself would detach it from its trigger.
    const onScroll = (event: Event) => { if (!panel.current?.contains(event.target as Node) && !inMenuLayer(event.target)) setOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', place)
    }
  }, [open, place])

  const close = () => setOpen(false)
  return (
    <span ref={anchor} className="menu-anchor">
      {cloneElement(trigger, {
        'aria-expanded': open,
        'aria-haspopup': 'menu',
        onClick: (event: React.MouseEvent) => {
          trigger.props.onClick?.(event)
          setOpen((value) => !value)
        },
      })}
      {open && createPortal(
        <div ref={panel} className={`popover popover-fixed ${className}`} role="menu" style={{ width, ...style }} onClick={(event) => event.stopPropagation()}>
          {typeof children === 'function' ? children(close) : children}
        </div>,
        document.body,
      )}
    </span>
  )
}

interface ItemProps {
  icon?: IconName | ReactNode
  label: ReactNode
  description?: ReactNode
  end?: ReactNode
  checked?: boolean
  chevron?: boolean
  danger?: boolean
  disabled?: boolean
  onClick?: () => void
  to?: string
  href?: string
}

function iconNode(icon: ItemProps['icon']) {
  if (!icon) return null
  return typeof icon === 'string' ? <Icon name={icon as IconName} size={18} /> : icon
}

export function MenuItem({ icon, label, description, end, checked, chevron, danger, disabled, onClick, to, href }: ItemProps) {
  const className = `menu-item ${danger ? 'menu-item-danger' : ''} ${description ? 'menu-item-two' : ''}`
  const body = (
    <>
      {iconNode(icon)}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {description && <span className="menu-item-desc">{description}</span>}
      </span>
      {(end || checked || chevron) && (
        <span className="menu-item-end">
          {end}
          {checked && <Icon name="check" size={16} className="text-ink" />}
          {chevron && <Icon name="chevron" size={14} />}
        </span>
      )}
    </>
  )
  if (to) return <Link to={to} className={className} role="menuitem" onClick={onClick}>{body}</Link>
  if (href) return <a href={href} target="_blank" rel="noreferrer" className={className} role="menuitem" onClick={onClick}>{body}</a>
  return <button type="button" className={className} role="menuitem" disabled={disabled} onClick={onClick}>{body}</button>
}

// Submenu opens to the side on hover or click and stays open while the
// pointer is inside either panel.
// Submenu opens beside its row on hover, click or →. Its panel lives in the
// floating layer like Menu's, so a scrolling menu or modal can't clip it.
export function Submenu({ icon, label, end, children, width = 220 }: { icon?: ItemProps['icon']; label: ReactNode; end?: ReactNode; children: ReactNode; placement?: Placement; width?: number }) {
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: 'hidden' })
  const row = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const timer = useRef<number>()
  const enter = () => { window.clearTimeout(timer.current); setOpen(true) }
  const leave = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setOpen(false), 160) }
  useEffect(() => () => window.clearTimeout(timer.current), [])

  useLayoutEffect(() => {
    if (!open) { setStyle({ visibility: 'hidden' }); return }
    const place = () => {
      const a = row.current?.getBoundingClientRect()
      const node = panel.current
      if (!a || !node) return
      const margin = 8
      const w = node.offsetWidth
      const h = node.scrollHeight
      let left = a.right + 4
      if (left + w > window.innerWidth - margin) left = Math.max(margin, a.left - w - 4)
      const room = window.innerHeight - margin * 2
      const height = Math.min(h, room)
      const top = Math.max(margin, Math.min(a.top - 7, window.innerHeight - margin - height))
      setStyle({ left, top, maxHeight: h > room ? room : undefined, overflowY: h > room ? 'auto' : undefined })
    }
    place()
    const observer = new ResizeObserver(place)
    if (panel.current) observer.observe(panel.current)
    return () => observer.disconnect()
  }, [open])

  return (
    <div ref={row} className="relative" onMouseEnter={enter} onMouseLeave={leave}>
      <button
        type="button"
        className="menu-item"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => { if (event.key === 'ArrowRight') { event.preventDefault(); setOpen(true) } }}
      >
        {iconNode(icon)}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="menu-item-end">{end}<Icon name="chevron" size={14} /></span>
      </button>
      {open && createPortal(
        <div ref={panel} data-menu-layer="" className="popover popover-fixed" role="menu" style={{ width, ...style }} onMouseEnter={enter} onMouseLeave={leave} onClick={(event) => event.stopPropagation()}>
          {children}
        </div>,
        document.body,
      )}
    </div>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="menu-label">{children}</div>
}

export function MenuSeparator() {
  return <div className="menu-sep" role="separator" />
}

// SwitchMark is the visual-only switch for rows that are themselves buttons.
export function SwitchMark({ checked }: { checked: boolean }) {
  return <span className="switch" aria-checked={checked} aria-hidden="true" />
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" disabled={disabled} onClick={(event) => { event.stopPropagation(); onChange(!checked) }} />
}

// ContextMenu is a Menu panel opened at a point (right-click). It closes on
// outside click, Escape, scroll or resize, like Menu.
export function ContextMenu({ at, onClose, children, width = 250 }: { at: { x: number; y: number }; onClose: () => void; children: (close: () => void) => ReactNode; width?: number }) {
  const panel = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; visibility?: 'hidden' }>({ left: at.x, top: at.y, visibility: 'hidden' })
  const close = useRef(onClose)
  close.current = onClose
  useLayoutEffect(() => {
    const node = panel.current
    if (!node) return
    const margin = 8
    const left = Math.max(margin, Math.min(at.x, window.innerWidth - node.offsetWidth - margin))
    const top = at.y + node.offsetHeight > window.innerHeight - margin ? Math.max(margin, at.y - node.offsetHeight) : at.y
    setPos({ left, top })
  }, [at.x, at.y])
  useEffect(() => {
    const onDown = (event: MouseEvent) => { if (!panel.current?.contains(event.target as Node) && !inMenuLayer(event.target)) close.current() }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close.current() } }
    const onScroll = (event: Event) => { if (!panel.current?.contains(event.target as Node) && !inMenuLayer(event.target)) close.current() }
    const onResize = () => close.current()
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [])
  return createPortal(
    <div ref={panel} className="popover popover-fixed" role="menu" style={{ width, ...pos }} onContextMenu={(event) => event.preventDefault()}>
      {children(() => close.current())}
    </div>,
    document.body,
  )
}
