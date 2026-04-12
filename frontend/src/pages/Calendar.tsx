import { useState, useEffect, useRef, useMemo, useCallback, type SyntheticEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { type View } from 'react-big-calendar'
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css'
import {
  format, startOfWeek, endOfWeek,
  startOfMonth, endOfMonth, eachDayOfInterval,
  addMonths, subMonths, addWeeks, subWeeks, addDays, subDays,
  isToday, isSameMonth, isSameDay,
} from 'date-fns'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import { Plus, RefreshCw, X, MapPin, Clock, ChevronLeft, ChevronRight } from 'lucide-react'
import { Sidebar } from '../components/layout/Sidebar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { calendar, tasks as tasksApi, projects as projectsApi } from '../lib/api'
import { getProjectColor, NO_PROJECT_COLOR, getContrastColor } from '../lib/colors'
import { parseUTCDate, toDatetimeLocal } from '../lib/datetime'
import {
  localizer, DnDCalendar, toBigCalEvent, CalendarEventBlock, getEventColor,
  GOOGLE_CAL_COLOR, GOOGLE_CAL_COLOR_OTHER,
  type BigCalEvent,
} from '../lib/calendarSetup'
import type { CalendarEvent, EventType, Task, Goal } from '../types'

// Use shared UTC parser
const toUTC = parseUTCDate

// ---------------------------------------------------------------------------
// Toolbar date range label
// ---------------------------------------------------------------------------

function getDateRangeLabel(date: Date, view: View): string {
  if (view === 'month') return format(date, 'MMMM yyyy')
  if (view === 'week') {
    const start = startOfWeek(date, { weekStartsOn: 1 })
    const end   = endOfWeek(date,   { weekStartsOn: 1 })
    if (format(start, 'MMMyyyy') === format(end, 'MMMyyyy')) {
      return `${format(start, 'MMM d')} – ${format(end, 'd, yyyy')}`
    }
    return `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`
  }
  return format(date, 'EEEE, MMMM d, yyyy')
}

// ---------------------------------------------------------------------------
// Mini calendar
// ---------------------------------------------------------------------------

function MiniCalendar({ selectedDate, onSelectDate }: {
  selectedDate: Date
  onSelectDate: (date: Date) => void
}) {
  const [month, setMonth] = useState(() => startOfMonth(selectedDate))

  useEffect(() => { setMonth(startOfMonth(selectedDate)) }, [selectedDate])

  const dayNames = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  const firstDay = startOfWeek(startOfMonth(month), { weekStartsOn: 1 })
  const lastDay  = endOfWeek(endOfMonth(month),     { weekStartsOn: 1 })
  const days     = eachDayOfInterval({ start: firstDay, end: lastDay })

  return (
    <div className="px-3 py-3">
      {/* Month header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
          {format(month, 'MMMM yyyy')}
        </span>
        <div className="flex gap-0.5">
          <button
            onClick={() => setMonth(m => subMonths(m, 1))}
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-500 dark:text-slate-400"
          >
            <ChevronLeft size={12} />
          </button>
          <button
            onClick={() => setMonth(m => addMonths(m, 1))}
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-500 dark:text-slate-400"
          >
            <ChevronRight size={12} />
          </button>
        </div>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {dayNames.map((d, i) => (
          <div key={i} className="text-center text-[10px] font-medium text-slate-400">{d}</div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {days.map(day => {
          const inMonth   = isSameMonth(day, month)
          const isSelected = isSameDay(day, selectedDate)
          const isTodayDay = isToday(day)
          return (
            <button
              key={day.toISOString()}
              onClick={() => onSelectDate(day)}
              className={[
                'w-6 h-6 mx-auto flex items-center justify-center rounded-full text-[11px] transition-colors',
                !inMonth    ? 'text-slate-300' : 'text-slate-700 dark:text-slate-300',
                isTodayDay && !isSelected ? 'text-primary-600 font-semibold' : '',
                isSelected  ? 'bg-primary-600 !text-white font-semibold' : 'hover:bg-slate-200 dark:hover:bg-slate-600',
              ].join(' ')}
            >
              {format(day, 'd')}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Calendar filter list
// ---------------------------------------------------------------------------

function CalendarFilterList({ calendars, hidden, onToggle }: {
  calendars: { id: string; summary: string; primary: boolean; backgroundColor: string }[]
  hidden: Set<string>
  onToggle: (id: string) => void
}) {
  const mine  = calendars.filter(c => c.primary)
  const other = calendars.filter(c => !c.primary)

  function Group({ title, items }: { title: string; items: typeof calendars }) {
    if (!items.length) return null
    return (
      <div className="mt-3">
        <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide px-3 mb-1">
          {title}
        </div>
        {items.map(cal => (
          <button
            key={cal.id}
            onClick={() => onToggle(cal.id)}
            className="flex items-center gap-2 w-full px-3 py-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-sm transition-colors text-left"
          >
            <div
              className="w-3 h-3 rounded-sm shrink-0 transition-opacity"
              style={{
                backgroundColor: cal.primary ? GOOGLE_CAL_COLOR : GOOGLE_CAL_COLOR_OTHER,
                opacity: hidden.has(cal.id) ? 0.25 : 1,
              }}
            />
            <span className={`text-xs truncate leading-tight ${hidden.has(cal.id) ? 'text-slate-400 line-through' : 'text-slate-700 dark:text-slate-300'}`}>
              {cal.summary}
            </span>
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="pb-4 border-t border-slate-200 dark:border-slate-700 pt-3 mt-1">
      <Group title="My Calendars" items={mine} />
      <Group title="Other Calendars" items={other} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Event detail popover (Google Calendar style)
// ---------------------------------------------------------------------------

interface PopoverState {
  event: CalendarEvent
  x: number
  y: number
}

function EventPopover({ state, calendarColors, calendarNames, tasksList, projectsList, onClose, onEdit, onDelete }: {
  state: PopoverState
  calendarColors: Record<string, string>
  calendarNames: Record<string, string>
  tasksList: Task[]
  projectsList: Goal[]
  onClose: () => void
  onEdit: (event: CalendarEvent) => void
  onDelete: (event: CalendarEvent) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { event, x, y } = state
  const color = getEventColor(event, calendarColors, tasksList, projectsList)

  // Clamp to viewport
  const left = Math.min(x, window.innerWidth - 296)
  const top  = (y + 320 > window.innerHeight) ? Math.max(8, y - 328) : y

  useEffect(() => {
    function handleDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleDown)
    return () => document.removeEventListener('mousedown', handleDown)
  }, [onClose])

  const calName = event.google_calendar_id ? calendarNames[event.google_calendar_id] : null

  return (
    <div
      ref={ref}
      className="fixed z-50 w-72 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden"
      style={{ left, top }}
    >
      {/* Coloured header */}
      <div className="h-10 flex items-center justify-between px-3" style={{ backgroundColor: color }}>
        <div /> {/* spacer */}
        <div className="flex items-center gap-2">
          {!event.is_read_only && (
            <button
              onClick={() => { onEdit(event); onClose() }}
              className="text-white/80 hover:text-white text-xs font-medium"
            >
              Edit
            </button>
          )}
          <button onClick={onClose} className="text-white/80 hover:text-white">
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="p-4 space-y-2.5">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm leading-snug">{event.title}</h3>

        {/* Time */}
        <div className="flex items-start gap-2 text-slate-600 dark:text-slate-400 text-xs">
          <Clock size={13} className="mt-0.5 shrink-0 text-slate-400" />
          <div>
            <div>{format(toUTC(event.start_datetime), 'EEEE, MMMM d')}</div>
            <div className="text-slate-500">
              {format(toUTC(event.start_datetime), 'HH:mm')} –{' '}
              {format(toUTC(event.end_datetime), 'HH:mm')}
            </div>
          </div>
        </div>

        {/* Location */}
        {event.location && (
          <div className="flex items-start gap-2 text-slate-600 text-xs">
            <MapPin size={13} className="mt-0.5 shrink-0 text-slate-400" />
            <span>{event.location}</span>
          </div>
        )}

        {/* Description */}
        {event.description && (
          <p className="text-xs text-slate-500 border-t border-slate-100 pt-2 leading-relaxed">
            {event.description}
          </p>
        )}

        {/* Calendar + badges */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
            <span className="text-xs text-slate-500">{calName ?? event.event_type}</span>
          </div>
          {event.source === 'google' && (
            <span className="text-[10px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded">Google</span>
          )}
          {event.is_read_only && (
            <span className="text-[10px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded">Read-only</span>
          )}
        </div>

        {/* Delete */}
        {!event.is_read_only && (
          <button
            onClick={() => { onDelete(event); onClose() }}
            className="text-xs text-danger hover:underline mt-1 block"
          >
            Delete event
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Event form dialog
// ---------------------------------------------------------------------------

function EventFormDialog({ open, onClose, onSave, initial, defaultStart, defaultEnd, tasksList, projectsList = [] }: {
  open: boolean
  onClose: () => void
  onSave: (data: Partial<CalendarEvent>, id?: number) => void
  initial?: CalendarEvent | null
  defaultStart?: Date
  defaultEnd?: Date
  tasksList: Task[]
  projectsList?: Goal[]
}) {
  // Convert a UTC Date to a local datetime-local input string
  const toLocal = (d: Date) => toDatetimeLocal(d)

  const [activeTab, setActiveTab] = useState('new')
  const [selectedTaskId, setSelectedTaskId] = useState<string>('__none__')

  const [title, setTitle]       = useState('')
  const [start, setStart]       = useState('')
  const [end, setEnd]           = useState('')
  const [type, setType]         = useState<EventType>('personal')
  const [location, setLocation] = useState('')
  const [description, setDesc]  = useState('')
  const [taskId, setTaskId]     = useState<number | undefined>()

  useEffect(() => {
    if (initial) {
      setTitle(initial.title)
      setStart(toLocal(toUTC(initial.start_datetime)))
      setEnd(toLocal(toUTC(initial.end_datetime)))
      setType(initial.event_type as EventType)
      setLocation(initial.location ?? '')
      setDesc(initial.description ?? '')
      setTaskId(initial.task_id)
    } else {
      const base = defaultStart ?? new Date()
      // Round up to next 15-minute mark
      const mins = base.getMinutes()
      base.setMinutes(Math.ceil(mins / 15) * 15, 0, 0)
      const endDate = defaultEnd ?? new Date(base.getTime() + 30 * 60_000)
      setTitle(''); setType('personal'); setLocation(''); setDesc(''); setTaskId(undefined)
      setStart(toDatetimeLocal(base))
      setEnd(toDatetimeLocal(endDate))
    }
    setActiveTab('new')
    setSelectedTaskId('__none__')
  }, [initial, open, defaultStart])

  function handleTaskSelect(value: string) {
    setSelectedTaskId(value)
    if (value === '__none__') return
    const task = tasksList.find(t => t.id === Number(value))
    if (!task) return
    // Pre-fill form fields from task
    setTitle(task.title)
    setDesc(task.description ?? '')
    setType('task_block')
    setTaskId(task.id)
    // Use clicked calendar slot or current time, rounded up to next 15min
    const now = new Date()
    const base = defaultStart ? new Date(defaultStart) : new Date(now)
    // If the base time is in the past, use now instead and round up
    if (base < now) base.setTime(now.getTime())
    const mins = base.getMinutes()
    base.setMinutes(Math.ceil(mins / 15) * 15, 0, 0)
    const durationMs = (task.estimated_minutes ?? 30) * 60_000
    const endDate = new Date(base.getTime() + durationMs)
    setStart(toDatetimeLocal(base))
    setEnd(toDatetimeLocal(endDate))
    // Switch to New Event tab so user can review
    setActiveTab('new')
  }

  function handleSave() {
    if (!title.trim()) { toast.error('Title is required'); return }
    onSave({
      title,
      start_datetime: new Date(start).toISOString(),
      end_datetime:   new Date(end).toISOString(),
      event_type:  type,
      location:    location || undefined,
      description: description || undefined,
      task_id:     taskId,
    }, initial?.id)
    onClose()
  }

  // Show unscheduled tasks only (todo, in_progress), ordered by due date then priority
  const PRIO_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
  const activeTasks = tasksList
    .filter(t => !t.deleted_at && (t.status === 'todo' || t.status === 'in_progress'))
    .sort((a, b) => {
      // Due date first (earliest first, null last)
      if (a.due_date && b.due_date) { const cmp = a.due_date.localeCompare(b.due_date); if (cmp !== 0) return cmp }
      if (a.due_date && !b.due_date) return -1
      if (!a.due_date && b.due_date) return 1
      // Then priority
      return (PRIO_ORDER[a.priority] ?? 2) - (PRIO_ORDER[b.priority] ?? 2)
    })

  const newEventForm = (
    <div className="space-y-4 pt-2">
      <div>
        <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Title</label>
        <Input value={title} onChange={e => setTitle(e.target.value)} className="mt-1" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wide flex items-center gap-1">
            <Clock size={11} /> Start
          </label>
          <Input type="datetime-local" value={start} onChange={e => {
            const newStart = e.target.value
            setStart(newStart)
            if (newStart) {
              const startDate = new Date(newStart)
              const selectedTask = taskId ? tasksList.find(t => t.id === taskId) : undefined
              const durationMs = (selectedTask?.estimated_minutes ?? 30) * 60_000
              const endDate = new Date(startDate.getTime() + durationMs)
              setEnd(toDatetimeLocal(endDate))
            }
          }} className="mt-1 h-8" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">End</label>
          <Input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} className="mt-1 h-8" />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Type</label>
        <Select value={type} onValueChange={v => setType(v as EventType)}>
          <SelectTrigger className="mt-1 h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="meeting">Meeting</SelectItem>
            <SelectItem value="personal">Personal</SelectItem>
            <SelectItem value="reminder">Reminder</SelectItem>
            <SelectItem value="task_block">Task Block</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-xs font-medium text-slate-500 uppercase tracking-wide flex items-center gap-1">
          <MapPin size={11} /> Location
        </label>
        <Input value={location} onChange={e => setLocation(e.target.value)} placeholder="Optional" className="mt-1" />
      </div>
      <div>
        <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Description</label>
        <Textarea value={description} onChange={e => setDesc(e.target.value)} rows={2} className="mt-1" />
      </div>
      <div className="flex gap-2 pt-1">
        <Button onClick={handleSave} className="flex-1">Save</Button>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit Event' : 'New Event'}</DialogTitle>
        </DialogHeader>
        {initial ? (
          newEventForm
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full">
              <TabsTrigger value="new" className="flex-1">New Event</TabsTrigger>
              <TabsTrigger value="from-task" className="flex-1">From Task</TabsTrigger>
            </TabsList>
            <TabsContent value="new">
              {newEventForm}
            </TabsContent>
            <TabsContent value="from-task" className="pt-2">
              <div className="space-y-3">
                <p className="text-xs text-slate-500">
                  Select a task to create a time block on the calendar.
                </p>
                <div className="max-h-[240px] overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-md divide-y divide-slate-100 dark:divide-slate-800">
                  {activeTasks.length === 0 ? (
                    <p className="p-3 text-sm text-slate-400 text-center">No tasks to schedule</p>
                  ) : activeTasks.map(t => {
                    const color = getProjectColor(t.project_id, projectsList)
                    const due = t.due_date ? new Date(t.due_date + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' }) : null
                    const dur = t.estimated_minutes ? (t.estimated_minutes < 60 ? `${t.estimated_minutes}m` : `${(t.estimated_minutes / 60).toFixed(1).replace('.0', '')}h`) : null
                    const selected = selectedTaskId === String(t.id)
                    const hasMeta = due || dur || t.priority
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => handleTaskSelect(String(t.id))}
                        className={`w-full text-left px-3 py-2.5 transition-colors ${selected ? 'bg-primary-50 dark:bg-primary-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                          <span className={`text-sm truncate flex-1 ${selected ? 'font-medium text-primary-700 dark:text-primary-300' : 'text-slate-700 dark:text-slate-200'}`}>
                            {t.title}
                          </span>
                        </div>
                        {hasMeta && (
                          <div className="flex items-center gap-3 mt-0.5 ml-[18px]">
                            {due && <span className="text-[10px] text-slate-400">Due: {due}</span>}
                            {dur && <span className="text-[10px] text-slate-400">Time: {dur}</span>}
                            {t.priority && <span className="text-[10px] text-slate-400">Priority: {t.priority}</span>}
                          </div>
                        )}
                      </button>
                    )
                  })
                  }
                </div>
                {activeTasks.length === 0 && (
                  <p className="text-sm text-slate-400">No active tasks available.</p>
                )}
              </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Main Calendar page
// ---------------------------------------------------------------------------

export function Calendar() {
  const qc = useQueryClient()
  const [view, setView]         = useState<View>('week')
  const [date, setDate]         = useState(new Date())
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing]   = useState<CalendarEvent | null>(null)
  const [defStart, setDefStart] = useState<Date | undefined>()
  const [defEnd, setDefEnd]     = useState<Date | undefined>()
  const [syncing, setSyncing]       = useState(false)
  const [popover, setPopover]       = useState<PopoverState | null>(null)
  const [hidden, setHidden]         = useState<Set<string>>(new Set())
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // Fetch window: 2 months around current date
  const viewStart = new Date(date.getFullYear(), date.getMonth() - 1, 1)
  const viewEnd   = new Date(date.getFullYear(), date.getMonth() + 2, 0)

  const { data: rawEvents = [], isLoading } = useQuery({
    queryKey: ['events', viewStart.toISOString(), viewEnd.toISOString()],
    queryFn:  () => calendar.events({ start: viewStart.toISOString(), end: viewEnd.toISOString() }),
  })

  const { data: calendarList = [] } = useQuery({
    queryKey: ['calendar-list'],
    queryFn:  calendar.listCalendars,
    staleTime: 5 * 60 * 1000,
  })

  const { data: tasksList = [] } = useQuery({
    queryKey: ['tasks'],
    queryFn:  () => tasksApi.list(),
    staleTime: 60_000,
  })

  const { data: projectsList = [] } = useQuery({
    queryKey: ['projects'],
    queryFn:  () => projectsApi.list(),
    staleTime: 5 * 60 * 1000,
  })

  const calendarColors = useMemo(
    () => Object.fromEntries(calendarList.map(c => [c.id, c.primary ? GOOGLE_CAL_COLOR : GOOGLE_CAL_COLOR_OTHER])),
    [calendarList],
  )
  const calendarNames = useMemo(
    () => Object.fromEntries(calendarList.map(c => [c.id, c.summary])),
    [calendarList],
  )

  // Filter hidden calendars
  const bigCalEvents = useMemo(() =>
    rawEvents
      .filter(e => !e.google_calendar_id || !hidden.has(e.google_calendar_id))
      .map(toBigCalEvent),
    [rawEvents, hidden],
  )

  function toggleCalendar(id: string) {
    setHidden(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // Navigation
  function goBack() {
    if (view === 'month')      setDate(d => subMonths(d, 1))
    else if (view === 'week')  setDate(d => subWeeks(d, 1))
    else                       setDate(d => subDays(d, 1))
  }
  function goForward() {
    if (view === 'month')      setDate(d => addMonths(d, 1))
    else if (view === 'week')  setDate(d => addWeeks(d, 1))
    else                       setDate(d => addDays(d, 1))
  }

  // Mutations
  const createEvent = useMutation({
    mutationFn: (body: Parameters<typeof calendar.createEvent>[0]) => calendar.createEvent(body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['events'] }); toast.success('Event created') },
    onError:   () => toast.error('Failed to create event'),
  })

  const updateEvent = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof calendar.updateEvent>[1] }) =>
      calendar.updateEvent(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['events'] }); toast.success('Event updated') },
    onError:   () => toast.error('Failed to update event'),
  })

  const deleteEvent = useMutation({
    mutationFn: (id: number) => calendar.deleteEvent(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['events'] }); qc.invalidateQueries({ queryKey: ['tasks'] }); toast.success('Event deleted') },
    onError:   () => toast.error('Failed to delete event'),
  })

  function handleSave(data: Partial<CalendarEvent>, id?: number) {
    if (id) {
      updateEvent.mutate({ id, data })
    } else if (data.event_type === 'task_block' && data.task_id) {
      // Use atomic schedule endpoint for task_block events
      tasksApi.schedule(data.task_id, {
        start_datetime: data.start_datetime!,
        end_datetime:   data.end_datetime!,
      }).then(() => {
        qc.invalidateQueries({ queryKey: ['events'] })
        qc.invalidateQueries({ queryKey: ['tasks'] })
        toast.success('Task scheduled')
      }).catch(() => toast.error('Failed to schedule task'))
    } else {
      createEvent.mutate({
        title:          data.title!,
        start_datetime: data.start_datetime!,
        end_datetime:   data.end_datetime!,
        event_type:     data.event_type,
        location:       data.location,
        description:    data.description,
        task_id:        data.task_id,
      })
    }
  }

  async function handleSync() {
    setSyncing(true)
    try {
      const result = await calendar.syncAll()
      qc.invalidateQueries({ queryKey: ['events'] })
      toast.success(`Synced ${result.total_fetched} events from ${result.calendars_synced} calendars`)
    } catch {
      toast.error('Google Calendar sync failed')
    } finally {
      setSyncing(false)
    }
  }

  async function handleEventMove({ event, start, end }: { event: BigCalEvent; start: string | Date; end: string | Date }) {
    const resource = event.resource
    if (!resource || resource.is_read_only) return
    const startDt = start instanceof Date ? start : new Date(start)
    const endDt = end instanceof Date ? end : new Date(end)
    try {
      // Atomic: moves event + updates linked task.scheduled_at in one transaction
      await calendar.moveEvent(resource.id, {
        start_datetime: startDt.toISOString(),
        end_datetime: endDt.toISOString(),
      })
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
    } catch {
      toast.error('Failed to move event')
    }
  }

  function handleEventClick(event: BigCalEvent, e: SyntheticEvent) {
    const target = e.target as HTMLElement
    const el     = target.closest('.rbc-event') as HTMLElement | null
    const rect   = el?.getBoundingClientRect()
    if (!rect) return
    setPopover({ event: event.resource, x: rect.left, y: rect.bottom + 8 })
  }

  // Custom event renderer
  const components = useMemo(() => ({
    event: (props: { event: BigCalEvent; title: string }) =>
      <CalendarEventBlock event={props.event} />,
  }), [])

  // Event style
  const eventPropGetter = useCallback((e: BigCalEvent) => {
    const colour = getEventColor(e.resource, calendarColors, tasksList, projectsList)
    return {
      style: {
        backgroundColor: colour,
        border: colour === NO_PROJECT_COLOR ? '1px solid #CBD5E1' : 'none',
        borderRadius: '4px',
        color: getContrastColor(colour),
        padding: '1px 4px',
      },
    }
  }, [calendarColors, tasksList, projectsList])

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-slate-900">
      <Sidebar />

      <div className="ml-[240px] flex flex-col flex-1 overflow-hidden min-w-0">
        {/* Top bar */}
        <header className="h-[56px] bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-4 shrink-0 z-10">
          <div className="flex items-center gap-1.5">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="mr-1 flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300 px-2 h-8 rounded border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                title="Show sidebar"
              >
                <ChevronRight size={13} />
                Calendars
              </button>
            )}
            <Button size="sm" variant="outline" onClick={() => setDate(new Date())} className="h-8 text-xs mr-1">
              Today
            </Button>
            <button
              onClick={goBack}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={goForward}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 transition-colors"
            >
              <ChevronRight size={16} />
            </button>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100 tracking-tight ml-1.5">
              {getDateRangeLabel(date, view)}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing} className="h-8 text-xs">
              <RefreshCw size={13} className={`mr-1 ${syncing ? 'animate-spin' : ''}`} />
              Sync Google
            </Button>
            <Button size="sm" onClick={() => { setEditing(null); setDefStart(new Date()); setFormOpen(true) }} className="h-8">
              <Plus size={14} className="mr-1" /> New Event
            </Button>
            {/* View toggle */}
            <div className="flex border border-slate-200 dark:border-slate-600 rounded-md overflow-hidden ml-1">
              {(['month', 'week', 'day'] as View[]).map(v => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={[
                    'px-3 h-8 text-xs font-medium capitalize transition-colors',
                    view === v
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700',
                  ].join(' ')}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </header>

        {/* Two-panel body */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Left panel */}
          <aside className={`flex flex-col shrink-0 bg-white dark:bg-slate-800 transition-[width] duration-200 ${sidebarOpen ? 'w-[220px] border-r border-slate-200 dark:border-slate-700 overflow-y-auto' : 'w-0 overflow-hidden'}`}>
            {/* Sidebar header with collapse button */}
            <div className="h-10 flex items-center justify-between px-3 border-b border-slate-100 dark:border-slate-700 shrink-0">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Calendars</span>
              <button
                onClick={() => setSidebarOpen(false)}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 px-1.5 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                title="Hide sidebar"
              >
                <ChevronLeft size={13} />
                <span>Hide</span>
              </button>
            </div>
            <MiniCalendar selectedDate={date} onSelectDate={setDate} />
            {calendarList.length > 0 && (
              <CalendarFilterList
                calendars={calendarList}
                hidden={hidden}
                onToggle={toggleCalendar}
              />
            )}
            {/* Project color legend */}
            {projectsList.length > 0 && (
              <div className="px-3 py-2 border-t border-slate-100 dark:border-slate-700">
                <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Projects</div>
                {projectsList.filter(p => !p.parent_id && !p.deleted_at).map(p => (
                  <div key={p.id} className="flex items-center gap-2 py-0.5">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: getProjectColor(p.id, projectsList) }} />
                    <span className="text-xs text-slate-600 dark:text-slate-300 truncate">{p.title}</span>
                  </div>
                ))}
                <div className="flex items-center gap-2 py-0.5 mt-1">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: NO_PROJECT_COLOR }} />
                  <span className="text-xs text-slate-400 truncate">No project</span>
                </div>
              </div>
            )}
          </aside>

          {/* Calendar grid */}
          <main className="flex-1 overflow-hidden min-w-0 p-0">
            {isLoading ? (
              <div className="w-full h-full bg-slate-50 animate-pulse" />
            ) : (
              <DnDCalendar
                localizer={localizer}
                events={bigCalEvents}
                view={view}
                date={date}
                onView={v => setView(v as View)}
                onNavigate={d => setDate(d)}
                onSelectEvent={(event, e) => handleEventClick(event as BigCalEvent, e as SyntheticEvent)}
                onSelectSlot={(slot: { start: Date; end: Date }) => {
                  setEditing(null)
                  setDefStart(slot.start)
                  setDefEnd(slot.end && slot.end.getTime() !== slot.start.getTime() ? slot.end : undefined)
                  setFormOpen(true)
                }}
                onEventDrop={handleEventMove}
                onEventResize={handleEventMove}
                draggableAccessor={(event: BigCalEvent) => !event.resource?.is_read_only}
                resizable
                selectable
                toolbar={false}
                style={{ height: '100%' }}
                eventPropGetter={e => eventPropGetter(e as BigCalEvent)}
                formats={{
                  timeGutterFormat: (d: Date) => format(d, 'HH:mm'),
                  eventTimeRangeFormat: ({ start, end }: { start: Date; end: Date }) =>
                    `${format(start, 'HH:mm')} – ${format(end, 'HH:mm')}`,
                  eventTimeRangeStartFormat: (d: Date) => format(d, 'HH:mm'),
                  selectRangeFormat: ({ start, end }: { start: Date; end: Date }) =>
                    `${format(start, 'HH:mm')} – ${format(end, 'HH:mm')}`,
                }}
                components={components}
                views={['month', 'week', 'day']}
                popup
              />
            )}
          </main>
        </div>
      </div>

      {/* Anchored event detail popover */}
      {popover && (
        <EventPopover
          state={popover}
          calendarColors={calendarColors}
          calendarNames={calendarNames}
          tasksList={tasksList}
          projectsList={projectsList}
          onClose={() => setPopover(null)}
          onEdit={event => { setEditing(event); setFormOpen(true) }}
          onDelete={event => deleteEvent.mutate(event.id)}
        />
      )}

      {/* Event form dialog */}
      <EventFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null) }}
        onSave={handleSave}
        initial={editing}
        defaultStart={defStart}
        defaultEnd={defEnd}
        tasksList={tasksList}
        projectsList={projectsList}
      />
    </div>
  )
}


