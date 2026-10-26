// DEV-ONLY MOCK (see mock.ts): the GitHub CLI answers and the checkout step
// behind "start a session from a GitHub repo and branch".

import { parseRepoRef } from './github'
import type { GitHubBranch, GitHubReply, GitHubRepo, GitPathInfo, GitPrepareJob, GitPrepareResult } from './types'

const day = 86400_000
const ago = (days: number) => new Date(Date.now() - days * day).toISOString()

const repos: GitHubRepo[] = [
  { nameWithOwner: 'ErzenXz/overseer', description: 'Self-hosted control room for coding agents across your machines', updatedAt: ago(0.05), isPrivate: false, defaultBranch: 'main' },
  { nameWithOwner: 'acme-labs/web', description: 'Marketing site and customer dashboard', updatedAt: ago(0.4), isPrivate: true, defaultBranch: 'main' },
  { nameWithOwner: 'ErzenXz/takvimi', description: 'Prayer times app with offline calendars', updatedAt: ago(1.2), isPrivate: true, defaultBranch: 'main' },
  { nameWithOwner: 'acme-labs/billing-service', description: 'Invoices, subscriptions and webhooks', updatedAt: ago(2), isPrivate: true, defaultBranch: 'main' },
  { nameWithOwner: 'ErzenXz/codex-harness', description: 'Test harness for terminal coding agents', updatedAt: ago(3), isPrivate: false, defaultBranch: 'main' },
  { nameWithOwner: 'ErzenXz/storefront', description: 'Headless storefront on Next.js', updatedAt: ago(6), isPrivate: true, defaultBranch: 'main' },
  { nameWithOwner: 'acme-labs/design-system', description: 'Tokens and React components', updatedAt: ago(9), isPrivate: false, defaultBranch: 'main' },
  { nameWithOwner: 'ErzenXz/api-gateway', description: 'Edge gateway with rate limits and auth', updatedAt: ago(12), isPrivate: true, defaultBranch: 'main' },
  { nameWithOwner: 'ErzenXz/worker', description: 'Background job runner', updatedAt: ago(15), isPrivate: true, defaultBranch: 'main' },
  { nameWithOwner: 'ErzenXz/archive', description: '', updatedAt: ago(30), isPrivate: false, defaultBranch: 'main' },
  { nameWithOwner: 'acme-labs/infra', description: 'Terraform and deploy scripts', updatedAt: ago(34), isPrivate: true, defaultBranch: 'main' },
  { nameWithOwner: 'ErzenXz/dotfiles', description: 'Shell, editor and git config', updatedAt: ago(70), isPrivate: false, defaultBranch: 'master' },
  { nameWithOwner: 'ErzenXz/pixel-garden', description: 'Tiny generative art toys', updatedAt: ago(120), isPrivate: false, defaultBranch: 'main' },
  { nameWithOwner: 'ErzenXz/notes-cli', description: 'Plain-text notes from the terminal', updatedAt: ago(200), isPrivate: false, defaultBranch: 'main' },
]

const pr = (number: number, title: string, draft = false) => ({ number, title, draft })

const branchesOf: Record<string, GitHubBranch[]> = {
  'ErzenXz/overseer': [
    { name: 'main', isDefault: true },
    { name: 'feat/github-picker', pr: pr(15, 'Start sessions from a GitHub repo and branch') },
    { name: 'user-feedback', pr: pr(14, 'Where it runs: pick the machine, folder and branch') },
    { name: 'fix/ws-reconnect', pr: pr(12, 'Reconnect the event socket after sleep', true) },
    { name: 'release-1.4' }, { name: 'docs/refresh-readme' }, { name: 'dependabot/npm_and_yarn/vite-7.1.4' }, { name: 'redesign-home' },
  ],
}

const slug = (branch: string) => branch.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '') || 'branch'

