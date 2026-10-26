import { createPortal } from 'react-dom'
import { KeyboardEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { agentInfo, relativeTime } from '../agents'
import { useDevices, usePref, useThreads } from '../store'
import Icon, { AgentMark, type IconName } from './Icon'
import { hintFor } from '../lib/shortcuts'

interface Item {
  key: string
  group: string
  label: string
  detail?: string
  hint?: string
  icon: ReactNode
  run: () => void
}

export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const navigate = useNavigate()
  const { value: threads } = useThreads()
  const { value: devices } = useDevices()
  const [theme, setTheme] = usePref<'system' | 'light' | 'dark'>('theme', 'system')
  const list = useRef<HTMLDivElement>(null)
  const go = (to: string) => () => { onClose(); navigate(to) }
  const icon = (name: IconName) => <Icon name={name} size={16} />
  // "system" follows the OS, so offer the opposite of what is on screen now.
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  const items = useMemo<Item[]>(() => [
    { key: 'new', group: 'Actions', label: 'New session', hint: hintFor('new'), icon: icon('plus'), run: go('/') },
    { key: 'term', group: 'Actions', label: 'New terminal', icon: icon('terminal'), run: go('/?mode=terminal') },
    { key: 'auto', group: 'Actions', label: 'Create automation', icon: icon('automation'), run: go('/automations?create=1') },
    { key: 'add', group: 'Actions', label: 'Add a machine', icon: icon('user-plus'), run: go('/machines?add=1') },
    { key: 'theme', group: 'Actions', label: dark ? 'Switch to light theme' : 'Switch to dark theme', icon: icon(dark ? 'sun' : 'moon'), run: () => { setTheme(dark ? 'light' : 'dark'); onClose() } },
    ...(threads ?? []).slice(0, 40).map((thread) => ({
      key: `t:${thread.id}`,
      group: 'Sessions',
      label: thread.title,
      detail: thread.deviceName,
      hint: relativeTime(thread.updatedAt),
      icon: <AgentMark agent={thread.agent} size={16} />,
      run: go(`/sessions/${thread.id}`),
    })),
    ...(devices ?? []).flatMap((device) => [
      { key: `d:${device.id}`, group: 'Machines', label: device.name, detail: device.online ? device.os : 'offline', icon: icon('monitor'), run: go(`/machines/${device.id}`) },
      ...(device.online ? [{ key: `v:${device.id}`, group: 'Machines', label: `${device.name} desktop`, detail: 'Remote desktop', icon: icon('presentation'), run: go(`/machines/${device.id}?tab=desktop`) }] : []),
    ]),
    { key: 'p:arena', group: 'Go to', label: 'Agent Arena', detail: 'Race agents on one task', hint: hintFor('go-v'), icon: icon('zap'), run: go('/arena') },
    { key: 'p:skills', group: 'Go to', label: 'Skills & plugins', hint: hintFor('go-k'), icon: icon('sparkles'), run: go('/skills') },
    { key: 'p:machines', group: 'Go to', label: 'Machines', hint: hintFor('go-m'), icon: icon('monitor'), run: go('/machines') },
    { key: 'p:keys', group: 'Actions', label: 'Keyboard shortcuts', hint: hintFor('help'), icon: icon('keyboard'), run: go('/settings/shortcuts') },
    { key: 'p:auto', group: 'Go to', label: 'Automations', hint: hintFor('go-a'), icon: icon('automation'), run: go('/automations') },
    { key: 'p:review', group: 'Go to', label: 'Review', hint: hintFor('go-r'), icon: icon('pull-request'), run: go('/review') },
    { key: 'p:mission', group: 'Go to', label: 'Mission control', hint: hintFor('go-o'), detail: 'Every agent on one screen', icon: icon('radio'), run: go('/mission') },
    { key: 'p:wrapped', group: 'Go to', label: 'Agent Wrapped', hint: hintFor('go-w'), detail: 'Your week with agents', icon: icon('sparkles'), run: go('/wrapped') },
    { key: 'p:projects', group: 'Go to', label: 'Projects', hint: hintFor('go-p'), icon: icon('book'), run: go('/projects') },
    { key: 'p:customize', group: 'Go to', label: 'Customize — MCP servers and agents', hint: hintFor('go-c'), icon: icon('customize'), run: go('/customize') },
    { key: 'p:sessions', group: 'Go to', label: 'All sessions', hint: hintFor('sessions'), icon: icon('list-bullets'), run: go('/sessions') },
    { key: 'p:settings', group: 'Go to', label: 'Settings', hint: hintFor('settings'), icon: icon('settings'), run: go('/settings') },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [threads, devices, theme, dark])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items.filter((item) => item.group !== 'Sessions' || items.indexOf(item) < 13)
    return items.filter((item) => `${item.label} ${item.detail ?? ''} ${item.hint ?? ''} ${agentInfo(item.key.startsWith('t:') ? (threads?.find((t) => `t:${t.id}` === item.key)?.agent ?? '') : '').name}`.toLowerCase().includes(q))
  }, [items, query, threads])

  useEffect(() => setActive(0), [query])
  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') onClose()
    else if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(filtered.length - 1, index + 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(0, index - 1)) }
    else if (event.key === 'Enter') { event.preventDefault(); filtered[active]?.run() }
  }

  const groups: { name: string; items: { item: Item; index: number }[] }[] = []
  filtered.forEach((item, index) => {
    const last = groups[groups.length - 1]
    if (last?.name === item.group) last.items.push({ item, index })
    else groups.push({ name: item.group, items: [{ item, index }] })
  })
  return createPortal(
    <div className="palette-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search">
        <div className="palette-search">
          <label className="palette-input">
            <Icon name="search" size={16} />
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKey} placeholder="Search sessions, machines and actions" aria-label="Search" role="combobox" aria-expanded="true" aria-controls="palette-results" />
          </label>
        </div>
        <div className="palette-list" ref={list} id="palette-results" role="listbox">
          {filtered.length === 0 && <p className="palette-empty">No results for “{query}”</p>}
          {groups.map((group) => (
            <div key={group.name} className="palette-group" role="group" aria-label={group.name}>
              <div className="palette-group-title">{group.name}</div>
              {group.items.map(({ item, index }) => (
                <button key={item.key} role="option" aria-selected={index === active} className="palette-row" data-active={index === active} onMouseMove={() => setActive(index)} onClick={item.run}>
                  <span className="palette-row-icon">{item.icon}</span>
                  <span className="palette-row-text">
                    <span className="palette-title">{item.label}</span>
                    {item.detail && <span className="palette-detail">{item.detail}</span>}
                  </span>
                  {item.hint && <span className="palette-meta">{item.hint}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
