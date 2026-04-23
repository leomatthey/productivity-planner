import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/sonner'

import { Welcome }     from './pages/Welcome'
import { Dashboard }   from './pages/Dashboard'
import { Tasks }       from './pages/Tasks'
import { Projects }    from './pages/Projects'
import { Calendar }    from './pages/Calendar'
import { Habits }      from './pages/Habits'
import { AIAssistant } from './pages/AIAssistant'
import { Analytics }   from './pages/Analytics'
import { Settings }    from './pages/Settings'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

const FIRST_VISIT_KEY = 'stride-visited'

/**
 * On the very first visit (no localStorage flag), redirect to /welcome.
 * Sets the flag immediately so subsequent loads land on the dashboard.
 */
function FirstVisitGate() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (typeof window === 'undefined') return
    let visited = false
    try { visited = localStorage.getItem(FIRST_VISIT_KEY) === 'true' } catch { /* private mode */ }
    if (!visited && location.pathname === '/') {
      try { localStorage.setItem(FIRST_VISIT_KEY, 'true') } catch { /* ignore */ }
      navigate('/welcome', { replace: true })
    }
  }, [location.pathname, navigate])

  return null
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <FirstVisitGate />
        <Routes>
          <Route path="/welcome"   element={<Welcome />} />
          <Route path="/"          element={<Dashboard />} />
          <Route path="/tasks"     element={<Tasks />} />
          <Route path="/projects"  element={<Projects />} />
          <Route path="/goals"     element={<Navigate to="/projects" replace />} />
          <Route path="/calendar"  element={<Calendar />} />
          <Route path="/habits"    element={<Habits />} />
          <Route path="/ai"        element={<AIAssistant />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/settings"  element={<Settings />} />
        </Routes>
      </BrowserRouter>
      <Toaster richColors position="bottom-right" />
    </QueryClientProvider>
  )
}
