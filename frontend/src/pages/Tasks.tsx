import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { type View } from 'react-big-calendar'
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import { dateFnsLocalizer } from 'react-big-calendar'
import { enUS } from 'date-fns/locale'
import {
  Plus, Search, X, ChevronDown, ChevronRight, Circle, CheckCircle2,
  Loader2, Trash2, Tag, Calendar, Flag, List, LayoutGrid,
} from 'lucide-react'
import { AppShell } from '../components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { tasks, projects as projectsApi, calendar as calendarApi } from '../lib/api'
import { getProjectColor, getContrastColor, NO_PROJECT_COLOR } from '../lib/colors'
import { parseUTCDate } from '../lib/datetime'
import {
  DnDCalendar, toBigCalEvent, CalendarEventBlock, getEventColor,
  type BigCalEvent,
} from '../lib/calendarSetup'
import type { Task, TaskStatus, Priority, EnergyLevel, Goal, CalendarEvent, UpdateTaskRequest } from '../types'

// Proposal block shape — local state only, not persisted until confirmed
interface ProposalBlock {
  taskId: number
  title: string
  start: Date
  end: Date
  color: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do', in_progress: 'In Progress', scheduled: 'Scheduled', done: 'Done',
}
const PRIORITY_ORDER: Priority[] = ['urgent', 'high', 'medium', 'low']
const STATUS_ORDER: TaskStatus[] = ['in_progress', 'scheduled', 'todo', 'done']
const ENERGY_LEVELS: EnergyLevel[] = ['low', 'medium', 'high']

const DURATION_OPTIONS = [
  { label: '5 min',     value: 5   },
  { label: '15 min',    value: 15  },
  { label: '30 min',    value: 30  },
  { label: '45 min',    value: 45  },
  { label: '1 hour',    value: 60  },
  { label: '1.5 hours', value: 90  },
  { label: '2 hours',   value: 120 },
  { label: '3 hours',   value: 180 },
  { label: '4 hours',   value: 240 },
] as const


function priorityClass(p: Priority): string {
  return p === 'urgent' ? 'badge-urgent'
    : p === 'high'   ? 'badge-high'
    : p === 'medium' ? 'badge-medium'
    : 'badge-low'
}

function statusClass(s: TaskStatus): string {
  return s === 'done'        ? 'badge-done'
    : s === 'in_progress' ? 'badge-in_progress'
    : s === 'scheduled'   ? 'badge-scheduled'
    : 'badge-todo'
}

function groupByFn(
  list: Task[],
  by: 'status' | 'priority' | 'due_date',
): [string, Task[]][] {
  const map = new Map<string, Task[]>()
  for (const t of list) {
    const key = by === 'status' ? t.status : by === 'priority' ? t.priority : (t.due_date ?? 'No date')
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(t)
  }
  const entries = Array.from(map.entries())
  // Sort groups by defined order when grouping by status
  if (by === 'status') {
    entries.sort((a, b) => STATUS_ORDER.indexOf(a[0] as TaskStatus) - STATUS_ORDER.indexOf(b[0] as TaskStatus))
  }
  return entries
}

const SKELETON_ROWS = Array.from({ length: 5 })

// ---------------------------------------------------------------------------
// Quick-add bar — PRESERVED EXACTLY
// ---------------------------------------------------------------------------

interface QuickAddProps {
  onCreate: (title: string, extra: Partial<Task>) => void
  isCreating: boolean
  textRef?: React.MutableRefObject<{ value: string; clear: () => void }>
}

function QuickAdd({ onCreate, isCreating, textRef }: QuickAddProps) {
  const [text, setText] = useState('')
  const [parsing, setParsing] = useState(false)
  if (textRef) textRef.current = { value: text, clear: () => setText('') }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    let due_date: string | undefined
    setParsing(true)
    try {
      const res = await tasks.parseDate(text)
      due_date = res.date
    } catch {
      // no date detected — that's fine
    } finally {
      setParsing(false)
    }
    onCreate(text.trim(), due_date ? { due_date } : {})
    setText('')
  }

  return (
    <form onSubmit={handleSubmit} className="flex-1 relative">
      <Plus size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <Input
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder='Add task… press Enter to add, or click "Add Details"'
        className="pl-8"
        disabled={isCreating || parsing}
      />
      {/* Hidden submit button so Enter works */}
      <button type="submit" className="hidden" />
    </form>
  )
}

// ---------------------------------------------------------------------------
// TaskRow — clean grid layout with column headers
// ---------------------------------------------------------------------------

