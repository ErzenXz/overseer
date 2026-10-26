import { useCallback, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { api, setUnauthorizedHandler } from './api'
import Layout from './components/Layout'
import Login from './pages/Login'
import AcceptInvite from './pages/AcceptInvite'
import NewSessionPage from './pages/NewSessionPage'
import SessionPage from './pages/SessionPage'
import SessionsPage from './pages/SessionsPage'
import AutomationsPage from './pages/AutomationsPage'
import AutopilotPage from './pages/AutopilotPage'
import RecipeImport from './pages/RecipeImport'
import MachinesPage from './pages/MachinesPage'
import MachinePage from './pages/MachinePage'
import ReviewPage from './pages/ReviewPage'
import SkillsPage from './pages/SkillsPage'
import CustomizePage from './pages/CustomizePage'
import SettingsPage from './pages/SettingsPage'
import CodingPage from './pages/CodingPage'
import ArenaRoot from './pages/ArenaPage'
import WrappedPage from './pages/WrappedPage'
import MissionPage from './pages/MissionPage'
import SharePage from './pages/SharePage'

interface Me {
  setupDone: boolean
  authenticated: boolean
  version: string
  multiUser?: boolean // more than one person: sign-in asks for a name
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null)
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const refresh = useCallback(async () => {
    try {
      setMe(await api.get<Me>('/api/me'))
    } catch {
      // Hub unreachable; show login screen which will surface errors.
      setMe({ setupDone: true, authenticated: false, version: '' })
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setMe((m) => (m ? { ...m, authenticated: false } : m))
      navigate('/login')
    })
  }, [navigate])

  // Shared session links are public: no login, no app around them.
  if (pathname.startsWith('/s/')) return <SharePage />

  if (me === null) {
    return <div className="flex h-full items-center justify-center"><span className="spinner" /></div>
  }

  if (!me.authenticated) {
    return (
      <Routes>
        <Route path="/invite/:token" element={<AcceptInvite onSuccess={refresh} />} />
        <Route path="*" element={<Login setupDone={me.setupDone} multiUser={!!me.multiUser} onSuccess={refresh} />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<NewSessionPage />} />
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/sessions/:id" element={<SessionPage />} />
        <Route path="/automations" element={<AutomationsPage />} />
        <Route path="/automations/import" element={<RecipeImport />} />
        <Route path="/automations/autopilot" element={<AutopilotPage />} />
        <Route path="/machines" element={<MachinesPage />} />
        <Route path="/machines/:id" element={<MachinePage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/arena/:id?" element={<ArenaRoot />} />
        <Route path="/wrapped" element={<WrappedPage />} />
        <Route path="/mission" element={<MissionPage />} />
        <Route path="/projects" element={<CodingPage />} />
        <Route path="/projects/:projectId" element={<CodingPage />} />
        <Route path="/customize" element={<CustomizePage />} />
        <Route path="/skills" element={<SkillsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/:section" element={<SettingsPage />} />
        {/* Old links keep working. */}
        <Route path="/new" element={<Navigate to="/" replace />} />
        <Route path="/agents" element={<Navigate to="/sessions" replace />} />
        <Route path="/fleet" element={<Navigate to="/machines" replace />} />
        <Route path="/setup" element={<Navigate to="/machines?tab=setup" replace />} />
        <Route path="/code" element={<Navigate to="/projects" replace />} />
        <Route path="/code/:projectId" element={<LegacyProject />} />
        <Route path="/devices/:id" element={<LegacyDevice />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

function LegacyDevice() {
  const { id = '' } = useParams()
  const { search } = useLocation()
  const session = new URLSearchParams(search).get('session')
  return <Navigate to={`/machines/${id}${session ? `?tab=terminal&session=${encodeURIComponent(session)}` : ''}`} replace />
}

function LegacyProject() {
  const { projectId = '' } = useParams()
  return <Navigate to={`/projects/${projectId}`} replace />
}
