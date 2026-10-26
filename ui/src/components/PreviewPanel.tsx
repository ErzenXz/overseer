import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { forwardCommand, previewHref, usePorts, usePreviewConfig } from '../previews'
import { useShell } from '../shell'
import type { PortInfo } from '../types'
import Icon from './Icon'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from './Menu'

type Viewport = 'fill' | 'tablet' | 'phone'
const widths: Record<Viewport, number | undefined> = { fill: undefined, tablet: 820, phone: 390 }

export interface PreviewRequest { port: number; path: string; nonce: number }

// PreviewPanel shows a dev server running on the session's machine, live,
// through the hub. It finds listening ports by itself, so a server the agent
// starts appears without any setup.
export default function PreviewPanel({ deviceId, deviceName, online, cwd, request }: {
  deviceId: string
  deviceName: string
  online: boolean
  cwd?: string
  request?: PreviewRequest | null
}) {
  const config = usePreviewConfig()
  const { ports, error } = usePorts(deviceId, online)
  const [port, setPort] = useState<number | null>(null)
  const [path, setPath] = useState('/')
  const [draft, setDraft] = useState('/')
  const [viewport, setViewport] = useState<Viewport>('fill')
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(true)
  const { toast } = useShell()

  const [showOther, setShowOther] = useState(false)

  // Only this session's servers by default: ones started in its folder (all of
  // them when there is no session, as on the machine page). A
  // machine runs plenty of other things (tunnels, databases, other projects).
  const web = useMemo(() => (ports ?? []).filter((item) => item.http), [ports])
  const mine = useMemo(() => (cwd ? web.filter((item) => inFolder(item.cwd, cwd)) : web), [web, cwd])
  const others = useMemo(() => web.filter((item) => !mine.includes(item)), [web, mine])
  const quiet = useMemo(() => (ports ?? []).filter((item) => !item.http), [ports])
  const current = ports?.find((item) => item.port === port)

  // Open what was asked for (a localhost link in a reply), else pick the
  // likeliest dev server: one started inside this session's folder.
  useEffect(() => {
    if (!request) return
    setPort(request.port)
    setPath(request.path)
    setDraft(request.path)
  }, [request?.nonce]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (port !== null || !mine.length) return
    setPort(mine[0].port)
  }, [mine, port])

  const src = current?.previewUrl ? previewHref(current.previewUrl, path) : ''
  useEffect(() => { setLoading(true) }, [src, reload])

  const go = (value: string) => { const next = value.trim() || '/'; setPath(next.startsWith('/') ? next : `/${next}`); setDraft(next.startsWith('/') ? next : `/${next}`); setReload((value) => value + 1) }
  const copy = (text: string, done: string) => navigator.clipboard?.writeText(text).then(() => toast(done)).catch(() => {})

  if (!online) return <Empty icon="monitor" title={`${deviceName} is offline`} text="Previews come back when the machine reconnects." />
  if (config && !config.domain) return <SetupHelp deviceName={deviceName} port={port ?? web[0]?.port ?? 5173} />

  const entry = (item: PortInfo, icon: 'globe' | 'plug', close: () => void) => (
    <MenuItem key={item.port} icon={icon} label={`:${item.port}${item.title ? `  ${item.title}` : ''}`} description={describe(item)} checked={item.port === port} onClick={() => { close(); setPort(item.port); go('/') }} />
  )

  return (
    <div className="preview">
      <div className="preview-bar">
        <Menu
          placement="bottom-start"
          width={300}
          trigger={
            <button type="button" className="preview-port" title="Choose a port">
              <span className={`dot ${current?.http ? 'dot-green' : ''}`} />
              <span>{port ? `:${port}` : 'No server'}</span>
              <Icon name="chevron-down" size={12} className="text-faint" />
            </button>
          }
        >
          {(close) => (
            <>
              <MenuLabel>From this session</MenuLabel>
              {mine.length === 0 && <div className="menu-label normal-case">No server started here yet</div>}
              {mine.map((item) => entry(item, 'globe', close))}
              {others.length + quiet.length > 0 && <MenuSeparator />}
              {others.length + quiet.length > 0 && (
                <MenuItem
                  icon={showOther ? 'chevron-up' : 'chevron-down'}
                  label={showOther ? `Hide other servers on ${deviceName}` : `Other servers on ${deviceName}`}
                  end={showOther ? undefined : <span className="text-faint">{others.length + quiet.length}</span>}
                  onClick={() => setShowOther(!showOther)}
                />
              )}
              {showOther && others.map((item) => entry(item, 'globe', close))}
              {showOther && quiet.map((item) => entry(item, 'plug', close))}
            </>
          )}
        </Menu>
        <form className="preview-address" onSubmit={(event) => { event.preventDefault(); go(draft) }}>
          <input aria-label="Path" value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} disabled={!src} />
        </form>
        <button type="button" className="icon-btn icon-btn-sm" aria-label="Reload" title="Reload" disabled={!src} onClick={() => setReload((value) => value + 1)}><Icon name="refresh" size={15} /></button>
        <div className="preview-sizes" role="group" aria-label="Viewport">
          {([['fill', 'monitor', 'Fit panel'], ['tablet', 'tablet', 'Tablet (820px)'], ['phone', 'phone', 'Phone (390px)']] as const).map(([key, icon, label]) => (
            <button key={key} type="button" className="icon-btn icon-btn-sm" aria-pressed={viewport === key} aria-label={label} title={label} onClick={() => setViewport(key)}><Icon name={icon} size={15} /></button>
          ))}
        </div>
        <Menu
          placement="bottom-end"
          width={250}
          trigger={<button type="button" className="icon-btn icon-btn-sm" aria-label="More" disabled={!port}><Icon name="more" size={15} /></button>}
        >
          {(close) => (
            <>
              {src && <MenuItem icon="external" label="Open in new tab" href={src} onClick={close} />}
              {src && <MenuItem icon="link" label="Copy link" description="Works for anyone signed in to this hub" onClick={() => { close(); copy(src, 'Link copied') }} />}
              {port && <MenuItem icon="terminal" label="Copy forward command" description={`Opens it on localhost:${port} on your computer`} onClick={() => { close(); copy(forwardCommand(deviceName, port), 'Command copied') }} />}
            </>
          )}
        </Menu>
      </div>

      <div className={`preview-stage ${viewport !== 'fill' ? 'is-device' : ''}`}>
        {!ports && !error ? (
          <Empty icon="radio" title="Looking for servers…" spinner />
        ) : !port ? (
          <Empty
            icon="radio"
            title="No dev server from this session yet"
            text="Start one in the Shell or ask the agent to, and it appears here on its own."
            spinner
          >
            {others.length > 0 && (
              <div className="preview-others">
                <button type="button" className="text-link text-[13px]" onClick={() => setShowOther(!showOther)}>
                  {showOther ? 'Hide' : 'Show'} {others.length} other {others.length === 1 ? 'server' : 'servers'} on {deviceName}
                </button>
                {showOther && others.slice(0, 8).map((item) => (
                  <button key={item.port} type="button" className="preview-other" onClick={() => { setPort(item.port); go('/') }}>
                    <span className="font-medium">:{item.port}</span>
                    <span className="truncate text-faint">{item.title || describe(item)}</span>
                  </button>
                ))}
              </div>
            )}
          </Empty>
        ) : !src ? (
          <Empty icon="plug" title={`:${port} isn’t answering HTTP`} text="It may still be starting, or it’s not a web server." spinner />
        ) : (
          <div className="preview-frame" style={{ width: widths[viewport] }}>
            {loading && <div className="preview-loading"><span className="spinner" /></div>}
            <iframe
              key={`${src}#${reload}`}
              src={src}
              title={`Preview of port ${port} on ${deviceName}`}
              onLoad={() => setLoading(false)}
              allow="clipboard-read; clipboard-write; fullscreen; geolocation; microphone; camera"
            />
          </div>
        )}
      </div>
    </div>
  )
}

