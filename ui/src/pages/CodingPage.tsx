import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import FxTerminal from '../components/FxTerminal'
import ProjectModal from '../components/ProjectModal'
import { useHubEvents, usePoll } from '../hooks'
import type { Device, Project } from '../types'

export default function CodingPage() {
  const { projectId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [projects, setProjects] = useState<Project[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState<Project | undefined>()
  const [showModal, setShowModal] = useState(false)
  const [showLoginHint, setShowLoginHint] = useState(() => localStorage.getItem('liveagent.fx.login-hint') !== 'hidden')
  const navigate = useNavigate()

  const load = useCallback(async () => {
    try {
      const [nextProjects, nextDevices] = await Promise.all([
        api.get<Project[]>('/api/projects'),
        api.get<Device[]>('/api/devices'),
      ])
      setProjects(nextProjects)
      setDevices(nextDevices)
      setLoaded(true)
    } catch {
      /* keep the last live snapshot */
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

  useEffect(() => {
    if (!projectId && projects.length > 0) navigate(`/code/${projects[0].id}`, { replace: true })
  }, [navigate, projectId, projects])

  const project = useMemo(() => projects.find((item) => item.id === projectId), [projectId, projects])
  const device = useMemo(() => devices.find((item) => item.id === project?.deviceId), [devices, project])

  const removeProject = async () => {
    if (!project || !window.confirm(`Remove ${project.name} from LiveAgent? Files on ${device?.name ?? 'the machine'} will not be deleted.`)) return
    await api.del(`/api/projects/${project.id}`)
    window.dispatchEvent(new Event('liveagent:projects-changed'))
    const remaining = projects.filter((item) => item.id !== project.id)
    setProjects(remaining)
    navigate(remaining[0] ? `/code/${remaining[0].id}` : '/code')
  }

  if (loaded && projects.length === 0) {
    return (
      <div className="code-empty">
        <div className="code-empty-mark"><span>fx</span></div>
        <p className="eyebrow mt-7">Coding workspace</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-white">What should we build?</h1>
        <p className="mt-3 max-w-lg text-center text-sm leading-6 text-zinc-500">
          Add a project, choose the PC where its files live, and let fx work there from this browser.
        </p>
        <button onClick={() => setShowModal(true)} className="btn-primary mt-6">Add your first project</button>
        {showModal && (
          <ProjectModal
            devices={devices}
            onClose={() => setShowModal(false)}
            onSaved={(saved) => { setShowModal(false); setProjects([saved]); navigate(`/code/${saved.id}`) }}
          />
        )}
      </div>
    )
  }

  if (!project) {
    return <div className="grid h-full place-items-center text-sm text-zinc-600">Loading workspace…</div>
  }

  return (
    <div className="coding-shell">
      <header className="coding-toolbar">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold text-zinc-100">{project.name}</h1>
            <span className={`node-dot ${device?.online ? 'node-dot-online' : ''}`} />
          </div>
          <p className="mt-0.5 truncate font-mono text-[10px] text-zinc-600">{project.path}</p>
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
            navigate(`/code/${saved.id}`)
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
