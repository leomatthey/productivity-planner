import { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
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
import { tasks, calendar as calendarApi, projects as projectsApi } from '../lib/api'
import { getProjectColor } from '../lib/colors'
import { parseUTCDate } from '../lib/datetime'
import type { Task, TaskStatus, Priority, EnergyLevel, Goal, CalendarEvent, UpdateTaskRequest } from '../types'

// Proposal shape returned by backend find-slots
interface SlotProposal {
  start: string  // ISO datetime
  end: string    // ISO datetime
  date: string   // ISO date
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do', in_progress: 'In Progress', scheduled: 'Scheduled', done: 'Done', cancelled: 'Cancelled',
}
const PRIORITY_ORDER: Priority[] = ['urgent', 'high', 'medium', 'low']
const STATUS_ORDER: TaskStatus[] = ['in_progress', 'scheduled', 'todo', 'done', 'cancelled']
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

const EVENT_COLOURS: Record<string, string> = {
  meeting: '#3B82F6', personal: '#8B5CF6', reminder: '#F59E0B',
  task_block: '#10B981', google_import: '#94A3B8',
}

const WORK_START_H = 9
const WORK_END_H   = 18
const HOUR_HEIGHT  = 48 // px

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
    : s === 'cancelled'   ? 'badge-cancelled'
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

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

// Use shared UTC parser — backend stores naive UTC datetimes
const toUTCSafe = parseUTCDate

function getSlotStyle(start: Date, end: Date): React.CSSProperties {
  const startMins = (start.getHours() - WORK_START_H) * 60 + start.getMinutes()
  const endMins   = (end.getHours()   - WORK_START_H) * 60 + end.getMinutes()
  const clampedStart = Math.max(0, startMins)
  const clampedEnd   = Math.min((WORK_END_H - WORK_START_H) * 60, endMins)
  if (clampedEnd <= clampedStart) return { display: 'none' }
  return {
    position: 'absolute' as const,
    top:    `${(clampedStart / 60) * HOUR_HEIGHT}px`,
    height: `${((clampedEnd - clampedStart) / 60) * HOUR_HEIGHT}px`,
    left: '2px',
    right: '2px',
  }
}

const SKELETON_ROWS = Array.from({ length: 5 })

// ---------------------------------------------------------------------------
// Quick-add bar — PRESERVED EXACTLY
// ---------------------------------------------------------------------------

interface QuickAddProps {
  onCreate: (title: string, extra: Partial<Task>) => void
  isCreating: boolean
}

function QuickAdd({ onCreate, isCreating }: QuickAddProps) {
  const [text, setText] = useState('')
  const [parsing, setParsing] = useState(false)

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
    <form onSubmit={handleSubmit} className="flex gap-2">
      <div className="relative flex-1">
        <Plus size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder='Add task… e.g. "Review deck by Friday"'
          className="pl-8"
        />
      </div>
      <Button type="submit" disabled={!text.trim() || isCreating || parsing} size="sm">
        {isCreating || parsing ? <Loader2 size={14} className="animate-spin" /> : 'Add'}
      </Button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// TaskRow — redesigned with project color circle, project name, structured cols
// ---------------------------------------------------------------------------

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
  const projectName = task.project_id
    ? (projectsList.find(p => p.id === task.project_id)?.title ?? null)
    : null
  const firstTag = task.tags ? task.tags.split(',')[0].trim() : null

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 rounded group hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer ${done ? 'opacity-60' : ''}`}
      onClick={() => onSelect(task)}
    >
      {/* Checkbox */}
      <button
        className="shrink-0 text-slate-300 hover:text-primary focus:outline-none"
        onClick={e => { e.stopPropagation(); onToggle(task) }}
        aria-label={done ? 'Mark incomplete' : 'Mark complete'}
      >
        {done
          ? <CheckCircle2 size={16} className="text-success" />
          : <Circle size={16} />}
      </button>

      {/* Project color circle (8px) */}
      <div
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: task.project_id ? projectColor : '#E2E8F0' }}
      />

      {/* Title + first tag */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className={`text-sm truncate ${done ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-200'}`}>
          {task.title}
        </span>
        {firstTag && (
          <span className="tag shrink-0 hidden lg:inline-flex">{firstTag}</span>
        )}
      </div>

      {/* Project name */}
      {projectName && (
        <span className="text-xs text-slate-400 hidden md:inline shrink-0 truncate max-w-[80px]">
          {projectName}
        </span>
      )}

      {/* Priority badge */}
      <span className={`${priorityClass(task.priority as Priority)} shrink-0`}>
        {task.priority}
      </span>

      {/* Due date */}
      {task.due_date && (
        <span className="text-xs text-slate-400 hidden md:inline shrink-0">{task.due_date}</span>
      )}

      {/* Est. Duration */}
      {task.estimated_minutes && (
        <span className="text-xs text-slate-400 hidden md:inline shrink-0">
          {task.estimated_minutes < 60
            ? `${task.estimated_minutes}m`
            : `${task.estimated_minutes / 60}h`}
        </span>
      )}

      {/* Status badge */}
      <span className={`${statusClass(task.status as TaskStatus)} hidden sm:inline-flex shrink-0`}>
        {STATUS_LABELS[task.status as TaskStatus]}
      </span>

      {/* Delete on hover */}
      <button
        className="shrink-0 text-slate-300 hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={e => { e.stopPropagation(); onDelete(task) }}
        aria-label="Delete"
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
}

function TaskDetailModal({ task, open, onClose, onSave, onCreate }: TaskDetailModalProps) {
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
  const [proposals, setProposals]     = useState<SlotProposal[]>([])
  const [scheduling, setScheduling]   = useState(false)

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
        setProposals([])
      } else {
        // Create mode — reset all fields
        setTitle(''); setDescription(''); setStatus('todo'); setPriority('medium')
        setDueDate(''); setTags(''); setProjectId(undefined); setEstMins(undefined)
        setEnergy(undefined); setScheduledAt(undefined); setProposals([])
      }
    }
  }, [task, open])

  async function handleFindSlots() {
    if (!task) return
    setScheduling(true)
    try {
      // If user changed estimated_minutes in the modal, save it first
      if (estimatedMins !== task.estimated_minutes) {
        await tasks.update(task.id, { estimated_minutes: estimatedMins })
      }
      const result = await tasks.findSlots({ task_id: task.id, count: 3 })
      if (result.slots.length === 0) {
        toast.error('No free slots found in the next 14 days')
      } else {
        setProposals(result.slots)
      }
    } catch {
      toast.error('Failed to find slots')
    } finally {
      setScheduling(false)
    }
  }

  async function handleApprove(proposal: SlotProposal) {
    if (!task) return
    setScheduling(true)
    try {
      await tasks.schedule(task.id, {
        start_datetime: proposal.start,
        end_datetime: proposal.end,
      })
      // Atomic: task status + calendar event both done
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['events'] })
      toast.success('Task scheduled')
      onClose()
    } catch {
      toast.error('Failed to schedule task')
    } finally {
      setScheduling(false)
    }
  }

  function handleSave() {
    if (!title.trim()) { toast.error('Title is required'); return }
    if (task) {
      onSave(task.id, {
        title,
        description:       description || undefined,
        status,
        priority,
        due_date:          dueDate || undefined,
        tags:              tags || undefined,
        project_id:        projectId,
        estimated_minutes: estimatedMins,
        energy_level:      energyLevel,
        scheduled_at:      scheduledAt,
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
                <Select value={status} onValueChange={v => setStatus(v as TaskStatus)}>
                  <SelectTrigger className="mt-1 h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_ORDER.map(s => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
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

            {/* ── Scheduling ── */}
            <div className="border-t border-slate-100 dark:border-slate-700 pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Schedule</span>
                {scheduledDisplay && (
                  <span className="text-xs text-primary-600 dark:text-primary-400">{scheduledDisplay}</span>
                )}
              </div>
              {status === 'scheduled' && scheduledAt ? (
                /* Already scheduled — show info + reschedule option */
                <div className="space-y-2">
                  <div className="bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-md px-3 py-2">
                    <div className="text-xs font-medium text-primary-700 dark:text-primary-300">
                      Scheduled for {scheduledDisplay}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      setStatus('todo')
                      setScheduledAt(undefined)
                      setProposals([])
                    }}
                  >
                    Reschedule
                  </Button>
                </div>
              ) : (
                /* Not scheduled — show scheduling UI */
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={handleFindSlots}
                    disabled={scheduling}
                  >
                    {scheduling ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
                    Find 3 Time Slots
                  </Button>
                  {proposals.length > 0 && (
                    <div className="space-y-2 mt-1">
                      {proposals.map((p, i) => {
                        const startDate = parseUTCDate(p.start)
                        const endDate = parseUTCDate(p.end)
                        const dateLabel = startDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
                        const timeLabel = `${startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                        return (
                          <div key={i} className="border border-slate-200 dark:border-slate-600 rounded-md p-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">{dateLabel}</div>
                                <div className="text-xs text-slate-500">{timeLabel}</div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <Button
                                  size="sm"
                                  className="h-6 text-xs px-2"
                                  onClick={() => handleApprove(p)}
                                  disabled={scheduling}
                                >
                                  Accept
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 text-xs px-2"
                                  onClick={() => setProposals(prev => prev.filter((_, idx) => idx !== i))}
                                >
                                  ✕
                                </Button>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {/* Manual scheduling fallback */}
                  {proposals.length === 0 && !scheduledAt && task && (
                    <div className="space-y-2 mt-1">
                      <label className="text-xs text-slate-500">Or pick a time manually:</label>
                      <Input
                        type="datetime-local"
                        value={scheduledAt ?? ''}
                        onChange={e => {
                          setScheduledAt(e.target.value ? new Date(e.target.value).toISOString() : undefined)
                          if (e.target.value) setStatus('scheduled')
                        }}
                        className="h-8 text-xs"
                      />
                    </div>
                  )}
                </>
              )}
            </div>

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
  { status: 'in_progress', label: 'In Progress' },
  { status: 'scheduled',   label: 'Scheduled' },
  { status: 'todo',        label: 'To Do' },
  { status: 'done',        label: 'Done' },
  { status: 'cancelled',   label: 'Cancelled' },
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
        {task.project_id && (
          <div className="w-2 h-2 rounded-full shrink-0 mt-1" style={{ backgroundColor: projectColor }} />
        )}
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
// SmartSchedulePanel — collapsible, custom mini week grid, no react-big-calendar
// ---------------------------------------------------------------------------

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const HOUR_LABELS = Array.from({ length: WORK_END_H - WORK_START_H }, (_, i) => {
  const h = WORK_START_H + i
  return h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`
})

// Batch proposal from backend
interface BatchProposal {
  taskId: number
  title: string
  start: Date
  end: Date
}

function SmartSchedulePanel({ allTasks, events }: {
  allTasks: Task[]
  events: CalendarEvent[]
}) {
  const [open, setOpen]           = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [proposed, setProposed]   = useState<BatchProposal[]>([])
  const [rejectedIds, setRejectedIds] = useState<Set<number>>(new Set())
  const [loading, setLoading]     = useState(false)

  const qc = useQueryClient()

  const monday = useMemo(() => getMondayOfWeek(new Date()), [])
  const weekDays = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday)
      d.setDate(d.getDate() + i)
      return d
    }),
    [monday],
  )

  const unscheduledTasks = allTasks.filter(
    t => !t.scheduled_at && t.status !== 'done' && t.status !== 'cancelled' && t.status !== 'scheduled' && !t.deleted_at,
  )

  function toggleId(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleSchedule() {
    const toSchedule = unscheduledTasks.filter(t => selectedIds.has(t.id))
    if (!toSchedule.length) { toast.error('Select at least one task'); return }
    setLoading(true)
    try {
      // Use backend auto-assign to get proposals
      const result = await tasks.scheduleBatch({
        task_ids: toSchedule.map(t => t.id),
      })
      // Convert to local BatchProposal format for display
      const proposals: BatchProposal[] = result.scheduled.map(s => ({
        taskId: s.task.id,
        title: s.task.title,
        start: parseUTCDate(String(s.event.start_datetime)),
        end: parseUTCDate(String(s.event.end_datetime)),
      }))
      setProposed(proposals)
      setRejectedIds(new Set())
      // Refresh queries since batch already scheduled
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['events'] })
      if (result.failed.length > 0) {
        toast.warning(`Could not schedule ${result.failed.length} task(s)`)
      }
      if (result.scheduled.length > 0) {
        toast.success(`Scheduled ${result.scheduled.length} task(s)`)
      }
    } catch {
      toast.error('Failed to schedule tasks')
    } finally {
      setLoading(false)
    }
  }

  async function handleUnscheduleRejected() {
    // Unschedule any that user rejected after the batch was applied
    const toUnschedule = proposed.filter(s => rejectedIds.has(s.taskId))
    for (const slot of toUnschedule) {
      try {
        await tasks.unschedule(slot.taskId)
      } catch { /* ignore individual failures */ }
    }
    qc.invalidateQueries({ queryKey: ['tasks'] })
    qc.invalidateQueries({ queryKey: ['events'] })
    toast.success('Rejected tasks unscheduled')
    setProposed([])
    setRejectedIds(new Set())
    setSelectedIds(new Set())
  }

  function getEventsOnDay(day: Date): CalendarEvent[] {
    const dateStr = day.toISOString().slice(0, 10)
    return events.filter(e => toUTCSafe(e.start_datetime).toISOString().slice(0, 10) === dateStr)
  }

  function getProposedOnDay(day: Date): BatchProposal[] {
    const dateStr = day.toISOString().slice(0, 10)
    return proposed.filter(s => s.start.toISOString().slice(0, 10) === dateStr)
  }

  const todayStr = new Date().toISOString().slice(0, 10)

  return (
    <div className="mt-6 card">
      <button
        className="flex items-center gap-2 px-4 py-3 w-full text-left text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-t transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <Calendar size={15} className="text-primary" />
        Smart Schedule
        {open
          ? <ChevronDown size={14} className="ml-auto" />
          : <ChevronRight size={14} className="ml-auto" />}
      </button>

      {open && (
        <div className="flex gap-6 p-4 border-t border-slate-100 dark:border-slate-700 overflow-x-auto">
          {/* Left: task checklist */}
          <div className="w-64 shrink-0">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
              Select tasks to schedule
            </p>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {unscheduledTasks.length === 0 && (
                <p className="text-sm text-slate-400">No unscheduled tasks</p>
              )}
              {unscheduledTasks.map(t => {
                const proposedSlot = proposed.find(s => s.taskId === t.id)
                const isRejected   = rejectedIds.has(t.id)
                return (
                  <label
                    key={t.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(t.id)}
                      onChange={() => toggleId(t.id)}
                      className="rounded border-slate-300"
                    />
                    <span className={`text-sm truncate flex-1 ${isRejected ? 'line-through text-slate-400' : 'text-slate-700 dark:text-slate-300'}`}>
                      {t.title}
                    </span>
                    {t.estimated_minutes && !proposedSlot && (
                      <span className="text-xs text-slate-400 shrink-0">{t.estimated_minutes}m</span>
                    )}
                    {proposedSlot && !isRejected && (
                      <div className="flex items-center gap-1 shrink-0 ml-auto">
                        <span className="text-[10px] text-primary-600 dark:text-primary-400">
                          {proposedSlot.start.toLocaleDateString([], { weekday: 'short' })}{' '}
                          {proposedSlot.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <button
                          type="button"
                          title="Reject this slot"
                          onClick={e => {
                            e.preventDefault()
                            setRejectedIds(prev => { const n = new Set(prev); n.add(t.id); return n })
                          }}
                          className="text-[10px] text-slate-400 hover:text-danger leading-none"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                    {isRejected && (
                      <span className="text-[10px] text-slate-300 shrink-0">skipped</span>
                    )}
                  </label>
                )
              })}
            </div>
            <div className="flex flex-col gap-2 mt-4">
              <Button size="sm" onClick={handleSchedule} disabled={selectedIds.size === 0 || loading}>
                {loading ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
                Schedule Selected
              </Button>
              {proposed.length > 0 && rejectedIds.size > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleUnscheduleRejected}
                >
                  Undo Rejected ({rejectedIds.size})
                </Button>
              )}
            </div>
          </div>

          {/* Right: mini week grid */}
          <div className="flex-1 min-w-[560px]">
            <div className="flex">
              {/* Hour labels column */}
              <div className="w-10 shrink-0">
                <div className="h-7" /> {/* day header spacer */}
                {HOUR_LABELS.map((label, i) => (
                  <div
                    key={i}
                    className="flex items-start justify-end pr-1.5 text-[10px] text-slate-400 leading-none"
                    style={{ height: `${HOUR_HEIGHT}px` }}
                  >
                    {label}
                  </div>
                ))}
              </div>

              {/* Day columns */}
              {weekDays.map((day, di) => {
                const dayEvents   = getEventsOnDay(day)
                const dayProposed = getProposedOnDay(day)
                const dayStr      = day.toISOString().slice(0, 10)
                return (
                  <div key={di} className="flex-1 min-w-0">
                    {/* Day header */}
                    <div
                      className={`h-7 text-center text-[11px] font-medium leading-7 ${
                        dayStr === todayStr
                          ? 'text-primary-600 font-bold'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {DAY_NAMES[di]} {day.getDate()}
                    </div>

                    {/* Grid body */}
                    <div
                      className="relative border-l border-slate-100 dark:border-slate-700"
                      style={{ height: `${(WORK_END_H - WORK_START_H) * HOUR_HEIGHT}px` }}
                    >
                      {/* Hour grid lines */}
                      {HOUR_LABELS.map((_, i) => (
                        <div
                          key={i}
                          className="absolute left-0 right-0 border-t border-slate-100 dark:border-slate-800"
                          style={{ top: `${i * HOUR_HEIGHT}px` }}
                        />
                      ))}

                      {/* Existing calendar events */}
                      {dayEvents.map(ev => {
                        const s   = toUTCSafe(ev.start_datetime)
                        const e   = toUTCSafe(ev.end_datetime)
                        const sty = getSlotStyle(s, e)
                        return (
                          <div
                            key={ev.id}
                            className="rounded text-[9px] text-white px-1 overflow-hidden leading-tight"
                            style={{
                              ...sty,
                              backgroundColor: EVENT_COLOURS[ev.event_type] ?? '#94A3B8',
                            }}
                          >
                            {ev.title}
                          </div>
                        )
                      })}

                      {/* Proposed slots */}
                      {dayProposed.map(slot => {
                        const sty = getSlotStyle(slot.start, slot.end)
                        return (
                          <div
                            key={slot.taskId}
                            className="rounded text-[9px] text-primary-700 px-1 overflow-hidden leading-tight border border-primary-300"
                            style={{ ...sty, backgroundColor: 'rgba(79,70,229,0.15)' }}
                          >
                            {slot.title}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
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

  const { data: events = [] } = useQuery({
    queryKey: ['events-scheduling'],
    queryFn: () => calendarApi.events({ include_stale: true }),
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

  const activeTasks    = filtered.filter(t => t.status !== 'done' && t.status !== 'cancelled')
  const completedTasks = filtered.filter(t => t.status === 'done' || t.status === 'cancelled')
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
        <div className="flex gap-1 ml-auto">
          <button
            onClick={() => setView('list')}
            title="List view"
            className={`p-1.5 rounded transition-colors ${view === 'list' ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
          >
            <List size={16} />
          </button>
          <button
            onClick={() => setView('kanban')}
            title="Kanban view"
            className={`p-1.5 rounded transition-colors ${view === 'kanban' ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
          >
            <LayoutGrid size={16} />
          </button>
        </div>
      </div>

      {/* Quick-add */}
      <div className="mb-6 flex gap-2 items-start">
        <div className="flex-1">
          <QuickAdd
            onCreate={(title, extra) => createTask.mutate({ title, ...extra })}
            isCreating={createTask.isPending}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 shrink-0"
          onClick={() => { setSelected(null); setModalOpen(true) }}
        >
          <Plus size={14} className="mr-1" /> Details
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
            <div className="py-2">
              {groups.map(([group, groupTasks]) => (
                <div key={group}>
                  <div className="section-header px-4">{group}</div>
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
      <SmartSchedulePanel allTasks={filtered} events={events} />

      {/* Task detail modal */}
      <TaskDetailModal
        task={selected}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        onCreate={data => { createTask.mutate(data); toast.success('Task created') }}
      />
    </AppShell>
  )
}
