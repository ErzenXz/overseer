import { KeyboardEvent, ReactElement, ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { mergeRepos, parseRepoRef, useGitHubBranches, useGitHubFind, useGitHubRepos, validBranchName, withBranch, type RepoSource } from '../github'
import { usePref } from '../store'
import type { Device, GitHubBranch, GitHubRepo, Thread } from '../types'
import {
  baseName, buildGroups, clonesOf, deviceStatusText, knownFolders, looksLikePath, probe, probeOf, shortPath,
  siblingCandidates, tildePath, useFolderInfo, useWhereVersion, type KnownFolder, type RepoGroup,
} from '../where'
import { FolderPicker, type ComposerSettings } from './Composer'
import Icon from './Icon'
import { Menu, MenuItem, MenuLabel, MenuSeparator, Submenu } from './Menu'
import { OsMark } from './DeviceMark'

// Where a new session will run: one quiet chip beside Send showing the
// machine, folder and branch, and one simple picker to change it.

interface TargetProps {
  devices: Device[]
  threads: Thread[]
  settings: ComposerSettings
  onSettings: (next: ComposerSettings) => void
  // A GitHub repo and branch picked instead of a folder: the machine checks
  // it out when the session starts. Null when a folder is used.
  source: RepoSource | null
  onSource: (source: RepoSource | null) => void
}


// TargetChip is the machine, folder and branch in one pill. Beside Send it
// stacks the machine over the folder and branch, so long names still fit; on
// phones there is no room there, so one line spans the strip under the box
// instead (block).
export function TargetChip({ block, ...props }: TargetProps & { block?: boolean }) {
  const { devices, settings, source } = props
  const device = devices.find((item) => item.id === settings.deviceId)
  const { entry, home } = useFolderInfo(settings.deviceId, settings.cwd, !!device?.online)
  const path = source ? source.repo : tildePath(settings.cwd || '~', home)
  const info = entry?.info
  const branch = source ? source.branch : info?.isRepo ? info.branch : undefined
  const label = device ? `${device.name}, ${source ? 'GitHub repo' : 'folder'} ${path}${branch ? `, branch ${branch}` : ''}${device.online ? '' : `, ${deviceStatusText(device)}`}` : 'No machine chosen'
  return (
    <TargetMenu {...props} placement={block ? 'bottom-start' : 'top-end'} trigger={
      <button type="button" className={`target-chip ${block ? 'is-block' : ''} ${source ? 'is-source' : ''} ${device && !device.online ? 'is-offline' : ''} ${!device ? 'is-empty' : ''}`} title={`Runs on ${label}. Click to change.`} aria-label={`Runs on ${label}. Change`}>
        {device && !device.online && <span className="dot dot-amber" />}
        <span className="target-text">
          <span className="target-name">{device?.name ?? 'Choose a machine'}</span>
          {device && <span className="target-sep target-sep-name">·</span>}
          {device && !block && !device.online ? (
            <span className="target-where target-where-off">{deviceStatusText(device)}</span>
          ) : device && (
            <span className="target-where">
              <span className="target-path" title={source ? path : undefined}>{source ? path.slice(path.indexOf('/') + 1) : shortPath(path)}</span>
              {branch && <><span className="target-sep">·</span><Icon name="git-branch" size={12} className="target-branch-icon" /><span className="target-branch">{branch}</span></>}
            </span>
          )}
        </span>
        <Icon name="chevron-down" size={12} className="ctl-chev" />
      </button>
    } />
  )
}

// TargetStrip is the tray under the composer, like Codex's but below: the
// folder (with its branch) and the machine, each one click to change, and a
// plain warning when the machine is offline.
export function TargetStrip(props: TargetProps & { locked?: boolean }) {
  const { devices, settings, source, onSettings, onSource, locked } = props
  const device = devices.find((item) => item.id === settings.deviceId)
  const { entry, home } = useFolderInfo(settings.deviceId, settings.cwd, !!device?.online)
  const info = entry?.info
  const branch = source ? source.branch : info?.isRepo ? info.branch : undefined
  const path = source ? source.repo : tildePath(settings.cwd || '~', home)
  const name = source ? source.repo.slice(source.repo.indexOf('/') + 1) : settings.cwd ? baseName(settings.cwd) : 'Home folder'
  const machines = [...devices].sort(byUse)
  return (
    <div className="ctx-strip">
      <TargetMenu {...props} placement="bottom-start" trigger={
        <button type="button" className="ctx-chip" disabled={locked} title={locked ? 'Fixed once a session is starting' : `Runs in ${path}${branch ? `, branch ${branch}` : ''}. Click to change.`} aria-label={`Folder ${path}${branch ? `, branch ${branch}` : ''}. Change`}>
          <Icon name={source ? 'github' : 'folder'} size={15} />
          <span className="ctx-name">{name}</span>
          {branch && <span className="ctx-branch"><Icon name="git-branch" size={12} />{branch}</span>}
          <Icon name="chevron-down" size={12} className="ctx-chev" />
        </button>
      } />
      <Menu placement="bottom-start" width={264} trigger={
        <button type="button" className={`ctx-chip ${device && !device.online ? 'is-offline' : ''}`} disabled={locked} title={locked ? 'Fixed once a session is starting' : device ? `Runs on ${device.name}. Click to change.` : 'Choose a machine'} aria-label={`Machine ${device?.name ?? 'none'}. Change`}>
          {device ? <OsMark os={device.os} size={15} /> : <Icon name="monitor" size={15} />}
          <span className="ctx-name">{device?.name ?? 'Choose a machine'}</span>
          {device && !device.online && <span className="ctx-off">offline</span>}
          <Icon name="chevron-down" size={12} className="ctx-chev" />
        </button>
      }>
        {(close) => machines.map((item) => (
          <MenuItem key={item.id} icon={<OsMark os={item.os} size={16} />} label={item.name} description={item.online ? undefined : `Offline, ${deviceStatusText(item)}`} checked={item.id === settings.deviceId} onClick={() => { onSource(null); if (item.id !== settings.deviceId) onSettings({ ...settings, deviceId: item.id, cwd: '' }); close() }} />
        ))}
      </Menu>
      {device && !device.online && (
        <span className="target-warn" role="alert">
          <Icon name="alert" size={14} />{device.name} was last seen {deviceStatusText(device).replace('last seen ', '')}. Pick an online machine to start.
        </span>
      )}
    </div>
  )
}

export function TargetMenu({ trigger, placement, ...props }: TargetProps & { trigger: ReactElement; placement: 'top-end' | 'bottom-start' }) {
  const width = Math.min(310, window.innerWidth - 16)
  return (
    <Menu placement={placement} width={width} className="target-menu" trigger={trigger}>
      {(close) => <TargetPanel {...props} close={close} />}
    </Menu>
  )
}

// The picker, kept simple: machines along the top, that machine's folders as
// one-line rows, and three ways out at the bottom (home folder, browse,
// GitHub). Typing searches folders on every machine at once.
type View = 'folders' | 'browse' | 'github'

const byUse = (a: Device, b: Device) => Number(b.online) - Number(a.online) || Number(b.isHub) - Number(a.isHub) || a.name.localeCompare(b.name)

function TargetPanel(props: TargetProps & { close: () => void }) {
  const { devices, settings } = props
  const sorted = useMemo(() => [...devices].sort(byUse), [devices])
  const [view, setView] = useState<View>(props.source ? 'github' : 'folders')
  // The machine whose folders are listed; picking a folder is what commits.
  const [machineId, setMachineId] = useState(() => (sorted.find((device) => device.id === settings.deviceId) ?? sorted.find((device) => device.online) ?? sorted[0])?.id ?? '')
  const machine = devices.find((device) => device.id === machineId)
  const tabs = <MachineTabs devices={sorted} value={machineId} onChange={setMachineId} />
  if (view === 'github') return <GitHubPanel {...props} machineId={machineId} tabs={tabs} onBack={() => setView('folders')} />
  if (view === 'browse' && machine) {
    return (
      <div className="tp">
        <PanelHead title={`Folders on ${machine.name}`} onBack={() => setView('folders')} />
        <FolderPicker deviceId={machine.id} value={machine.id === settings.deviceId ? settings.cwd : ''} onPick={(cwd) => { props.onSource(null); props.onSettings({ ...settings, deviceId: machine.id, cwd }); props.close() }} />
      </div>
    )
  }
  return <FolderPanel {...props} machine={machine} machines={sorted} onMachine={setMachineId} onView={setView} />
}

function PanelHead({ title, onBack, children }: { title: string; onBack: () => void; children?: ReactNode }) {
  return (
    <div className="tp-head">
      <button type="button" className="icon-btn" aria-label="Back" onClick={onBack}><Icon name="arrow-left" size={16} /></button>
      <span className="truncate">{title}</span>
      {children}
    </div>
  )
}

// MachineTabs: the machines to choose from. Down the left side of the folder
// picker (vertical), or in one scrolling row above the GitHub lists. Offline
// ones are greyed out and say when they were last seen.
function MachineTabs({ devices, value, onChange, vertical }: { devices: Device[]; value: string; onChange: (id: string) => void; vertical?: boolean }) {
  return (
    <div className={`tp-machines ${vertical ? 'is-vertical' : ''}`} role="tablist" aria-label="Machine">
      {vertical && <p className="tp-machines-label">Machines</p>}
      {devices.map((device) => (
        <button key={device.id} type="button" role="tab" aria-selected={device.id === value} className={device.online ? '' : 'is-offline'} title={device.online ? device.name : `${device.name}: offline, ${deviceStatusText(device)}`} onClick={() => onChange(device.id)}>
          <span className="tp-machine-name">{device.name}</span>
          {vertical && !device.online && <span className="tp-machine-sub">{deviceStatusText(device)}</span>}
        </button>
      ))}
    </div>
  )
}

// useProbeKnown asks each online machine about its own recent folders, then
// whether the same ~/ folder exists on the others. Offline machines are never
// asked.
function useProbeKnown(devices: Device[], folders: KnownFolder[]) {
  const version = useWhereVersion()
  useEffect(() => {
    for (const device of devices) if (device.online) probe(device.id, folders.filter((folder) => folder.deviceId === device.id).map((folder) => folder.path))
  }, [devices, folders])
  useEffect(() => {
    for (const [deviceId, paths] of siblingCandidates(folders, devices)) probe(deviceId, paths)
  }, [version, devices, folders])
  return version
}

// Folders under the usual code roots (~/Projects, ~/code…) on one machine, so a
// long list of projects can be searched without having opened each one first.
const ROOTS = ['Projects', 'projects', 'code', 'Code', 'src', 'dev', 'Developer', 'repos', 'work', 'workspace', 'git', 'GitHub', 'Documents/GitHub']
const rootCache = new Map<string, { at: number; items: { name: string; path: string; root: string }[] }>()

function useProjectFolders(deviceId: string, online: boolean) {
  const [items, setItems] = useState(() => rootCache.get(deviceId)?.items ?? [])
  useEffect(() => {
    const hit = rootCache.get(deviceId)
    if (hit && Date.now() - hit.at < 60_000) { setItems(hit.items); return }
    setItems(hit?.items ?? [])
    if (!deviceId || !online) return
    let alive = true
    Promise.all(ROOTS.map(async (root) => {
      try {
        const listing = await api.get<{ path: string; entries: { name: string; dir: boolean }[] }>(`/api/devices/${deviceId}/fs?path=${encodeURIComponent(`~/${root}`)}`)
        const base = listing.path.replace(/\/$/, '')
        return (listing.entries ?? []).filter((entry) => entry.dir && !entry.name.startsWith('.') && entry.name !== 'node_modules').map((entry) => ({ name: entry.name, path: `${base}/${entry.name}`, root }))
      } catch { return [] }
    })).then((lists) => {
      const seen = new Set<string>()
      const all = lists.flat().filter((item) => (seen.has(item.path) ? false : (seen.add(item.path), true))).sort((a, b) => a.name.localeCompare(b.name))
      rootCache.set(deviceId, { at: Date.now(), items: all })
      if (alive) setItems(all)
    })
    return () => { alive = false }
  }, [deviceId, online])
  return items
}

// A folder on a machine, as one row: what to show and whether it can be used.
interface FolderItem { key: string; deviceId: string; path: string; name: string; branch?: string; usedAt: number }

function folderItems(groups: RepoGroup[]): FolderItem[] {
  const items: FolderItem[] = []
  const seen = new Set<string>()
  for (const group of groups) {
    for (const place of group.places) {
      const info = place.probe?.info
      if (info && !info.exists) continue
      if (place.inferred && !info?.exists) continue // a guess, not confirmed there
      const path = info?.resolved || place.path
      const key = `${place.deviceId}:${path}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push({ key, deviceId: place.deviceId, path, name: baseName(path) || group.name, branch: info?.isRepo ? info.branch : undefined, usedAt: place.usedAt })
    }
  }
  return items.sort((a, b) => b.usedAt - a.usedAt)
}

// FolderPanel is a plain menu, like the model picker: the machine on top (a
// side menu lists the others), its recent folders, then three ways to pick one
// that isn't listed. Choosing a folder is what commits.
function FolderPanel({ devices, threads, settings, onSettings, onSource, close, machine, machines, onMachine, onView }: TargetProps & { close: () => void; machine?: Device; machines: Device[]; onMachine: (id: string) => void; onView: (view: View) => void }) {
  const [query, setQuery] = useState('')
  const search = useRef<HTMLInputElement>(null)
  // The menu takes focus as it opens, so ask for it a beat later (not on touch screens).
  useEffect(() => {
    if (typeof window.matchMedia !== 'function' || !window.matchMedia('(pointer: fine)').matches) return
    const timer = window.setTimeout(() => search.current?.focus(), 60)
    return () => window.clearTimeout(timer)
  }, [])
  const folders = useMemo(() => knownFolders(threads), [threads])
  const version = useProbeKnown(devices, folders)
  const online = !!machine?.online
  const recent = useMemo(() => folderItems(buildGroups(devices, folders)).filter((item) => item.deviceId === machine?.id), [devices, folders, version, machine?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const projects = useProjectFolders(machine?.id ?? '', online)
  const needle = query.trim().toLowerCase()
  const typed = looksLikePath(query) ? query.trim() : ''
  useEffect(() => {
    if (!typed || !online || !machine) return
    const timer = window.setTimeout(() => probe(machine.id, [typed]), 300)
    return () => window.clearTimeout(timer)
  }, [typed, online, machine])
  const typedInfo = machine && typed ? probeOf(machine.id, typed)?.info : undefined

  const recentPaths = new Set(recent.map((item) => item.path))
  const match = (name: string, path: string) => !needle || typed || name.toLowerCase().includes(needle) || path.toLowerCase().includes(needle)
  const recentShown = recent.filter((item) => match(item.name, item.path)).slice(0, needle ? 30 : 6)
  const projectShown = projects.filter((item) => !recentPaths.has(item.path) && match(item.name, item.path)).slice(0, needle ? 40 : 30)
  const pick = (deviceId: string, cwd: string) => { onSource(null); onSettings({ ...settings, deviceId, cwd }); close() }
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (typed) { if (online && typedInfo?.exists && machine) pick(machine.id, typedInfo.resolved || typed); return }
    const first = recentShown[0] ?? (projectShown[0] && { deviceId: machine?.id ?? '', path: projectShown[0].path })
    if (first && online) pick(first.deviceId, first.path)
  }
  return (
    <>
      <Submenu icon={<OsMark os={machine?.os} size={16} />} label={machine?.name ?? 'Choose a machine'} end={machine && !machine.online ? <span className="text-faint">offline</span> : undefined} width={260}>
        {machines.map((device) => (
          <MenuItem key={device.id} icon={<OsMark os={device.os} size={16} />} label={device.name} description={device.online ? undefined : `Offline, ${deviceStatusText(device)}`} checked={device.id === machine?.id} onClick={() => onMachine(device.id)} />
        ))}
      </Submenu>
      <MenuSeparator />
      <label className="tp-search">
        <Icon name="search" size={15} />
        <input ref={search} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKey} placeholder="Search folders or type a path" aria-label="Search folders or type a path" />
      </label>
      <div className="tp-scroll">
        {typed && (
          <MenuItem icon="folder" label={typed} end={<span className="text-faint">{!online ? 'offline' : !typedInfo ? '…' : !typedInfo.exists ? 'not found' : typedInfo.isRepo ? typedInfo.branch : ''}</span>} disabled={!online || !typedInfo?.exists} onClick={() => machine && pick(machine.id, typedInfo?.resolved || typed)} />
        )}
        {!typed && recentShown.length > 0 && <MenuLabel>{needle ? 'Folders' : 'Recent'}</MenuLabel>}
        {!typed && recentShown.map((item) => {
          const current = item.deviceId === settings.deviceId && item.path === settings.cwd
          return <MenuItem key={item.key} icon="folder" label={item.name} end={item.branch ? <span className="text-faint">{item.branch}</span> : undefined} checked={current} disabled={!online} onClick={() => pick(item.deviceId, item.path)} />
        })}
        {!typed && projectShown.length > 0 && <MenuLabel>{needle ? 'Projects' : 'Projects on this machine'}</MenuLabel>}
        {!typed && projectShown.map((item) => (
          <MenuItem key={item.path} icon="folder" label={item.name} end={<span className="text-faint">~/{item.root}</span>} checked={machine?.id === settings.deviceId && item.path === settings.cwd} disabled={!online} onClick={() => machine && pick(machine.id, item.path)} />
        ))}
        {!typed && recentShown.length === 0 && projectShown.length === 0 && <p className="menu-empty">{!online ? `${machine?.name ?? 'This machine'} is offline.` : needle ? 'No folders match. Type a full path, or use Other folder.' : 'No projects found yet. Use Other folder.'}</p>}
      </div>
      <MenuSeparator />
      <MenuItem icon="home" label="Home folder" checked={!!machine && machine.id === settings.deviceId && !settings.cwd} disabled={!online} onClick={() => machine && pick(machine.id, '')} />
      <MenuItem icon="folder-open" label="Other folder…" disabled={!online} onClick={() => onView('browse')} />
      <MenuItem icon="github" label="From GitHub…" onClick={() => onView('github')} />
    </>
  )
}

// ---- GitHub ----

const splitRepo = (name: string) => { const i = name.indexOf('/'); return [name.slice(0, i + 1), name.slice(i + 1)] as const }

// GitHub: pick one of your repos, then a branch. It runs on the machine chosen
// in the tabs. Repos and branches come from the GitHub CLI on one machine (the
// one Review uses).
function GitHubPanel({ devices, threads, settings, onSettings, source, onSource, close, machineId, tabs, onBack }: TargetProps & { close: () => void; machineId: string; tabs: ReactElement; onBack: () => void }) {
  const navigate = useNavigate()
  const [ghPref, setGhPref] = usePref('review.device', '')
  const [repo, setRepo] = useState<GitHubRepo | null>(source ? { nameWithOwner: source.repo, isPrivate: false } : null)
  const [hint, setHint] = useState<string | undefined>(source?.branch)
  const [query, setQuery] = useState('')
  const [choosingGh, setChoosingGh] = useState(false)
  const folders = useMemo(() => knownFolders(threads), [threads])
  const version = useProbeKnown(devices, folders)
  const online = devices.filter((device) => device.online)
  const ghDevice = online.find((device) => device.id === ghPref) ?? online.find((device) => device.id === settings.deviceId) ?? online.find((device) => device.isHub) ?? online[0]
  const groups = useMemo(() => buildGroups(devices, folders), [devices, folders, version]) // eslint-disable-line react-hooks/exhaustive-deps

  const signIn = async () => {
    if (!ghDevice) return
    await api.post(`/api/devices/${ghDevice.id}/sessions`, { name: `gh-login-${Date.now().toString().slice(-5)}`, command: 'gh auth login', kind: 'setup' })
    close()
    navigate(`/machines/${ghDevice.id}?tab=terminal`)
  }

  if (repo) {
    return (
      <BranchView
        key={repo.nameWithOwner}
        repo={repo} hint={hint} devices={devices} groups={groups} machineId={machineId} tabs={tabs} ghDevice={ghDevice}
        onBack={() => { setRepo(null); setHint(undefined) }}
        onPick={(deviceId, branch, cwd) => { onSettings({ ...settings, deviceId, cwd }); onSource({ repo: repo.nameWithOwner, branch }); close() }}
        onSignIn={signIn} onChooseGh={() => { setRepo(null); setChoosingGh(true) }}
      />
    )
  }
  if (choosingGh) {
    return (
      <div className="tp">
        <PanelHead title="Read GitHub with the CLI on" onBack={() => setChoosingGh(false)} />
        <div className="tp-list">
          {online.map((device) => (
            <button key={device.id} type="button" className="tp-row" onClick={() => { setGhPref(device.id); setChoosingGh(false) }}>
              <OsMark os={device.os} size={15} className="tp-icon" /><span className="tp-name">{device.name}</span>
              {device.id === ghDevice?.id && <Icon name="check" size={15} className="tp-check" />}
            </button>
          ))}
        </div>
      </div>
    )
  }
  return (
    <RepoList
      query={query} onQuery={setQuery} devices={devices} groups={groups} ghDevice={ghDevice} onBack={onBack}
      onPick={(next, branch) => { setRepo(next); setHint(branch); setQuery('') }}
      onSignIn={signIn} onChooseGh={() => setChoosingGh(true)}
    />
  )
}

function RepoList({ query, onQuery, devices, groups, ghDevice, onPick, onSignIn, onChooseGh, onBack }: {
  query: string; onQuery: (value: string) => void; devices: Device[]; groups: RepoGroup[]; ghDevice?: Device
  onPick: (repo: GitHubRepo, branch?: string) => void; onSignIn: () => void; onChooseGh: () => void; onBack: () => void
}) {
  const repos = useGitHubRepos(ghDevice?.id, true)
  const ref = parseRepoRef(query)
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const mine = repos.reply?.status === 'ok' ? repos.reply.repos ?? [] : []
  const matches = words.length ? mine.filter((item) => words.every((word) => `${item.nameWithOwner} ${item.description ?? ''}`.toLowerCase().includes(word))) : mine
  // A pasted name or link is looked up on GitHub; other text only when your own repos do not answer it.
  const lookup = ref ? query : words.join(' ').length >= 3 && matches.length < 4 ? query : ''
  const found = useGitHubFind(ghDevice?.id, lookup)
  const foundRepos = found.reply?.status === 'ok' ? found.reply.repos ?? [] : []
  const shown = ref ? mergeRepos(foundRepos, matches) : mergeRepos(matches, foundRepos)
  const failed = repos.reply && repos.reply.status !== 'ok' ? repos.reply : undefined
  const waiting = !ghDevice ? false : repos.loading && !repos.reply
  const searching = !!lookup && found.loading && !found.reply

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && shown[0]) { event.preventDefault(); onPick(shown[0], found.reply?.branch) }
  }

  let body: ReactElement
  if (!ghDevice) body = <p className="tp-empty">No machine is online to read GitHub with.</p>
  else if (repos.error) body = <GhProblem status="error" message={repos.error} device={ghDevice} onRetry={repos.reload} onChoose={onChooseGh} />
  else if (failed && !ref) body = <GhProblem status={failed.status} message={failed.message} device={ghDevice} onRetry={repos.reload} onSignIn={onSignIn} onChoose={onChooseGh} canChoose={devices.filter((device) => device.online).length > 1} />
  else if (waiting) body = <div className="target-gh-skeleton">{[0, 1, 2, 3].map((index) => <div key={index} className="skeleton" />)}</div>
  else {
    body = (
      <>
        {shown.slice(0, 40).map((item) => <RepoRow key={item.nameWithOwner} repo={item} devices={devices} groups={groups} onPick={() => onPick(item, ref && item.nameWithOwner.toLowerCase() === ref.repo.toLowerCase() ? ref.branch ?? found.reply?.branch : undefined)} />)}
        {searching && <div className="target-gh-skeleton"><div className="skeleton" /></div>}
        {shown.length === 0 && !searching && <p className="tp-empty">{words.length ? 'No repos match. Paste owner/name or a link to use any repo.' : 'No repos found.'}</p>}
        {found.reply && found.reply.status !== 'ok' && ref && <p className="tp-empty target-bad">{found.reply.message}</p>}
      </>
    )
  }

  return (
    <div className="tp">
      <PanelHead title="From GitHub" onBack={onBack}>
        {ghDevice && <button type="button" className="tp-head-link" onClick={onChooseGh} title="Which machine's GitHub CLI to use">{repos.reply?.login || ghDevice.name}{repos.loading && repos.reply && <span className="spinner" aria-label="Loading more repos" />}</button>}
      </PanelHead>
      <label className="tp-search">
        <Icon name="search" size={15} />
        <input value={query} onChange={(event) => onQuery(event.target.value)} onKeyDown={onKey} placeholder="Search your repos or paste a link" aria-label="Search your repos or paste a GitHub link" autoFocus={typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches} />
      </label>
      <div className="tp-list tp-list-tall">{body}</div>
    </div>
  )
}

function RepoRow({ repo, devices, groups, onPick }: { repo: GitHubRepo; devices: Device[]; groups: RepoGroup[]; onPick: () => void }) {
  const [owner, name] = splitRepo(repo.nameWithOwner)
  const clone = clonesOf(groups, repo.nameWithOwner)[0]
  const cloneOn = clone && devices.find((device) => device.id === clone.deviceId)?.name
  return (
    <button type="button" className="tp-row" onClick={onPick} title={repo.description || repo.nameWithOwner}>
      <Icon name={repo.isPrivate ? 'lock' : 'github'} size={15} className="tp-icon" />
      <span className="tp-name"><span className="tp-dim">{owner}</span>{name}</span>
      {cloneOn && <span className="tp-side">on {cloneOn}</span>}
    </button>
  )
}

// BranchView is the second step: which branch. It runs on the machine chosen
// in the tabs, using its clone if it has one.
function BranchView({ repo, hint, devices, groups, machineId, tabs, ghDevice, onBack, onPick, onSignIn, onChooseGh }: {
  repo: GitHubRepo; hint?: string; devices: Device[]; groups: RepoGroup[]; machineId: string; tabs: ReactElement; ghDevice?: Device
  onBack: () => void; onPick: (deviceId: string, branch: string, cwd: string) => void; onSignIn: () => void; onChooseGh: () => void
}) {
  const clones = clonesOf(groups, repo.nameWithOwner)
  const [query, setQuery] = useState('')
  const branches = useGitHubBranches(ghDevice?.id, repo.nameWithOwner)
  const failed = branches.reply && branches.reply.status !== 'ok' ? branches.reply : undefined
  const list: GitHubBranch[] = withBranch(branches.reply?.branches ?? [], hint)
  const needle = query.trim().toLowerCase()
  const shown = needle ? list.filter((branch) => branch.name.toLowerCase().includes(needle) || `#${branch.pr?.number}` === needle || branch.pr?.title.toLowerCase().includes(needle)) : list
  const machine = devices.find((device) => device.id === machineId)
  const ready = !!machine?.online
  const info = clones.find((place) => place.deviceId === machineId)?.probe?.info
  const cwdFor = (branch: string) => (info?.isRepo && info.branch === branch ? info.resolved : '')
  const typedBranch = query.trim()
  const canUseTyped = validBranchName(typedBranch) && !list.some((branch) => branch.name === typedBranch)
  const choose = (branch: string) => { if (ready) onPick(machineId, branch, cwdFor(branch)) }

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (shown[0]) choose(shown[0].name)
    else if (canUseTyped) choose(typedBranch)
  }

  let body: ReactElement
  if (!ghDevice) body = <p className="tp-empty">No machine is online to read GitHub with.</p>
  else if (branches.error) body = <GhProblem status="error" message={branches.error} device={ghDevice} onRetry={branches.reload} onChoose={onChooseGh} />
  else if (failed) body = <GhProblem status={failed.status} message={failed.message} device={ghDevice} onRetry={branches.reload} onSignIn={onSignIn} onChoose={onChooseGh} canChoose={devices.filter((device) => device.online).length > 1} />
  else if (!branches.reply) body = <div className="target-gh-skeleton">{[0, 1, 2, 3].map((index) => <div key={index} className="skeleton" />)}</div>
  else {
    body = (
      <>
        {shown.map((branch) => (
          <button key={branch.name} type="button" className="tp-row" disabled={!ready} onClick={() => choose(branch.name)} title={branch.pr?.title}>
            <Icon name={branch.pr ? 'pull-request' : 'git-branch'} size={15} className="tp-icon" />
            <span className="tp-name">{branch.name}</span>
            <span className="tp-side">{branch.isDefault ? 'default' : branch.pr ? `#${branch.pr.number}` : ''}</span>
          </button>
        ))}
        {canUseTyped && (
          <button type="button" className="tp-row" disabled={!ready} onClick={() => choose(typedBranch)}>
            <Icon name="plus" size={15} className="tp-icon" /><span className="tp-name">Use “{typedBranch}”</span>
          </button>
        )}
        {!shown.length && !canUseTyped && <p className="tp-empty">No branches match.</p>}
      </>
    )
  }

  return (
    <div className="tp">
      <PanelHead title={repo.nameWithOwner} onBack={onBack} />
      {tabs}
      <p className="tp-hint">{!machine ? 'Choose a machine.' : !ready ? `${machine.name} is offline.` : info?.isRepo ? `Uses your clone on ${machine.name}.` : `Clones it to ${machine.name}.`}</p>
      <label className="tp-search">
        <Icon name="search" size={15} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKey} placeholder="Find a branch" aria-label="Find a branch or pull request" autoFocus={typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches} />
      </label>
      <div className="tp-list tp-list-tall">{body}</div>
    </div>
  )
}

// GhProblem says why GitHub could not be read and what to do about it.
function GhProblem({ status, message, device, onRetry, onSignIn, onChoose, canChoose }: {
  status: string; message?: string; device: Device; onRetry: () => void; onSignIn?: () => void; onChoose: () => void; canChoose?: boolean
}) {
  const text = status === 'no-gh' ? `The GitHub CLI isn’t installed on ${device.name}.` : status === 'no-auth' ? `The GitHub CLI isn’t signed in on ${device.name}.` : message || 'Could not reach GitHub.'
  return (
    <div className="target-gh-problem" role="alert">
      <Icon name="alert" size={16} />
      <p>{text}</p>
      <div className="target-gh-problem-actions">
        {status === 'no-auth' && onSignIn && <button type="button" className="btn btn-sm btn-dark" onClick={onSignIn}>Sign in on {device.name}</button>}
        {status === 'no-gh' && <a className="btn btn-sm btn-outline" href="https://cli.github.com" target="_blank" rel="noreferrer">Get the GitHub CLI</a>}
        {(status === 'error' || status === 'not-found') && <button type="button" className="btn btn-sm btn-outline" onClick={onRetry}>Try again</button>}
        {(status === 'no-gh' || status === 'no-auth') && canChoose && <button type="button" className="btn btn-sm btn-outline" onClick={onChoose}>Use another machine</button>}
      </div>
    </div>
  )
}

// SessionWhere is the read-only "where it runs" line for an existing session:
// the machine the session actually runs on, its folder and branch. It never
// offers to change them; a session stays where it started.
export function SessionWhere({ deviceId, deviceName, cwd, device }: { deviceId: string; deviceName: string; cwd: string; device?: Device }) {
  const online = device ? device.online : true
  const { entry, home } = useFolderInfo(deviceId, cwd, online)
  const path = tildePath(cwd || '~', home)
  const info = entry?.info
  const branch = info?.isRepo ? info.branch : undefined
  return (
    <Link to={`/machines/${deviceId}`} className={`where-line ${online ? '' : 'is-offline'}`} title={`Runs on ${device?.name ?? deviceName}, folder ${path}${branch ? `, branch ${branch}` : ''}${online ? '' : ', offline'}`}>
      {!online && <span className="dot dot-amber" />}
      <span className="where-name">{device?.name ?? deviceName}</span>
      {!online && <span className="where-off">offline</span>}
      <span className="target-sep">·</span>
      <span className="where-path">{shortPath(path)}</span>
      {branch && <><span className="target-sep">·</span><Icon name="git-branch" size={13} className="target-branch-icon" /><span className="where-branch">{branch}</span></>}
    </Link>
  )
}
