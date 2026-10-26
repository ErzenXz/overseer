import { useEffect, useSyncExternalStore } from 'react'
import { api } from './api'
import { relativeTime } from './agents'
import type { Device, GitInfoResult, GitPathInfo, Thread } from './types'

// "Where it runs": which machine, which folder, which branch. Folder facts
// come from the machine itself (POST /api/devices/{id}/git-info) and are kept
// in a small shared cache so the picker, the chip beside Send and the session
// header never ask twice.

// ---- formatting ----

export function deviceStatusText(device: Pick<Device, 'online' | 'lastSeen'>): string {
  if (device.online) return 'online'
  return device.lastSeen ? `last seen ${relativeTime(device.lastSeen)}` : 'never connected'
}

// tildePath shows a path under the machine's home folder as ~/…
export function tildePath(path: string, home?: string): string {
  if (!path) return '~'
  if (path === '~' || path.startsWith('~/') || path.startsWith('~\\')) return path
  if (home) {
    const base = home.replace(/[\\/]+$/, '')
    if (path === base) return '~'
    if (path.startsWith(base) && (path[base.length] === '/' || path[base.length] === '\\')) return `~${path.slice(base.length)}`
  }
  return path
}

// shortPath keeps the last two folders of a long path: …/services/api
export function shortPath(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : path
}

export const baseName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path

export function looksLikePath(text: string): boolean {
  const value = text.trim()
  return value.startsWith('/') || value.startsWith('~') || /^[a-zA-Z]:[\\/]/.test(value)
}

// ---- git-info cache ----

export interface Probe {
  at: number
  info?: GitPathInfo
  error?: string
}

const FRESH_MS = 45_000
const ERROR_RETRY_MS = 8_000
const cache = new Map<string, Probe>()
// Home folders are kept in this browser too, so "~/code/api" shows at once on
// the next visit instead of the long path.
const HOMES_KEY = 'overseer:where.homes'
const homes = (() => {
  try { return new Map<string, string>(Object.entries(JSON.parse(localStorage.getItem(HOMES_KEY) ?? '{}'))) } catch { return new Map<string, string>() }
})()
function rememberHome(deviceId: string, home: string) {
  if (homes.get(deviceId) === home) return
  homes.set(deviceId, home)
  try { localStorage.setItem(HOMES_KEY, JSON.stringify(Object.fromEntries(homes))) } catch { /* storage unavailable */ }
}
const pending = new Set<string>()
const listeners = new Set<() => void>()
let version = 0

const keyOf = (deviceId: string, path: string) => `${deviceId}\n${path}`

// The repo each folder last turned out to be, kept in this browser so a
// machine that is offline still sits with its repo (no branch: that could be
// stale).
const REMEMBER_KEY = 'overseer:where.remotes'
const remembered = (() => {
  try { return new Map<string, string>(Object.entries(JSON.parse(localStorage.getItem(REMEMBER_KEY) ?? '{}'))) } catch { return new Map<string, string>() }
})()
function remember(deviceId: string, path: string, remoteKey?: string) {
  const key = keyOf(deviceId, path)
  if ((remembered.get(key) ?? '') === (remoteKey ?? '')) return
  if (remoteKey) remembered.set(key, remoteKey)
  else remembered.delete(key)
  try { localStorage.setItem(REMEMBER_KEY, JSON.stringify(Object.fromEntries([...remembered].slice(-200)))) } catch { /* storage unavailable */ }
}
const bump = () => { version++; listeners.forEach((listener) => listener()) }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

// useWhereVersion re-renders the caller whenever a probe lands.
export const useWhereVersion = () => useSyncExternalStore(subscribe, () => version)

export const probeOf = (deviceId: string, path: string): Probe | undefined => cache.get(keyOf(deviceId, path))
export const isProbing = (deviceId: string, path: string) => pending.has(keyOf(deviceId, path))
export const homeOf = (deviceId: string) => homes.get(deviceId)

