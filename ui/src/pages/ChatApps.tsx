import { ReactNode, useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api'
import Icon, { type IconName } from '../components/Icon'
import { Switch } from '../components/Menu'
import { useDevices } from '../store'
import {
  chatEventLabels, slackManifest, webhookExample,
  type ChatApp, type ChatAppPatch, type ChatEvent, type ChatKind,
} from '../chatApps'

// Settings → Chat apps: get a message when an agent needs you, and answer it
// from Telegram, Slack or Discord. The hub connects out to each service, so
// none of them needs a public address.

const meta: Record<ChatKind, { icon: IconName; blurb: string }> = {
  telegram: { icon: 'message', blurb: 'Buttons in a chat with your own bot. Easiest to set up.' },
  slack: { icon: 'hash', blurb: 'Buttons in a channel or a direct message, over Slack Socket Mode.' },
  discord: { icon: 'users', blurb: 'Buttons in a channel, through a bot you create.' },
  webhook: { icon: 'link', blurb: 'Posts a JSON event to a URL. For ntfy, Home Assistant, n8n and more.' },
}

const errorText = (cause: unknown) => (cause instanceof ApiError || cause instanceof Error ? cause.message : 'Something went wrong')

function useChatApps() {
  const [apps, setApps] = useState<ChatApp[] | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      setApps(await api.get<ChatApp[]>('/api/chat/apps'))
      setError('')
    } catch (cause) {
      setError(errorText(cause))
    }
  }, [])
  useEffect(() => {
    load()
    const timer = window.setInterval(() => { if (!document.hidden) load() }, 3000)
    return () => window.clearInterval(timer)
  }, [load])
  const replace = useCallback((app: ChatApp) => setApps((current) => current?.map((item) => (item.kind === app.kind ? app : item)) ?? current), [])
  return { apps, error, replace }
}

export default function ChatApps() {
  const { apps, error, replace } = useChatApps()
  return (
    <div className="ca-stack">
      <p className="ca-intro">
        Overseer connects out to these services, so nothing needs a public address. Only the chat you link here can answer, and every answer goes through the same path as the buttons in the app.
      </p>
      {error && !apps && <p className="ca-error" role="alert">{error}</p>}
      {!apps && !error && <p className="ca-muted">Loading…</p>}
      {apps?.map((app) => <AppCard key={app.kind} app={app} onChange={replace} />)}
    </div>
  )
}

function StatusBadge({ app }: { app: ChatApp }) {
  if (!app.configured) return <span className="ca-muted ca-status-text">Not set up</span>
  if (!app.enabled) return <span className="badge">Off</span>
  if (app.status.state === 'connected') {
    if (app.kind !== 'webhook' && !app.linked) return <span className="badge badge-amber">Not linked</span>
    return <span className="badge badge-green">{app.kind === 'webhook' ? 'Ready' : 'Connected'}</span>
  }
  if (app.status.state === 'error') return <span className="badge badge-red">Problem</span>
  return <span className="badge">Connecting…</span>
}

function summary(app: ChatApp) {
  if (!app.configured) return meta[app.kind].blurb
  switch (app.kind) {
    case 'telegram': return app.linked ? `Linked to ${app.chatTitle || 'a chat'}${app.botName ? ` · @${app.botName}` : ''}` : `${app.botName ? `@${app.botName} · ` : ''}Waiting for you to link a chat`
    case 'slack': return `Channel ${app.channel}${app.botName ? ` · ${app.botName}` : ''}`
    case 'discord': return `Channel ${app.channel}${app.botName ? ` · ${app.botName}` : ''}`
    default: return app.webhookUrl
  }
}