const TASK_GRID_COLS = '24px 10px minmax(180px,1fr) 88px 72px 56px 76px 20px'

function TaskListHeader() {
  return (
    <div
      className="grid items-center gap-2 px-3 py-1.5 border-b border-slate-100 dark:border-slate-800 sticky top-0 bg-white dark:bg-slate-900 z-[1]"
      style={{ gridTemplateColumns: TASK_GRID_COLS }}
    >
      <span />
      <span />
      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Task</span>
      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest text-center">Status</span>
      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest text-center">Due</span>
      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest text-center">Time</span>
      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest text-center">Priority</span>
      <span />
    </div>
  )
}

interface TaskRowProps {
  task: Task
  projectsList: Goal[]
  onToggle: (t: Task) => void
  onSelect: (t: Task) => void
  onDelete: (t: Task) => void
}

function TaskRow({ task, projectsList, onToggle, onSelect, onDelete }: TaskRowProps) {
  const done = task.status === 'done'
  const projectColor = getProjectColor(task.project_id, projectsList)
  const durationLabel = task.estimated_minutes
    ? (task.estimated_minutes < 60 ? `${task.estimated_minutes}m` : `${(task.estimated_minutes / 60).toFixed(1).replace('.0', '')}h`)
    : ''
  const dueDateLabel = task.due_date
    ? new Date(task.due_date + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })
    : ''
  const overdue = !!task.due_date && !done && task.due_date < new Date().toISOString().split('T')[0]

  return (
    <div
      className={`grid items-center gap-2 px-3 py-2 border-b border-slate-50 dark:border-slate-800/50 group hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors ${done ? 'opacity-45' : ''}`}
      style={{ gridTemplateColumns: TASK_GRID_COLS }}
      onClick={() => onSelect(task)}
    >
      <button
        className="text-slate-300 hover:text-primary"
        onClick={e => { e.stopPropagation(); onToggle(task) }}
      >
        {done ? <CheckCircle2 size={16} className="text-success" /> : <Circle size={16} />}
      </button>

      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: task.project_id ? projectColor : '#E2E8F0' }} />

      <span className={`text-sm truncate ${done ? 'line-through text-slate-400' : 'text-slate-700 dark:text-slate-200 font-medium'}`}>
        {task.title}
      </span>

      <span className={`${statusClass(task.status as TaskStatus)} justify-center`}>
        {STATUS_LABELS[task.status as TaskStatus]}
      </span>

      <span className={`text-xs text-center ${overdue ? 'text-danger font-semibold' : 'text-slate-400'}`}>
        {dueDateLabel}
      </span>

      <span className="text-xs text-slate-400 text-center">{durationLabel}</span>

      <span className={`${priorityClass(task.priority as Priority)} justify-center`}>{task.priority}</span>

      <button
        className="text-slate-300 hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={e => { e.stopPropagation(); onDelete(task) }}
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}

// SlotDayPreview removed — scheduling proposals now come from backend

// ---------------------------------------------------------------------------
// TaskDetailModal — Dialog, two columns, scheduling section
// ---------------------------------------------------------------------------

interface TaskDetailModalProps {
  task: Task | null
  open: boolean
  onClose: () => void
  onSave: (id: number, data: UpdateTaskRequest) => void
  onCreate?: (data: { title: string; description?: string; status?: TaskStatus; priority?: Priority; due_date?: string; tags?: string; project_id?: number; estimated_minutes?: number; energy_level?: EnergyLevel }) => void
  initialTitle?: string
}

