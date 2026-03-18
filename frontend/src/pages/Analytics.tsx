import { useQuery } from '@tanstack/react-query'
import { BarChart2, CheckSquare, Target, Repeat2, CalendarDays, Bot } from 'lucide-react'
import { AppShell } from '../components/layout/AppShell'
import { analytics } from '../lib/api'
import type { DbStats } from '../lib/api'

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------
interface StatCardProps {
  label: string
  value: number | string
  icon: React.ReactNode
  description?: string
}

function StatCard({ label, value, icon, description }: StatCardProps) {
  return (
    <div className="metric-tile">
      <div className="flex items-start justify-between">
        <span className="metric-value">{value}</span>
        <span className="text-slate-300">{icon}</span>
      </div>
      <span className="metric-label">{label}</span>
      {description && <p className="text-xs text-slate-400 mt-1">{description}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Placeholder chart section
// ---------------------------------------------------------------------------
function ChartPlaceholder({ title }: { title: string }) {
  return (
    <div className="card p-6">
      <h3 className="mb-3">{title}</h3>
      <div className="h-48 bg-slate-50 rounded-lg border-2 border-dashed border-slate-200 flex flex-col items-center justify-center">
        <BarChart2 size={32} className="text-slate-200 mb-2" />
        <p className="text-sm text-slate-400 font-medium">Coming in Sprint 4</p>
        <p className="text-xs text-slate-300 mt-1">LLM-powered insights & charts</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export function Analytics() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['analytics-stats'],
    queryFn: analytics.stats,
    refetchInterval: 60_000,
  })

  const s: DbStats = stats ?? {
    tasks_total: 0, tasks_active: 0,
    goals_total: 0, goals_active: 0,
    habits_total: 0, habits_active: 0,
    habit_completions: 0,
    events_total: 0, events_active: 0,
    ai_messages: 0,
  }

  return (
    <AppShell title="Analytics">
      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="metric-tile animate-pulse">
              <div className="h-8 w-12 bg-slate-200 rounded" />
              <div className="h-3 w-20 bg-slate-100 rounded mt-1" />
            </div>
          ))
        ) : (
          <>
            <StatCard label="Tasks (active)"    value={s.tasks_active}       icon={<CheckSquare size={18} />} description={`${s.tasks_total} total`} />
            <StatCard label="Goals (active)"    value={s.goals_active}       icon={<Target size={18} />} description={`${s.goals_total} total`} />
            <StatCard label="Habits (active)"   value={s.habits_active}      icon={<Repeat2 size={18} />} description={`${s.habits_total} total`} />
            <StatCard label="Completions"       value={s.habit_completions}  icon={<Repeat2 size={18} />} />
            <StatCard label="Events (active)"   value={s.events_active}      icon={<CalendarDays size={18} />} description={`${s.events_total} total`} />
            <StatCard label="AI Messages"       value={s.ai_messages}        icon={<Bot size={18} />} />
          </>
        )}
      </div>

      {/* Chart placeholders */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <ChartPlaceholder title="Task Completion Rate (last 30 days)" />
        <ChartPlaceholder title="Habit Streak Overview" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <ChartPlaceholder title="Goal Progress Distribution" />
        <ChartPlaceholder title="Priority Breakdown" />
      </div>

      {/* LLM insights placeholder */}
      <div className="card p-6">
        <div className="flex items-center gap-2 mb-3">
          <Bot size={18} className="text-primary" />
          <h3>AI Insights</h3>
          <span className="badge bg-primary-50 text-primary-700 ml-1">Sprint 4</span>
        </div>
        <div className="bg-slate-50 rounded-lg border-2 border-dashed border-slate-200 p-8 text-center">
          <Bot size={28} className="text-slate-200 mx-auto mb-2" />
          <p className="text-sm font-medium text-slate-400">LLM-generated insights — Coming in Sprint 4</p>
          <p className="text-xs text-slate-300 mt-1">
            AI will analyse your productivity patterns and surface actionable recommendations
          </p>
          {/* TODO: Sprint 4 — wire /api/analytics/insights endpoint + render structured JSON response */}
        </div>
      </div>
    </AppShell>
  )
}