function AppCard({ app, onChange }: { app: ChatApp; onChange: (app: ChatApp) => void }) {
  const [open, setOpen] = useState(app.kind === 'telegram')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  const run = async (work: () => Promise<ChatApp | void>, done?: string) => {
    setBusy(true)
    setError('')
    setNote('')
    try {
      const next = await work()
      if (next) onChange(next)
      if (done) setNote(done)
      return true
    } catch (cause) {
      setError(errorText(cause))
      return false
    } finally {
      setBusy(false)
    }
  }
  const save = (patch: ChatAppPatch, done?: string) => run(() => api.put<ChatApp>(`/api/chat/apps/${app.kind}`, patch), done)
  const test = () => run(async () => { await api.post(`/api/chat/apps/${app.kind}/test`) }, 'Test message sent. Check the chat.')
  const remove = () => {
    if (!window.confirm(`Disconnect ${app.name}? Saved tokens are deleted from the hub.`)) return
    run(() => api.del<ChatApp>(`/api/chat/apps/${app.kind}`))
  }
  const shared = { app, busy, save, test, remove, run, onChange }

  return (
    <section className="ca-card" aria-label={app.name}>
      <button type="button" className="ca-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="ca-logo"><Icon name={meta[app.kind].icon} size={19} /></span>
        <span className="ca-head-main">
          <span className="ca-title">{app.name}</span>
          <span className="ca-sub">{summary(app)}</span>
        </span>
        <StatusBadge app={app} />
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={17} className="ca-chevron" />
      </button>
      {open && (
        <div className="ca-body">
          {app.configured && app.enabled && app.status.state === 'error' && (
            <p className="ca-error" role="alert">{app.status.detail || 'Could not connect.'}</p>
          )}
          {app.kind === 'telegram' && <TelegramSetup {...shared} />}
          {app.kind === 'slack' && <SlackSetup {...shared} />}
          {app.kind === 'discord' && <DiscordSetup {...shared} />}
          {app.kind === 'webhook' && <WebhookSetup {...shared} />}
          {app.configured && <Preferences {...shared} />}
          {(error || note) && <p className={error ? 'ca-error' : 'ca-note'} role={error ? 'alert' : 'status'}>{error || note}</p>}
        </div>
      )}
    </section>
  )
}

interface Shared {
  app: ChatApp
  busy: boolean
  save: (patch: ChatAppPatch, done?: string) => Promise<boolean>
  test: () => void
  remove: () => void
  run: (work: () => Promise<ChatApp | void>, done?: string) => Promise<boolean>
  onChange: (app: ChatApp) => void
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="ca-steps">{children}</ol>
}

function Link({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer" className="ca-link">{children}<Icon name="external" size={12} /></a>
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="ca-field">
      <span className="ca-label">{label}</span>
      {children}
      {hint && <span className="ca-hint">{hint}</span>}
    </label>
  )
}

function SecretInput({ value, onChange, saved, placeholder }: { value: string; onChange: (value: string) => void; saved: string; placeholder: string }) {
  return (
    <input
      className="input ca-mono"
      type="password"
      autoComplete="off"
      spellCheck={false}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={saved ? `${saved}  (saved, type to replace)` : placeholder}
    />
  )
}

function Copy({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button type="button" className="btn btn-outline btn-sm" onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); window.setTimeout(() => setDone(false), 1500) }).catch(() => {})}>
      <Icon name={done ? 'check' : 'copy'} size={14} />{done ? 'Copied' : label}
    </button>
  )
}

// --- Telegram ---

function TelegramSetup({ app, busy, save, run, test }: Shared) {
  const [token, setToken] = useState('')
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    if (!app.linkCode) return
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [app.linkCode])
  const left = app.linkExpires ? Math.max(0, app.linkExpires - now) : 0
  const connect = () => run(() => api.post<ChatApp>('/api/chat/apps/telegram/connect'))

  if (!app.configured) {
    return (
      <>
        <Steps>
          <li>In Telegram, open <Link href="https://t.me/BotFather">@BotFather</Link> and send <code>/newbot</code>.</li>
          <li>Choose a name and a username. BotFather replies with a token like <code>123456789:AAH…</code>.</li>
          <li>Paste the token here, then link your chat.</li>
        </Steps>
        <form className="ca-form" onSubmit={(event) => { event.preventDefault(); if (token.trim()) save({ botToken: token.trim() }).then((ok) => ok && setToken('')) }}>
          <Field label="Bot token"><SecretInput value={token} onChange={setToken} saved="" placeholder="123456789:AAH…" /></Field>
          <div className="ca-actions"><button className="btn btn-primary" disabled={busy || !token.trim()}>Save token</button></div>
        </form>
      </>
    )
  }
  return (
    <>
      {app.linked && !app.linkCode ? (
        <div className="ca-linked">
          <span className="ca-linked-text"><Icon name="check" size={16} className="ca-ok" />Linked to <strong>{app.chatTitle || 'your chat'}</strong>. Only this chat can answer.</span>
          <span className="ca-actions">
            <button className="btn btn-outline btn-sm" onClick={test} disabled={busy || !app.enabled}>Send a test message</button>
            <button className="btn btn-ghost btn-sm" onClick={connect} disabled={busy}>Link a different chat</button>
          </span>
        </div>
      ) : app.linkCode ? (
        <div className="ca-code-card">
          <p className="ca-code-title">Send this to your bot in Telegram</p>
          <div className="ca-code-row">
            <code className="ca-code">/start {app.linkCode}</code>
            <Copy text={`/start ${app.linkCode}`} />
          </div>
          <div className="ca-actions">
            {app.linkUrl && <a className="btn btn-primary btn-sm" href={app.linkUrl} target="_blank" rel="noreferrer">Open @{app.botName} in Telegram<Icon name="external" size={13} /></a>}
            <span className="ca-muted">{left > 0 ? `Code expires in ${Math.ceil(left / 60)} min. This page updates when the chat is linked.` : 'The code expired.'}</span>
            {left === 0 && <button className="btn btn-outline btn-sm" onClick={connect} disabled={busy}>New code</button>}
          </div>
        </div>
      ) : (
        <div className="ca-linked">
          <span className="ca-linked-text">Bot <strong>@{app.botName}</strong> is ready. Link the chat that should get the messages.</span>
          <span className="ca-actions"><button className="btn btn-primary btn-sm" onClick={connect} disabled={busy}>Connect</button></span>
        </div>
      )}
      <ReplaceToken label="bot token" placeholder="123456789:AAH…" saved={app.botToken} busy={busy} onSave={(value) => save({ botToken: value }, 'Token replaced. Link your chat again.')} />
    </>
  )
}

