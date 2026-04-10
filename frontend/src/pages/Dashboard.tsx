import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, Circle, CalendarDays, AlertCircle, Repeat2, ChevronRight } from 'lucide-react'
import { AppShell } from '../components/layout/AppShell'
import { tasks, habits, calendar } from '../lib/api'
import type { Task, CalendarEvent } from '../types'
import { parseUTCDate } from '../lib/datetime'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function today(): string {
  return new Date().toISOString().split('T')[0]
}

function isToday(dateStr?: string): boolean {
  return !!dateStr && dateStr.split('T')[0] === today()
}

function isOverdue(task: Task): boolean {
  if (!task.due_date) return false
  if (task.status === 'done') return false
  return task.due_date < today()
}

function formatTime(iso: string): string {
  return parseUTCDate(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(iso: string): string {
  return parseUTCDate(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

const EVENT_COLOURS: Record<string, string> = {
  meeting:      '#3B82F6',
  personal:     '#8B5CF6',
  reminder:     '#F59E0B',
  task_block:   '#10B981',
  google_import:'#94A3B8',
}

// ---------------------------------------------------------------------------
// Skeleton
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
interface TileProps {
  label: string
  value: string | number
  icon: React.ReactNode
  accent?: string
}
function MetricTile({ label, value, icon, accent }: TileProps) {
  return (
    <div className="metric-tile">
      <div className="flex items-start justify-between">
        <span className="metric-value" style={accent ? { color: accent } : undefined}>{value}</span>
        <span className="text-slate-300">{icon}</span>
      </div>
      <span className="metric-label">{label}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Task row
// ---------------------------------------------------------------------------
function TaskRow({ task, onToggle }: { task: Task; onToggle: (t: Task) => void }) {
  const done = task.status === 'done'
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 rounded hover:bg-slate-50 dark:hover:bg-slate-700/50 group cursor-pointer
                  ${done ? 'opacity-50' : ''}`}
      onClick={() => onToggle(task)}
    >
      {done
        ? <CheckCircle2 size={16} className="text-success shrink-0" />
        : <Circle size={16} className="text-slate-300 group-hover:text-primary shrink-0" />}
      <span className={`flex-1 text-sm ${done ? 'line-through text-slate-400' : 'text-slate-700 dark:text-slate-300'}`}>
        {task.title}
      </span>
      {task.priority === 'urgent' && <span className="badge-urgent">urgent</span>}
      {task.priority === 'high'   && <span className="badge-high">high</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Habit chip
// ---------------------------------------------------------------------------
function HabitChip({ habit, onComplete }: {
  habit: { id: number; title: string; today_done: boolean }
  onComplete: (id: number) => void
}) {
  return (
    <button
      onClick={() => !habit.today_done && onComplete(habit.id)}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium border transition-all
        ${habit.today_done
          ? 'bg-success text-white border-success'
          : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-primary hover:text-primary'}`}
    >
      {habit.today_done ? <CheckCircle2 size={13} /> : <Circle size={13} />}
      {habit.title}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Event row
// ---------------------------------------------------------------------------
function EventRow({ event }: { event: CalendarEvent }) {
  const colour = EVENT_COLOURS[event.event_type] ?? '#94A3B8'
  return (
    <div className="flex items-start gap-3 px-3 py-2 rounded hover:bg-slate-50 dark:hover:bg-slate-700/50">
      <div className="w-1 self-stretch rounded-full mt-1 shrink-0" style={{ backgroundColor: colour }} />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-slate-800 dark:text-slate-200 truncate">{event.title}</div>
        <div className="text-xs text-slate-400">{formatDate(event.start_datetime)} · {formatTime(event.start_datetime)}</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function Dashboard() {
  const qc = useQueryClient()

  const { data: allTasks = [], isLoading: loadingTasks } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => tasks.list(),
  })

  const { data: allHabits = [], isLoading: loadingHabits } = useQuery({
    queryKey: ['habits'],
    queryFn: () => habits.list(),
  })

  const { data: events = [], isLoading: loadingEvents } = useQuery({
    queryKey: ['events', 'upcoming'],
    queryFn: () => calendar.events({ start: new Date().toISOString() }),
  })

  // Derived metrics
  const todayTasks  = allTasks.filter(t => isToday(t.due_date))
  const overdueTasks = allTasks.filter(t => isOverdue(t))
  // todayHabits would be used by a "pending" counter — not currently displayed
  const doneHabits  = allHabits.filter(h => h.today_done).length
  const upcomingEvents = [...events]
    .sort((a, b) => a.start_datetime.localeCompare(b.start_datetime))
    .slice(0, 3)

  // Mutations
  const toggleTask = useMutation({
    mutationFn: (task: Task) => tasks.update(task.id, {
      status: task.status === 'done' ? 'todo' : 'done',
      current_updated_at: task.updated_at,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
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

  return (
    <AppShell title="Dashboard">
      {/* Metric tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {loadingTasks ? (
          <><SkeletonTile /><SkeletonTile /></>
        ) : (
          <>
            <MetricTile
              label="Due Today"
              value={todayTasks.length}
              icon={<CalendarDays size={18} />}
            />
            <MetricTile
              label="Overdue"
              value={overdueTasks.length}
              icon={<AlertCircle size={18} />}
              accent={overdueTasks.length > 0 ? '#DC2626' : undefined}
            />
          </>
        )}
        {loadingHabits ? (
          <SkeletonTile />
        ) : (
          <MetricTile
            label="Habits Done"
            value={`${doneHabits}/${allHabits.length}`}
            icon={<Repeat2 size={18} />}
            accent={doneHabits === allHabits.length && allHabits.length > 0 ? '#059669' : undefined}
          />
        )}
        {loadingEvents ? (
          <SkeletonTile />
        ) : (
          <MetricTile
            label="Next Event"
            value={upcomingEvents[0] ? formatTime(upcomingEvents[0].start_datetime) : '—'}
            icon={<CalendarDays size={18} />}
          />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Today's tasks */}
        <div className="lg:col-span-2 space-y-4">
          <div className="card">
            <div className="px-4 pt-4 pb-2 flex items-center justify-between">
              <h3>Today's Tasks</h3>
              <a href="/tasks" className="text-xs text-primary hover:underline flex items-center gap-0.5">
                All tasks <ChevronRight size={12} />
              </a>
            </div>
            <div className="pb-2">
              {loadingTasks ? (
                <div className="px-4 space-y-1"><SkeletonRow /><SkeletonRow /><SkeletonRow /></div>
              ) : todayTasks.length === 0 ? (
                <p className="px-4 pb-3 text-sm text-slate-400">No tasks due today 🎉</p>
              ) : (
                todayTasks.map(t => (
                  <TaskRow key={t.id} task={t} onToggle={t => toggleTask.mutate(t)} />
                ))
              )}
            </div>
          </div>

          {/* Overdue (if any) */}
          {overdueTasks.length > 0 && (
            <div className="card">
              <div className="px-4 pt-4 pb-2">
                <h3 className="text-danger">Overdue ({overdueTasks.length})</h3>
              </div>
              <div className="pb-2">
                {overdueTasks.slice(0, 5).map(t => (
                  <TaskRow key={t.id} task={t} onToggle={t => toggleTask.mutate(t)} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Habit check-ins */}
          <div className="card">
            <div className="px-4 pt-4 pb-2 flex items-center justify-between">
              <h3>Habits</h3>
              <a href="/habits" className="text-xs text-primary hover:underline flex items-center gap-0.5">
                Manage <ChevronRight size={12} />
              </a>
            </div>
            <div className="px-4 pb-4 flex flex-wrap gap-2">
              {loadingHabits ? (
                <div className="w-full space-y-1"><SkeletonRow /><SkeletonRow /></div>
              ) : allHabits.length === 0 ? (
                <p className="text-sm text-slate-400">No active habits</p>
              ) : (
                allHabits.map(h => (
                  <HabitChip key={h.id} habit={h} onComplete={id => completeHabit.mutate(id)} />
                ))
              )}
            </div>
          </div>

          {/* Upcoming events */}
          <div className="card">
            <div className="px-4 pt-4 pb-2 flex items-center justify-between">
              <h3>Upcoming</h3>
              <a href="/calendar" className="text-xs text-primary hover:underline flex items-center gap-0.5">
                Calendar <ChevronRight size={12} />
              </a>
            </div>
            <div className="pb-2">
              {loadingEvents ? (
                <div className="px-4 space-y-1"><SkeletonRow /><SkeletonRow /></div>
              ) : upcomingEvents.length === 0 ? (
                <p className="px-4 pb-3 text-sm text-slate-400">No upcoming events</p>
              ) : (
                upcomingEvents.map(e => <EventRow key={e.id} event={e} />)
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
