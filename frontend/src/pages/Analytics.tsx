/**
 * Analytics.tsx — Sprint 4
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

import { useState, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  AreaChart, Area,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { Bot, TrendingUp, TrendingDown, Minus, Sparkles } from 'lucide-react'

import { AppShell } from '../components/layout/AppShell'
import { analytics } from '../lib/api'
import type {
  AnalyticsStats, AnalyticsInsights, InsightHighlight,
  InsightPattern, InsightRecommendation, InsightMetricKey,
} from '../lib/api'
import { chartPalette, colors } from '../lib/theme'

// ---------------------------------------------------------------------------
// Metric key → chart identifier mapping (drives visual highlighting)
// ---------------------------------------------------------------------------
const METRIC_TO_CHART: Record<InsightMetricKey, string> = {
  task_completion_rate: 'tasks-trend',
  tasks_this_week:      'tasks-trend',
  overdue_tasks:        'priority-breakdown',
  habit_completion_rate:'habits-bar',
  top_habit_streak:     'habits-bar',
  goal_progress:        'goals-pie',
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
// 1. Task completion trend — AreaChart (last 8 weeks)
// ---------------------------------------------------------------------------
function TaskTrendChart({ stats, highlighted }: { stats: AnalyticsStats; highlighted: boolean }) {
  const data = stats.tasks.completion_by_week
  return (
    <ChartCard
      title="Task Completion Trend"
      subtitle="Tasks created vs completed — last 8 weeks"
      highlighted={highlighted}
    >
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="gradCompleted" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={chartPalette[0]} stopOpacity={0.2} />
              <stop offset="95%" stopColor={chartPalette[0]} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={chartPalette[1]} stopOpacity={0.15} />
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
// 2. Habit completion rate — BarChart per habit (last 30 days %)
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
        <div className="h-[200px] flex items-center justify-center text-sm text-slate-400">
          No active habits
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
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
// 3. Priority breakdown — PieChart (donut)
// ---------------------------------------------------------------------------
const PRIORITY_COLORS: Record<string, string> = {
  urgent: colors.danger.DEFAULT,
  high:   colors.warning.DEFAULT,
  medium: colors.slate[400],
  low:    colors.slate[200],
}

function PriorityPieChart({ stats, highlighted }: { stats: AnalyticsStats; highlighted: boolean }) {
  const breakdown = stats.tasks.priority_breakdown
  const data = Object.entries(breakdown).map(([name, value]) => ({ name, value }))
  return (
    <ChartCard title="Task Priority Breakdown" highlighted={highlighted}>
      {data.length === 0 ? (
        <div className="h-[200px] flex items-center justify-center text-sm text-slate-400">
          No tasks
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie
              data={data}
              cx="50%" cy="50%"
              innerRadius={50} outerRadius={80}
              paddingAngle={3}
              dataKey="value"
            >
              {data.map((entry, i) => (
                <Cell
                  key={i}
                  fill={PRIORITY_COLORS[entry.name] ?? chartPalette[i % chartPalette.length]}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name) => [value ?? 0, String(name)]}
              contentStyle={{ fontSize: 12, borderColor: colors.slate[200] }}
            />
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 12 }}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}

// ---------------------------------------------------------------------------
// 4. Busiest hours heatmap — 24 cells with opacity-scaled background
// ---------------------------------------------------------------------------
function BusiestHoursHeatmap({ stats }: { stats: AnalyticsStats }) {
  const hours = stats.calendar.busiest_hours
  const maxCount = Math.max(...hours.map((h) => h.count), 1)
  const HOUR_LABELS = [
    '12a','1a','2a','3a','4a','5a','6a','7a','8a','9a','10a','11a',
    '12p','1p','2p','3p','4p','5p','6p','7p','8p','9p','10p','11p',
  ]
  return (
    <ChartCard title="Calendar — Busiest Hours" subtitle="Event density by hour of day" highlighted={false}>
      <div className="grid grid-cols-12 gap-1.5 mt-2">
        {hours.map((h) => {
          const opacity = h.count === 0 ? 0.06 : 0.15 + (h.count / maxCount) * 0.85
          return (
            <div
              key={h.hour}
              title={`${HOUR_LABELS[h.hour]}: ${h.count} event${h.count !== 1 ? 's' : ''}`}
              className="rounded-sm flex flex-col items-center justify-center h-9 cursor-default"
              style={{ backgroundColor: `rgba(79,70,229,${opacity})` }}
            >
              <span className="text-[9px] font-medium text-slate-600 leading-none">
                {HOUR_LABELS[h.hour]}
              </span>
              {h.count > 0 && (
                <span className="text-[9px] text-slate-500 leading-none mt-0.5">{h.count}</span>
              )}
            </div>
          )
        })}
      </div>
      <p className="text-xs text-slate-400 mt-2 text-center">
        Darker = more events. Hover for count.
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

function HighlightsRow({ highlights }: { highlights: InsightHighlight[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
      {highlights.map((h, i) => (
        <div key={i} className="metric-tile">
          <div className="flex items-center justify-between mb-1">
            <TrendIcon trend={h.trend} />
            <TrendArrow trend={h.trend} />
          </div>
          <div className="text-xl font-bold text-slate-900 dark:text-slate-100">{h.value}</div>
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
      <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-widest">Patterns</h3>
      {patterns.map((p, i) => (
        <div key={i} className={`rounded-lg p-4 ${SEVERITY_CLASSES[p.severity] ?? SEVERITY_CLASSES.neutral}`}>
          <p className="font-semibold text-sm text-slate-800 dark:text-slate-200 mb-1">{p.title}</p>
          <p className="text-sm text-slate-600">{p.description}</p>
        </div>
      ))}
    </div>
  )
}

function RecommendationsList({ recommendations }: { recommendations: InsightRecommendation[] }) {
  return (
    <div className="space-y-3 mb-6">
      <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-widest">Recommendations</h3>
      {recommendations.map((r, i) => (
        <div key={i} className="card p-4 flex gap-3">
          <span className={PRIORITY_BADGE_CLASSES[r.priority] ?? PRIORITY_BADGE_CLASSES.medium}>
            {r.priority}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{r.action}</p>
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

  return (
    <AppShell
      title="Analytics"
      action={
        <button
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium
                     hover:bg-primary-700 transition-colors duration-100 disabled:opacity-50"
          onClick={() => insightsMutation.mutate()}
          disabled={insightsMutation.isPending || statsLoading}
        >
          <Sparkles size={14} />
          {insightsMutation.isPending ? 'Generating…' : 'Generate Insights'}
        </button>
      }
    >
      {/* ----------------------------------------------------------------- */}
      {/* Summary stats row                                                  */}
      {/* ----------------------------------------------------------------- */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-8">
        {statsLoading ? (
          Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="metric-tile animate-pulse">
              <div className="h-7 w-10 bg-slate-200 rounded mb-1" />
              <div className="h-2.5 w-16 bg-slate-100 rounded" />
            </div>
          ))
        ) : (
          <>
            <div className="metric-tile">
              <span className="metric-value">{stats.tasks.total}</span>
              <span className="metric-label">Tasks total</span>
            </div>
            <div className="metric-tile">
              <span className="metric-value text-success">{stats.tasks.completed}</span>
              <span className="metric-label">Completed</span>
            </div>
            <div className="metric-tile">
              <span className="metric-value text-danger">{stats.tasks.overdue}</span>
              <span className="metric-label">Overdue</span>
            </div>
            <div className="metric-tile">
              <span className="metric-value">{stats.tasks.completion_rate}%</span>
              <span className="metric-label">Done rate</span>
            </div>
            <div className="metric-tile">
              <span className="metric-value">{stats.goals.total}</span>
              <span className="metric-label">Goals</span>
            </div>
            <div className="metric-tile">
              <span className="metric-value">{stats.habits.total_active}</span>
              <span className="metric-label">Active habits</span>
            </div>
            <div className="metric-tile">
              <span className="metric-value">{stats.calendar.total_events}</span>
              <span className="metric-label">Events</span>
            </div>
          </>
        )}
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Charts — row 1: task trend + habit bar                             */}
      {/* ----------------------------------------------------------------- */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <TaskTrendChart
          stats={stats}
          highlighted={highlightedCharts.has('tasks-trend')}
        />
        <HabitBarChart
          stats={stats}
          highlighted={highlightedCharts.has('habits-bar')}
        />
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Charts — row 2: priority pie + busiest hours heatmap               */}
      {/* ----------------------------------------------------------------- */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <PriorityPieChart
          stats={stats}
          highlighted={highlightedCharts.has('priority-breakdown')}
        />
        <BusiestHoursHeatmap stats={stats} />
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* AI Insights panel                                                   */}
      {/* ----------------------------------------------------------------- */}
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
            Failed to generate insights. Make sure the backend is running and ANTHROPIC_API_KEY is set.
          </div>
        )}

        {!insightsMutation.isPending && !insights && !insightsMutation.isError && (
          <div className="bg-slate-50 rounded-lg border-2 border-dashed border-slate-200 p-10 text-center">
            <Bot size={28} className="text-slate-200 mx-auto mb-2" />
            <p className="text-sm font-medium text-slate-400">
              Click "Generate Insights" to analyse your productivity data with AI
            </p>
            <p className="text-xs text-slate-300 mt-1">
              Claude will surface patterns, trends, and actionable recommendations
            </p>
          </div>
        )}

        {insights && !insightsMutation.isPending && (
          <>
            {/* Highlights row — metric cards with trend arrows */}
            <HighlightsRow highlights={insights.highlights} />
            {/* Patterns — coloured left-border cards */}
            <PatternsList patterns={insights.patterns} />
            {/* Recommendations — priority-badged action items */}
            <RecommendationsList recommendations={insights.recommendations} />
            {/* Focus suggestion — prominent indigo card */}
            <FocusSuggestion focus={insights.focus_suggestion} />
          </>
        )}
      </div>
    </AppShell>
  )
}