function TaskDetailModal({ task, open, onClose, onSave, onCreate, initialTitle = '' }: TaskDetailModalProps) {
  const [title, setTitle]             = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus]           = useState<TaskStatus>('todo')
  const [priority, setPriority]       = useState<Priority>('medium')
  const [dueDate, setDueDate]         = useState('')
  const [tags, setTags]               = useState('')
  const [projectId, setProjectId]     = useState<number | undefined>()
  const [estimatedMins, setEstMins]   = useState<number | undefined>()
  const [energyLevel, setEnergy]      = useState<EnergyLevel | undefined>()
  const [scheduledAt, setScheduledAt] = useState<string | undefined>()

  const qc = useQueryClient()

  const { data: projectsList = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
    enabled: open,
  })

  useEffect(() => {
    if (open) {
      if (task) {
        setTitle(task.title)
        setDescription(task.description ?? '')
        setStatus(task.status as TaskStatus)
        setPriority(task.priority as Priority)
        setDueDate(task.due_date ?? '')
        setTags(task.tags ?? '')
        setProjectId(task.project_id)
        setEstMins(task.estimated_minutes)
        setEnergy(task.energy_level as EnergyLevel | undefined)
        setScheduledAt(task.scheduled_at)
      } else {
        // Create mode — reset all fields, use initialTitle if provided
        setTitle(initialTitle); setDescription(''); setStatus('todo'); setPriority('medium')
        setDueDate(''); setTags(''); setProjectId(undefined); setEstMins(undefined)
        setEnergy(undefined); setScheduledAt(undefined)
      }
    }
  }, [task, open])

  function handleSave() {
    if (!title.trim()) { toast.error('Title is required'); return }
    if (task) {
      onSave(task.id, {
        title,
        description:       description || undefined,
        status:            status === 'scheduled' ? undefined : status, // scheduled tasks managed via schedule/unschedule
        priority,
        due_date:          dueDate || undefined,
        tags:              tags || undefined,
        project_id:        projectId,
        estimated_minutes: estimatedMins,
        energy_level:      energyLevel,
        current_updated_at: task.updated_at,
      })
    } else if (onCreate) {
      onCreate({
        title,
        description: description || undefined,
        status,
        priority,
        due_date: dueDate || undefined,
        tags: tags || undefined,
        project_id: projectId,
        estimated_minutes: estimatedMins,
        energy_level: energyLevel,
      })
    }
    onClose()
  }

  const scheduledDisplay = scheduledAt
    ? parseUTCDate(scheduledAt).toLocaleString([], {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : null

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{task ? 'Edit Task' : 'New Task'}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">

          {/* ── Left column — core fields ── */}
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Title</label>
              <Input value={title} onChange={e => setTitle(e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Description</label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Project</label>
              <Select
                value={projectId !== undefined ? String(projectId) : '__none__'}
                onValueChange={v => setProjectId(v === '__none__' ? undefined : Number(v))}
              >
                <SelectTrigger className="mt-1 h-8"><SelectValue placeholder="No project" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No project</SelectItem>
                  {/* Show top-level projects first, then sub-projects indented below their parent */}
                  {projectsList
                    .filter(p => !p.parent_id && !p.deleted_at)
                    .flatMap(parent => {
                      const children = projectsList.filter(c => c.parent_id === parent.id && !c.deleted_at)
                      const parentColor = getProjectColor(parent.id, projectsList)
                      return [
                        <SelectItem key={parent.id} value={String(parent.id)}>
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: parentColor }} />
                            {parent.title}
                          </span>
                        </SelectItem>,
                        ...children.map(child => {
                          const childColor = getProjectColor(child.id, projectsList)
                          return (
                            <SelectItem key={child.id} value={String(child.id)}>
                              <span className="flex items-center gap-1.5 pl-3">
                                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: childColor }} />
                                {child.title}
                              </span>
                            </SelectItem>
                          )
                        }),
                      ]
                    })}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide flex items-center gap-1">
                <Tag size={11} /> Tags
                <span className="text-slate-300 font-normal normal-case">(comma-separated)</span>
              </label>
              <Input value={tags} onChange={e => setTags(e.target.value)} placeholder="work, urgent" className="mt-1" />
            </div>
          </div>

          {/* ── Right column — attributes + scheduling ── */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide flex items-center gap-1">
                  <Flag size={11} /> Priority
                </label>
                <Select value={priority} onValueChange={v => setPriority(v as Priority)}>
                  <SelectTrigger className="mt-1 h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITY_ORDER.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Status</label>
                <Select value={status} onValueChange={v => setStatus(v as TaskStatus)} disabled={status === 'scheduled'}>
                  <SelectTrigger className="mt-1 h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_ORDER.filter(s => s !== 'scheduled').map(s => (
                      <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide flex items-center gap-1">
                  <Calendar size={11} /> Due Date
                </label>
                <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="mt-1 h-8" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Est. Duration</label>
                <Select
                  value={estimatedMins !== undefined ? String(estimatedMins) : '__none__'}
                  onValueChange={v => setEstMins(v === '__none__' ? undefined : Number(v))}
                >
                  <SelectTrigger className="mt-1 h-8"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {DURATION_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Energy Level</label>
              <Select
                value={energyLevel ?? '__none__'}
                onValueChange={v => setEnergy(v === '__none__' ? undefined : v as EnergyLevel)}
              >
                <SelectTrigger className="mt-1 h-8"><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Any</SelectItem>
                  {ENERGY_LEVELS.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* ── Scheduling info ── */}
            {task && status === 'scheduled' && scheduledAt ? (
              <div className="border-t border-slate-100 dark:border-slate-700 pt-3 space-y-2">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Schedule</span>
                <div className="bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-md px-3 py-2">
                  <div className="text-xs font-medium text-primary-700 dark:text-primary-300">
                    Scheduled for {scheduledDisplay}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={async () => {
                    if (!task) return
                    try {
                      await tasks.unschedule(task.id)
                      qc.invalidateQueries({ queryKey: ['tasks'] })
                      qc.invalidateQueries({ queryKey: ['events'] })
                      toast.success('Task unscheduled')
                      onClose()
                    } catch {
                      toast.error('Failed to unschedule')
                    }
                  }}
                >
                  Unschedule
                </Button>
              </div>
            ) : task ? (
              <p className="text-xs text-slate-400 border-t border-slate-100 dark:border-slate-700 pt-3">
                Select this task in Smart Schedule below to find a time slot.
              </p>
            ) : (
              <p className="text-xs text-slate-400 border-t border-slate-100 dark:border-slate-700 pt-3">
                Save the task first, then schedule via Smart Schedule below.
              </p>
            )}

            <div className="pt-2 space-y-2 border-t border-slate-100 dark:border-slate-700">
              <Button onClick={handleSave} className="w-full">Save</Button>
              <Button variant="outline" onClick={onClose} className="w-full">Cancel</Button>
            </div>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// CompletedSection — collapsible, collapsed by default
// ---------------------------------------------------------------------------

function CompletedSection({ tasks: completedTasks, projectsList, onToggle, onSelect, onDelete }: {
  tasks: Task[]
  projectsList: Goal[]
  onToggle: (t: Task) => void
  onSelect: (t: Task) => void
  onDelete: (t: Task) => void
}) {
  const [open, setOpen] = useState(false)
  if (completedTasks.length === 0) return null
  return (
    <div className="mt-2">
      <button
        className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 w-full text-left"
        onClick={() => setOpen(v => !v)}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Completed ({completedTasks.length})
      </button>
      {open && completedTasks.map(t => (
        <TaskRow
          key={t.id}
          task={t}
          projectsList={projectsList}
          onToggle={onToggle}
          onSelect={onSelect}
          onDelete={onDelete}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// KanbanView — static, 4 columns
// ---------------------------------------------------------------------------

const KANBAN_COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo',        label: 'To Do' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'scheduled',   label: 'Scheduled' },
  { status: 'done',        label: 'Done' },
]

function KanbanCard({ task, projectsList, onSelect }: {
  task: Task
  projectsList: Goal[]
  onSelect: (t: Task) => void
}) {
  const projectColor = getProjectColor(task.project_id, projectsList)
  return (
    <div className="card-hover p-3 cursor-pointer" onClick={() => onSelect(task)}>
      <div className="flex items-start gap-2 mb-2">
        <div className="w-2.5 h-2.5 rounded-full shrink-0 mt-1" style={{ backgroundColor: task.project_id ? projectColor : '#E2E8F0' }} />
        <span className="text-sm text-slate-800 dark:text-slate-200 leading-snug flex-1">{task.title}</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={priorityClass(task.priority as Priority)}>{task.priority}</span>
        {task.due_date && <span className="text-xs text-slate-400">{task.due_date}</span>}
        {task.estimated_minutes && (
          <span className="text-xs text-slate-400">
            {task.estimated_minutes < 60
              ? `${task.estimated_minutes}m`
              : `${task.estimated_minutes / 60}h`}
          </span>
        )}
      </div>
    </div>
  )
}

function KanbanView({ tasks: allTasks, projectsList, onSelect }: {
  tasks: Task[]
  projectsList: Goal[]
  onSelect: (t: Task) => void
}) {
  return (
    <div className="grid grid-cols-4 gap-4">
      {KANBAN_COLUMNS.map(col => {
        const colTasks = allTasks.filter(t => t.status === col.status)
        return (
          <div key={col.status} className="flex flex-col gap-2">
            <div className="flex items-center gap-2 px-1 py-2 border-b border-slate-200 dark:border-slate-700">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-widest">
                {col.label}
              </span>
              <span className="badge bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
                {colTasks.length}
              </span>
            </div>
            <div className="space-y-2 overflow-y-auto max-h-[60vh]">
              {colTasks.map(t => (
                <KanbanCard key={t.id} task={t} projectsList={projectsList} onSelect={onSelect} />
              ))}
              {colTasks.length === 0 && (
                <p className="text-xs text-slate-300 px-1 py-3 text-center">Empty</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SmartSchedulePanel — Propose → Preview → Confirm flow
// Uses react-big-calendar (same component as main Calendar) for consistency.
// Proposals are ghost blocks (dashed, transparent) — only proposals are draggable.
// ---------------------------------------------------------------------------

function proposalToBigCalEvent(p: ProposalBlock): BigCalEvent {
  return {
    id: -p.taskId, // negative to avoid collision with real event IDs
    title: p.title,
    start: p.start,
    end: p.end,
    resource: {
      id: -p.taskId,
      title: p.title,
      event_type: 'task_block',
      start_datetime: p.start.toISOString(),
      end_datetime: p.end.toISOString(),
      is_recurring: false,
      source: 'local' as const,
      is_read_only: false,
      sync_stale: false,
      created_at: new Date().toISOString(),
      isProposal: true,
      proposalColor: p.color,
    } as CalendarEvent & { isProposal: boolean; proposalColor: string },
  }
}

function SmartSchedulePanel({ projectsList }: {
  projectsList: Goal[]
}) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [proposals, setProposals] = useState<ProposalBlock[]>([])
  const [loading, setLoading]     = useState(false)
  const [calDate, setCalDate]     = useState(new Date())

  const qc = useQueryClient()

  // Own unfiltered tasks query — always up to date regardless of toolbar filters
  const { data: schedulerTasks = [] } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => tasks.list(),
  })

  // Events from the same cache the main Calendar uses — single source of truth
  const { data: rawEvents = [] } = useQuery({
    queryKey: ['events'],
    queryFn: () => calendarApi.events(),
  })

  // Status is the source of truth — 'todo' and 'in_progress' are schedulable
  const unscheduledTasks = schedulerTasks.filter(
    t => (t.status === 'todo' || t.status === 'in_progress') && !t.deleted_at,
  )

  // Merge real events + proposal ghost blocks into one array for react-big-calendar
  const calendarEvents = useMemo<BigCalEvent[]>(() => [
    ...rawEvents.map(toBigCalEvent),
    ...proposals.map(proposalToBigCalEvent),
  ], [rawEvents, proposals])

  // Proposal-aware event styling
  const eventPropGetter = useCallback((e: object) => {
    const event = e as BigCalEvent
    if (event.resource?.isProposal) {
      const raw = event.resource.proposalColor ?? '#94A3B8'
      const isGrey = raw === NO_PROJECT_COLOR
      const color = isGrey ? '#94A3B8' : raw  // slate-400 instead of slate-200 for visibility
      return {
        style: {
          backgroundColor: color + (isGrey ? '30' : '20'),
          border: `2px dashed ${color}`,
          color: isGrey ? '#64748B' : color,  // slate-500 text for grey proposals
          borderRadius: '4px',
          padding: '1px 4px',
        } as React.CSSProperties,
      }
    }
    // Real events: same styling as main Calendar
    const colour = getEventColor(event.resource, {}, schedulerTasks, projectsList)
    return {
      style: {
        backgroundColor: colour,
        border: colour === NO_PROJECT_COLOR ? '1px solid #CBD5E1' : 'none',
        borderRadius: '4px',
        color: getContrastColor(colour),
        padding: '1px 4px',
      } as React.CSSProperties,
    }
  }, [schedulerTasks, projectsList])

  // Only proposals are draggable
  const draggableAccessor = useCallback(
    (event: BigCalEvent) => !!event.resource?.isProposal,
    [],
  )

  // Drag updates local proposal state — no backend call
  const handleEventDrop = useCallback(({ event, start, end }: {
    event: BigCalEvent; start: string | Date; end: string | Date
  }) => {
    if (!event.resource?.isProposal) return
    const taskId = Math.abs(event.id)
    const newStart = start instanceof Date ? start : new Date(start)
    const newEnd = end instanceof Date ? end : new Date(end)
    setProposals(prev => prev.map(p =>
      p.taskId === taskId ? { ...p, start: newStart, end: newEnd } : p
    ))
  }, [])

  const components = useMemo(() => ({
    event: (props: { event: BigCalEvent }) => <CalendarEventBlock event={props.event} />,
  }), [])

  function toggleId(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
        setProposals(p => p.filter(pr => pr.taskId !== id))
      } else {
        next.add(id)
      }
      return next
    })
  }

  // Propose: find slots without writing to DB
  async function handlePropose() {
    const toSchedule = unscheduledTasks.filter(t => selectedIds.has(t.id))
    if (!toSchedule.length) { toast.error('Select at least one task'); return }
    setLoading(true)
    try {
      const result = await tasks.findSlotsBatch({ task_ids: toSchedule.map(t => t.id) })
      const blocks: ProposalBlock[] = result.proposals.map(p => {
        const task = schedulerTasks.find(t => t.id === p.task_id)
        return {
          taskId: p.task_id,
          title: p.title,
          start: parseUTCDate(p.start),
          end: parseUTCDate(p.end),
          color: getProjectColor(task?.project_id, projectsList),
        }
      })
      setProposals(blocks)
      if (result.unscheduled.length > 0) {
        toast.warning(`Could not find slots for ${result.unscheduled.length} task(s)`)
      }
      // Navigate calendar to the first proposal's date
      if (blocks.length > 0) setCalDate(blocks[0].start)
    } catch {
      toast.error('Failed to find scheduling slots')
    } finally {
      setLoading(false)
    }
  }

  // Confirm: write proposals to DB atomically
  async function handleConfirm() {
    if (proposals.length === 0) return
    setLoading(true)
    try {
      await tasks.scheduleBatch({
        items: proposals.map(p => ({
          task_id: p.taskId,
          start_datetime: p.start.toISOString(),
          end_datetime: p.end.toISOString(),
        })),
      })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['events'] })
      toast.success(`Scheduled ${proposals.length} task(s)`)
      setProposals([])
      setSelectedIds(new Set())
    } catch {
      toast.error('Failed to confirm schedule')
    } finally {
      setLoading(false)
    }
  }

  // Scheduler localizer: week starts on today's day of week so on Sunday
  // you see Sun→Sat (7 days forward), enabling cross-week planning.
  const schedulerLocalizer = useMemo(() => {
    const todayDow = new Date().getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6
    return dateFnsLocalizer({
      format,
      parse,
      startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: todayDow }),
      getDay,
      locales: { 'en-US': enUS },
    })
  }, [])

  // Work hours for calendar bounds
  const workStart = useMemo(() => { const d = new Date(); d.setHours(7, 0, 0, 0); return d }, [])
  const workEnd = useMemo(() => { const d = new Date(); d.setHours(20, 0, 0, 0); return d }, [])
  const scrollTo = useMemo(() => { const d = new Date(); d.setHours(8, 0, 0, 0); return d }, [])

  return (
    <div className="mt-6 card">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
        <Calendar size={15} className="text-primary" />
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Smart Schedule</span>
      </div>
      <div className="flex gap-4 p-4">
        {/* Left: task checklist */}
        <div className="w-56 shrink-0">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">
            Select tasks to schedule
          </p>
          <div className="space-y-0.5 max-h-64 overflow-y-auto">
            {unscheduledTasks.length === 0 && (
              <p className="text-sm text-slate-400">No unscheduled tasks</p>
            )}
            {unscheduledTasks.map(t => {
              const proposal = proposals.find(p => p.taskId === t.id)
              return (
                <label
                  key={t.id}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
                    proposal ? 'bg-primary-50 dark:bg-primary-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(t.id)}
                    onChange={() => toggleId(t.id)}
                    className="rounded border-slate-300"
                  />
                  <span className="text-sm truncate flex-1 text-slate-700 dark:text-slate-300">
                    {t.title}
                  </span>
                  {t.estimated_minutes && (
                    <span className="text-[10px] text-slate-400 shrink-0">{t.estimated_minutes}m</span>
                  )}
                </label>
              )
            })}
          </div>
          <div className="flex flex-col gap-2 mt-3">
            <Button size="sm" onClick={handlePropose} disabled={selectedIds.size === 0 || loading}>
              {loading ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
              Schedule Selected
            </Button>
            {proposals.length > 0 && (
              <>
                <Button size="sm" onClick={handleConfirm} disabled={loading}>
                  Confirm ({proposals.length})
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setProposals([]); setSelectedIds(new Set()) }}>
                  Cancel
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Right: react-big-calendar — same component as main Calendar page */}
        <div className="flex-1 min-w-[480px] overflow-hidden">
          <DnDCalendar
            localizer={schedulerLocalizer}
            events={calendarEvents}
            view={'week' as View}
            date={calDate}
            onView={() => {}}
            onNavigate={d => setCalDate(d)}
            onEventDrop={handleEventDrop}
            onEventResize={handleEventDrop}
            draggableAccessor={draggableAccessor}
            resizable={false}
            selectable={false}
            toolbar={true}
            style={{ height: 500 }}
            eventPropGetter={eventPropGetter}
            components={components}
            formats={{
              timeGutterFormat: (d: Date) => format(d, 'HH:mm'),
              eventTimeRangeFormat: ({ start, end }: { start: Date; end: Date }) =>
                `${format(start, 'HH:mm')} – ${format(end, 'HH:mm')}`,
            }}
            views={['week']}
            min={workStart}
            max={workEnd}
            scrollToTime={scrollTo}
            step={15}
            timeslots={4}
          />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function Tasks() {
  const qc = useQueryClient()

  const [search, setSearch]        = useState('')
  const [filterStatus, setFStatus] = useState('all')
  const [filterPriority, setFPrio] = useState('all')
  const [sortBy, setSortBy]        = useState('created')
  const [groupBy, setGroupBy]      = useState<'status' | 'priority' | 'due_date'>('status')
  const [view, setView]            = useState<'list' | 'kanban'>('list')
  const [filterProject, setFProject] = useState<string>('all')
  const [selected, setSelected]    = useState<Task | null>(null)
  const [createTitle, setCreateTitle] = useState('')
  const quickAddTextRef = useRef<{ value: string; clear: () => void }>({ value: '', clear: () => {} })
  const [modalOpen, setModalOpen]  = useState(false)

  const undoRef = useRef<{ task: Task; timer: ReturnType<typeof setTimeout> } | null>(null)

  const { data: allTasks = [], isLoading } = useQuery({
    queryKey: ['tasks', filterStatus, filterPriority, filterProject],
    queryFn: () => tasks.list({
      status:     filterStatus   !== 'all' ? filterStatus             : undefined,
      priority:   filterPriority !== 'all' ? filterPriority           : undefined,
      project_id: filterProject  !== 'all' ? Number(filterProject)    : undefined,
    }),
  })

  const { data: projectsList = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
  })


  const createTask = useMutation({
    mutationFn: (body: Parameters<typeof tasks.create>[0]) => tasks.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
    onError: () => toast.error('Failed to create task'),
  })

  const updateTask = useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateTaskRequest }) =>
      tasks.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
    onError: () => toast.error('Failed to update task'),
  })

  const deleteTask = useMutation({
    mutationFn: (id: number) => tasks.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
    onError: () => toast.error('Failed to delete task'),
  })

  function handleToggle(task: Task) {
    if (task.status === 'done') {
      // Undo done → back to todo
      updateTask.mutate({ id: task.id, data: { status: 'todo', current_updated_at: task.updated_at } })
    } else if (task.status === 'scheduled') {
      // Unschedule + mark done atomically
      tasks.unschedule(task.id).then(() => {
        updateTask.mutate({ id: task.id, data: { status: 'done' } })
        qc.invalidateQueries({ queryKey: ['events'] })
      })
    } else {
      // todo/in_progress → done
      updateTask.mutate({ id: task.id, data: { status: 'done', current_updated_at: task.updated_at } })
    }
  }

  function handleSave(id: number, data: UpdateTaskRequest) {
    updateTask.mutate({ id, data })
    toast.success('Task saved')
  }

  function handleDelete(task: Task) {
    if (undoRef.current) {
      clearTimeout(undoRef.current.timer)
      deleteTask.mutate(undoRef.current.task.id)
    }
    qc.setQueryData<Task[]>(['tasks', filterStatus, filterPriority], old =>
      (old ?? []).filter(t => t.id !== task.id),
    )
    const timer = setTimeout(() => {
      deleteTask.mutate(task.id)
      undoRef.current = null
    }, 3000)
    undoRef.current = { task, timer }
    toast('Task deleted', {
      action: {
        label: 'Undo',
        onClick: () => {
          if (undoRef.current?.task.id === task.id) {
            clearTimeout(undoRef.current.timer)
            undoRef.current = null
            qc.invalidateQueries({ queryKey: ['tasks'] })
          }
        },
      },
      duration: 3000,
    })
  }

  const filtered = useMemo(() => {
    let list = allTasks.filter(t => {
      if (t.deleted_at) return false
      if (!search) return true
      return t.title.toLowerCase().includes(search.toLowerCase())
    })
    if (sortBy === 'due_date') {
      list = [...list].sort((a, b) => (a.due_date ?? 'z').localeCompare(b.due_date ?? 'z'))
    } else if (sortBy === 'priority') {
      list = [...list].sort((a, b) =>
        PRIORITY_ORDER.indexOf(a.priority as Priority) - PRIORITY_ORDER.indexOf(b.priority as Priority),
      )
    }
    return list
  }, [allTasks, search, sortBy])

  const activeTasks    = filtered.filter(t => t.status !== 'done')
  const completedTasks = filtered.filter(t => t.status === 'done')
  const groups         = groupByFn(activeTasks, groupBy)

  function openModal(task: Task) {
    setSelected(task)
    setModalOpen(true)
  }

  return (
    <AppShell title="Tasks">
      {/* Unified toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search tasks…"
            className="pl-8 h-8 w-44 text-sm"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X size={12} className="text-slate-400" />
            </button>
          )}
        </div>

        <Select value={filterStatus} onValueChange={setFStatus}>
          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUS_ORDER.map(s => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterPriority} onValueChange={setFPrio}>
          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Priority" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            {PRIORITY_ORDER.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterProject} onValueChange={setFProject}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Project" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            {projectsList.map(p => {
              const dot = getProjectColor(p.id, projectsList)
              return (
                <SelectItem key={p.id} value={String(p.id)}>
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: dot }}
                    />
                    {p.title}
                  </span>
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>

        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Sort" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="created">Sort: Created</SelectItem>
            <SelectItem value="due_date">Sort: Due date</SelectItem>
            <SelectItem value="priority">Sort: Priority</SelectItem>
          </SelectContent>
        </Select>

        <Select value={groupBy} onValueChange={v => setGroupBy(v as typeof groupBy)}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Group" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="status">Group: Status</SelectItem>
            <SelectItem value="priority">Group: Priority</SelectItem>
            <SelectItem value="due_date">Group: Due Date</SelectItem>
          </SelectContent>
        </Select>

        {/* View toggle */}
        <div className="flex border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden ml-auto">
          <button
            onClick={() => setView('list')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${view === 'list' ? 'bg-primary text-white' : 'bg-white dark:bg-slate-800 text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}
          >
            <List size={14} /> List
          </button>
          <button
            onClick={() => setView('kanban')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${view === 'kanban' ? 'bg-primary text-white' : 'bg-white dark:bg-slate-800 text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}
          >
            <LayoutGrid size={14} /> Board
          </button>
        </div>
      </div>

      {/* Quick-add */}
      <div className="mb-6 flex gap-2 items-start">
        <QuickAdd
          onCreate={(title, extra) => createTask.mutate({ title, ...extra })}
          isCreating={createTask.isPending}
          textRef={quickAddTextRef}
        />
        <Button
          variant="outline"
          size="sm"
          className="h-9 shrink-0"
          onClick={() => { setCreateTitle(quickAddTextRef.current.value); quickAddTextRef.current.clear(); setSelected(null); setModalOpen(true) }}
        >
          Add Details
        </Button>
      </div>

      {/* Main content */}
      {isLoading ? (
        <div className="card p-4 space-y-1">
          {SKELETON_ROWS.map((_, i) => (
            <div key={i} className="h-9 bg-slate-50 rounded animate-pulse" />
          ))}
        </div>
      ) : view === 'kanban' ? (
        <KanbanView
          tasks={filtered}
          projectsList={projectsList}
          onSelect={openModal}
        />
      ) : (
        <div className="card">
          {filtered.length === 0 ? (
            <p className="p-6 text-sm text-slate-400 text-center">
              {search || filterStatus !== 'all' || filterPriority !== 'all'
                ? 'No tasks match your filters.'
                : 'No tasks yet — add one above!'}
            </p>
          ) : (
            <div>
              <TaskListHeader />
              {groups.map(([group, groupTasks]) => (
                <div key={group}>
                  <div className="section-header px-4">{STATUS_LABELS[group as TaskStatus] ?? group}</div>
                  {groupTasks.map(t => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      projectsList={projectsList}
                      onToggle={handleToggle}
                      onSelect={openModal}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              ))}
              <CompletedSection
                tasks={completedTasks}
                projectsList={projectsList}
                onToggle={handleToggle}
                onSelect={openModal}
                onDelete={handleDelete}
              />
            </div>
          )}
        </div>
      )}

      {/* Smart Schedule Panel */}
      <SmartSchedulePanel projectsList={projectsList} />

      {/* Task detail modal */}
      <TaskDetailModal
        task={selected}
        open={modalOpen}
        onClose={() => { setModalOpen(false); setCreateTitle('') }}
        onSave={handleSave}
        onCreate={data => { createTask.mutate(data); toast.success('Task created') }}
        initialTitle={createTitle}
      />
    </AppShell>
  )
}
