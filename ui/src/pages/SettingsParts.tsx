import { FormEvent, useCallback, useState } from 'react'
import { api, timeAgo } from '../api'
import { usePoll } from '../hooks'
import type { ApiTokenInfo, Preset, PreviewConfig, UpdateStatus } from '../types'
import { setPreviewConfig, usePreviewConfig } from '../previews'
import { Link } from 'react-router-dom'

const cardClass =
  'settings-detail'
const inputClass =
  'rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent'

export function SoftwareUpdates() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    try {
      setStatus(await api.get<UpdateStatus>('/api/updates'))
    } catch {
      /* a restart briefly makes the hub unavailable */
    }
  }, [])
  usePoll(load, 10000)

  const run = async (action: 'check' | 'install' | 'rollback') => {
    setBusy(action)
    setMessage('')
    try {
      if (action === 'rollback' && !confirm(`Restore ${status?.rollbackVersion}? The hub will restart.`)) return
      const next = await api.post<UpdateStatus | { ok: boolean }>(`/api/updates/${action}`)
      if ('currentVersion' in next) setStatus(next)
      if (action !== 'check') {
        setMessage(action === 'install' ? 'Verified update is installing. The hub will restart automatically.' : 'Previous version is being restored. The hub will restart automatically.')
        setTimeout(() => location.reload(), 7000)
      }
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Update action failed')
    } finally {
      setBusy('')
    }
  }

  const setAuto = async (enabled: boolean) => {
    if (!status) return
    setStatus({ ...status, autoUpdate: enabled })
    try {
      await api.patch('/api/updates', { autoUpdate: enabled })
    } catch (error) {
      setStatus({ ...status, autoUpdate: !enabled })
      setMessage(error instanceof Error ? error.message : 'Could not save update preference')
    }
  }

  return (
    <section className={cardClass}>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-medium text-ink">Software updates</h2>
            {status?.updateAvailable && <span className="rounded-full bg-accent/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-accent">Update ready</span>}
          </div>
          <p className="max-w-xl text-sm leading-6 text-muted">
            Stable releases are checksum-verified, tested before replacement, and keep one previous version ready for rollback.
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-3 text-sm text-secondary">
          <span>Auto-update</span>
          <input
            type="checkbox"
            checked={status?.autoUpdate ?? true}
            disabled={!status?.managed}
            onChange={(event) => setAuto(event.target.checked)}
            className="h-4 w-4 accent-accent"
          />
        </label>
      </div>

      <div className="mt-5 grid gap-px overflow-hidden rounded-xl border border-line bg-tint sm:grid-cols-3">
        <div className="bg-canvas/70 p-4"><p className="eyebrow">Installed</p><p className="mt-2 font-mono text-sm text-ink">{status?.currentVersion || 'Loading…'}</p></div>
        <div className="bg-canvas/70 p-4"><p className="eyebrow">Stable release</p><p className="mt-2 font-mono text-sm text-ink">{status?.latestVersion || 'Not checked'}</p></div>
        <div className="bg-canvas/70 p-4"><p className="eyebrow">Device fleet</p><p className="mt-2 text-sm text-ink">{status ? `${status.fleetTotal - status.fleetOutdated}/${status.fleetTotal} current` : 'Loading…'}</p></div>
      </div>

      {!status?.managed && status && (
        <p className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-5 text-warning">
          This is a standalone/debug run. It can check releases, but automatic replacement is enabled after installing Overseer as a background service. You can also run <code className="font-mono">overseer update</code> manually.
        </p>
      )}
      {(message || status?.error) && <p className="mt-4 text-xs leading-5 text-muted">{message || status?.error}</p>}

      <div className="mt-5 flex flex-wrap gap-2">
        <button className="btn-secondary" disabled={!!busy} onClick={() => run('check')}>{busy === 'check' ? 'Checking…' : 'Check now'}</button>
        {status?.updateAvailable && status.managed && <button className="btn-primary" disabled={!!busy} onClick={() => run('install')}>{busy === 'install' ? 'Installing…' : `Install ${status.latestVersion}`}</button>}
        {status?.rollbackVersion && status.managed && <button className="btn-secondary" disabled={!!busy} onClick={() => run('rollback')}>Restore {status.rollbackVersion}</button>}
      </div>
      {status?.lastChecked ? <p className="mt-3 text-[11px] text-muted">Last checked {timeAgo(status.lastChecked)} · managed agents retry automatically and update to the hub release.</p> : null}
    </section>
  )
}

