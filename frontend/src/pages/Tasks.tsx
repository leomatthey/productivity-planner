import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Plus, Search, X, ChevronDown, Circle, CheckCircle2,
  Loader2, Trash2, Tag, Calendar, Flag,
} from 'lucide-react'
import { AppShell } from '../components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { tasks } from '../lib/api'
import type { Task, TaskStatus, Priority } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do', in_progress: 'In Progress', done: 'Done', cancelled: 'Cancelled',
}
const PRIORITY_ORDER: Priority[] = ['urgent', 'high', 'medium', 'low']

function priorityClass(p: Priority): string {
  return p === 'urgent' ? 'badge-urgent'
       : p === 'high'   ? 'badge-high'
       : p === 'medium' ? 'badge-medium'
       : 'badge-low'
}

function statusClass(s: TaskStatus): string {
  return s === 'done'        ? 'badge-done'
       : s === 'in_progress' ? 'badge-in_progress'
       : s === 'cancelled'   ? 'badge-cancelled'
       : 'badge-todo'
}

function groupByFn(
  list: Task[],
  by: 'status' | 'priority' | 'due_date',
): [string, Task[]][] {
  const map = new Map<string, Task[]>()
  for (const t of list) {
    const key =
      by === 'status'   ? t.status :
      by === 'priority' ? t.priority :
      t.due_date ?? 'No date'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(t)
  }
  return Array.from(map.entries())
}

const SKELETON_ROWS = Array.from({ length: 5 })

// ---------------------------------------------------------------------------
// Quick-add bar
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
// Task row
// ---------------------------------------------------------------------------
interface TaskRowProps {
  task: Task
  onToggle: (t: Task) => void
  onSelect: (t: Task) => void
  onDelete: (t: Task) => void
}

