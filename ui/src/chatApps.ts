// Chat apps (Telegram, Slack, Discord, webhook): the shapes the hub returns.
// Tokens are write-only: the hub sends them back masked.

export type ChatKind = 'telegram' | 'slack' | 'discord' | 'webhook'
export type ChatEvent = 'approval' | 'question' | 'finished' | 'failed'

export interface ChatApp {
  kind: ChatKind
  name: string
  configured: boolean
  enabled: boolean
  linked: boolean
  status: { state: 'off' | 'connecting' | 'connected' | 'error'; detail?: string }
  botToken: string
  appToken: string
  webhookUrl: string
  webhookSecret: string
  botName?: string
  channel?: string
  chatTitle?: string
  allowedUsers: string[]
  events: ChatEvent[]
  machines: string[]
  hideAlways: boolean
  linkCode?: string
  linkUrl?: string
  linkExpires?: number
  inviteUrl?: string
  canAnswer: boolean
}

export interface ChatAppPatch {
  enabled?: boolean
  botToken?: string
  appToken?: string
  channel?: string
  webhookUrl?: string
  webhookSecret?: string
  clearWebhookSecret?: boolean
  allowedUsers?: string[]
  events?: ChatEvent[]
  machines?: string[]
  hideAlways?: boolean
}

export const chatEventLabels: Record<ChatEvent, { title: string; sub: string }> = {
  approval: { title: 'Needs approval', sub: 'An agent wants to run something and waits for you' },
  question: { title: 'Asks a question', sub: 'An agent needs a choice or an answer' },
  finished: { title: 'Finished', sub: 'A session is done, with a short summary' },
  failed: { title: 'Failed', sub: 'A session stopped with an error' },
}

// The Slack app manifest: Socket Mode and interactivity on, two scopes.
export const slackManifest = `{
  "display_information": {
    "name": "Overseer",
    "description": "Answer your coding agents from Slack"
  },
  "features": {
    "app_home": {
      "messages_tab_enabled": true,
      "messages_tab_read_only_enabled": true
    },
    "bot_user": {
      "display_name": "Overseer",
      "always_online": true
    }
  },
  "oauth_config": {
    "scopes": {
      "bot": ["chat:write", "im:write"]
    }
  },
  "settings": {
    "interactivity": { "is_enabled": true },
    "socket_mode_enabled": true,
    "org_deploy_enabled": false,
    "token_rotation_enabled": false
  }
}`

export const webhookExample = `{
  "type": "approval",
  "at": "2026-10-29T14:02:11Z",
  "text": "Studio · Claude Code wants to run the auth tests",
  "session": { "id": "9f2c…", "title": "Fix flaky auth tests" },
  "machine": { "id": "a1b2…", "name": "Studio" },
  "agent": { "id": "claude", "name": "Claude Code" },
  "title": "Run the auth tests",
  "command": "go test ./internal/auth/...",
  "links": { "open": "https://hub.example.com/sessions/9f2c…" }
}`
