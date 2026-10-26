import type { IconName } from './components/Icon'

export interface SettingsSection {
  id: string
  title: string
  description: string
  icon: IconName
  group: 'personal' | 'hub' | 'products' | 'advanced'
}

export const settingsSections: SettingsSection[] = [
  { id: 'preferences', title: 'Preferences', description: 'Theme, your name and session defaults', icon: 'user', group: 'personal' },
  { id: 'shortcuts', title: 'Keyboard shortcuts', description: 'Move around without the mouse', icon: 'keyboard', group: 'personal' },
  { id: 'notifications', title: 'Notifications', description: 'Desktop alerts when agents finish or need you', icon: 'bell', group: 'personal' },
  { id: 'general', title: 'General', description: 'Hub version, software updates and rollback', icon: 'sliders', group: 'hub' },
  { id: 'people', title: 'People', description: 'Who is on this hub, and invite links', icon: 'users', group: 'hub' },
  { id: 'activity', title: 'Activity', description: 'Who did what: sign-ins, approvals, hand-offs and changes', icon: 'history', group: 'hub' },
  { id: 'connections', title: 'Connections', description: 'Git providers and API tokens for tools and agents', icon: 'plug', group: 'hub' },
  { id: 'chat', title: 'Chat apps', description: 'Answer agents from Telegram, Slack and Discord', icon: 'message', group: 'hub' },
  { id: 'machines', title: 'Machines', description: 'Add machines and see what is connected', icon: 'monitor', group: 'hub' },
  { id: 'previews', title: 'Previews', description: 'See dev servers on your machines live, from anywhere', icon: 'globe', group: 'hub' },
  { id: 'shares', title: 'Shared links', description: 'Replays and live links to your sessions', icon: 'link', group: 'hub' },
  { id: 'usage', title: 'Usage & Limits', description: 'Plan limits, tokens and cost across your agents', icon: 'gauge', group: 'hub' },
  { id: 'agents', title: 'Agents', description: 'Coding agent CLIs installed on each machine', icon: 'bot', group: 'products' },
  { id: 'automations', title: 'Schedules', description: 'Recurring and event-driven agent runs', icon: 'automation', group: 'products' },
  { id: 'mcp', title: 'MCP servers', description: 'Tools every agent gets on every machine', icon: 'layers', group: 'products' },
  { id: 'review', title: 'Review', description: 'Pull requests from your GitHub account', icon: 'pull-request', group: 'products' },
  { id: 'presets', title: 'Terminal presets', description: 'Commands for plain terminal sessions', icon: 'terminal', group: 'advanced' },
  { id: 'tokens', title: 'API tokens', description: 'Tokens for the Overseer CLI and MCP clients', icon: 'key', group: 'advanced' },
]

export const settingsGroups: { id: SettingsSection['group']; title: string; description: string }[] = [
  { id: 'hub', title: '', description: '' },
  { id: 'products', title: 'Products', description: 'Configure agents and the tools they get' },
  { id: 'advanced', title: 'Advanced', description: 'Terminals and programmatic access' },
]