function branchesFor(repo: string): GitHubBranch[] {
  const def = repos.find((item) => item.nameWithOwner.toLowerCase() === repo.toLowerCase())?.defaultBranch ?? 'main'
  return branchesOf[repo] ?? [{ name: def, isDefault: true }, { name: 'develop', pr: pr(41, 'Tidy the settings screen') }, { name: 'fix/typos' }, { name: 'chore/deps' }]
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface Job { started: number; result: GitPrepareResult; error?: string; cancelled?: boolean }
const jobs = new Map<string, Job>()
const JOB_MS = 2400

export interface MockGitHubContext {
  online: (deviceId: string) => boolean
  home: (deviceId: string) => string
  info: (deviceId: string, path: string) => GitPathInfo
}

export async function githubRoute(method: string, path: string, search: URLSearchParams, body: Record<string, unknown>, ctx: MockGitHubContext): Promise<Response | null> {
  const gh = path.match(/^\/api\/devices\/([^/]+)\/github\/(repos|find|branches)$/)
  if (method === 'GET' && gh) {
    const id = decodeURIComponent(gh[1])
    if (!ctx.online(id)) return json({ error: 'device is offline' }, 503)
    await wait(gh[2] === 'repos' ? 650 : 380)
    if (id === 'homelab') return json({ status: 'no-auth', message: 'The GitHub CLI is not signed in on this machine.' } satisfies GitHubReply)
    if (gh[2] === 'repos') return json({ status: 'ok', login: 'ErzenXz', repos } satisfies GitHubReply)
    if (gh[2] === 'branches') {
      const ref = parseRepoRef(search.get('repo') ?? '')
      if (!ref) return json({ error: 'repo must be owner/name' }, 400)
      const list = branchesFor(ref.repo)
      return json({ status: 'ok', defaultBranch: list.find((branch) => branch.isDefault)?.name, branches: list } satisfies GitHubReply)
    }
    const q = (search.get('q') ?? '').trim()
    const ref = parseRepoRef(q)
    if (ref) {
      const known = repos.find((item) => item.nameWithOwner.toLowerCase() === ref.repo.toLowerCase())
      return json({ status: 'ok', repos: [known ?? { nameWithOwner: ref.repo, description: 'Public repository', updatedAt: ago(8), isPrivate: false, defaultBranch: 'main' }], branch: ref.branch } satisfies GitHubReply)
    }
    const found: GitHubRepo[] = /overseer|agent/i.test(q)
      ? [{ nameWithOwner: 'ironclad/agent-overseer', description: 'Unrelated overseer for something else', updatedAt: ago(90), isPrivate: false, defaultBranch: 'main' }]
      : []
    return json({ status: 'ok', repos: found } satisfies GitHubReply)
  }

  const prep = path.match(/^\/api\/devices\/([^/]+)\/git-prepare$/)
  if (method === 'POST' && prep) {
    const id = decodeURIComponent(prep[1])
    if (!ctx.online(id)) return json({ error: 'device is offline' }, 503)
    const repo = String(body.repo ?? '')
    const branch = String(body.branch ?? '')
    const [owner, name] = repo.split('/')
    const home = ctx.home(id)
    // The same decision the agent makes: already on the branch, a clone on
    // something else, or no clone.
    const known = (Array.isArray(body.known) ? body.known.map(String) : []).map((folder) => ctx.info(id, folder)).filter((info) => info.isRepo)
    const onBranch = known.find((info) => info.branch === branch)
    const result: GitPrepareResult = onBranch
      ? { action: 'reuse', path: onBranch.resolved, branch, home }
      : known.length
        ? { action: 'worktree', path: `${home}/.overseer/worktrees/${owner}-${name}/${slug(branch)}`, branch, home, source: known[0].resolved }
        : { action: 'clone', path: `${home}/code/${name}`, branch, home }
    if (body.plan) { await wait(200); return json(result) }
    const key = String(body.key ?? '')
    if (!jobs.has(key)) jobs.set(key, { started: Date.now(), result, error: id === 'homelab' ? 'This machine is not signed in to GitHub. Run “gh auth login” there.' : undefined })
    return json(snapshot(key))
  }

  const job = path.match(/^\/api\/git-prepare\/([^/]+)$/)
  if (job) {
    const key = decodeURIComponent(job[1])
    if (!jobs.has(key)) return json({ error: 'no such job' }, 404)
    if (method === 'DELETE') jobs.get(key)!.cancelled = true
    if (method === 'GET' || method === 'DELETE') return json(snapshot(key))
  }
  return null
}

function snapshot(key: string): GitPrepareJob {
  const job = jobs.get(key)!
  if (job.cancelled) return { key, state: 'failed', error: 'Cancelled.' }
  if (Date.now() - job.started < JOB_MS) return { key, state: 'running' }
  return job.error ? { key, state: 'failed', error: job.error } : { key, state: 'done', result: job.result }
}