// probe asks a machine about folders it has not answered for lately. Answers
// arrive per machine, so rows fill in as they come.
export function probe(deviceId: string, paths: string[], force = false) {
  const now = Date.now()
  const todo = [...new Set(paths.filter(Boolean))].filter((path) => {
    const key = keyOf(deviceId, path)
    if (pending.has(key)) return false
    const known = cache.get(key)
    return force || !known || now - known.at > (known.error ? ERROR_RETRY_MS : FRESH_MS)
  })
  for (let i = 0; i < todo.length; i += 32) {
    const chunk = todo.slice(i, i + 32)
    chunk.forEach((path) => pending.add(keyOf(deviceId, path)))
    api.post<GitInfoResult>(`/api/devices/${encodeURIComponent(deviceId)}/git-info`, { paths: chunk })
      .then((result) => {
        if (result.home) rememberHome(deviceId, result.home)
        result.paths.forEach((info, index) => {
          const path = chunk[index] ?? info.path
          cache.set(keyOf(deviceId, path), { at: Date.now(), info })
          if (info.exists) remember(deviceId, path, info.remoteKey)
        })
      })
      .catch((cause) => {
        const error = cause instanceof Error ? cause.message : 'Could not check'
        chunk.forEach((path) => cache.set(keyOf(deviceId, path), { at: Date.now(), error }))
      })
      .finally(() => {
        chunk.forEach((path) => pending.delete(keyOf(deviceId, path)))
        bump()
      })
  }
  if (todo.length) bump()
}

// useFolderInfo watches one folder on one machine, refreshing now and then
// so a branch switch shows up.
export function useFolderInfo(deviceId: string, path: string, online: boolean, refreshMs = 60_000) {
  useWhereVersion()
  useEffect(() => {
    if (!deviceId || !online) return
    probe(deviceId, [path || '~'])
    const timer = window.setInterval(() => probe(deviceId, [path || '~'], true), refreshMs)
    return () => window.clearInterval(timer)
  }, [deviceId, path, online, refreshMs])
  if (!deviceId) return { entry: undefined, loading: false, home: undefined }
  const key = path || '~'
  return { entry: probeOf(deviceId, key), loading: isProbing(deviceId, key) && !probeOf(deviceId, key), home: homeOf(deviceId) }
}

// ---- repos ----

export interface KnownFolder {
  deviceId: string
  path: string
  usedAt: number
}

// knownFolders are the folders sessions ran in lately, newest first, at most
// `perDevice` for each machine. This is the bound on what gets checked.
export function knownFolders(threads: Thread[], perDevice = 8): KnownFolder[] {
  const best = new Map<string, KnownFolder>()
  for (const thread of threads) {
    if (!thread.cwd) continue
    const key = keyOf(thread.deviceId, thread.cwd)
    const seen = best.get(key)
    if (!seen || thread.updatedAt > seen.usedAt) best.set(key, { deviceId: thread.deviceId, path: thread.cwd, usedAt: thread.updatedAt })
  }
  const counts = new Map<string, number>()
  return [...best.values()].sort((a, b) => b.usedAt - a.usedAt).filter((folder) => {
    const n = counts.get(folder.deviceId) ?? 0
    counts.set(folder.deviceId, n + 1)
    return n < perDevice
  })
}

export interface Place {
  deviceId: string
  path: string // as asked: the thread's folder or what was typed
  usedAt: number
  inferred: boolean // the same ~/ path on another machine, never used there
  probe?: Probe
  loading: boolean
}

export interface RepoGroup {
  id: string
  name: string
  remote?: string
  usedAt: number
  places: Place[]
}

// homeRelative turns a known folder into "~/x" using its machine's home.
function homeRelative(path: string, home?: string): string | null {
  const short = tildePath(path, home)
  return short.startsWith('~/') || short.startsWith('~\\') ? short : null
}

