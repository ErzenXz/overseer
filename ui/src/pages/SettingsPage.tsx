import { FormEvent, useCallback, useState } from 'react'
import { api, timeAgo } from '../api'
import { usePoll } from '../hooks'
import type { ApiTokenInfo, Preset } from '../types'

export default function SettingsPage() {
  return (
    <div className="max-w-3xl p-8">
      <h1 className="mb-8 text-2xl font-semibold text-slate-100">Settings</h1>
      <ApiTokens />
      <Presets />
      <McpHelp />
    </div>
  )
}

const cardClass =
  'mb-8 rounded-xl border border-slate-800 bg-slate-900/40 p-6'
const inputClass =
  'rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500'

function ApiTokens() {
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
      <h2 className="mb-1 text-lg font-medium text-slate-100">API tokens</h2>
      <p className="mb-4 text-sm text-slate-400">
        For the <code className="text-sky-300">overseer fleet</code> CLI and
        the MCP server — this is how your coding agents get hands on the fleet.
      </p>
      <form onSubmit={create} className="mb-4 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="token name, e.g. senior-agent"
          required
          className={`${inputClass} flex-1`}
        />
        <button className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400">
          Create
        </button>
      </form>
      {fresh && (
        <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
          <p className="mb-2 text-xs text-emerald-300">
            Copy this now — it won't be shown again:
          </p>
          <code className="block overflow-x-auto whitespace-nowrap font-mono text-[13px] text-emerald-200">
            {fresh}
          </code>
        </div>
      )}
      <ul className="divide-y divide-slate-800/60">
        {tokens.map((t) => (
          <li key={t.id} className="flex items-center justify-between py-2">
            <span className="text-sm text-slate-200">{t.name}</span>
            <span className="flex items-center gap-4">
              <span className="text-xs text-slate-500">
                created {timeAgo(t.createdAt)}
              </span>
              <button
                onClick={() => revoke(t.id)}
                className="text-xs text-slate-500 hover:text-rose-400"
              >
                Revoke
              </button>
            </span>
          </li>
        ))}
        {tokens.length === 0 && (
          <li className="py-2 text-sm text-slate-500">No tokens yet.</li>
        )}
      </ul>
    </section>
  )
}

function Presets() {
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
      <h2 className="mb-1 text-lg font-medium text-slate-100">
        Launch presets
      </h2>
      <p className="mb-4 text-sm text-slate-400">
        One-click commands in the Launch dialog. Add your favorite agents.
      </p>
      <form onSubmit={create} className="mb-4 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="name, e.g. Aider"
          required
          className={`${inputClass} w-40`}
        />
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="command, e.g. aider"
          className={`${inputClass} flex-1 font-mono`}
        />
        <button className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400">
          Add
        </button>
      </form>
      <ul className="divide-y divide-slate-800/60">
        {presets.map((p) => (
          <li key={p.id} className="flex items-center justify-between py-2">
            <span className="text-sm text-slate-200">{p.name}</span>
            <span className="flex items-center gap-4">
              <code className="font-mono text-xs text-slate-400">
                {p.command || '(shell)'}
              </code>
              <button
                onClick={() => remove(p.id)}
                className="text-xs text-slate-500 hover:text-rose-400"
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

function McpHelp() {
  const origin = location.origin
  return (
    <section className={cardClass}>
      <h2 className="mb-1 text-lg font-medium text-slate-100">
        Give an agent control of your fleet
      </h2>
      <p className="mb-4 text-sm text-slate-400">
        Run a coding agent on any machine with the{' '}
        <code className="text-sky-300">overseer</code> binary and an API token,
        and it can see every device, launch worker agents, read their output,
        and steer them. For Claude Code:
      </p>
      <pre className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-950 p-4 font-mono text-[13px] leading-relaxed text-slate-300">
        {`overseer fleet login --hub ${origin} --token YOUR_API_TOKEN
claude mcp add overseer -- overseer mcp`}
      </pre>
      <p className="mt-3 text-xs text-slate-500">
        Then ask it things like “launch claude in ~/projects/api on the
        homelab box and have it fix the failing tests.”
      </p>
    </section>
  )
}
