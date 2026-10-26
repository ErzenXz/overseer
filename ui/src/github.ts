import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { api } from './api'
import type { GitHubBranch, GitHubReply, GitHubRepo, GitPrepareJob, GitPrepareResult } from './types'

// GitHub as a place to start a session from: the user's repos and a repo's
// branches come from the GitHub CLI on one of their machines (through the hub),
// and "prepare" gets the chosen branch checked out on the machine that will
// run the session. Answers are kept in a small shared cache so reopening the
// picker is instant.

export interface RepoSource {
  repo: string // owner/name
  branch: string
}

// ---- reading a typed repo ----

// parseRepoRef reads "owner/name", a github.com link or an ssh remote, and the
// branch if the link names one (.../tree/feature/x).
export function parseRepoRef(text: string): { repo: string; branch?: string } | null {
  let value = text.trim()
  if (value.startsWith('git@github.com:')) value = value.slice('git@github.com:'.length)
  else if (/github\.com\//i.test(value)) {
    try {
      const url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`)
      if (url.hostname.replace(/^www\./, '').toLowerCase() !== 'github.com') return null
      value = url.pathname
    } catch { return null }
  }
  const parts = value.replace(/^\/+|\/+$/g, '').split('/')
  if (parts.length < 2) return null
  const owner = parts[0]
  const name = parts[1].replace(/\.git$/, '')
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(name) || name === '.' || name === '..') return null
  // Plain "owner/name" only: anything longer must be a link.
  if (parts.length > 2 && !/github\.com/i.test(text) && !text.trim().startsWith('git@')) return null
  const branch = parts.length >= 4 && parts[2] === 'tree' ? parts.slice(3).join('/') : undefined
  return { repo: `${owner}/${name}`, branch }
}

// ---- cache ----

interface Entry<T> {
  at: number
  value?: T
  error?: string
  loading: boolean
}

const STALE_MS = 3 * 60_000
const listeners = new Set<() => void>()
let version = 0
const bump = () => { version++; listeners.forEach((listener) => listener()) }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const useVersion = () => useSyncExternalStore(subscribe, () => version)

const repoCache = new Map<string, Entry<GitHubReply>>()
const branchCache = new Map<string, Entry<GitHubReply>>()
const findCache = new Map<string, Entry<GitHubReply>>()

async function load(cache: Map<string, Entry<GitHubReply>>, key: string, path: string, force: boolean) {
  const known = cache.get(key)
  if (known?.loading) return
  if (!force && known && Date.now() - known.at < STALE_MS && !known.error) return
  cache.set(key, { ...known, at: known?.at ?? 0, loading: true })
  bump()
  try {
    const value = await api.get<GitHubReply>(path)
    cache.set(key, { at: Date.now(), value, loading: false })
  } catch (cause) {
    cache.set(key, { at: Date.now(), error: cause instanceof Error ? cause.message : 'Could not reach GitHub', loading: false })
  }
  bump()
}

export interface Loaded {
  reply?: GitHubReply
  error?: string
  loading: boolean
  reload: () => void
}

function view(entry: Entry<GitHubReply> | undefined, reload: () => void): Loaded {
  return { reply: entry?.value, error: entry?.error, loading: !entry || entry.loading, reload }
}

// loadRepos fetches the repo list in two steps: a short list of the newest
// repos first (a couple of seconds), then the full list with organizations
// (up to ten), so the picker has something to show right away.
async function loadRepos(deviceId: string, force: boolean) {
  const known = repoCache.get(deviceId)
  if (known?.loading) return
  if (!force && known && Date.now() - known.at < STALE_MS && !known.error) return
  repoCache.set(deviceId, { ...known, at: known?.at ?? 0, loading: true })
  bump()
  const base = `/api/devices/${encodeURIComponent(deviceId)}/github/repos`
  try {
    if (!known?.value) {
      const quick = await api.get<GitHubReply>(`${base}?quick=1`)
      repoCache.set(deviceId, { at: 0, value: quick, loading: quick.status === 'ok' })
      bump()
      if (quick.status !== 'ok') return
    }
    try {
      repoCache.set(deviceId, { at: Date.now(), value: await api.get<GitHubReply>(base), loading: false })
    } catch (cause) {
      // The short list is still good; only a missing one is an error.
      const shown = repoCache.get(deviceId)?.value
      repoCache.set(deviceId, { at: Date.now(), value: shown, error: shown ? undefined : cause instanceof Error ? cause.message : 'Could not reach GitHub', loading: false })
    }
  } catch (cause) {
    repoCache.set(deviceId, { at: Date.now(), error: cause instanceof Error ? cause.message : 'Could not reach GitHub', loading: false })
  }
  bump()
}

// useGitHubRepos lists the signed-in user's repos (and their organizations')
// as seen by the GitHub CLI on one machine.
export function useGitHubRepos(deviceId: string | undefined, enabled: boolean): Loaded {
  useVersion()
  useEffect(() => { if (deviceId && enabled) loadRepos(deviceId, false) }, [deviceId, enabled])
  const reload = useCallback(() => { if (deviceId) loadRepos(deviceId, true) }, [deviceId])
  return view(deviceId ? repoCache.get(deviceId) : undefined, reload)
}

export function useGitHubBranches(deviceId: string | undefined, repo: string | undefined): Loaded {
  useVersion()
  const key = `${deviceId}\n${repo}`
  const path = `/api/devices/${encodeURIComponent(deviceId ?? '')}/github/branches?repo=${encodeURIComponent(repo ?? '')}`
  useEffect(() => { if (deviceId && repo) load(branchCache, key, path, false) }, [deviceId, repo, key, path])
  const reload = useCallback(() => { if (deviceId && repo) load(branchCache, key, path, true) }, [deviceId, repo, key, path])
  return view(deviceId && repo ? branchCache.get(key) : undefined, reload)
}

// useGitHubFind looks a typed name or link up on GitHub itself, a moment after
// typing stops. An empty query asks nothing.
export function useGitHubFind(deviceId: string | undefined, query: string): Loaded {
  useVersion()
  const q = query.trim()
  const key = `${deviceId}\n${q}`
  const path = `/api/devices/${encodeURIComponent(deviceId ?? '')}/github/find?q=${encodeURIComponent(q)}`
  useEffect(() => {
    if (!deviceId || q.length < 2) return
    const timer = window.setTimeout(() => load(findCache, key, path, false), 350)
    return () => window.clearTimeout(timer)
  }, [deviceId, q, key, path])
  const reload = useCallback(() => { if (deviceId && q) load(findCache, key, path, true) }, [deviceId, q, key, path])
  return view(deviceId && q.length >= 2 ? findCache.get(key) : undefined, reload)
}

// mergeRepos puts a looked-up repo list after the one already shown, without
// repeating anything.
export function mergeRepos(first: GitHubRepo[], more: GitHubRepo[] = []): GitHubRepo[] {
  const seen = new Set(first.map((repo) => repo.nameWithOwner.toLowerCase()))
  return [...first, ...more.filter((repo) => !seen.has(repo.nameWithOwner.toLowerCase()))]
}

// branchesOf adds a branch the caller asked for (from a link or typed) when
// the list does not have it.
export function withBranch(branches: GitHubBranch[], name?: string): GitHubBranch[] {
  if (!name || branches.some((branch) => branch.name === name)) return branches
  return [{ name }, ...branches]
}

export function validBranchName(name: string): boolean {
  return !!name && name.length <= 200 && !/^[-/]|[/.]$|\.\.|\/\/|@\{|\.lock$|[\s~^:?*[\\\x00-\x1f\x7f]/.test(name) && name !== '@'
}

// ---- getting the checkout ready ----

export const prepareAction = {
  clone: (repo: string, machine: string) => `Cloning ${repo} on ${machine}…`,
  worktree: (branch: string, machine: string) => `Adding a separate folder for ${branch} on ${machine}…`,
  reuse: (branch: string, machine: string) => `Checking out ${branch} on ${machine}…`,
} as const

export interface PrepareHooks {
  signal: AbortSignal
  // The step, known as soon as the machine has looked at what is there.
  onPlan: (action: GitPrepareResult['action']) => void
}

export class PrepareCancelled extends Error {
  constructor() { super('Cancelled.') }
}

// prepareCheckout asks the machine to get repo@branch ready and waits for it.
// The work runs as a job on the hub, so a long clone never holds one browser
// request open; cancelling stops it on the machine.
export async function prepareCheckout(deviceId: string, source: RepoSource, known: string[], hooks: PrepareHooks): Promise<GitPrepareResult> {
  const base = `/api/devices/${encodeURIComponent(deviceId)}/git-prepare`
  const body = { repo: source.repo, branch: source.branch, known }
  const gone = () => { if (hooks.signal.aborted) throw new PrepareCancelled() }

  gone()
  const plan = await api.post<GitPrepareResult>(base, { ...body, plan: true }, 30_000)
  gone()
  hooks.onPlan(plan.action)
  if (plan.action === 'reuse') return plan // nothing to do on the machine

  const key = `p-${crypto.randomUUID().replace(/-/g, '')}`
  let job = await api.post<GitPrepareJob>(base, { ...body, key })
  const stop = () => { api.del(`/api/git-prepare/${key}`).catch(() => {}) }
  hooks.signal.addEventListener('abort', stop, { once: true })
  try {
    let misses = 0
    while (job.state === 'running') {
      await new Promise((resolve) => setTimeout(resolve, 900))
      gone()
      try {
        job = await api.get<GitPrepareJob>(`/api/git-prepare/${key}`)
        misses = 0
      } catch (cause) {
        // A hub that restarted forgets the job; a flaky connection is retried.
        if (cause instanceof Error && 'status' in cause && (cause as { status: number }).status === 404) throw new Error('The hub restarted while this was running. Try again.')
        if (++misses > 20) throw new Error('Lost contact with the hub. Try again.')
      }
    }
  } finally {
    hooks.signal.removeEventListener('abort', stop)
  }
  gone()
  if (job.state === 'failed' || !job.result) throw new Error(job.error || 'Could not get the repo ready.')
  return job.result
}
