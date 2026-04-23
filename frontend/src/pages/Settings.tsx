import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Save, Download, RefreshCw, Link2, Unlink, Database, Sparkles, AlertTriangle, Clock } from 'lucide-react'
import { AppShell } from '../components/layout/AppShell'
import { useTabExplainer } from '../components/TabExplainer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { preferences, calendar, analytics } from '../lib/api'
import type { DbStats, GoogleCalendarStatus } from '../lib/api'

// ---------------------------------------------------------------------------
// Preferences form
// ---------------------------------------------------------------------------
function PreferencesSection() {
  const qc = useQueryClient()
  const [workStart, setWorkStart] = useState('09:00')
  const [workEnd, setWorkEnd]     = useState('18:00')
  const [dirty, setDirty]         = useState(false)

  const { data: prefs } = useQuery({
    queryKey: ['preferences'],
    queryFn: preferences.getAll,
  })

  useEffect(() => {
    if (prefs) {
      // Scheduling engine reads work_start_hour/work_end_hour (integer strings)
      const startHour = prefs.work_start_hour ?? '9'
      const endHour = prefs.work_end_hour ?? '18'
      setWorkStart(`${startHour.padStart(2, '0')}:00`)
      setWorkEnd(`${endHour.padStart(2, '0')}:00`)
      setDirty(false)
    }
  }, [prefs])

  const savePrefs = useMutation({
    mutationFn: async () => {
      // Save as integer hour strings — matches keys the scheduling engine reads
      const startHour = String(parseInt(workStart.split(':')[0], 10))
      const endHour = String(parseInt(workEnd.split(':')[0], 10))
      await Promise.all([
        preferences.set('work_start_hour', startHour),
        preferences.set('work_end_hour', endHour),
      ])
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['preferences'] })
      toast.success('Preferences saved')
      setDirty(false)
    },
    onError: () => toast.error('Failed to save preferences'),
  })

  return (
    <div className="card p-6 space-y-4">
      <h3>Preferences</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Work Day Start</label>
          <Input
            type="time"
            value={workStart}
            onChange={e => { setWorkStart(e.target.value); setDirty(true) }}
            className="mt-1 h-8"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Work Day End</label>
          <Input
            type="time"
            value={workEnd}
            onChange={e => { setWorkEnd(e.target.value); setDirty(true) }}
            className="mt-1 h-8"
          />
        </div>
      </div>
      <Button
        size="sm"
        onClick={() => savePrefs.mutate()}
        disabled={!dirty || savePrefs.isPending}
      >
        <Save size={13} className="mr-1" />
        Save Preferences
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Database stats section
// ---------------------------------------------------------------------------
function DbStatsSection() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['analytics-stats'],
    queryFn: analytics.stats,
  })

  const rows: Array<{ label: string; key: keyof DbStats }> = [
    { label: 'Tasks (active)',        key: 'tasks_active' },
    { label: 'Tasks (total)',         key: 'tasks_total' },
    { label: 'Projects (active)',     key: 'goals_active' },
    { label: 'Habits (active)',       key: 'habits_active' },
    { label: 'Habit Completions',     key: 'habit_completions' },
    { label: 'Calendar Events (active)', key: 'events_active' },
    { label: 'AI Messages',           key: 'ai_messages' },
  ]

  return (
    <div className="card p-6">
      <div className="flex items-center gap-2 mb-4">
        <Database size={16} className="text-slate-400" />
        <h3>Database Stats</h3>
      </div>
      {isLoading ? (
        <div className="space-y-2">
          {rows.map((_, i) => <div key={i} className="h-6 bg-slate-50 rounded animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-1">
          {rows.map(r => (
            <div key={r.key} className="flex justify-between text-sm py-1 border-b border-slate-50">
              <span className="text-slate-600">{r.label}</span>
              <span className="font-medium text-slate-900">{stats?.[r.key] ?? 0}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Google Calendar section
// ---------------------------------------------------------------------------
function GoogleCalendarSection() {
  const qc = useQueryClient()
  const [syncing, setSyncing] = useState(false)

  // Handle OAuth callback: Google redirects to /settings?code=AUTH_CODE
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    if (!code) return
    // Clear the code from URL immediately to prevent re-exchange on re-render
    window.history.replaceState({}, '', window.location.pathname)
    calendar.exchangeCode(code)
      .then(() => {
        qc.invalidateQueries({ queryKey: ['gc-status'] })
        toast.success('Google Calendar connected!')
      })
      .catch((err) => {
        console.error('[OAuth] exchange-code failed:', err)
        toast.error('Failed to connect Google Calendar')
      })
  }, [qc])

  const { data: gcStatus } = useQuery({
    queryKey: ['gc-status'],
    queryFn: calendar.status,
  })

  const status = gcStatus as GoogleCalendarStatus | undefined

  async function handleConnect() {
    try {
      const redirectUri = `${window.location.origin}/settings`
      const { url } = await calendar.authUrl(redirectUri)
      window.location.href = url
    } catch {
      toast.error('Failed to get Google Calendar auth URL. Ensure client_secrets.json is configured.')
    }
  }

  async function handleDisconnect() {
    try {
      await calendar.disconnect()
      qc.invalidateQueries({ queryKey: ['gc-status'] })
      toast.success('Disconnected from Google Calendar')
    } catch {
      toast.error('Failed to disconnect')
    }
  }

  async function handleSync() {
    setSyncing(true)
    try {
      const result = await calendar.sync()
      qc.invalidateQueries({ queryKey: ['events'] })
      toast.success(`Synced ${result.total_fetched} events`)
    } catch {
      toast.error('Sync failed — ensure Google Calendar is connected')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="card p-6">
      <div className="flex items-center gap-2 mb-4">
        <h3>Google Calendar</h3>
        {status?.authenticated ? (
          <span className="badge-active">Connected</span>
        ) : (
          <span className="badge-todo">Not connected</span>
        )}
      </div>

      {!status?.has_secrets_file && (
        <p className="text-xs text-warning bg-warning-light px-3 py-2 rounded mb-4">
          client_secrets.json not found. Place it in the backend directory to enable Google Calendar.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {status?.authenticated ? (
          <>
            <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
              <RefreshCw size={13} className={`mr-1 ${syncing ? 'animate-spin' : ''}`} />
              Sync Now
            </Button>
            <Button size="sm" variant="outline" onClick={handleDisconnect} className="text-danger border-danger/30">
              <Unlink size={13} className="mr-1" />
              Disconnect
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={handleConnect} disabled={!status?.has_secrets_file}>
            <Link2 size={13} className="mr-1" />
            Connect Google Calendar
          </Button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Export section
// ---------------------------------------------------------------------------
function ExportSection() {
  async function handleExport() {
    try {
      const [tasksData, goalsData, habitsData] = await Promise.all([
        fetch('/api/tasks').then(r => r.json()),
        fetch('/api/goals').then(r => r.json()),
        fetch('/api/habits').then(r => r.json()),
      ])
      const blob = new Blob(
        [JSON.stringify({ tasks: tasksData, goals: goalsData, habits: habitsData }, null, 2)],
        { type: 'application/json' }
      )
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `planner-export-${new Date().toISOString().split('T')[0]}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Data exported')
    } catch {
      toast.error('Export failed')
    }
  }

  return (
    <div className="card p-6">
      <h3 className="mb-3">Export Data</h3>
      <p className="text-sm text-slate-500 mb-4">
        Download all your tasks, goals, and habits as a JSON file.
      </p>
      <Button size="sm" variant="outline" onClick={handleExport}>
        <Download size={13} className="mr-1" />
        Export JSON
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Demo Data section — reset & re-seed the database for demo/showcase
// ---------------------------------------------------------------------------
function DemoDataSection() {
  const qc = useQueryClient()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [seeding, setSeeding] = useState(false)

  async function handleSeed() {
    setSeeding(true)
    try {
      const res = await fetch('/api/admin/seed?reset=true', { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const counts = await res.json()
      // Refresh every view that touches the DB.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['tasks'] }),
        qc.invalidateQueries({ queryKey: ['goals'] }),
        qc.invalidateQueries({ queryKey: ['projects'] }),
        qc.invalidateQueries({ queryKey: ['habits'] }),
        qc.invalidateQueries({ queryKey: ['events'] }),
        qc.invalidateQueries({ queryKey: ['events-scheduling'] }),
        qc.invalidateQueries({ queryKey: ['analytics-stats'] }),
        qc.invalidateQueries({ queryKey: ['preferences'] }),
        qc.invalidateQueries({ queryKey: ['db-stats'] }),
      ])
      const parts = [
        `${counts.tasks ?? 0} tasks`,
        `${counts.goals ?? 0} projects`,
        `${counts.habits ?? 0} habits`,
        `${counts.events ?? 0} events`,
      ]
      toast.success(`Demo data ready — ${parts.join(' · ')}`)
      setConfirmOpen(false)
    } catch (err) {
      toast.error(`Seed failed: ${err instanceof Error ? err.message : 'check backend logs'}`)
    } finally {
      setSeeding(false)
    }
  }

  return (
    <>
      <div className="card p-6">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={16} className="text-primary" />
          <h3>Demo Data</h3>
        </div>
        <p className="text-sm text-slate-600 mb-1">
          Replace your local data with a rich showcase dataset —
          projects with subprojects, historical task completions,
          habit streaks, and calendar events.
        </p>
        <p className="text-xs text-slate-400 mb-4">
          Google Calendar events and your work-hour preferences are preserved.
          Local task blocks and meetings are scheduled around any existing events.
        </p>
        <Button
          size="sm"
          onClick={() => setConfirmOpen(true)}
          disabled={seeding}
          className="bg-primary text-white hover:bg-primary-700"
        >
          {seeding ? <RefreshCw size={13} className="mr-1 animate-spin" /> : <Database size={13} className="mr-1" />}
          Reset &amp; Seed Demo Data
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={v => !seeding && setConfirmOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-warning" />
              Replace all local data?
            </DialogTitle>
            <DialogDescription>
              This will <strong>permanently delete</strong> all local tasks, projects, habits
              (and their completion history), and locally-created calendar events —
              then insert a fresh demo dataset.
              <br /><br />
              <strong>Preserved:</strong> Google Calendar events, work-hour preferences.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={seeding}>
              Cancel
            </Button>
            <Button
              onClick={handleSeed}
              disabled={seeding}
              className="bg-danger text-white hover:bg-danger-dark"
            >
              {seeding ? <RefreshCw size={13} className="mr-1 animate-spin" /> : null}
              Yes — replace and seed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export function Settings() {
  const settingsExplainer = useTabExplainer({
    storageKey: 'explainer-settings',
    title: 'Settings',
    subtitle: 'Preferences, Google Calendar, and a one-click demo dataset.',
    highlights: [
      { icon: Clock,    title: 'Work hours',           body: 'These power the smart scheduler — your work-day window for finding free slots.' },
      { icon: Link2,    title: 'Google Calendar',      body: 'Connect once via OAuth and your real events are pulled in (read-only) and respected by the scheduler.' },
      { icon: Database, title: 'Reset & Seed Demo',    body: 'Loads a rich showcase dataset — projects, subprojects, 30-day habit history, scheduled tasks. Google events are preserved.' },
    ],
    tip: 'Tip: connect Google first, then seed — task blocks will be placed in genuinely free slots.',
  })

  return (
    <AppShell title="Settings" action={settingsExplainer.button}>
      {settingsExplainer.dialog}
      <div className="max-w-2xl space-y-6">
        <PreferencesSection />
        <Separator />
        <GoogleCalendarSection />
        <Separator />
        <DemoDataSection />
        <Separator />
        <ExportSection />
        <Separator />
        <DbStatsSection />
      </div>
    </AppShell>
  )
}
