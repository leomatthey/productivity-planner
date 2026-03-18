import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Dashboard }    from './pages/Dashboard'
import { Tasks }        from './pages/Tasks'
import { Goals }        from './pages/Goals'
import { Calendar }     from './pages/Calendar'
import { Habits }       from './pages/Habits'
import { AIAssistant }  from './pages/AIAssistant'
import { Analytics }    from './pages/Analytics'
import { Settings }     from './pages/Settings'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"          element={<Dashboard />} />
        <Route path="/tasks"     element={<Tasks />} />
        <Route path="/goals"     element={<Goals />} />
        <Route path="/calendar"  element={<Calendar />} />
        <Route path="/habits"    element={<Habits />} />
        <Route path="/ai"        element={<AIAssistant />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/settings"  element={<Settings />} />
      </Routes>
    </BrowserRouter>
  )
}