// inFolder reports whether a server runs in the session's folder or one inside
// it (a Vite app in ui/).
function inFolder(serverCwd: string | undefined, sessionCwd: string | undefined) {
  if (!serverCwd || !sessionCwd) return false
  const a = serverCwd.replace(/\/+$/, '')
  const b = sessionCwd.replace(/\/+$/, '')
  if (!a || !b) return false
  return a === b || a.startsWith(`${b}/`)
}

function describe(item: PortInfo) {
  return [item.process, item.cwd?.replace(/^\/(Users|home)\/[^/]+/, '~')].filter(Boolean).join(' · ') || item.address
}

function Empty({ icon, title, text, spinner, children }: { icon: 'radio' | 'plug' | 'monitor'; title: string; text?: string; spinner?: boolean; children?: React.ReactNode }) {
  return (
    <div className="preview-empty">
      <span className="preview-empty-icon">{spinner ? <span className="preview-pulse" /> : null}<Icon name={icon} size={20} /></span>
      <p className="font-medium text-ink">{title}</p>
      {text && <p className="max-w-[320px] text-[13px] text-muted">{text}</p>}
      {children}
    </div>
  )
}

// SetupHelp explains the one-time DNS step when the hub has no preview domain,
// and offers forwarding to localhost, which needs none.
function SetupHelp({ deviceName, port }: { deviceName: string; port: number }) {
  const { toast } = useShell()
  const command = forwardCommand(deviceName, port)
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-[440px] space-y-4">
        <div className="flex items-center gap-2 text-[15px] font-medium text-ink"><Icon name="globe" size={18} />Live previews need a domain</div>
        <p className="text-[13.5px] text-secondary">Each preview gets its own address like <code className="code-inline">5173-{slug(deviceName)}.example.com</code>, so dev servers and hot reload work unchanged.</p>
        <ol className="list-decimal space-y-1.5 pl-5 text-[13.5px] text-secondary">
          <li>In Cloudflare Zero Trust → your tunnel → Public hostnames, add <code className="code-inline">*.example.com</code> pointing at the same service as Overseer.</li>
          <li>Set the domain in <Link className="text-link" to="/settings/previews">Settings → Previews</Link>.</li>
        </ol>
        <div className="card p-3">
          <p className="mb-2 text-[13px] text-muted">No domain? Open it on your own computer instead:</p>
          <button type="button" className="preview-command" onClick={() => { navigator.clipboard?.writeText(command).then(() => toast('Command copied')).catch(() => {}) }}>
            <code>{command}</code><Icon name="copy" size={14} />
          </button>
          <p className="mt-2 text-[12.5px] text-faint">Then visit http://localhost:{port}</p>
        </div>
      </div>
    </div>
  )
}

export const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'machine'
