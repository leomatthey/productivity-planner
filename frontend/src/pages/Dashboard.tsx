import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  CheckCircle2, Circle, CalendarDays, AlertCircle, ListTodo,
  Repeat2, ChevronRight, Clock, AlertTriangle,
} from 'lucide-react'
import { AppShell } from '../components/layout/AppShell'
import { useTabExplainer } from '../components/TabExplainer'
import { Progress } from '@/components/ui/progress'
import { tasks, habits, calendar } from '../lib/api'
import type { Task, CalendarEvent } from '../types'
import { parseUTCDate } from '../lib/datetime'
import { getProjectColor } from '../lib/colors'
import { EVENT_COLOURS } from '../lib/calendarSetup'
import type { HabitOut } from '../lib/api'
import { projects as projectsApi } from '../lib/api'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayStr(): string {
  return new Date().toISOString().split('T')[0]
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function formattedDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
}

function formatTime(iso: string): string {
  return parseUTCDate(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

function isAllDay(event: CalendarEvent): boolean {
  return event.start_datetime.includes('T00:00:00')
    && event.end_datetime.includes('T00:00:00')
    && event.start_datetime !== event.end_datetime
}

function durationLabel(start: string, end: string): string {
  const mins = (parseUTCDate(end).getTime() - parseUTCDate(start).getTime()) / 60_000
  if (mins < 60) return `${mins}m`
  const h = mins / 60
  return h === Math.floor(h) ? `${h}h` : `${h.toFixed(1)}h`
}

function dueDateLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

function SkeletonTile() {
  return (
    <div className="metric-tile animate-pulse">
      <div className="h-8 w-16 bg-slate-200 rounded" />
      <div className="h-3 w-24 bg-slate-100 rounded mt-1" />
    </div>
  )
}

function SkeletonRow() {
  return <div className="h-9 bg-slate-50 rounded animate-pulse mb-1" />
}

// ---------------------------------------------------------------------------
// Metric tile
// ---------------------------------------------------------------------------

function MetricTile({ label, value, icon, accent }: {
  label: string; value: string | number; icon: React.ReactNode; accent?: string
}) {
  return (
    <div className="metric-tile">
      <div className="flex items-start justify-between">
        <span className="metric-value" style={accent ? { color: accent } : undefined}>{value}</span>
        <span style={accent ? { color: accent, opacity: 0.5 } : undefined} className={accent ? '' : 'text-slate-300'}>
          {icon}
        </span>
      </div>
      <span className="metric-label">{label}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Timeline entry (merged tasks + events for today)
// ---------------------------------------------------------------------------

interface TimelineItem {
  id: string
  time: string        // "09:00" or "All day"
  sortKey: number     // minutes from midnight for sorting
  title: string
  duration?: string   // "1h", "30m"
  color: string
  badge?: string      // "Google"
  type: 'task' | 'event'
  task?: Task
}

function TimelineRow({ item, onToggleTask }: { item: TimelineItem; onToggleTask?: (t: Task) => void }) {
  const isTask = item.type === 'task'
  const done = item.task?.status === 'done'
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors ${
        isTask ? 'hover:bg-slate-50 cursor-pointer' : 'hover:bg-slate-50'
      } ${done ? 'opacity-40' : ''}`}
      onClick={isTask && item.task && onToggleTask ? () => onToggleTask(item.task!) : undefined}
    >
      <span className="text-xs text-slate-400 w-12 shrink-0 text-right font-mono">{item.time}</span>
      <div className="w-1 self-stretch rounded-full shrink-0" style={{ backgroundColor: item.color }} />
      <div className="flex-1 min-w-0">
        <span className={`text-sm ${done ? 'line-through text-slate-400' : 'text-slate-800'}`}>
          {item.title}
        </span>
      </div>
      {item.duration && <span className="text-xs text-slate-400 shrink-0">{item.duration}</span>}
      {item.badge && <span className="text-[10px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded shrink-0">{item.badge}</span>}
      {isTask && (
        done
          ? <CheckCircle2 size={15} className="text-success shrink-0" />
          : <Circle size={15} className="text-slate-300 shrink-0" />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Habit chip (reused from before)
// ---------------------------------------------------------------------------

function HabitChip({ habit, onComplete }: {
  habit: HabitOut; onComplete: (id: number) => void
}) {
  return (
    <button
      onClick={() => !habit.today_done && onComplete(habit.id)}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium border transition-all
        ${habit.today_done
          ? 'bg-success text-white border-success'
          : 'bg-white text-slate-600 border-slate-200 hover:border-primary hover:text-primary'}`}
    >
      {habit.today_done ? <CheckCircle2 size={13} /> : <Circle size={13} />}
      {habit.title}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Dashboard() {
  const qc = useQueryClient()
  const td = todayStr()

  const { data: allTasks = [], isLoading: loadingTasks } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => tasks.list(),
  })

  const { data: allHabits = [], isLoading: loadingHabits } = useQuery({
    queryKey: ['habits'],
    queryFn: () => habits.list(),
  })

  // Events for today only
  const todayStart = new Date(td + 'T00:00:00').toISOString()
  const todayEnd = new Date(td + 'T23:59:59').toISOString()
  const { data: todayEvents = [], isLoading: loadingEvents } = useQuery({
    queryKey: ['events', 'dashboard', td],
    queryFn: () => calendar.events({ start: todayStart, end: todayEnd }),
  })

  const { data: projectsList = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
  })

  // ---- Derived data ----
  const activeTasks = allTasks.filter(t => t.status !== 'done' && !t.deleted_at)

  const overdueTasks = useMemo(() =>
    activeTasks.filter(t => t.due_date && t.due_date < td),
    [activeTasks, td],
  )

  const scheduledToday = useMemo(() =>
    allTasks
      .filter(t => t.scheduled_at && t.scheduled_at.split('T')[0] === td && !t.deleted_at)
      .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? '')),
    [allTasks, td],
  )
  const scheduledTodayIds = useMemo(() => new Set(scheduledToday.map(t => t.id)), [scheduledToday])

  const dueToday = useMemo(() =>
    activeTasks.filter(t => t.due_date === td && !scheduledTodayIds.has(t.id)),
    [activeTasks, td, scheduledTodayIds],
  )

  // Due Soon: tasks due today through 3 days out (excludes overdue)
  const threeDaysOut = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() + 3)
    return d.toISOString().split('T')[0]
  }, [])
  const dueSoonCount = useMemo(() =>
    activeTasks.filter(t => t.due_date && t.due_date >= td && t.due_date <= threeDaysOut).length,
    [activeTasks, td, threeDaysOut],
  )

  // Due This Week: through end of Sunday (current calendar week)
  const endOfWeek = useMemo(() => {
    const d = new Date()
    const dayOfWeek = d.getDay() // 0=Sun
    const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek
    d.setDate(d.getDate() + daysUntilSunday)
    return d.toISOString().split('T')[0]
  }, [])
  const dueThisWeek = useMemo(() =>
    activeTasks
      .filter(t => t.due_date && t.due_date >= td && t.due_date <= endOfWeek && !scheduledTodayIds.has(t.id))
      .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? '')),
    [activeTasks, td, endOfWeek, scheduledTodayIds],
  )

  const doneHabits = allHabits.filter(h => h.today_done).length

  // ---- Build timeline ----
  const timelineItems = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = []

    // Scheduled tasks
    for (const t of scheduledToday) {
      const start = parseUTCDate(t.scheduled_at!)
      const dur = t.estimated_minutes
      const endTime = dur ? new Date(start.getTime() + dur * 60_000) : null
      items.push({
        id: `task-${t.id}`,
        time: `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`,
        sortKey: start.getHours() * 60 + start.getMinutes(),
        title: t.title,
        duration: endTime ? durationLabel(t.scheduled_at!, endTime.toISOString()) : undefined,
        color: getProjectColor(t.project_id, projectsList),
        type: 'task',
        task: t,
      })
    }

    // Non-task_block events (meetings, personal, google imports)
    const taskBlockIds = new Set(scheduledToday.map(t => t.id))
    for (const e of todayEvents) {
      // Skip task_block events — they're represented by the task entries above
      if (e.event_type === 'task_block' && e.task_id && taskBlockIds.has(e.task_id)) continue
      if (e.event_type === 'task_block') continue

      const allDay = isAllDay(e)
      // Skip all-day events that ended at midnight today (they belong to yesterday)
      if (allDay && e.end_datetime.startsWith(td) && e.start_datetime < e.end_datetime) continue
      // Skip non-all-day events that started before today
      if (!allDay && e.start_datetime.split('T')[0] < td) continue
      const start = parseUTCDate(e.start_datetime)
      items.push({
        id: `event-${e.id}`,
        time: allDay ? 'All day' : formatTime(e.start_datetime),
        sortKey: allDay ? -1 : start.getHours() * 60 + start.getMinutes(),
        title: e.title,
        duration: allDay ? undefined : durationLabel(e.start_datetime, e.end_datetime),
        color: EVENT_COLOURS[e.event_type] ?? '#94A3B8',
        badge: e.source === 'google' ? 'Google' : undefined,
        type: 'event',
      })
    }

    items.sort((a, b) => a.sortKey - b.sortKey)
    return items
  }, [scheduledToday, todayEvents, projectsList])

  // ---- Mutations ----
  const toggleTask = useMutation({
    mutationFn: (task: Task) => {
      if (task.status === 'scheduled') {
        return tasks.unschedule(task.id).then(() =>
          tasks.update(task.id, { status: 'done' })
        )
      }
      return tasks.update(task.id, {
        status: task.status === 'done' ? 'todo' : 'done',
        current_updated_at: task.updated_at,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['events'] })
    },
    onError: () => toast.error('Failed to update task'),
  })

  const completeHabit = useMutation({
    mutationFn: (id: number) => habits.complete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['habits'] })
      toast.success('Habit marked complete!')
    },
    onError: () => toast.error('Failed to mark habit'),
  })

  const isLoading = loadingTasks || loadingHabits || loadingEvents

  const { dialog: explainerDialog, button: explainerButton } = useTabExplainer({
    storageKey: 'explainer-dashboard',
    title: 'Dashboard',
    subtitle: 'Your daily command centre — what\'s slipping, what\'s next, and what\'s on your plate today.',
    highlights: [
      { icon: AlertTriangle, title: 'Overdue banner',  body: 'Items past their due date surface at the top so nothing rots quietly.' },
      { icon: Clock,         title: 'Today\'s plan',   body: 'A clean timeline of every scheduled task block and meeting today.' },
      { icon: ListTodo,      title: 'Quick triage',    body: 'Tap a task to mark complete, jump straight into details, or pivot to another tab.' },
    ],
    tip: 'Tip: open the AI Assistant on Tasks/Projects/Habits for in-context creation — the Dashboard always reflects fresh data.',
  })

  return (
    <AppShell title="" action={explainerButton}>
      {explainerDialog}
      {/* Greeting */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{greeting()}</h1>
        <p className="text-sm text-slate-400 mt-0.5">{formattedDate()}</p>
      </div>

      {/* Overdue banner */}
      {overdueTasks.length > 0 && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={15} className="text-red-500" />
            <span className="text-sm font-semibold text-red-700">
              {overdueTasks.length} Overdue Task{overdueTasks.length > 1 ? 's' : ''}
            </span>
            <a href="/tasks" className="ml-auto text-xs text-red-500 hover:underline flex items-center gap-0.5">
              View all <ChevronRight size={11} />
            </a>
          </div>
          <div className="space-y-1">
            {overdueTasks.slice(0, 4).map(t => (
              <div key={t.id} className="flex items-center gap-2 text-sm text-red-700">
                <AlertCircle size={13} className="shrink-0 text-red-400" />
                <span className="truncate flex-1">{t.title}</span>
                {t.due_date && <span className="text-xs text-red-400 shrink-0">{dueDateLabel(t.due_date)}</span>}
              </div>
            ))}
            {overdueTasks.length > 4 && (
              <p className="text-xs text-red-400">+{overdueTasks.length - 4} more</p>
            )}
          </div>
        </div>
      )}

      {/* Metric tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {isLoading ? (
          <><SkeletonTile /><SkeletonTile /><SkeletonTile /><SkeletonTile /></>
        ) : (
          <>
            <MetricTile
              label="Scheduled Today"
              value={scheduledToday.length}
              icon={<CalendarDays size={18} />}
            />
            <MetricTile
              label="Due Soon (3d)"
              value={dueSoonCount}
              icon={<Clock size={18} />}
              accent={dueSoonCount > 0 ? '#D97706' : undefined}
            />
            <MetricTile
              label="Active Tasks"
              value={activeTasks.length}
              icon={<ListTodo size={18} />}
            />
            <MetricTile
              label="Habits Done"
              value={`${doneHabits}/${allHabits.length}`}
              icon={<Repeat2 size={18} />}
              accent={doneHabits === allHabits.length && allHabits.length > 0 ? '#059669' : undefined}
            />
          </>
        )}
      </div>

      {/* Two-column body */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left: Today's Plan */}
        <div className="lg:col-span-3">
          <div className="card">
            <div className="px-4 pt-4 pb-2 flex items-center justify-between">
              <h3>Today's Plan</h3>
              <a href="/calendar" className="text-xs text-primary hover:underline flex items-center gap-0.5">
                Calendar <ChevronRight size={12} />
              </a>
            </div>
            <div className="pb-2">
              {isLoading ? (
                <div className="px-4 space-y-1"><SkeletonRow /><SkeletonRow /><SkeletonRow /></div>
              ) : timelineItems.length === 0 && dueToday.length === 0 ? (
                <p className="px-4 pb-3 text-sm text-slate-400">Nothing scheduled for today. Use Smart Schedule to plan your day.</p>
              ) : (
                <>
                  {timelineItems.map(item => (
                    <TimelineRow
                      key={item.id}
                      item={item}
                      onToggleTask={item.task ? t => toggleTask.mutate(t) : undefined}
                    />
                  ))}
                  {/* Tasks due today but not scheduled */}
                  {dueToday.length > 0 && (
                    <div className="mt-2 border-t border-slate-100 pt-2">
                      <p className="px-3 text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">
                        Due today — no time set
                      </p>
                      {dueToday.map(t => (
                        <div
                          key={t.id}
                          className="flex items-center gap-3 px-3 py-2 rounded hover:bg-slate-50 cursor-pointer"
                          onClick={() => toggleTask.mutate(t)}
                        >
                          <span className="w-12 shrink-0" />
                          <div className="w-1 h-4 rounded-full bg-slate-200 shrink-0" />
                          <span className="text-sm text-slate-700 flex-1 truncate">{t.title}</span>
                          {t.priority === 'urgent' && <span className="badge-urgent">urgent</span>}
                          {t.priority === 'high' && <span className="badge-high">high</span>}
                          <Circle size={15} className="text-slate-300 shrink-0" />
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="lg:col-span-2 space-y-4">
          {/* Habits */}
          <div className="card">
            <div className="px-4 pt-4 pb-2 flex items-center justify-between">
              <h3>Habits</h3>
              <a href="/habits" className="text-xs text-primary hover:underline flex items-center gap-0.5">
                Manage <ChevronRight size={12} />
              </a>
            </div>
            <div className="px-4 pb-4">
              {loadingHabits ? (
                <div className="space-y-1"><SkeletonRow /><SkeletonRow /></div>
              ) : allHabits.length === 0 ? (
                <p className="text-sm text-slate-400">No active habits</p>
              ) : (
                <>
                  {/* Progress bar */}
                  <div className="flex items-center gap-3 mb-3">
                    <Progress
                      value={allHabits.length > 0 ? (doneHabits / allHabits.length) * 100 : 0}
                      className="h-2 flex-1"
                    />
                    <span className="text-xs font-medium text-slate-500">{doneHabits}/{allHabits.length}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {allHabits.map(h => (
                      <HabitChip key={h.id} habit={h} onComplete={id => completeHabit.mutate(id)} />
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Due This Week */}
          <div className="card">
            <div className="px-4 pt-4 pb-2 flex items-center justify-between">
              <h3>Due This Week</h3>
              <a href="/tasks" className="text-xs text-primary hover:underline flex items-center gap-0.5">
                All tasks <ChevronRight size={12} />
              </a>
            </div>
            <div className="pb-2">
              {loadingTasks ? (
                <div className="px-4 space-y-1"><SkeletonRow /><SkeletonRow /></div>
              ) : dueThisWeek.length === 0 ? (
                <p className="px-4 pb-3 text-sm text-slate-400">No upcoming deadlines this week</p>
              ) : (
                dueThisWeek.map(t => (
                  <div
                    key={t.id}
                    className="flex items-center gap-3 px-3 py-2 rounded hover:bg-slate-50 cursor-pointer"
                    onClick={() => toggleTask.mutate(t)}
                  >
                    <Circle size={15} className="text-slate-300 shrink-0" />
                    <span className="text-sm text-slate-700 flex-1 truncate">{t.title}</span>
                    {t.due_date && (
                      <span className="text-xs text-slate-400 shrink-0">{dueDateLabel(t.due_date)}</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