export function ApiTokens() {
  const [tokens, setTokens] = useState<ApiTokenInfo[]>([])
  const [name, setName] = useState('')
  const [fresh, setFresh] = useState('')

  const load = useCallback(async () => {
    try {
      setTokens(await api.get<ApiTokenInfo[]>('/api/tokens'))
    } catch {
      /* transient */
    }
  }, [])
  usePoll(load, 30000)

  const create = async (e: FormEvent) => {
    e.preventDefault()
    const r = await api.post<{ token: string }>('/api/tokens', { name })
    setFresh(r.token)
    setName('')
    load()
  }

  const revoke = async (id: number) => {
    if (!confirm('Revoke this token? Anything using it will lose access.')) return
    await api.del(`/api/tokens/${id}`)
    load()
  }

  return (
    <section className={cardClass}>
      <h2 className="mb-1 text-lg font-medium text-ink">API tokens</h2>
      <p className="mb-4 text-sm text-muted">
        For the <code className="text-accent">overseer fleet</code> CLI and
        the MCP server — this is how your coding agents get hands on the fleet.
      </p>
      <form onSubmit={create} className="mb-4 flex flex-col gap-2 sm:flex-row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="token name, e.g. senior-agent"
          required
          className={`${inputClass} flex-1`}
        />
        <button className="btn-primary">
          Create
        </button>
      </form>
      {fresh && (
        <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
          <p className="mb-2 text-xs text-positive">
            Copy this now — it won't be shown again:
          </p>
          <code className="block overflow-x-auto whitespace-nowrap font-mono text-[13px] text-positive">
            {fresh}
          </code>
        </div>
      )}
      <ul className="divide-y divide-line/60">
        {tokens.map((t) => (
          <li key={t.id} className="flex items-center justify-between py-2">
            <span className="text-sm text-ink">{t.name}</span>
            <span className="flex items-center gap-4">
              <span className="text-xs text-muted">
                created {timeAgo(t.createdAt)}
              </span>
              <button
                onClick={() => revoke(t.id)}
                className="text-xs text-muted hover:text-danger"
              >
                Revoke
              </button>
            </span>
          </li>
        ))}
        {tokens.length === 0 && (
          <li className="py-2 text-sm text-muted">No tokens yet.</li>
        )}
      </ul>
    </section>
  )
}

