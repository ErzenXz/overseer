// Every keyboard shortcut in one list: the handlers (useShortcuts), the help
// overlay (?), the settings page and the palette all read from here.

export const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform)
export const MOD = isMac ? '⌘' : 'Ctrl'
export const ALT = isMac ? '⌥' : 'Alt'

export interface Shortcut {
  id: string
  group: 'Go to' | 'Sessions' | 'Workspace' | 'Anywhere' | 'Message box'
  label: string
  keys: string[] // shown as separate keys, in order
  then?: boolean // keys are pressed one after the other, not together
}

// "g" then a letter jumps to a page. Letters are mnemonic where they can be.
export const GO: { key: string; to: string; label: string }[] = [
  { key: 'n', to: '/', label: 'New session' },
  { key: 's', to: '/sessions', label: 'All sessions' },
  { key: 'a', to: '/automations', label: 'Automations' },
  { key: 'r', to: '/review', label: 'Review' },
  { key: 'v', to: '/arena', label: 'Agent Arena' },
  { key: 'm', to: '/machines', label: 'Machines' },
  { key: 'o', to: '/mission', label: 'Mission control' },
  { key: 'w', to: '/wrapped', label: 'Agent Wrapped' },
  { key: 'k', to: '/skills', label: 'Skills & plugins' },
  { key: 'p', to: '/projects', label: 'Projects' },
  { key: 'c', to: '/customize', label: 'Customize' },
  { key: 'u', to: '/settings/usage', label: 'Usage & limits' },
  { key: 'i', to: '/settings/shortcuts', label: 'Keyboard shortcuts' },
  { key: ',', to: '/settings', label: 'Settings' },
]

// The workspace panel beside a session: Alt+1 … Alt+6, Alt+0 closes it.
export const PANELS = ['shell', 'preview', 'desktop', 'files', 'changes', 'plan'] as const

export const SHORTCUTS: Shortcut[] = [
  { id: 'palette', group: 'Anywhere', label: 'Search sessions, machines and actions', keys: [MOD, 'K'] },
  { id: 'help', group: 'Anywhere', label: 'Show all shortcuts', keys: ['?'] },
  { id: 'new', group: 'Anywhere', label: 'New session', keys: ['⇧', MOD, 'O'] },
  { id: 'sessions', group: 'Anywhere', label: 'All sessions', keys: [MOD, 'J'] },
  { id: 'settings', group: 'Anywhere', label: 'Settings', keys: [MOD, ','] },
  { id: 'sidebar', group: 'Anywhere', label: 'Show or hide the sessions panel', keys: [MOD, 'B'] },
  { id: 'theme', group: 'Anywhere', label: 'Switch between light and dark', keys: ['⇧', MOD, 'L'] },
  { id: 'focus', group: 'Anywhere', label: 'Jump to the message box', keys: ['/'] },
  ...GO.map((item): Shortcut => ({ id: `go-${item.key}`, group: 'Go to', label: item.label, keys: ['G', item.key === ',' ? ',' : item.key.toUpperCase()], then: true })),
  { id: 'prev', group: 'Sessions', label: 'Previous session', keys: [ALT, '↑'] },
  { id: 'next', group: 'Sessions', label: 'Next session', keys: [ALT, '↓'] },
  { id: 'allow', group: 'Sessions', label: 'Allow what the agent asks (Allow once)', keys: [MOD, '↵'] },
  { id: 'reject', group: 'Sessions', label: 'Reject what the agent asks', keys: ['⇧', MOD, '⌫'] },
  { id: 'stop', group: 'Sessions', label: 'Stop the agent', keys: [MOD, '.'] },
  { id: 'panel', group: 'Workspace', label: 'Show or hide the workspace', keys: ['⇧', MOD, 'P'] },
  ...PANELS.map((tab, index): Shortcut => ({ id: `panel-${tab}`, group: 'Workspace', label: `Open ${tab === 'plan' ? 'the plan' : tab === 'files' ? 'files' : tab === 'changes' ? 'changes' : `the ${tab}`}`, keys: [ALT, String(index + 1)] })),
  { id: 'send', group: 'Message box', label: 'Send', keys: ['↵'] },
  { id: 'newline', group: 'Message box', label: 'New line', keys: ['⇧', '↵'] },
  { id: 'mode', group: 'Message box', label: 'Switch to the next mode', keys: ['⇧', 'Tab'] },
  { id: 'slash', group: 'Message box', label: 'Show commands', keys: ['/'] },
  { id: 'close', group: 'Message box', label: 'Close a menu or dialog', keys: ['Esc'] },
]

export const GROUPS: Shortcut['group'][] = ['Anywhere', 'Go to', 'Sessions', 'Workspace', 'Message box']

// The keys for one shortcut as a single string, like "G S" or "⌘ K", for hints.
export function hintFor(id: string): string | undefined {
  const found = SHORTCUTS.find((item) => item.id === id)
  return found ? found.keys.join(found.then ? ' ' : '') : undefined
}

// Anything the page listens for: the Session page reacts to these.
export type ShortcutAction = { name: 'panel'; tab: (typeof PANELS)[number] | 'toggle' | 'close' } | { name: 'stop' }
export const ACTION_EVENT = 'overseer:shortcut'
export const fireAction = (action: ShortcutAction) => window.dispatchEvent(new CustomEvent(ACTION_EVENT, { detail: action }))