// candidatePaths are the "same folder on another machine" guesses worth
// asking about: the ~/ form of every known repo on each other online machine.
export function siblingCandidates(folders: KnownFolder[], devices: Device[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const online = devices.filter((device) => device.online)
  for (const folder of folders) {
    const rel = homeRelative(folder.path, homeOf(folder.deviceId))
    if (!rel) continue
    for (const device of online) {
      if (device.id === folder.deviceId) continue
      if (folders.some((other) => other.deviceId === device.id && homeRelative(other.path, homeOf(device.id)) === rel)) continue
      const list = out.get(device.id) ?? []
      if (!list.includes(rel) && list.length < 8) list.push(rel)
      out.set(device.id, list)
    }
  }
  return out
}

// buildGroups turns known folders (and guesses) into repos, merging the same
// remote across machines. Folders that turned out not to exist, and guesses
// that are a different repo, are left out.
export function buildGroups(devices: Device[], folders: KnownFolder[]): RepoGroup[] {
  const byId = new Map(devices.map((device) => [device.id, device]))
  const candidates: Place[] = []
  for (const folder of folders) {
    if (!byId.has(folder.deviceId)) continue
    candidates.push({ deviceId: folder.deviceId, path: folder.path, usedAt: folder.usedAt, inferred: false, probe: probeOf(folder.deviceId, folder.path), loading: isProbing(folder.deviceId, folder.path) })
  }
  for (const [deviceId, paths] of siblingCandidates(folders, devices)) {
    for (const path of paths) candidates.push({ deviceId, path, usedAt: 0, inferred: true, probe: probeOf(deviceId, path), loading: isProbing(deviceId, path) })
  }

  const knownRemotes = new Set(candidates.flatMap((place) => (!place.inferred && place.probe?.info?.remoteKey ? [place.probe.info.remoteKey] : [])))
  const groups = new Map<string, RepoGroup>()
  const seenFolder = new Set<string>()
  for (const place of candidates) {
    const info = place.probe?.info
    if (info && !info.exists) continue
    const resolved = info?.resolved ?? place.path
    const folderKey = keyOf(place.deviceId, resolved)
    if (seenFolder.has(folderKey)) continue
    // An offline machine cannot be asked; its repo is what it last was.
    const remote = info ? info.remoteKey : byId.get(place.deviceId)?.online ? undefined : remembered.get(keyOf(place.deviceId, place.path))
    // A guess only counts once it proves to be a clone of a known repo.
    if (place.inferred && !(remote && knownRemotes.has(remote))) continue
    const id = remote ? `r:${remote}` : `p:${folderKey}`
    seenFolder.add(folderKey)
    const group = groups.get(id) ?? { id, name: remote ? baseName(remote) : baseName(resolved), remote, usedAt: 0, places: [] }
    group.places.push(place)
    group.usedAt = Math.max(group.usedAt, place.usedAt)
    groups.set(id, group)
  }
  for (const group of groups.values()) {
    group.places.sort((a, b) => Number(!!byId.get(b.deviceId)?.online) - Number(!!byId.get(a.deviceId)?.online) || b.usedAt - a.usedAt)
  }
  return [...groups.values()].sort((a, b) => b.usedAt - a.usedAt)
}

// ---- GitHub repos on machines ----

// clonesOf are the places (on any machine) known to hold a clone of a GitHub
// repo, found the same way as the repo groups above: by remote.
export function clonesOf(groups: RepoGroup[], repo: string): Place[] {
  const key = `github.com/${repo}`.toLowerCase()
  return groups.find((group) => group.remote?.toLowerCase() === key)?.places.filter((place) => !(place.probe?.info && !place.probe.info.exists)) ?? []
}

// knownClonePaths are the folders on one machine already known to hold a clone
// of a GitHub repo, for the machine to look at first.
export function knownClonePaths(devices: Device[], folders: KnownFolder[], repo: string, deviceId: string): string[] {
  return clonesOf(buildGroups(devices, folders), repo)
    .filter((place) => place.deviceId === deviceId)
    .map((place) => place.probe?.info?.resolved || place.path)
}