export function Presets() {
  const [presets, setPresets] = useState<Preset[]>([])
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')

  const load = useCallback(async () => {
    try {
      setPresets(await api.get<Preset[]>('/api/presets'))
    } catch {
      /* transient */
    }
  }, [])
  usePoll(load, 30000)

  const create = async (e: FormEvent) => {
    e.preventDefault()
    await api.post('/api/presets', { name, command })
    setName('')
    setCommand('')
    load()
  }

  const remove = async (id: number) => {
    await api.del(`/api/presets/${id}`)
    load()
  }

  return (
    <section className={cardClass}>
      <h2 className="mb-1 text-lg font-medium text-ink">
        Launch presets
      </h2>
      <p className="mb-4 text-sm text-muted">
        One-click commands in the Launch dialog. Add your favorite agents.
      </p>
      <form onSubmit={create} className="mb-4 flex flex-col gap-2 sm:flex-row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="name, e.g. Aider"
          required
          className={`${inputClass} w-full sm:w-40`}
        />
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="command, e.g. aider"
          className={`${inputClass} flex-1 font-mono`}
        />
        <button className="btn-primary">
          Add
        </button>
      </form>
      <ul className="divide-y divide-line/60">
        {presets.map((p) => (
          <li key={p.id} className="flex items-center justify-between py-2">
            <span className="text-sm text-ink">{p.name}</span>
            <span className="flex items-center gap-4">
              <code className="font-mono text-xs text-muted">
                {p.command || '(shell)'}
              </code>
              <button
                onClick={() => remove(p.id)}
                className="text-xs text-muted hover:text-danger"
              >
                Delete
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function McpHelp() {
  const origin = location.origin
  return (
    <section className={cardClass}>
      <h2 className="mb-1 text-lg font-medium text-ink">
        Give an agent control of your fleet
      </h2>
      <p className="mb-4 text-sm text-muted">
        Run a coding agent on any machine with the{' '}
        <code className="text-accent">overseer</code> binary and an API token,
        and it can see every device, launch worker agents, read their output,
        and steer them. For Claude Code:
      </p>
      <pre className="overflow-x-auto rounded-lg border border-line bg-canvas p-4 font-mono text-[13px] leading-relaxed text-secondary">
        {`overseer fleet login --hub ${origin} --token YOUR_API_TOKEN
claude mcp add overseer -- overseer mcp`}
      </pre>
      <p className="mt-3 text-xs text-muted">
        Then ask it things like “launch claude in ~/projects/api on the
        homelab box and have it fix the failing tests.”
      </p>

      <div className="mt-6 border-t border-line pt-5">
        <h3 className="mb-1 text-sm font-medium text-ink">
          Remote MCP (ChatGPT, Claude, Cursor)
        </h3>
        <p className="mb-3 text-sm text-muted">
          Any client that supports remote MCP connectors can drive your fleet
          over HTTPS. Add this endpoint and paste an API token as the Bearer
          credential:
        </p>
        <pre className="overflow-x-auto rounded-lg border border-line bg-canvas p-4 font-mono text-[13px] leading-relaxed text-secondary">
          {`${origin.replace(/^http:/, 'https:')}/mcp`}
        </pre>
        <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/8 p-3 text-xs text-warning">
          ⚠️ This is a remote shell — the tools run commands and write files on
          your devices. Only expose it over HTTPS ({''}
          <code className="font-mono">--tls-domain</code> or a TLS proxy), and
          treat the API token like an SSH key. Revoke it in{' '}
          <Link to="/settings/tokens" className="underline">Connections</Link> if it leaks.
        </div>
      </div>
    </section>
  )
}

// Previews: the domain dev-server previews live under, with the one-time
// Cloudflare Tunnel step that makes them reachable.
export function PreviewSettings() {
  const config = usePreviewConfig()
  const [domain, setDomain] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const value = domain ?? (config?.source === 'setting' ? config.domain : '')
  const effective = config?.domain || ''
  const save = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      setPreviewConfig(await api.put<PreviewConfig>('/api/previews/config', { domain: value.trim() }))
      setDomain(null)
      setMessage('Saved')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }
  const example = `5173-erzen-dev.${effective || 'example.com'}`
  return (
    <div className="space-y-5">
      <section className={cardClass}>
        <form onSubmit={save} className="space-y-3">
          <label className="block text-sm font-medium text-ink" htmlFor="preview-domain">Preview domain</label>
          <div className="flex gap-2">
            <input id="preview-domain" className={`${inputClass} flex-1 font-mono`} placeholder={config?.source === 'derived' ? `${config.domain} (from the hub address)` : 'example.com'} value={value} onChange={(event) => setDomain(event.target.value)} spellCheck={false} disabled={config?.source === 'flag'} />
            <button className="btn btn-primary" disabled={busy || config?.source === 'flag'}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
          <p className="text-[13px] text-muted">
            {config?.source === 'flag' ? <>Set by <code className="code-inline">--preview-domain</code> when the hub started.</>
              : effective ? <>Previews open at <code className="code-inline">https://{example}</code>. Leave empty to use the hub’s own domain.</>
                : <>No domain yet. Previews are off until you set one; <code className="code-inline">overseer forward</code> still works.</>}
          </p>
          {message && <p className="text-[13px] text-muted">{message}</p>}
        </form>
      </section>
      <section className={cardClass}>
        <h3 className="mb-2 text-sm font-medium text-ink">Cloudflare Tunnel</h3>
        <ol className="list-decimal space-y-2 pl-5 text-[13.5px] text-secondary">
          <li>Open Cloudflare Zero Trust → Networks → Tunnels → your Overseer tunnel → Public hostnames.</li>
          <li>Add a hostname with subdomain <code className="code-inline">*</code> on <code className="code-inline">{effective || 'example.com'}</code>, pointing at the same service as Overseer (for example <code className="code-inline">http://localhost:4200</code>).</li>
          <li>Start a dev server on any machine and open a session’s Preview tab.</li>
        </ol>
        <p className="mt-3 text-[13px] text-muted">Previews stay private: each one asks this hub who you are first. Other records on the domain keep working; the wildcard only catches names that don’t exist.</p>
      </section>
      <section className={cardClass}>
        <h3 className="mb-2 text-sm font-medium text-ink">Open a port on your own computer</h3>
        <p className="mb-2 text-[13.5px] text-secondary">No domain needed. With the Overseer CLI signed in, this serves a machine’s port on your localhost:</p>
        <pre className="preview-command"><code>overseer forward erzen-dev 5173</code></pre>
      </section>
    </div>
  )
}