function ReplaceToken({ label, placeholder, saved, busy, onSave }: { label: string; placeholder: string; saved: string; busy: boolean; onSave: (value: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  if (!open) return <p className="ca-small">Saved {label}: <code>{saved}</code> <button type="button" className="ca-linkbtn" onClick={() => setOpen(true)}>Replace</button></p>
  return (
    <form className="ca-inline" onSubmit={(event) => { event.preventDefault(); if (value.trim()) onSave(value.trim()).then((ok) => { if (ok) { setValue(''); setOpen(false) } }) }}>
      <SecretInput value={value} onChange={setValue} saved="" placeholder={placeholder} />
      <button className="btn btn-primary btn-sm" disabled={busy || !value.trim()}>Save</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  )
}

// --- Slack ---

function SlackSetup({ app, busy, save, test }: Shared) {
  const [bot, setBot] = useState('')
  const [appToken, setAppToken] = useState('')
  const [channel, setChannel] = useState(app.channel ?? '')
  useEffect(() => setChannel(app.channel ?? ''), [app.channel])
  const submit = async () => {
    const patch: ChatAppPatch = { channel: channel.trim() }
    if (bot.trim()) patch.botToken = bot.trim()
    if (appToken.trim()) patch.appToken = appToken.trim()
    if (await save(patch, app.configured ? 'Saved.' : undefined)) { setBot(''); setAppToken('') }
  }
  return (
    <>
      {!app.configured && (
        <Steps>
          <li>Go to <Link href="https://api.slack.com/apps">api.slack.com/apps</Link>, choose <strong>Create New App</strong>, then <strong>From a manifest</strong>, and paste the manifest below.</li>
          <li>Install the app to your workspace. Under <strong>OAuth &amp; Permissions</strong>, copy the <strong>Bot User OAuth Token</strong> (<code>xoxb-</code>).</li>
          <li>Under <strong>Basic Information → App-Level Tokens</strong>, generate a token with the <code>connections:write</code> scope (<code>xapp-</code>).</li>
          <li>In Slack, invite the bot to a private channel with <code>/invite @Overseer</code>, and paste that channel's ID. To use a direct message instead, paste your own member ID (<code>U…</code>).</li>
        </Steps>
      )}
      <details className="ca-details">
        <summary>Slack app manifest</summary>
        <div className="ca-manifest-bar"><Copy text={slackManifest} label="Copy manifest" /><span className="ca-muted">Socket Mode and interactivity on. Scopes: chat:write, im:write.</span></div>
        <pre className="ca-pre">{slackManifest}</pre>
      </details>
      <form className="ca-form" onSubmit={(event) => { event.preventDefault(); submit() }}>
        <Field label="Bot token"><SecretInput value={bot} onChange={setBot} saved={app.botToken} placeholder="xoxb-…" /></Field>
        <Field label="App-level token"><SecretInput value={appToken} onChange={setAppToken} saved={app.appToken} placeholder="xapp-…" /></Field>
        <Field label="Channel ID" hint="Right-click the channel, Copy link, and take the part starting with C or G. Or your member ID for a direct message.">
          <input className="input ca-mono" value={channel} onChange={(event) => setChannel(event.target.value)} placeholder="C0123ABCDEF" spellCheck={false} />
        </Field>
        <div className="ca-actions">
          <button className="btn btn-primary" disabled={busy || (!app.configured && (!bot.trim() || !appToken.trim() || !channel.trim()))}>{app.configured ? 'Save' : 'Connect Slack'}</button>
          {app.configured && <button type="button" className="btn btn-outline" onClick={test} disabled={busy || !app.enabled}>Send a test message</button>}
        </div>
      </form>
      {app.configured && !app.linked && <p className="ca-warn">No account can answer yet. Send a test message, then press <strong>Link me</strong> in Slack, or add your member ID below.</p>}
    </>
  )
}

// --- Discord ---

function DiscordSetup({ app, busy, save, test }: Shared) {
  const [bot, setBot] = useState('')
  const [channel, setChannel] = useState(app.channel ?? '')
  useEffect(() => setChannel(app.channel ?? ''), [app.channel])
  const submit = async () => {
    const patch: ChatAppPatch = { channel: channel.trim() }
    if (bot.trim()) patch.botToken = bot.trim()
    if (await save(patch, app.configured ? 'Saved.' : undefined)) setBot('')
  }
  return (
    <>
      {!app.configured && (
        <Steps>
          <li>Open the <Link href="https://discord.com/developers/applications">Discord developer portal</Link>, create an application, and add a <strong>Bot</strong>. Press <strong>Reset Token</strong> and copy it.</li>
          <li>Paste the token and your channel ID below. After saving, an invite link appears: add the bot to your server.</li>
          <li>To get the channel ID, turn on Developer Mode (User Settings → Advanced), then right-click the channel and choose <strong>Copy Channel ID</strong>. Use a private channel only you can see.</li>
        </Steps>
      )}
      <form className="ca-form" onSubmit={(event) => { event.preventDefault(); submit() }}>
        <Field label="Bot token"><SecretInput value={bot} onChange={setBot} saved={app.botToken} placeholder="Bot token" /></Field>
        <Field label="Channel ID">
          <input className="input ca-mono" value={channel} onChange={(event) => setChannel(event.target.value)} placeholder="123456789012345678" inputMode="numeric" spellCheck={false} />
        </Field>
        <div className="ca-actions">
          <button className="btn btn-primary" disabled={busy || (!app.configured && (!bot.trim() || !channel.trim()))}>{app.configured ? 'Save' : 'Connect Discord'}</button>
          {app.configured && <button type="button" className="btn btn-outline" onClick={test} disabled={busy || !app.enabled}>Send a test message</button>}
          {app.inviteUrl && <a className="btn btn-outline" href={app.inviteUrl} target="_blank" rel="noreferrer">Invite the bot<Icon name="external" size={13} /></a>}
        </div>
      </form>
      {app.configured && !app.linked && <p className="ca-warn">No account can answer yet. Send a test message, then press <strong>Link me</strong> in Discord, or add your user ID below.</p>}
      <p className="ca-small">Leave “Interactions Endpoint URL” empty in the developer portal: buttons arrive over the bot's connection, no public address needed.</p>
    </>
  )
}

// --- Webhook ---

function WebhookSetup({ app, busy, save, test }: Shared) {
  const [url, setUrl] = useState('')
  const [secret, setSecret] = useState('')
  const submit = async () => {
    const patch: ChatAppPatch = {}
    if (url.trim()) patch.webhookUrl = url.trim()
    if (secret.trim()) patch.webhookSecret = secret.trim()
    if (await save(patch, app.configured ? 'Saved.' : undefined)) { setUrl(''); setSecret('') }
  }
  return (
    <>
      {!app.configured && <p className="ca-small">Overseer sends a JSON <code>POST</code> for each event you pick. It cannot answer approvals; use Telegram, Slack or Discord for that.</p>}
      <form className="ca-form" onSubmit={(event) => { event.preventDefault(); submit() }}>
        <Field label="URL" hint="Treated as a secret: it is saved on the hub and shown shortened.">
          <input className="input ca-mono" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder={app.webhookUrl || 'https://ntfy.sh/your-topic'} spellCheck={false} />
        </Field>
        <Field label="Signing secret (optional)" hint="Adds an X-Overseer-Signature header: sha256 HMAC of the body.">
          <SecretInput value={secret} onChange={setSecret} saved={app.webhookSecret} placeholder="Any string" />
        </Field>
        <div className="ca-actions">
          <button className="btn btn-primary" disabled={busy || (!app.configured && !url.trim()) || (app.configured && !url.trim() && !secret.trim())}>{app.configured ? 'Save' : 'Save webhook'}</button>
          {app.configured && <button type="button" className="btn btn-outline" onClick={test} disabled={busy || !app.enabled}>Send a test event</button>}
          {app.configured && app.webhookSecret && <button type="button" className="btn btn-ghost" onClick={() => save({ clearWebhookSecret: true })} disabled={busy}>Remove secret</button>}
        </div>
      </form>
      <details className="ca-details">
        <summary>Example event</summary>
        <pre className="ca-pre">{webhookExample}</pre>
      </details>
    </>
  )
}

// --- settings shared by every app ---

function Preferences({ app, busy, save, remove }: Shared) {
  const { value: devices } = useDevices()
  const [users, setUsers] = useState(app.allowedUsers.join(', '))
  useEffect(() => setUsers(app.allowedUsers.join(', ')), [app.allowedUsers])
  const toggleEvent = (event: ChatEvent) => save({ events: app.events.includes(event) ? app.events.filter((item) => item !== event) : [...app.events, event] })
  const toggleMachine = (id: string) => save({ machines: app.machines.includes(id) ? app.machines.filter((item) => item !== id) : [...app.machines, id] })
  const idsLabel = app.kind === 'slack' ? 'Slack member IDs (U…)' : app.kind === 'discord' ? 'Discord user IDs' : 'Telegram user IDs'
  const usersChanged = users.split(',').map((item) => item.trim()).filter(Boolean).join(',') !== app.allowedUsers.join(',')
  return (
    <div className="ca-prefs">
      <div className="ca-row">
        <span className="ca-row-main"><span className="ca-row-title">Send messages</span><span className="ca-row-sub">Switch off to pause without losing the setup</span></span>
        <Switch checked={app.enabled} disabled={busy} label={`Send messages to ${app.name}`} onChange={(value) => save({ enabled: value })} />
      </div>
      <div className="ca-row ca-row-top">
        <span className="ca-row-main"><span className="ca-row-title">What to send</span></span>
        <div className="ca-checks">
          {(Object.keys(chatEventLabels) as ChatEvent[]).map((event) => (
            <label key={event} className="ca-check">
              <input type="checkbox" checked={app.events.includes(event)} disabled={busy} onChange={() => toggleEvent(event)} />
              <span><span className="ca-check-title">{chatEventLabels[event].title}</span><span className="ca-check-sub">{chatEventLabels[event].sub}</span></span>
            </label>
          ))}
        </div>
      </div>
      <div className="ca-row ca-row-top">
        <span className="ca-row-main"><span className="ca-row-title">Machines</span><span className="ca-row-sub">Only messages from these machines</span></span>
        <div className="ca-chips" role="group" aria-label="Machines">
          <button type="button" className="ca-chip" aria-pressed={app.machines.length === 0} disabled={busy} onClick={() => save({ machines: [] })}>All machines</button>
          {devices?.map((device) => (
            <button key={device.id} type="button" className="ca-chip" aria-pressed={app.machines.includes(device.id)} disabled={busy} onClick={() => toggleMachine(device.id)}>{device.name}</button>
          ))}
        </div>
      </div>
      {app.canAnswer && (
        <div className="ca-row">
          <span className="ca-row-main"><span className="ca-row-title">Show “Always allow”</span><span className="ca-row-sub">Off keeps standing permissions in the app: only Allow once and Reject</span></span>
          <Switch checked={!app.hideAlways} disabled={busy} label="Show Always allow button" onChange={(value) => save({ hideAlways: !value })} />
        </div>
      )}
      {app.canAnswer && app.kind !== 'telegram' && (
        <div className="ca-row ca-row-top">
          <span className="ca-row-main"><span className="ca-row-title">Who can answer</span><span className="ca-row-sub">{idsLabel}, comma separated. The first person to press “Link me” is added for you.</span></span>
          <form className="ca-inline" onSubmit={(event) => { event.preventDefault(); save({ allowedUsers: users.split(',').map((item) => item.trim()).filter(Boolean) }, 'Saved.') }}>
            <input className="input ca-mono" value={users} onChange={(event) => setUsers(event.target.value)} placeholder="none yet" spellCheck={false} aria-label={idsLabel} />
            <button className="btn btn-outline btn-sm" disabled={busy || !usersChanged}>Save</button>
          </form>
        </div>
      )}
      {app.canAnswer && app.kind === 'telegram' && app.linked && (
        <div className="ca-row">
          <span className="ca-row-main"><span className="ca-row-title">Who can answer</span><span className="ca-row-sub">Telegram user ID{app.allowedUsers.length > 1 ? 's' : ''} {app.allowedUsers.join(', ')} in this chat</span></span>
        </div>
      )}
      <div className="ca-row ca-row-end">
        <button type="button" className="btn btn-ghost btn-sm ca-danger" onClick={remove} disabled={busy}>Disconnect {app.name}</button>
      </div>
    </div>
  )
}
