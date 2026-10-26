// DEV-ONLY MOCK (see mock.ts): Settings → Chat apps with Telegram connected,
// so the page can be screenshotted without a hub.

import type { ChatApp, ChatAppPatch, ChatKind } from './chatApps'

const base = (kind: ChatKind, name: string): ChatApp => ({
  kind, name, configured: false, enabled: false, linked: false, status: { state: 'off' },
  botToken: '', appToken: '', webhookUrl: '', webhookSecret: '', allowedUsers: [], events: [], machines: [], hideAlways: false, canAnswer: kind !== 'webhook',
})

let apps: ChatApp[] = [
  { ...base('telegram', 'Telegram'), configured: true, enabled: true, linked: true, status: { state: 'connected' }, botToken: '8123••••••••k2Qw', botName: 'overseer_studio_bot',
    chatTitle: 'Erzen', allowedUsers: ['482910337'], events: ['approval', 'question', 'finished'], machines: [] },
  base('slack', 'Slack'),
  base('discord', 'Discord'),
  base('webhook', 'Webhook'),
]

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

export function chatRoute(method: string, path: string, body: Record<string, unknown>): Response | null {
  if (method === 'GET' && path === '/api/chat/apps') return json(apps)
  const match = path.match(/^\/api\/chat\/apps\/(telegram|slack|discord|webhook)(\/connect|\/test)?$/)
  if (!match) return null
  const kind = match[1] as ChatKind
  const current = apps.find((app) => app.kind === kind)!
  const update = (patch: Partial<ChatApp>) => {
    const next = { ...current, ...patch }
    apps = apps.map((app) => (app.kind === kind ? next : app))
    return next
  }
  if (match[2] === '/test') return current.configured ? json({ ok: true }) : json({ error: 'Finish the setup first.' }, 409)
  if (match[2] === '/connect') {
    if (!current.configured) return json({ error: 'Save the bot token first.' }, 409)
    return json(update({ linkCode: 'k7m2xq9p', linkUrl: 'https://t.me/overseer_studio_bot?start=k7m2xq9p', linkExpires: Math.floor(Date.now() / 1000) + 600 }))
  }
  if (method === 'DELETE') return json(update(base(kind, current.name)))
  if (method === 'PUT') {
    const patch = body as ChatAppPatch
    const next: Partial<ChatApp> = {}
    if (patch.botToken) {
      next.botToken = `${patch.botToken.slice(0, 4)}••••••••${patch.botToken.slice(-4)}`
      next.botName = kind === 'telegram' ? 'overseer_demo_bot' : 'Overseer'
      next.configured = kind !== 'slack' || !!current.appToken || !!patch.appToken
    }
    if (patch.appToken) { next.appToken = `${patch.appToken.slice(0, 4)}••••••••${patch.appToken.slice(-4)}`; next.configured = !!(current.botToken || patch.botToken) }
    if (patch.channel !== undefined) next.channel = patch.channel
    if (patch.webhookUrl) { next.webhookUrl = `${new URL(patch.webhookUrl).origin}/••••••••`; next.configured = true }
    if (patch.webhookSecret) next.webhookSecret = '••••••••'
    if (patch.clearWebhookSecret) next.webhookSecret = ''
    if (patch.allowedUsers) { next.allowedUsers = patch.allowedUsers; next.linked = patch.allowedUsers.length > 0 }
    if (patch.events) next.events = patch.events
    if (patch.machines) next.machines = patch.machines
    if (patch.hideAlways !== undefined) next.hideAlways = patch.hideAlways
    if (patch.enabled !== undefined) next.enabled = patch.enabled
    const configured = next.configured ?? current.configured
    if (configured && !current.configured && patch.enabled === undefined) { next.enabled = true; next.events = ['approval', 'question'] }
    const enabled = next.enabled ?? current.enabled
    next.status = enabled && configured ? { state: 'connected' } : { state: 'off' }
    return json(update(next))
  }
  return null
}