function TaskRow({ task, onToggle, onSelect, onDelete }: TaskRowProps) {
  const done = task.status === 'done'
  return (
    <div className={`flex items-center gap-3 px-3 py-2 rounded group hover:bg-slate-50 dark:hover:bg-slate-700/50 ${done ? 'opacity-60' : ''}`}>
      <button
        className="shrink-0 text-slate-300 hover:text-primary focus:outline-none"
        onClick={() => onToggle(task)}
        aria-label={done ? 'Mark incomplete' : 'Mark complete'}
      >
        {done
          ? <CheckCircle2 size={16} className="text-success" />
          : <Circle size={16} />}
      </button>

      <button
        className={`flex-1 text-left text-sm ${done ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-200'}`}
        onClick={() => onSelect(task)}
      >
        {task.title}
      </button>

      <span className={`${statusClass(task.status as TaskStatus)} hidden sm:inline-flex`}>
        {STATUS_LABELS[task.status as TaskStatus]}
      </span>
      <span className={priorityClass(task.priority as Priority)}>
        {task.priority}
      </span>
      {task.due_date && (
        <span className="text-xs text-slate-400 hidden md:inline">{task.due_date}</span>
      )}
      {task.tags && (
        <span className="tag hidden lg:inline-flex">{task.tags.split(',')[0].trim()}</span>
      )}

      <button
        className="shrink-0 text-slate-300 hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={() => onDelete(task)}
        aria-label="Delete"
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Task detail slide-over
// ---------------------------------------------------------------------------
interface SlideOverProps {
  task: Task | null
  open: boolean
  onClose: () => void
  onSave: (id: number, data: Partial<Task>) => void
}

function TaskSlideOver({ task, open, onClose, onSave }: SlideOverProps) {
  const [title, setTitle]       = useState('')
  const [dueDate, setDueDate]   = useState('')
  const [priority, setPriority] = useState<Priority>('medium')
  const [status, setStatus]     = useState<TaskStatus>('todo')
  const [tags, setTags]         = useState('')
  const [notes, setNotes]       = useState('')

  useEffect(() => {
    if (task) {
      setTitle(task.title)
      setDueDate(task.due_date ?? '')
      setPriority(task.priority as Priority)
      setStatus(task.status as TaskStatus)
      setTags(task.tags ?? '')
      setNotes(task.description ?? '')
    }
  }, [task])

  function handleSave() {
    if (!task) return
    onSave(task.id, {
      title,
      due_date: dueDate || undefined,
      priority,
      status,
      tags: tags || undefined,
      description: notes || undefined,
    })
    onClose()
  }

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent className="w-[420px] sm:w-[480px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit Task</SheetTitle>
        </SheetHeader>
        {task && (
          <div className="mt-6 space-y-4">
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Title</label>
              <Input value={title} onChange={e => setTitle(e.target.value)} className="mt-1" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide flex items-center gap-1">
                  <Flag size={11} /> Priority
                </label>
                <Select value={priority} onValueChange={v => setPriority(v as Priority)}>
                  <SelectTrigger className="mt-1 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITY_ORDER.map(p => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Status</label>
                <Select value={status} onValueChange={v => setStatus(v as TaskStatus)}>
                  <SelectTrigger className="mt-1 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(STATUS_LABELS) as TaskStatus[]).map(s => (
                      <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide flex items-center gap-1">
                <Calendar size={11} /> Due Date
              </label>
              <Input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="mt-1 h-8"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide flex items-center gap-1">
                <Tag size={11} /> Tags <span className="text-slate-300 font-normal normal-case">(comma-separated)</span>
              </label>
              <Input
                value={tags}
                onChange={e => setTags(e.target.value)}
                placeholder="work, urgent, follow-up"
                className="mt-1"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Notes</label>
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={4}
                className="mt-1"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} className="flex-1">Save</Button>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
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
  const [groupBy, setGroupBy]      = useState<'status' | 'priority' | 'due_date'>('status')
  const [selected, setSelected]    = useState<Task | null>(null)
  const [slideOpen, setSlideOpen]  = useState(false)

  // Undo-delete state
  const undoRef = useRef<{ task: Task; timer: ReturnType<typeof setTimeout> } | null>(null)

  const { data: allTasks = [], isLoading } = useQuery({
    queryKey: ['tasks', filterStatus, filterPriority],
    queryFn: () => tasks.list({
      status:   filterStatus   !== 'all' ? filterStatus   : undefined,
      priority: filterPriority !== 'all' ? filterPriority : undefined,
    }),
  })

  const createTask = useMutation({
    mutationFn: (body: Parameters<typeof tasks.create>[0]) => tasks.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
    onError: () => toast.error('Failed to create task'),
  })

  const updateTask = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof tasks.update>[1] }) =>
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
    updateTask.mutate({
      id: task.id,
      data: {
        status: task.status === 'done' ? 'todo' : 'done',
        current_updated_at: task.updated_at,
      },
    })
  }

  function handleSave(id: number, data: Partial<Task>) {
    updateTask.mutate({
      id,
      data: {
        ...data,
        current_updated_at: selected?.updated_at,
      },
    })
    toast.success('Task saved')
  }

  function handleDelete(task: Task) {
    if (undoRef.current) {
      clearTimeout(undoRef.current.timer)
      deleteTask.mutate(undoRef.current.task.id)
    }
    // Optimistic remove
    qc.setQueryData<Task[]>(['tasks', filterStatus, filterPriority], old =>
      (old ?? []).filter(t => t.id !== task.id)
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

  const filtered = allTasks.filter(t => {
    if (t.deleted_at) return false
    if (!search) return true
    return t.title.toLowerCase().includes(search.toLowerCase())
  })

  const groups = groupByFn(filtered, groupBy)

  const action = (
    <Select value={groupBy} onValueChange={v => setGroupBy(v as typeof groupBy)}>
      <SelectTrigger className="h-8 w-40 text-xs">
        <ChevronDown size={12} className="mr-1 text-slate-400" />
        <SelectValue placeholder="Group by" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="status">Group: Status</SelectItem>
        <SelectItem value="priority">Group: Priority</SelectItem>
        <SelectItem value="due_date">Group: Due Date</SelectItem>
      </SelectContent>
    </Select>
  )

  return (
    <AppShell title="Tasks" action={action}>
      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search tasks…"
            className="pl-8 h-8 w-48 text-sm"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X size={12} className="text-slate-400" />
            </button>
          )}
        </div>

        <Select value={filterStatus} onValueChange={setFStatus}>
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {(Object.keys(STATUS_LABELS) as TaskStatus[]).map(s => (
              <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterPriority} onValueChange={setFPrio}>
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue placeholder="All priorities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            {PRIORITY_ORDER.map(p => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {(filterStatus !== 'all' || filterPriority !== 'all') && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-slate-500"
            onClick={() => { setFStatus('all'); setFPrio('all') }}
          >
            <X size={12} className="mr-1" />Clear
          </Button>
        )}
      </div>

      {/* Quick-add */}
      <div className="mb-6">
        <QuickAdd
          onCreate={(title, extra) => createTask.mutate({ title, ...extra })}
          isCreating={createTask.isPending}
        />
      </div>

      {/* Task list */}
      <div className="card">
        {isLoading ? (
          <div className="p-4 space-y-1">
            {SKELETON_ROWS.map((_, i) => (
              <div key={i} className="h-9 bg-slate-50 rounded animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-sm text-slate-400 text-center">
            {search || filterStatus !== 'all' || filterPriority !== 'all' ? 'No tasks match your filters.' : 'No tasks yet — add one above!'}
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
                    onToggle={handleToggle}
                    onSelect={t => { setSelected(t); setSlideOpen(true) }}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Slide-over */}
      <TaskSlideOver
        task={selected}
        open={slideOpen}
        onClose={() => setSlideOpen(false)}
        onSave={handleSave}
      />
    </AppShell>
  )
}
