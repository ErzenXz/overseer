import type { IconName } from './components/Icon'

export const settingsSections: { id: string; title: string; description: string; icon: IconName; group: string }[] = [
  { id: 'general', title: 'General', description: 'Software updates and hub preferences', icon: 'settings', group: 'Workspace' },
  { id: 'connections', title: 'Connections', description: 'API tokens for your tools and agents', icon: 'fleet', group: 'Workspace' },
  { id: 'presets', title: 'Session presets', description: 'Commands for starting your agents and terminals', icon: 'terminal', group: 'Agents' },
  { id: 'mcp', title: 'MCP integration', description: 'Connect coding agents to your machines', icon: 'code', group: 'Agents' },
]
