import { useCallback, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { api, setUnauthorizedHandler } from './api'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import DevicePage from './pages/DevicePage'
import AgentsPage from './pages/AgentsPage'
import SettingsPage from './pages/SettingsPage'
import SetupPage from './pages/SetupPage'

interface Me {
  setupDone: boolean
  authenticated: boolean
  version: string
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null)
  const navigate = useNavigate()

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

  if (me === null) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        Loading…
      </div>
    )
  }

  if (!me.authenticated) {
    return (
      <Routes>
        <Route
          path="*"
          element={<Login setupDone={me.setupDone} onSuccess={refresh} />}
        />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route element={<Layout version={me.version} />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/devices/:id" element={<DevicePage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
