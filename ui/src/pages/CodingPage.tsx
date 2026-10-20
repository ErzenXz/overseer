import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import FxTerminal from '../components/FxTerminal'
import ProjectModal from '../components/ProjectModal'
import { useHubEvents, usePoll } from '../hooks'
import type { Device, Project } from '../types'
import Icon from '../components/Icon'

export default function CodingPage() {
  const { projectId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [projects, setProjectsState] = useState<Project[]>([])
  // Polls, hub events and local edits race; a response may only apply if no
  // newer request started and no local edit happened while it was in flight.
  const requestSeq = useRef(0)
  const editSeq = useRef(0)
  const setProjects = useCallback((update: Project[] | ((items: Project[]) => Project[])) => {
    editSeq.current++
    setProjectsState(update)
  }, [])
  const [devices, setDevices] = useState<Device[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Project | undefined>()
  const [showModal, setShowModal] = useState(false)
  const [showLoginHint, setShowLoginHint] = useState(() => localStorage.getItem('liveagent.fx.login-hint') !== 'hidden')
  const navigate = useNavigate()

  const load = useCallback(async () => {
    const request = ++requestSeq.current
    const edits = editSeq.current
    try {
      const [nextProjects, nextDevices] = await Promise.all([
        api.get<Project[]>('/api/projects'),
        api.get<Device[]>('/api/devices'),
      ])
      if (request !== requestSeq.current) return
      setDevices(nextDevices)
      if (edits === editSeq.current) setProjectsState(nextProjects)
      setLoaded(true)
      setError('')
    } catch {
      if (request === requestSeq.current) setError('Unable to load projects. Please try again.')
    }
  }, [])

  usePoll(load, 12_000)
  useHubEvents((event) => {
    if (event.type === 'device.online' || event.type === 'device.offline') load()
  })

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setEditing(undefined)
      setShowModal(true)
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const project = useMemo(() => projects.find((item) => item.id === projectId), [projectId, projects])
  const device = useMemo(() => devices.find((item) => item.id === project?.deviceId), [devices, project])

  const removeProject = async () => {
    if (!project || !window.confirm(`Remove ${project.name} from Overseer? Files on ${device?.name ?? 'the machine'} will not be deleted.`)) return
    try {
      await api.del(`/api/projects/${project.id}`)
      window.dispatchEvent(new Event('liveagent:projects-changed'))
      setProjects((items) => items.filter((item) => item.id !== project.id))
      navigate('/projects')
    } catch { setError('Could not remove the project. Please try again.') }
  }

  if (!projectId) {
    return (
      <div className="main-scroll"><div className="page">
        <h1 className="page-title">Projects</h1>
        <p className="page-sub">Folders on your machines, with a browser workspace and one-click agent sessions</p>
        <div className="page-toolbar mb-8"><span className="grow" /><button onClick={() => { setEditing(undefined); setShowModal(true) }} className="btn btn-dark"><Icon name="plus" size={16} />New project</button></div>
        {error && <div className="error-banner" role="alert">{error}<button onClick={load}>Retry</button></div>}
        {!loaded ? <p className="text-sm text-muted">{error ? 'Projects unavailable.' : 'Loading projects…'}</p> : projects.length === 0 ? <div className="empty-state"><span className="empty-icon"><Icon name="code" size={26} /></span><h2>No projects yet</h2><p>Open a directory on a connected machine to start a project.</p><button onClick={() => setShowModal(true)} className="btn-primary"><Icon name="plus" size={16} />New project</button><span className="mt-5 text-[11px] text-muted">Powered by fx · Runs in your browser</span></div> : <div className="grid-cards">{projects.map((item) => { const machine = devices.find((d) => d.id === item.deviceId); return <div key={item.id} className="tpl-card"><Link to={`/projects/${item.id}`} className="tpl-card-title hover:underline"><Icon name="folder" size={19} className="text-muted" />{item.name}</Link><p className="tpl-card-desc font-mono text-[13px]">{item.path}</p><div className="tpl-card-tags items-center"><span className="chip"><span className={`dot ${machine?.online ? 'dot-green' : ''}`} />{machine?.name ?? 'Unknown machine'}</span><span className="flex-1" /><Link to={`/?device=${item.deviceId}&cwd=${encodeURIComponent(item.path)}`} className="btn btn-sm btn-outline">New session</Link><Link to={`/projects/${item.id}`} className="btn btn-sm btn-ghost">Open</Link></div></div> })}</div>}
        {showModal && (
          <ProjectModal
            devices={devices}
            onClose={() => setShowModal(false)}
            onSaved={(saved) => { setShowModal(false); setProjects((items) => [...items.filter((item) => item.id !== saved.id), saved]); navigate(`/projects/${saved.id}`) }}
          />
        )}
      </div></div>
    )
  }

  if (!project) {
    return <div className="page-shell"><div className="empty-state"><h2>{error || (loaded ? 'Project not found' : 'Loading workspace…')}</h2><Link to="/projects" className="btn-secondary">Back to projects</Link></div></div>
  }

  return (
    <div className="coding-shell">
      {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError('')}>Dismiss</button></div>}
      <header className="coding-toolbar">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold text-ink">{project.name}</h1>
            <span className={`node-dot ${device?.online ? 'node-dot-online' : ''}`} />
          </div>
          <p className="mt-0.5 truncate font-mono text-[10px] text-muted">{project.path}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="machine-pill">
            <DeviceIcon />
            {device?.name ?? 'Unknown machine'}
          </span>
          <button onClick={() => { setEditing(project); setShowModal(true) }} className="toolbar-button" aria-label="Edit project"><SlidersIcon /></button>
          <button onClick={removeProject} className="toolbar-button toolbar-button-danger" aria-label="Remove project"><TrashIcon /></button>
        </div>
      </header>

      {showLoginHint && (
        <div className="fx-login-hint">
          <span className="fx-wordmark">fx</span>
          <p><strong>One fx login, every machine.</strong> Type <code>/login</code> below once. Your session stays in this browser while project commands run on <span>{device?.name}</span>.</p>
          <button onClick={() => { localStorage.setItem('liveagent.fx.login-hint', 'hidden'); setShowLoginHint(false) }} aria-label="Dismiss login hint">×</button>
        </div>
      )}

      <main className="min-h-0 flex-1">
        <FxTerminal project={project} device={device} />
      </main>

      <footer className="coding-statusbar">
        <span className="inline-flex items-center gap-1.5"><span className={`node-dot ${device?.online ? 'node-dot-online' : ''}`} />{device?.online ? 'Connected' : 'Offline'}</span>
        <span className="hidden items-center gap-1.5 font-mono min-[480px]:inline-flex">fx / browser runtime</span>
        <span className="ml-auto hidden sm:inline">Commands execute in {project.path}</span>
      </footer>

      {showModal && (
        <ProjectModal
          devices={devices}
          project={editing}
          onClose={() => setShowModal(false)}
          onSaved={(saved) => {
            setShowModal(false)
            setProjects((current) => current.map((item) => item.id === saved.id ? saved : item))
            navigate(`/projects/${saved.id}`)
          }}
        />
      )}
    </div>
  )
}

function DeviceIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><rect x="3" y="5" width="18" height="13" rx="2" /><path d="M8 21h8M12 18v3" /></svg>
}

function SlidersIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></svg>
}

function TrashIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg>
}
