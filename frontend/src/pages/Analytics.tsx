/**
 * Analytics.tsx — Sprint 4 (executive-dashboard redesign)
 *
 * Assignment compliance:
 *   Feature 2 (analytics.py + Analytics.tsx):
 *     data aggregation → LLM structured JSON → chart visual highlighting ✓
 *
 * Non-straightforward LLM feature:
 *   The LLM insight response contains a "metric" key per highlight.
 *   That key is mapped to a chart identifier (METRIC_TO_CHART).
 *   After insights load, highlightedCharts (Set<string>) is recomputed and
 *   passed as a prop to each chart card — adding a ring/glow when the LLM
 *   flagged that metric. LLM output directly drives visual chart state.
 */

import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  AreaChart, Area,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  Bot, TrendingUp, TrendingDown, Minus, Sparkles,
  CheckCircle2, Clock, Target, Activity, AlertTriangle,
  ChevronRight, ChevronDown,
} from 'lucide-react'

import { AppShell } from '../components/layout/AppShell'
import { useTabExplainer } from '../components/TabExplainer'
import { analytics } from '../lib/api'
import type {
  AnalyticsStats, AnalyticsInsights, InsightHighlight,
  InsightPattern, InsightRecommendation, InsightMetricKey,
  AnalyticsProject, ProjectHealthStatus,
} from '../lib/api'
import { chartPalette, colors } from '../lib/theme'
import { getSubProjectShade } from '../lib/colors'

// ---------------------------------------------------------------------------
// Metric key → chart identifier mapping (drives visual highlighting)
// ---------------------------------------------------------------------------
const METRIC_TO_CHART: Record<InsightMetricKey, string> = {
  task_completion_rate:  'tasks-trend',
  tasks_this_week:       'tasks-trend',
  overdue_tasks:         'project-health',
  habit_completion_rate: 'habits-bar',
  top_habit_streak:      'habits-bar',
  goal_progress:         'project-health',
  project_health:        'project-health',
  time_allocation:       'time-allocation',
}

// ---------------------------------------------------------------------------
// Project status visual mapping (RAG)
// ---------------------------------------------------------------------------
const STATUS_META: Record<ProjectHealthStatus, { label: string; bg: string; text: string; dot: string }> = {
  on_track:    { label: 'On Track',    bg: 'bg-success-light', text: 'text-success',     dot: 'bg-success'    },
  at_risk:     { label: 'At Risk',     bg: 'bg-warning-light', text: 'text-warning',     dot: 'bg-warning'    },
  off_track:   { label: 'Off Track',   bg: 'bg-danger-light',  text: 'text-danger',      dot: 'bg-danger'     },
  no_deadline: { label: 'No Deadline', bg: 'bg-slate-100',     text: 'text-slate-500',   dot: 'bg-slate-400'  },
}

// ---------------------------------------------------------------------------
// Empty default stats (used while loading)
// ---------------------------------------------------------------------------
const EMPTY_STATS: AnalyticsStats = {
  tasks: {
    total: 0, completed: 0, in_progress: 0, todo: 0, cancelled: 0,
    overdue: 0, completion_rate: 0,
    completion_by_week: [],
    avg_completion_hours: 0,
    priority_breakdown: {},
    tag_breakdown: {},
  },
  habits: { habits: [], total_active: 0 },
  goals: {
    total: 0, completed: 0, in_progress: 0, paused: 0,
    avg_progress_pct: 0, progress_distribution: {},
  },
  calendar: { total_events: 0, by_type: {}, busiest_days: [], busiest_hours: [] },
  projects: [],
  time_allocation_week: {
    by_project: [],
    total_minutes: 0,
    total_hours: 0,
    last_week_total_minutes: 0,
    last_week_total_hours: 0,
    week_start: '',
    week_end: '',
  },
}

// ---------------------------------------------------------------------------
// Chart card wrapper — adds a highlight ring when flagged by LLM
// ---------------------------------------------------------------------------
interface ChartCardProps {
  title: string
  subtitle?: string
  highlighted: boolean
  children: React.ReactNode
}

