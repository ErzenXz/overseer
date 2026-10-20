import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { shortTime } from '../agents'
import Icon from '../components/Icon'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../components/Menu'
import { SidebarToggle, useOwnHeader, useShell } from '../shell'
import { createThread, useDevices, usePref } from '../store'
import type { ExecResult } from '../types'

interface PullRequest {
  number: number
  title: string
  url: string
  updatedAt: string
  isDraft: boolean
  state: string
  author: { login: string }
  repository: { nameWithOwner: string }
  commentsCount?: number
}

interface PrStats { additions: number; deletions: number; ci: 'pass' | 'fail' | 'pending' | '' }

const fields = 'number,title,url,updatedAt,isDraft,state,author,repository,commentsCount'

// Review uses the GitHub CLI on one of your machines, so it sees exactly what
// `gh` is signed in to there and nothing is stored on the hub.
export default function ReviewPage() {
  useOwnHeader()
  const { value: devices } = useDevices()
  const online = (devices ?? []).filter((device) => device.online)
  const [deviceId, setDeviceId] = usePref('review.device', '')
  const device = online.find((item) => item.id === deviceId) ?? online.find((item) => item.isHub) ?? online[0]
  const [mine, setMine] = useState<PullRequest[] | null>(null)
  const [requested, setRequested] = useState<PullRequest[]>([])
  const [stats, setStats] = useState<Record<string, PrStats>>({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [repo, setRepo] = useState('')
  const [url, setUrl] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const navigate = useNavigate()
  const { toast } = useShell()

  const exec = useCallback(async (command: string) => {
    if (!device) throw new Error('No machine online')
    const result = await api.post<ExecResult>(`/api/devices/${device.id}/exec`, { command, timeoutSec: 60 })
    if (result.exitCode !== 0) throw new Error((result.stderr || result.stdout).trim().split('\n').slice(-1)[0] || `gh exited ${result.exitCode}`)
    return result.stdout
  }, [device])

  const load = useCallback(async () => {
    if (!device) return
    setLoading(true)
    setError('')
    try {
      const [authored, review] = await Promise.all([
        exec(`gh search prs --author=@me --state=open --limit 50 --json ${fields}`),
        exec(`gh search prs --review-requested=@me --state=open --limit 30 --json ${fields}`).catch(() => '[]'),
      ])
      const own = JSON.parse(authored || '[]') as PullRequest[]
      const asked = (JSON.parse(review || '[]') as PullRequest[]).filter((pr) => !own.some((item) => item.url === pr.url))
      setMine(own)
      setRequested(asked)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not load pull requests'
      setError(/not found|command not found|127/.test(message) ? `The GitHub CLI isn’t installed on ${device.name}.` : /auth|login/i.test(message) ? `gh isn’t signed in on ${device.name}. Run “gh auth login” there.` : message)
      setMine((current) => current ?? [])
    } finally {
      setLoading(false)
    }
  }, [device, exec])

  useEffect(() => { load() }, [device?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Diff size and CI state come from one `gh pr view` per row, a few at a time.
  useEffect(() => {
    const all = [...requested, ...(mine ?? [])].filter((pr) => !stats[pr.url]).slice(0, 24)
    if (!all.length || !device) return
    let alive = true
    const queue = [...all]
    const worker = async () => {
      while (alive && queue.length) {
        const pr = queue.shift()!
        try {
          const out = JSON.parse(await exec(`gh pr view ${pr.number} -R ${pr.repository.nameWithOwner} --json additions,deletions,statusCheckRollup`)) as { additions: number; deletions: number; statusCheckRollup?: { conclusion?: string; status?: string }[] }
          const checks = out.statusCheckRollup ?? []
          const ci = checks.some((check) => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED'].includes(check.conclusion ?? '')) ? 'fail' : checks.some((check) => check.status && check.status !== 'COMPLETED') ? 'pending' : checks.length ? 'pass' : ''
          if (alive) setStats((current) => ({ ...current, [pr.url]: { additions: out.additions, deletions: out.deletions, ci } }))
        } catch {
          if (alive) setStats((current) => ({ ...current, [pr.url]: { additions: 0, deletions: 0, ci: '' } }))
        }
      }
    }
    Promise.all([worker(), worker(), worker(), worker()])
    return () => { alive = false }
  }, [mine, requested]) // eslint-disable-line react-hooks/exhaustive-deps

  const repos = useMemo(() => [...new Set([...requested, ...(mine ?? [])].map((pr) => pr.repository.nameWithOwner))].sort(), [mine, requested])
  const visible = (list: PullRequest[]) => list.filter((pr) => !repo || pr.repository.nameWithOwner === repo)

  const startReview = async (prUrl: string, mode: 'review' | 'fix') => {
    if (!device) return
    const prompt = mode === 'review'
      ? `Review the pull request ${prUrl}. Check it out with \`gh pr checkout\` in a temporary clone, read the diff carefully, run the tests, and give me a prioritised list of real bugs and risky changes with file:line references. Do not push anything.`
      : `The pull request ${prUrl} has failing CI. Check out its branch with \`gh pr checkout\`, reproduce the failing checks locally, fix them, and push to the same branch. Summarise the fix.`
    const thread = await createThread({ deviceId: device.id, agent: 'claude', cwd: '~', prompt, access: mode === 'review' ? 'ask' : 'auto', title: `${mode === 'review' ? 'Review' : 'Fix CI on'} ${prUrl.replace(/^https?:\/\/(www\.)?github\.com\//, '')}` })
    navigate(`/sessions/${thread.id}`)
  }

  const goTo = (event: FormEvent) => {
    event.preventDefault()
    const value = url.trim()
    if (!/^https?:\/\/\S+\/(pull|merge_requests)\/\d+/.test(value) && !/github\.com\/.+\/pull\/\d+|gitlab\.com\/.+\/merge_requests\/\d+/.test(value)) { toast('Paste a pull request URL'); return }
    startReview(value.startsWith('http') ? value : `https://${value}`, 'review')
  }

  const group = (key: string, title: string, icon: 'clock' | 'pull-request', list: PullRequest[]) => {
    if (!list.length) return null
    return (
      <section key={key}>
        <button className="review-group w-full" onClick={() => setCollapsed({ ...collapsed, [key]: !collapsed[key] })} aria-expanded={!collapsed[key]}>
          <Icon name={icon} size={18} className="text-muted" />{title}<span className="text-faint">{list.length}</span>
          <Icon name={collapsed[key] ? 'chevron' : 'chevron-down'} size={14} className="ml-auto text-faint" />
        </button>
        {!collapsed[key] && list.map((pr) => <PrRow key={pr.url} pr={pr} stats={stats[pr.url]} onReview={() => startReview(pr.url, 'review')} onFix={() => startReview(pr.url, 'fix')} onCopy={() => { navigator.clipboard?.writeText(pr.url); toast('Link copied') }} />)}
      </section>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="review-bar">
        <SidebarToggle />
        <Menu placement="bottom-start" width={300} trigger={<button className="btn btn-ghost btn-sm" style={{ fontSize: 15 }}>{repo || 'All repositories'}<Icon name="chevron-down" size={14} /></button>}>
          {(close) => (
            <>
              <MenuItem label="All repositories" checked={!repo} onClick={() => { setRepo(''); close() }} />
              {repos.length > 0 && <MenuSeparator />}
              <div className="menu-scroll">{repos.map((name) => <MenuItem key={name} icon="github" label={name} checked={repo === name} onClick={() => { setRepo(name); close() }} />)}</div>
            </>
          )}
        </Menu>
        <span className="flex-1" />
        <button className="icon-btn" aria-label="Refresh" title="Refresh" onClick={load} disabled={loading}>{loading ? <span className="spinner" /> : <Icon name="refresh" size={18} />}</button>
        <form className="review-url hidden md:flex" onSubmit={goTo}>
          <input className="input" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="github.com/org/repo/pull/1" aria-label="Pull request URL" />
        </form>
        <button className="btn btn-dark hidden md:inline-flex" onClick={goTo} disabled={!url.trim()}>Review pull request</button>
        <Menu placement="bottom-end" width={280} trigger={<button className="icon-btn" aria-label="GitHub machine" title="Which machine’s gh to use"><Icon name="user-plus" size={18} /></button>}>
          {(close) => (
            <>
              <MenuLabel>Use GitHub CLI on</MenuLabel>
              {online.map((item) => <MenuItem key={item.id} icon="monitor" label={item.name} checked={item.id === device?.id} onClick={() => { setDeviceId(item.id); close() }} />)}
            </>
          )}
        </Menu>
      </div>
      <div className="main-scroll">
        {!device ? (
          <div className="empty"><span className="empty-icon"><Icon name="pull-request" size={24} /></span><h2>No machine online</h2><p>Review reads your pull requests with the GitHub CLI on one of your machines.</p><Link to="/machines" className="btn btn-dark">Go to machines</Link></div>
        ) : error ? (
          <div className="empty">
            <span className="empty-icon"><Icon name="github" size={24} /></span>
            <h2>Connect GitHub</h2>
            <p>{error}</p>
            <div className="mt-5 flex gap-2">
              <button className="btn btn-dark" onClick={async () => { await api.post(`/api/devices/${device.id}/sessions`, { name: `gh-login-${Date.now().toString().slice(-5)}`, command: 'gh auth login', kind: 'setup' }); navigate(`/machines/${device.id}?tab=terminal`) }}>Sign in on {device.name}</button>
              <button className="btn btn-outline" onClick={load}>Try again</button>
            </div>
          </div>
        ) : mine === null ? (
          <div className="space-y-px">{[0, 1, 2, 3, 4].map((index) => <div key={index} className="pr-row"><div className="skeleton h-10 w-full" /></div>)}</div>
        ) : visible(mine).length + visible(requested).length === 0 ? (
          <div className="empty"><span className="empty-icon"><Icon name="check" size={24} /></span><h2>Nothing to review</h2><p>No open pull requests by you or waiting for your review{repo ? ` in ${repo}` : ''}.</p></div>
        ) : (
          <>
            {group('requested', 'Waiting for your review', 'clock', visible(requested))}
            {group('mine', 'Your pull requests', 'pull-request', visible(mine))}
          </>
        )}
      </div>
    </div>
  )
}

function PrRow({ pr, stats, onReview, onFix, onCopy }: { pr: PullRequest; stats?: PrStats; onReview: () => void; onFix: () => void; onCopy: () => void }) {
  return (
    <div className="pr-row">
      <Icon name="pull-request" size={20} className={`pr-icon ${pr.isDraft ? 'draft' : ''}`} />
      <div className="min-w-0 flex-1">
        <a href={pr.url} target="_blank" rel="noreferrer" className="pr-title hover:underline">
          <span className="truncate">{pr.title}</span>
          <span className="num">#{pr.number}</span>
          {stats?.ci === 'pass' && <Icon name="check" size={15} className="text-positive" />}
          {stats?.ci === 'fail' && <Icon name="close" size={15} className="text-danger" />}
          {stats?.ci === 'pending' && <span className="dot dot-amber" />}
        </a>
        <div className="pr-sub">{shortTime(Date.parse(pr.updatedAt) / 1000)} • {pr.author.login} • {pr.repository.nameWithOwner}{pr.isDraft ? ' • draft' : ''}</div>
      </div>
      <div className="pr-end">
        {!!pr.commentsCount && <span className="flex items-center gap-1 text-muted"><Icon name="message" size={16} />{pr.commentsCount}</span>}
        <span className="diffstat data-number">{stats ? <><span className="plus">+{compact(stats.additions)}</span> <span className="minus">−{compact(stats.deletions)}</span></> : <span className="skeleton inline-block h-3 w-14" />}</span>
        <button className="btn btn-sm btn-ghost hidden lg:inline-flex" onClick={onReview}><Icon name="sparkles" size={15} />Review</button>
        <Menu placement="bottom-end" width={240} trigger={<button className="icon-btn" aria-label="Pull request actions"><Icon name="more" size={18} /></button>}>
          {(close) => (
            <>
              <MenuItem icon="sparkles" label="Review with an agent" onClick={() => { close(); onReview() }} />
              <MenuItem icon="wrench" label="Fix failing CI" disabled={stats?.ci !== 'fail'} onClick={() => { close(); onFix() }} />
              <MenuSeparator />
              <MenuItem icon="external" label="Open on GitHub" href={pr.url} onClick={close} />
              <MenuItem icon="copy" label="Copy link" onClick={() => { close(); onCopy() }} />
            </>
          )}
        </Menu>
      </div>
    </div>
  )
}

function compact(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}K` : String(n)
}
