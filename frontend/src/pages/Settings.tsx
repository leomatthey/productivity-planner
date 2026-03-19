import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Save, Download, RefreshCw, Link2, Unlink, Database, Beaker } from 'lucide-react'
import { AppShell } from '../components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { preferences, calendar, analytics } from '../lib/api'
import type { DbStats, GoogleCalendarStatus } from '../lib/api'

// ---------------------------------------------------------------------------
// Dev mode detection
// ---------------------------------------------------------------------------
function isDevMode(): boolean {
  return new URLSearchParams(window.location.search).get('dev') === 'true'
}

// ---------------------------------------------------------------------------
// Preferences form
// ---------------------------------------------------------------------------
function PreferencesSection() {
  const qc = useQueryClient()
  const [workStart, setWorkStart] = useState('09:00')
  const [workEnd, setWorkEnd]     = useState('18:00')
  const [theme, setTheme]         = useState('light')
  const [dirty, setDirty]         = useState(false)

  const { data: prefs } = useQuery({
    queryKey: ['preferences'],
    queryFn: preferences.getAll,
  })

  useEffect(() => {
    if (prefs) {
      setWorkStart(prefs.work_start ?? '09:00')
      setWorkEnd(prefs.work_end ?? '18:00')
      setTheme(prefs.theme ?? 'light')
      setDirty(false)
    }
  }, [prefs])

  const savePrefs = useMutation({
    mutationFn: async () => {
      await Promise.all([
        preferences.set('work_start', workStart),
        preferences.set('work_end', workEnd),
        preferences.set('theme', theme),
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
        <div>
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Theme</label>
          <Select value={theme} onValueChange={v => { setTheme(v); setDirty(true) }}>
            <SelectTrigger className="mt-1 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark (coming soon)</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>
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
    { label: 'Goals (active)',        key: 'goals_active' },
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
// Dev tools section (hidden behind ?dev=true)
// ---------------------------------------------------------------------------
function DevToolsSection() {
  const [seeding, setSeeding] = useState(false)

  async function handleSeed() {
    setSeeding(true)
    try {
      await fetch('/api/seed', { method: 'POST' })
      toast.success('Seed data inserted')
    } catch {
      toast.error('Seed failed — check backend logs')
    } finally {
      setSeeding(false)
    }
  }

  return (
    <div className="card p-6 border-warning">
      <div className="flex items-center gap-2 mb-3">
        <Beaker size={16} className="text-warning" />
        <h3 className="text-warning">Dev Tools</h3>
        <span className="badge bg-warning-light text-warning">?dev=true</span>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        These tools are only visible when <code className="font-mono bg-slate-100 px-1 rounded">?dev=true</code> is in the URL.
      </p>
      <Button size="sm" variant="outline" onClick={handleSeed} disabled={seeding} className="border-warning/40 text-warning">
        {seeding ? <RefreshCw size={13} className="mr-1 animate-spin" /> : <Database size={13} className="mr-1" />}
        Insert Seed Data
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export function Settings() {
  const devMode = isDevMode()

  return (
    <AppShell title="Settings">
      <div className="max-w-2xl space-y-6">
        <PreferencesSection />
        <Separator />
        <GoogleCalendarSection />
        <Separator />
        <ExportSection />
        <Separator />
        <DbStatsSection />
        {devMode && (
          <>
            <Separator />
            <DevToolsSection />
          </>
        )}
      </div>
    </AppShell>
  )
}