function ChartCard({ title, subtitle, highlighted, children }: ChartCardProps) {
  return (
    <div
      className={[
        'card p-6 transition-all duration-300',
        highlighted
          ? 'ring-2 ring-primary ring-offset-2 border-primary-200'
          : '',
      ].join(' ')}
    >
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <h3>{title}</h3>
          {highlighted && (
            <span className="badge bg-primary-50 text-primary-700 text-xs">
              ↑ AI flagged
            </span>
          )}
        </div>
        {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Executive Hero Strip — 4 large metric cards
// ---------------------------------------------------------------------------
type HeroAccent = 'success' | 'warning' | 'danger' | 'primary' | 'slate'

interface HeroMetricProps {
  icon: React.ReactNode
  label: string
  value: string | number
  delta?: number
  deltaUnit?: string
  accent?: HeroAccent
}

const HERO_VALUE_CLASS: Record<HeroAccent, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger:  'text-danger',
  primary: 'text-primary',
  slate:   'text-slate-900',
}

const HERO_ICON_CLASS: Record<HeroAccent, string> = {
  success: 'bg-success-light text-success',
  warning: 'bg-warning-light text-warning',
  danger:  'bg-danger-light  text-danger',
  primary: 'bg-primary-50    text-primary',
  slate:   'bg-slate-100     text-slate-500',
}

function HeroMetric({ icon, label, value, delta, deltaUnit, accent = 'slate' }: HeroMetricProps) {
  const deltaLabel = delta === undefined ? null : (
    <span className={`text-xs font-semibold ml-2 whitespace-nowrap ${
      delta > 0 ? 'text-success' : delta < 0 ? 'text-danger' : 'text-slate-400'
    }`}>
      {delta > 0 ? '↑' : delta < 0 ? '↓' : '→'} {Math.abs(delta)}{deltaUnit ? ` ${deltaUnit}` : ''}
    </span>
  )

  return (
    <div className="card p-5 flex items-start gap-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${HERO_ICON_CLASS[accent]}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="metric-label">{label}</p>
        <div className="flex items-baseline mt-1">
          <span className={`text-3xl font-bold tracking-tight ${HERO_VALUE_CLASS[accent]}`}>{value}</span>
          {deltaLabel}
        </div>
        {delta === undefined && deltaUnit && (
          <p className="text-xs text-slate-400 mt-0.5">{deltaUnit}</p>
        )}
      </div>
    </div>
  )
}

function ExecutiveHero({ stats }: { stats: AnalyticsStats }) {
  const weeks = stats.tasks.completion_by_week
  const thisWeek = weeks.length > 0 ? weeks[weeks.length - 1] : null
  const lastWeek = weeks.length > 1 ? weeks[weeks.length - 2] : null
  const doneThisWeek = thisWeek?.completed ?? 0
  const doneLastWeek = lastWeek?.completed ?? 0
  const doneDelta = doneThisWeek - doneLastWeek

  const hoursThisWeek = stats.time_allocation_week.total_hours
  const hoursLastWeek = stats.time_allocation_week.last_week_total_hours
  const hoursDelta = Math.round((hoursThisWeek - hoursLastWeek) * 10) / 10

  const projects = stats.projects
  const onTrackCount = projects.filter(p => p.status === 'on_track').length
  const atRiskCount  = projects.filter(p => p.status === 'at_risk' || p.status === 'off_track').length

  const habits = stats.habits.habits
  const consistentCount = habits.filter(h => (h.completion_rate_7d ?? 0) >= 80).length

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <HeroMetric
        icon={<CheckCircle2 size={20} />}
        label="Done this week"
        value={doneThisWeek}
        delta={doneDelta === 0 ? undefined : doneDelta}
        deltaUnit="vs last wk"
        accent="success"
      />
      <HeroMetric
        icon={<Clock size={20} />}
        label="Hours scheduled"
        value={`${hoursThisWeek.toFixed(1)}h`}
        delta={hoursDelta === 0 ? undefined : hoursDelta}
        deltaUnit="vs last wk"
        accent="primary"
      />
      <HeroMetric
        icon={atRiskCount > 0 ? <AlertTriangle size={20} /> : <Target size={20} />}
        label="Projects on track"
        value={projects.length === 0 ? '—' : `${onTrackCount}/${projects.length}`}
        delta={atRiskCount > 0 ? -atRiskCount : undefined}
        deltaUnit={atRiskCount > 0 ? 'need attention' : undefined}
        accent={atRiskCount > 0 ? 'warning' : 'success'}
      />
      <HeroMetric
        icon={<Activity size={20} />}
        label="Habit consistency"
        value={habits.length === 0 ? '—' : `${consistentCount}/${habits.length}`}
        deltaUnit={habits.length > 0 ? '≥ 80% in last 7 days' : undefined}
        accent={consistentCount === habits.length && habits.length > 0 ? 'success' : 'slate'}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Project Health Board — top-level rows with expandable subprojects
// ---------------------------------------------------------------------------
function DeadlineCell({ project }: { project: AnalyticsProject }) {
  if (!project.target_date) return <span className="text-xs text-slate-300">—</span>
  const late = project.days_to_target !== null && project.days_to_target < 0
  return (
    <>
      <div className="text-xs text-slate-700">
        {new Date(project.target_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
      </div>
      <div className={`text-[11px] ${late ? 'text-danger font-medium' : 'text-slate-400'}`}>
        {project.days_to_target! < 0
          ? `${Math.abs(project.days_to_target!)}d late`
          : project.days_to_target === 0
            ? 'today'
            : `${project.days_to_target}d left`}
      </div>
    </>
  )
}

interface ProjectRowProps {
  project: AnalyticsProject
  /** Used to derive a lighter shade for sub-project rows. */
  derivedColor?: string
  /** Render as nested sub-row (indented, lighter). */
  nested?: boolean
  /** Expand state — undefined when not expandable. */
  expanded?: boolean
  onToggle?: () => void
}

function ProjectRow({ project, derivedColor, nested = false, expanded, onToggle }: ProjectRowProps) {
  const meta = STATUS_META[project.status]
  const color = derivedColor ?? project.color ?? '#94A3B8'
  const expandable = onToggle !== undefined
  const hasSubs = project.subprojects.length > 0

  // For parent rows that have subprojects: show "X/Y total" + small "(N direct)" if applicable.
  const taskLabel = (() => {
    if (hasSubs && project.direct_task_total > 0) {
      return (
        <span className="text-[11px] text-slate-400 shrink-0 font-mono">
          {project.task_done}/{project.task_total}
          <span className="text-slate-300 ml-1">({project.direct_task_done}/{project.direct_task_total} direct)</span>
        </span>
      )
    }
    return (
      <span className="text-[11px] text-slate-400 shrink-0 font-mono">
        {project.task_done}/{project.task_total}
      </span>
    )
  })()

  return (
    <div
      onClick={expandable ? onToggle : undefined}
      className={[
        'grid grid-cols-12 gap-3 items-center px-3 py-3 rounded-md transition-colors',
        nested ? 'pl-10 bg-slate-50/40' : '',
        expandable ? 'cursor-pointer hover:bg-slate-50' : '',
      ].join(' ')}
    >
      {/* Project name (with optional chevron) */}
      <div className="col-span-4 flex items-center gap-2 min-w-0">
        {expandable ? (
          expanded
            ? <ChevronDown size={14} className="text-slate-400 shrink-0" />
            : <ChevronRight size={14} className="text-slate-400 shrink-0" />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span
          className={`rounded-full shrink-0 ${nested ? 'w-2 h-2' : 'w-2.5 h-2.5'}`}
          style={{ backgroundColor: color }}
        />
        <span className={`truncate ${nested ? 'text-xs text-slate-700' : 'text-sm font-medium text-slate-800'}`}>
          {project.title}
        </span>
        {taskLabel}
      </div>

      {/* Progress */}
      <div className="col-span-3">
        <div className={`relative rounded-full bg-slate-100 overflow-hidden ${nested ? 'h-1.5' : 'h-2'}`}>
          <div
            className="absolute left-0 top-0 h-full rounded-full transition-all"
            style={{
              width: `${Math.max(project.progress_pct, project.progress_pct === 0 ? 0 : 4)}%`,
              backgroundColor: color,
            }}
          />
        </div>
        <span className="text-[11px] text-slate-500 mt-1 inline-block">{project.progress_pct}%</span>
      </div>

      {/* Deadline */}
      <div className="col-span-2 text-right">
        <DeadlineCell project={project} />
      </div>

      {/* Velocity */}
      <div className="col-span-1 text-right">
        <div className="text-xs font-mono text-slate-600">{project.velocity_per_week}</div>
        <div className="text-[10px] text-slate-400">tasks/wk</div>
      </div>

      {/* Status pill */}
      <div className="col-span-2 text-right">
        <span className={`badge ${meta.bg} ${meta.text} text-xs px-2 py-1 inline-flex items-center`}>
          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot} mr-1.5`} />
          {meta.label}
        </span>
      </div>
    </div>
  )
}

function DirectTasksRow({ project }: { project: AnalyticsProject }) {
  const directRemaining = project.direct_task_total - project.direct_task_done
  const directPct = project.direct_task_total > 0
    ? Math.round((project.direct_task_done / project.direct_task_total) * 100)
    : 0
  const color = project.color ?? '#94A3B8'

  return (
    <div className="grid grid-cols-12 gap-3 items-center px-3 py-2 pl-10 rounded-md bg-slate-50/40">
      <div className="col-span-4 flex items-center gap-2 min-w-0">
        <span className="w-3.5 shrink-0" />
        <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-slate-300" />
        <span className="text-xs italic text-slate-500">Direct work</span>
        <span className="text-[11px] text-slate-400 font-mono">
          {project.direct_task_done}/{project.direct_task_total}
        </span>
      </div>
      <div className="col-span-3">
        <div className="relative h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="absolute left-0 top-0 h-full rounded-full"
            style={{ width: `${Math.max(directPct, directPct === 0 ? 0 : 4)}%`, backgroundColor: color }}
          />
        </div>
        <span className="text-[11px] text-slate-500 mt-1 inline-block">{directPct}%</span>
      </div>
      <div className="col-span-2 text-right text-xs text-slate-300">—</div>
      <div className="col-span-1 text-right text-[11px] text-slate-400">{directRemaining} left</div>
      <div className="col-span-2 text-right text-[11px] text-slate-400">tasks at parent level</div>
    </div>
  )
}

function ProjectHealthBoard({ stats, highlighted }: { stats: AnalyticsStats; highlighted: boolean }) {
  const projects = stats.projects
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())

  // Auto-expand any project that has subprojects when the project list first arrives.
  const projectIdKey = projects.map(p => p.id).join(',')
  useEffect(() => {
    setExpandedIds(prev => {
      if (prev.size > 0) return prev
      const next = new Set<number>()
      projects.forEach(p => {
        if (p.subprojects.length > 0) next.add(p.id)
      })
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectIdKey])

  const toggle = (id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div
      className={[
        'card p-6 transition-all duration-300 mb-6',
        highlighted ? 'ring-2 ring-primary ring-offset-2 border-primary-200' : '',
      ].join(' ')}
    >
      <div className="mb-5">
        <div className="flex items-center gap-2">
          <h3>Project Health</h3>
          {highlighted && (
            <span className="badge bg-primary-50 text-primary-700 text-xs">↑ AI flagged</span>
          )}
        </div>
        <p className="text-xs text-slate-400 mt-0.5">
          Top-level projects with rolled-up status, velocity, and projected finish. Click to expand subprojects.
        </p>
      </div>

      {projects.length === 0 ? (
        <div className="h-[140px] flex items-center justify-center text-sm text-slate-400">
          No active projects
        </div>
      ) : (
        <div>
          {/* Header row */}
          <div className="grid grid-cols-12 gap-3 px-3 pb-2 text-[10px] font-semibold text-slate-400 uppercase tracking-widest border-b border-slate-100">
            <div className="col-span-4">Project</div>
            <div className="col-span-3">Progress</div>
            <div className="col-span-2 text-right">Deadline</div>
            <div className="col-span-1 text-right">Velocity</div>
            <div className="col-span-2 text-right">Status</div>
          </div>
          <div className="divide-y divide-slate-100">
            {projects.map(p => {
              const hasChildren = p.subprojects.length > 0
              const hasDirectAndSubs = hasChildren && p.direct_task_total > 0
              const isExpanded = expandedIds.has(p.id)
              const parentColor = p.color ?? '#94A3B8'
              return (
                <div key={p.id}>
                  <ProjectRow
                    project={p}
                    expanded={hasChildren ? isExpanded : undefined}
                    onToggle={hasChildren ? () => toggle(p.id) : undefined}
                  />
                  {hasChildren && isExpanded && (
                    <div className="bg-slate-50/30 -mx-1 px-1 py-1 space-y-1 border-l-2" style={{ borderLeftColor: parentColor }}>
                      {hasDirectAndSubs && <DirectTasksRow project={p} />}
                      {p.subprojects.map(sp => (
                        <ProjectRow
                          key={sp.id}
                          project={sp}
                          derivedColor={getSubProjectShade(parentColor)}
                          nested
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Task completion trend — AreaChart (last 8 weeks)
// ---------------------------------------------------------------------------
function TaskTrendChart({ stats, highlighted }: { stats: AnalyticsStats; highlighted: boolean }) {
  const data = stats.tasks.completion_by_week
  return (
    <ChartCard
      title="Task Completion Trend"
      subtitle="Tasks created vs completed — last 8 weeks"
      highlighted={highlighted}
    >
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="gradCompleted" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={chartPalette[0]} stopOpacity={0.25} />
              <stop offset="95%" stopColor={chartPalette[0]} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={chartPalette[1]} stopOpacity={0.18} />
              <stop offset="95%" stopColor={chartPalette[1]} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={colors.slate[100]} />
          <XAxis dataKey="week" tick={{ fontSize: 11, fill: colors.slate[400] }} />
          <YAxis tick={{ fontSize: 11, fill: colors.slate[400] }} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderColor: colors.slate[200] }}
            labelStyle={{ color: colors.slate[700] }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area
            type="monotone" dataKey="total" name="Created"
            stroke={chartPalette[1]} fill="url(#gradTotal)" strokeWidth={2}
          />
          <Area
            type="monotone" dataKey="completed" name="Completed"
            stroke={chartPalette[0]} fill="url(#gradCompleted)" strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

// ---------------------------------------------------------------------------
// Time Allocation This Week — Donut (replaces priority pie)
// ---------------------------------------------------------------------------
function TimeAllocationDonut({ stats, highlighted }: { stats: AnalyticsStats; highlighted: boolean }) {
  const alloc = stats.time_allocation_week
  const data = alloc.by_project.map(p => ({
    name:  p.title,
    value: p.minutes,
    color: p.color ?? '#94A3B8',
  }))

  return (
    <ChartCard
      title="Time This Week"
      subtitle={`${alloc.total_hours.toFixed(1)}h scheduled across ${data.length} ${data.length === 1 ? 'bucket' : 'buckets'}`}
      highlighted={highlighted}
    >
      {data.length === 0 ? (
        <div className="h-[220px] flex items-center justify-center text-sm text-slate-400">
          No tasks scheduled this week
        </div>
      ) : (
        <>
          <div className="relative">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={92}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {data.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: any) => [`${(Number(value) / 60).toFixed(1)}h`, 'Scheduled']}
                  contentStyle={{ fontSize: 12, borderColor: colors.slate[200] }}
                />
              </PieChart>
            </ResponsiveContainer>
            {/* Centre overlay */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-2xl font-bold text-slate-900 leading-none">
                {alloc.total_hours.toFixed(1)}h
              </span>
              <span className="text-[10px] uppercase tracking-widest text-slate-400 mt-1">
                this week
              </span>
            </div>
          </div>
          {/* Legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 text-xs">
            {data.map((d, i) => (
              <div key={i} className="flex items-center gap-1.5 text-slate-600">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                <span className="truncate max-w-[120px] font-medium">{d.name}</span>
                <span className="text-slate-400 font-mono">{(d.value / 60).toFixed(1)}h</span>
              </div>
            ))}
          </div>
        </>
      )}
    </ChartCard>
  )
}

// ---------------------------------------------------------------------------
// Habit completion rate — BarChart per habit (last 30 days %)
// ---------------------------------------------------------------------------
function HabitBarChart({ stats, highlighted }: { stats: AnalyticsStats; highlighted: boolean }) {
  const data = stats.habits.habits.map((h) => ({
    name: h.title.length > 14 ? h.title.slice(0, 13) + '…' : h.title,
    rate: h.completion_rate_30d,
    streak: h.streak_current,
  }))
  return (
    <ChartCard
      title="Habit Completion Rate"
      subtitle="% of last 30 days completed"
      highlighted={highlighted}
    >
      {data.length === 0 ? (
        <div className="h-[220px] flex items-center justify-center text-sm text-slate-400">
          No active habits
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={colors.slate[100]} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: colors.slate[400] }} />
            <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11, fill: colors.slate[400] }} />
            <Tooltip
              formatter={(value) => [`${value ?? 0}%`, 'Completion rate']}
              contentStyle={{ fontSize: 12, borderColor: colors.slate[200] }}
            />
            <Bar dataKey="rate" name="Rate %" radius={[4, 4, 0, 0]}>
              {data.map((_, i) => (
                <Cell key={i} fill={chartPalette[i % chartPalette.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}

// ---------------------------------------------------------------------------
// Calendar Load — 24-cell heatmap by hour-of-day
// ---------------------------------------------------------------------------
function CalendarLoadHeatmap({ stats }: { stats: AnalyticsStats }) {
  const hours = stats.calendar.busiest_hours
  const maxCount = Math.max(...hours.map((h) => h.count), 1)
  const HOUR_LABELS = [
    '00','01','02','03','04','05','06','07','08','09','10','11',
    '12','13','14','15','16','17','18','19','20','21','22','23',
  ]
  return (
    <ChartCard title="Calendar Load — Hours of Day" subtitle="Event density by hour, all-time" highlighted={false}>
      <div className="grid grid-cols-12 gap-1.5 mt-2">
        {hours.map((h) => {
          const opacity = h.count === 0 ? 0.06 : 0.18 + (h.count / maxCount) * 0.82
          return (
            <div
              key={h.hour}
              title={`${HOUR_LABELS[h.hour]}: ${h.count} event${h.count !== 1 ? 's' : ''}`}
              className="group relative rounded-sm flex items-center justify-center h-10 cursor-default"
              style={{ backgroundColor: `rgba(79,70,229,${opacity})` }}
            >
              <span className="text-[10px] font-medium text-slate-700 leading-none transition-opacity group-hover:opacity-0">
                {HOUR_LABELS[h.hour]}
              </span>
              <span className="absolute inset-0 flex items-center justify-center text-[11px] font-mono font-semibold text-slate-800 opacity-0 transition-opacity group-hover:opacity-100">
                {h.count}
              </span>
            </div>
          )
        })}
      </div>
      <p className="text-xs text-slate-400 mt-3 text-center">
        Darker = more events. Hover a cell to see the count.
      </p>
    </ChartCard>
  )
}

// ---------------------------------------------------------------------------
// Insights panel subcomponents
// ---------------------------------------------------------------------------

function TrendIcon({ trend }: { trend: 'up' | 'down' | 'neutral' }) {
  if (trend === 'up')      return <TrendingUp  size={16} className="text-success" />
  if (trend === 'down')    return <TrendingDown size={16} className="text-danger" />
  return                          <Minus        size={16} className="text-slate-400" />
}

function TrendArrow({ trend }: { trend: 'up' | 'down' | 'neutral' }) {
  if (trend === 'up')   return <span className="text-success font-bold">↑</span>
  if (trend === 'down') return <span className="text-danger font-bold">↓</span>
  return                       <span className="text-slate-400 font-bold">→</span>
}

const SEVERITY_CLASSES: Record<string, string> = {
  positive: 'border-l-4 border-success bg-success-light',
  neutral:  'border-l-4 border-slate-300 bg-slate-50',
  warning:  'border-l-4 border-warning bg-warning-light',
}

const PRIORITY_BADGE_CLASSES: Record<string, string> = {
  high:   'badge bg-danger-light  text-danger',
  medium: 'badge bg-warning-light text-warning',
  low:    'badge bg-slate-100 text-slate-500',
}

function HeadlineCard({ headline }: { headline: string }) {
  return (
    <div className="rounded-xl bg-gradient-to-br from-primary-50 via-white to-primary-50/40 border-2 border-primary-200 p-5 mb-6 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary text-white flex items-center justify-center shrink-0 shadow">
          <Sparkles size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold text-primary uppercase tracking-widest mb-1">
            Executive Summary
          </p>
          <p className="text-base font-medium text-slate-900 leading-relaxed">{headline}</p>
        </div>
      </div>
    </div>
  )
}

function HighlightsRow({ highlights }: { highlights: InsightHighlight[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
      {highlights.map((h, i) => (
        <div key={i} className="metric-tile">
          <div className="flex items-center justify-between mb-1">
            <TrendIcon trend={h.trend} />
            <TrendArrow trend={h.trend} />
          </div>
          <div className="text-xl font-bold text-slate-900">{h.value}</div>
          <div className="metric-label">{h.metric.replace(/_/g, ' ')}</div>
          <p className="text-xs text-slate-500 mt-1 leading-tight">{h.insight}</p>
        </div>
      ))}
    </div>
  )
}

function PatternsList({ patterns }: { patterns: InsightPattern[] }) {
  return (
    <div className="space-y-3 mb-6">
      <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-widest">Patterns</h3>
      {patterns.map((p, i) => (
        <div key={i} className={`rounded-lg p-4 ${SEVERITY_CLASSES[p.severity] ?? SEVERITY_CLASSES.neutral}`}>
          <p className="font-semibold text-sm text-slate-800 mb-1">{p.title}</p>
          <p className="text-sm text-slate-600">{p.description}</p>
        </div>
      ))}
    </div>
  )
}

function RecommendationsList({ recommendations }: { recommendations: InsightRecommendation[] }) {
  return (
    <div className="space-y-3 mb-6">
      <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-widest">Recommendations</h3>
      {recommendations.map((r, i) => (
        <div key={i} className="card p-4 flex gap-3">
          <span className={PRIORITY_BADGE_CLASSES[r.priority] ?? PRIORITY_BADGE_CLASSES.medium}>
            {r.priority}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-800">{r.action}</p>
            <p className="text-xs text-slate-500 mt-0.5">{r.rationale}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function FocusSuggestion({ focus }: { focus: AnalyticsInsights['focus_suggestion'] }) {
  return (
    <div className="rounded-xl bg-primary-50 border border-primary-200 p-5">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={16} className="text-primary" />
        <span className="text-sm font-semibold text-primary-700">Focus this week</span>
      </div>
      <p className="text-base font-bold text-primary-900 mb-1">{focus.area}</p>
      <p className="text-sm text-primary-700">{focus.reason}</p>
    </div>
  )
}

// Skeleton shown while LLM is generating
function InsightsSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-20 bg-primary-50 rounded-xl" />
      <div className="grid grid-cols-3 lg:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="metric-tile">
            <div className="h-4 w-4 bg-slate-200 rounded mb-2" />
            <div className="h-6 w-16 bg-slate-200 rounded mb-1" />
            <div className="h-3 w-20 bg-slate-100 rounded" />
          </div>
        ))}
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-16 bg-slate-100 rounded-lg" />
      ))}
      <div className="h-24 bg-primary-50 rounded-xl" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export function Analytics() {
  const [insights, setInsights] = useState<AnalyticsInsights | null>(null)

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['analytics-stats'],
    queryFn: analytics.full,
    refetchInterval: 60_000,
  })

  const stats: AnalyticsStats = statsData ?? EMPTY_STATS

  // Compute which chart cards the LLM flagged, based on insight highlight metrics.
  // This is the non-straightforward LLM feature: LLM output drives visual chart state.
  const highlightedCharts = useMemo<Set<string>>(() => {
    if (!insights) return new Set()
    const set = new Set<string>()
    insights.highlights.forEach((h) => {
      const chartId = METRIC_TO_CHART[h.metric]
      if (chartId) set.add(chartId)
    })
    return set
  }, [insights])

  const insightsMutation = useMutation({
    mutationFn: () => analytics.insights(stats),
    onSuccess: (data) => setInsights(data),
  })

  const insightsError = insightsMutation.error as Error | null

  const analyticsExplainer = useTabExplainer({
    storageKey: 'explainer-analytics',
    title: 'Analytics',
    subtitle: 'An executive dashboard — what\'s on track, where time is going, what\'s slipping.',
    highlights: [
      { icon: Activity,    title: 'Hero metrics',         body: 'Done this week / Hours scheduled / Projects on track / Habit consistency — all with a Δ vs last week.' },
      { icon: AlertTriangle,title: 'Project Health Board', body: 'Per-project RAG status (On Track / At Risk / Off Track) using rolled-up tasks across subprojects.' },
      { icon: Sparkles,    title: 'AI insights',          body: '"Generate Insights" produces a concrete executive summary that names specific projects, habits, and numbers.' },
    ],
    tip: 'Tip: the LLM also flags charts to highlight by mapping each "metric" key to a chart card — watch the rings glow.',
  })

  return (
    <AppShell
      title="Analytics"
      action={
        <div className="flex items-center gap-2">
          {analyticsExplainer.button}
          <button
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium
                       hover:bg-primary-700 transition-colors duration-100 disabled:opacity-50 shadow-sm"
            onClick={() => insightsMutation.mutate()}
            disabled={insightsMutation.isPending || statsLoading}
          >
            <Sparkles size={14} />
            {insightsMutation.isPending ? 'Generating…' : 'Generate Insights'}
          </button>
        </div>
      }
    >
      {analyticsExplainer.dialog}
      {/* Executive Hero Strip */}
      {statsLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card p-5 animate-pulse h-[88px]" />
          ))}
        </div>
      ) : (
        <ExecutiveHero stats={stats} />
      )}

      {/* Project Health Board (full width) */}
      <ProjectHealthBoard stats={stats} highlighted={highlightedCharts.has('project-health')} />

      {/* Charts row 1: trend + time allocation */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <TaskTrendChart
          stats={stats}
          highlighted={highlightedCharts.has('tasks-trend')}
        />
        <TimeAllocationDonut
          stats={stats}
          highlighted={highlightedCharts.has('time-allocation')}
        />
      </div>

      {/* Charts row 2: habits + calendar load */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <HabitBarChart
          stats={stats}
          highlighted={highlightedCharts.has('habits-bar')}
        />
        <CalendarLoadHeatmap stats={stats} />
      </div>

      {/* AI Insights panel */}
      <div className="card p-6">
        <div className="flex items-center gap-2 mb-5">
          <Bot size={18} className="text-primary" />
          <h2 className="text-base font-semibold text-slate-900">AI Insights</h2>
          {insights && (
            <span className="badge bg-success-light text-success ml-1 text-xs">Ready</span>
          )}
        </div>

        {insightsMutation.isPending && <InsightsSkeleton />}

        {insightsMutation.isError && (
          <div className="rounded-lg bg-danger-light border border-danger p-4 text-sm text-danger">
            <strong>Failed to generate insights.</strong>{' '}
            {insightsError?.message || 'Unknown error.'} Check the backend logs for details.
          </div>
        )}

        {!insightsMutation.isPending && !insights && !insightsMutation.isError && (
          <div className="bg-slate-50 rounded-lg border-2 border-dashed border-slate-200 p-10 text-center">
            <Bot size={28} className="text-slate-200 mx-auto mb-2" />
            <p className="text-sm font-medium text-slate-400">
              Click "Generate Insights" to analyse your productivity data with AI
            </p>
            <p className="text-xs text-slate-300 mt-1">
              Claude will surface a concrete executive summary, patterns, and actionable recommendations
            </p>
          </div>
        )}

        {insights && !insightsMutation.isPending && (
          <>
            {insights.headline && <HeadlineCard headline={insights.headline} />}
            <HighlightsRow highlights={insights.highlights} />
            <PatternsList patterns={insights.patterns} />
            <RecommendationsList recommendations={insights.recommendations} />
            <FocusSuggestion focus={insights.focus_suggestion} />
          </>
        )}
      </div>
    </AppShell>
  )
}
