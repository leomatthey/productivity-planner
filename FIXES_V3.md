# Productivity Planner — Targeted Fix Prompt (v3)

Feed this file verbatim to Claude Code. Do NOT paraphrase.

---

## Context

You are fixing a React + TypeScript + FastAPI productivity planner at:
`/sessions/wonderful-ecstatic-pasteur/mnt/A1/productivity-planner/`

Stack: React 18, TypeScript, Vite, Tailwind, shadcn/ui, TanStack Query.
Backend: FastAPI + SQLite.

**DO NOT** change:
- QuickAdd bar (Tasks page) — preserved exactly as-is
- App routing, AppShell, Sidebar layout
- Google Calendar sync logic
- The existing ProjectFormDialog color picker

Work through the files in this exact order. Each section is self-contained.
After all edits, run the build check at the end and fix any TypeScript errors.

---

## PHASE 1 — Backend scheduling engine fix (highest priority — affects chatbot AND UI)

### FILE: `backend/agent/tools.py`

There are three bugs in `_exec_suggest_schedule`:

**Bug A — Stale Google Calendar events excluded from busy calculation:**
The function calls `crud.get_events(start=day_start, end=day_end)`, which uses
`include_stale=False` by default. Google Calendar events that have been synced but
are marked `sync_stale=True` (outdated since last sync) are silently dropped.
These events represent REAL appointments and must still block those time slots.

**Bug B — Already-scheduled tasks not treated as busy:**
Tasks that have `scheduled_at` set on the target day are completely ignored.
The second scheduling run will double-book time already claimed by a previous run.

**Bug C — Tool description doesn't mandate creating calendar events:**
After `suggest_schedule` proposes slots, the AI should ALWAYS call `create_event`
for each slot. The current "and/or" wording lets the AI skip `create_event`, which
means future `suggest_schedule` calls never see those scheduled tasks as busy.

**Fix A+B — Replace the busy-interval building block in `_exec_suggest_schedule`:**

Find the section that builds `raw_busy` from calendar events. It currently is:

```python
    raw_busy = []
    for e in events:
        e_s = e.start_datetime.hour * 60 + e.start_datetime.minute
        e_e = e.end_datetime.hour   * 60 + e.end_datetime.minute
        if e_e > work_start_min and e_s < work_end_min:
            raw_busy.append((max(e_s, work_start_min), min(e_e, work_end_min)))
```

First, change the `events = crud.get_events(...)` call just above that block to
include stale events:
```python
    events = crud.get_events(start=day_start, end=day_end, include_stale=True)
```

Then replace the entire `raw_busy` block (from `raw_busy = []` through `raw_busy.sort()`)
with the following, which also adds already-scheduled tasks as busy intervals:

```python
    raw_busy = []
    # 1. Busy from calendar events — include stale so Google events are never missed
    for e in events:
        e_s = e.start_datetime.hour * 60 + e.start_datetime.minute
        e_e = e.end_datetime.hour   * 60 + e.end_datetime.minute
        if e_e > work_start_min and e_s < work_end_min:
            raw_busy.append((max(e_s, work_start_min), min(e_e, work_end_min)))

    # 2. Busy from tasks already scheduled on this day — prevents double-booking
    all_tasks_for_busy = crud.get_tasks()
    for t in all_tasks_for_busy:
        if not t.scheduled_at:
            continue
        if t.scheduled_at.date() != target_date:
            continue
        if not t.estimated_minutes or t.estimated_minutes <= 0:
            continue
        t_s = t.scheduled_at.hour * 60 + t.scheduled_at.minute
        t_e = t_s + t.estimated_minutes
        if t_e > work_start_min and t_s < work_end_min:
            raw_busy.append((max(t_s, work_start_min), min(t_e, work_end_min)))

    raw_busy.sort()
```

**Fix B — Update `_SUGGEST_SCHEDULE` tool description to mandate `create_event`:**

Find the `_SUGGEST_SCHEDULE` dict definition. Its `"description"` field currently
ends with text about "call update_task (scheduled_at) and/or create_event to actually
apply the schedule."

Replace that description value with:

```python
    "description": (
        "Generate a suggested time-block schedule for a given day using all pending or "
        "in-progress tasks that have an estimated_minutes set. "
        "Respects existing calendar events AND already-scheduled tasks as busy time. "
        "Returns a list of proposed time blocks. "
        "IMPORTANT: after calling this tool, you MUST apply the schedule by calling "
        "BOTH update_task (to set scheduled_at) AND create_event (event_type='task_block', "
        "task_id=<id>) for EVERY slot returned. Never skip create_event — without it the "
        "calendar will not reflect the schedule and future scheduling calls will "
        "double-book the same slot."
    ),
```

**Fix C — Update the agent system prompt to reinforce calendar event creation:**

In `backend/agent/agent.py`, find the `_build_system_prompt` function.
In the static description paragraph that begins with `"You can help the user:\n"`,
find the line `"- Schedule and manage calendar events\n"` and change it to:

```python
        "- Schedule and manage calendar events — ALWAYS create a calendar event "
        "(event_type='task_block') whenever you schedule a task, so it appears on "
        "the calendar and future scheduling calls avoid double-booking\n"
```

---

## PHASE 1b — Frontend event-fetch fix for scheduling (stale Google events)

The frontend's scheduling components fetch calendar events via `calendarApi.events()`,
which sends `GET /calendar/events` with `include_stale=false` (default). This means
stale/outdated Google Calendar events are silently excluded from the busy-time
calculation, allowing tasks to be scheduled into those slots.

The Calendar page display should remain `include_stale=false` (don't show stale events
on the grid). But the SmartSchedulePanel and TaskDetailModal need stale events
included so they block those slots.

### FILE: `frontend/src/lib/api.ts`

Add `include_stale` to the `EventFilters` interface:

Find:
```typescript
export interface EventFilters {
  start?: string
  end?: string
  source?: string
}
```
Replace with:
```typescript
export interface EventFilters {
  start?: string
  end?: string
  source?: string
  include_stale?: boolean
}
```

### FILE: `frontend/src/pages/Tasks.tsx`

There are two places that fetch events for scheduling. Both need `include_stale: true`.

**In `TaskDetailModal`**, change the events query from:
```typescript
  const { data: events = [] } = useQuery({
    queryKey: ['events'],
    queryFn: () => calendarApi.events(),
    enabled: open,
  })
```
to:
```typescript
  const { data: events = [] } = useQuery({
    queryKey: ['events-scheduling'],
    queryFn: () => calendarApi.events({ include_stale: true }),
    enabled: open,
  })
```

**In `SmartSchedulePanel`** (the component receives `events` as a prop — the fetch
is in the parent `Tasks()` function). In `Tasks()`, find the events query:
```typescript
  const { data: events = [] } = useQuery({
    queryKey: ['events'],
    queryFn: () => calendarApi.events(),
  })
```
Change it to:
```typescript
  const { data: events = [] } = useQuery({
    queryKey: ['events-scheduling'],
    queryFn: () => calendarApi.events({ include_stale: true }),
  })
```

---

## PHASE 2 — Shared frontend utilities

### FILE: `frontend/src/lib/colors.ts`

Add this function after `generateShades` (before `getProjectColor`):

```typescript
/**
 * Returns a color for a sub-project derived from its parent's color.
 * Each sibling index gets a progressively lighter shade with a small hue rotation.
 */
export function getSubProjectColor(parentColor: string, siblingIndex: number): string {
  const { h, s, l } = hexToHSL(parentColor)
  const newL = Math.min(l + 14 + siblingIndex * 10, 78)
  const newS = Math.max(s * 0.72, 28)
  const newH = (h + siblingIndex * 9) % 360
  return hslToHex(newH, newS, newL)
}
```

### FILE: `frontend/src/lib/scheduling.ts`

Add this exported function at the very end of the file (after `scheduleBatch`):

```typescript
/**
 * Returns up to `count` (default 3) candidate ScheduledTask slots for a single task,
 * searching across up to maxDaysAhead days from startDate.
 * Takes at most one slot per day so proposals are spread across different days.
 */
export function findTopSlots(
  task: Task,
  events: CalendarEvent[],
  startDate: Date,
  count = 3,
  opts: ScheduleBatchOptions = {},
): ScheduledTask[] {
  const {
    maxDaysAhead   = 14,
    skipWeekends   = false,
    workdayStart   = 9,
    workdayEnd     = 18,
    bufferMinutes  = 15,
    minSlotMinutes = 30,
  } = opts

  const slotOpts: FindFreeSlotsOptions = { workdayStart, workdayEnd, bufferMinutes, minSlotMinutes }
  const needed = task.estimated_minutes ?? 30
  const results: ScheduledTask[] = []

  for (let i = 0; i < maxDaysAhead && results.length < count; i++) {
    const d = new Date(startDate)
    d.setDate(d.getDate() + i)
    d.setHours(0, 0, 0, 0)
    if (skipWeekends) {
      const dow = d.getDay()
      if (dow === 0 || dow === 6) continue
    }
    const slots = findFreeSlots(events, d, slotOpts)
    for (const slot of slots) {
      if (slot.durationMinutes >= needed) {
        results.push({
          taskId: task.id,
          title:  task.title,
          start:  new Date(slot.start),
          end:    new Date(slot.start.getTime() + needed * 60_000),
        })
        break // one slot per day only — for variety
      }
    }
  }

  return results
}
```

---

## PHASE 3 — Calendar page fix

### FILE: `frontend/src/pages/Calendar.tsx`

### Fix 3a — `getEventColor`: correctly color task_block events

Replace the entire `getEventColor` function with:

```typescript
function getEventColor(
  event: CalendarEvent,
  calendarColors: Record<string, string>,
  tasksList: Task[] = [],
  projectsList: Goal[] = [],
): string {
  if (event.source === 'google' && event.google_calendar_id && calendarColors[event.google_calendar_id]) {
    return calendarColors[event.google_calendar_id]
  }
  if (event.event_type === 'task_block') {
    if (event.task_id) {
      const task = tasksList.find(t => t.id === event.task_id)
      if (task) {
        if (task.project_id != null) {
          return getProjectColor(task.project_id, projectsList)
        }
        return '#4F46E5' // task exists but has no project — indigo
      }
    }
    return '#6366F1' // task_block with no task linked — slate-indigo
  }
  return EVENT_COLOURS[event.event_type] ?? '#94A3B8'
}
```

### Fix 3b — Pass `task_id` when saving new events

In the `handleSave` function in `Calendar()`, change the `createEvent.mutate(...)` call to:

```typescript
      createEvent.mutate({
        title:          data.title!,
        start_datetime: data.start_datetime!,
        end_datetime:   data.end_datetime!,
        event_type:     data.event_type,
        location:       data.location,
        description:    data.description,
        task_id:        data.task_id,
      })
```

---

## PHASE 4 — Projects page fixes

### FILE: `frontend/src/pages/Projects.tsx`

### Fix 4a — Import `getSubProjectColor`

Change:
```typescript
import { PROJECT_COLORS } from '../lib/colors'
```
to:
```typescript
import { PROJECT_COLORS, getSubProjectColor } from '../lib/colors'
```

### Fix 4b — Update `SubProjectRowProps` to accept parent color + index

Change the `SubProjectRowProps` interface to:
```typescript
interface SubProjectRowProps {
  project: Goal
  linkedTasks: Task[]
  parentColor: string
  siblingIndex: number
  onEdit: (p: Goal) => void
  onToggle: (p: Goal) => void
  onDelete: (p: Goal) => void
}
```

### Fix 4c — Derive sub-project color from parent in `SubProjectRow`

Change the function signature and first two lines of `SubProjectRow` to:
```typescript
function SubProjectRow({ project, linkedTasks, parentColor, siblingIndex, onEdit, onToggle, onDelete }: SubProjectRowProps) {
  const [expanded, setExpanded] = useState(false)
  const done  = project.status === 'completed'
  const color = getSubProjectColor(parentColor, siblingIndex)
```
(Remove the old `const color = projectColorFor(project)` line.)

### Fix 4d — Pass `parentColor` and `siblingIndex` to each SubProjectRow

In `ProjectCard`, change:
```tsx
              subProjects.map(sp => (
                <SubProjectRow
                  key={sp.id}
                  project={sp}
                  linkedTasks={allTasks.filter(t => t.project_id === sp.id)}
                  onEdit={onEditSubProject}
                  onToggle={onToggleSubProject}
                  onDelete={onDeleteSubProject}
                />
              ))
```
to:
```tsx
              subProjects.map((sp, i) => (
                <SubProjectRow
                  key={sp.id}
                  project={sp}
                  linkedTasks={allTasks.filter(t => t.project_id === sp.id)}
                  parentColor={color}
                  siblingIndex={i}
                  onEdit={onEditSubProject}
                  onToggle={onToggleSubProject}
                  onDelete={onDeleteSubProject}
                />
              ))
```

### Fix 4e — Add `onAddTask` prop to `ProjectCardProps` and function signature

Add to `ProjectCardProps`:
```typescript
  onAddTask: (projectId: number, title: string) => void
```

Add `onAddTask` to `ProjectCard`'s destructured parameters:
```typescript
function ProjectCard({
  project, subProjects, linkedTasks, allTasks,
  onEdit, onDelete, onAddSubProject,
  onToggleSubProject, onDeleteSubProject, onEditSubProject, onAddTask,
}: ProjectCardProps) {
```

### Fix 4f — Add local quick-add state inside `ProjectCard`

At the top of the `ProjectCard` function body, after `const [expanded, setExpanded] = useState(false)`, add:
```typescript
  const [quickTitle, setQuickTitle]     = useState('')
  const [showQuickAdd, setShowQuickAdd] = useState(false)
```

### Fix 4g — Add quick task-add UI in expanded ProjectCard body

In the expanded body section (inside `{expanded && (...) }`), after the linked tasks div
and before the sub-projects div, insert:

```tsx
          {/* Quick add task */}
          <div className="mb-3">
            {showQuickAdd ? (
              <form
                onSubmit={e => {
                  e.preventDefault()
                  if (quickTitle.trim()) {
                    onAddTask(project.id, quickTitle.trim())
                    setQuickTitle('')
                    setShowQuickAdd(false)
                  }
                }}
                className="flex gap-1 items-center"
              >
                <Input
                  autoFocus
                  value={quickTitle}
                  onChange={e => setQuickTitle(e.target.value)}
                  placeholder="Task title…"
                  className="h-7 text-xs flex-1"
                />
                <Button type="submit" size="sm" className="h-7 text-xs px-2">Add</Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2"
                  onClick={() => setShowQuickAdd(false)}
                >
                  ✕
                </Button>
              </form>
            ) : (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); setShowQuickAdd(true) }}
                className="flex items-center gap-1 px-2 py-1 text-xs text-slate-400 hover:text-primary transition-colors"
              >
                <Plus size={11} /> Add task to project
              </button>
            )}
          </div>
```

### Fix 4h — Add `createTask` mutation in `Projects()`

Inside `Projects()`, after the `deleteProject` mutation, add:
```typescript
  const createTask = useMutation({
    mutationFn: (body: Parameters<typeof tasks.create>[0]) => tasks.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      toast.success('Task added')
    },
    onError: () => toast.error('Failed to add task'),
  })
```

### Fix 4i — Pass `onAddTask` to `ProjectCard` in the render loop

In the `topLevel.map(p => (...))` block, add this prop to `<ProjectCard>`:
```tsx
              onAddTask={(projectId, title) =>
                createTask.mutate({ title, project_id: projectId })
              }
```

---

## PHASE 5 — Tasks page (all fixes)

### FILE: `frontend/src/pages/Tasks.tsx`

Work through these changes in order.

### Fix 5a — Update scheduling import

Change:
```typescript
import { scheduleBatch, type ScheduledTask } from '../lib/scheduling'
```
to:
```typescript
import { scheduleBatch, findTopSlots, type ScheduledTask } from '../lib/scheduling'
```

### Fix 5b — Add `DURATION_OPTIONS` constant

After the `ENERGY_LEVELS` constant, add:
```typescript
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
```

### Fix 5c — Add `SlotDayPreview` component

Add this new component right before the `TaskDetailModal` function definition:

```typescript
// Mini day timeline showing where a proposed slot falls — used inside TaskDetailModal
function SlotDayPreview({ slot, events }: { slot: ScheduledTask; events: CalendarEvent[] }) {
  const dateStr = slot.start.toISOString().slice(0, 10)
  const dayEvents = events.filter(e =>
    toUTCSafe(e.start_datetime).toISOString().slice(0, 10) === dateStr,
  )

  return (
    <div
      className="relative mt-1.5 border border-slate-100 dark:border-slate-700 rounded overflow-hidden bg-slate-50 dark:bg-slate-900"
      style={{ height: `${(WORK_END_H - WORK_START_H) * HOUR_HEIGHT}px` }}
    >
      {HOUR_LABELS.map((label, i) => (
        <div
          key={i}
          className="absolute left-0 right-0 border-t border-slate-100 dark:border-slate-800 flex items-start"
          style={{ top: `${i * HOUR_HEIGHT}px` }}
        >
          <span className="text-[8px] text-slate-300 pl-0.5 leading-none">{label}</span>
        </div>
      ))}
      {dayEvents.map(ev => {
        const s   = toUTCSafe(ev.start_datetime)
        const e   = toUTCSafe(ev.end_datetime)
        const sty = getSlotStyle(s, e)
        return (
          <div
            key={ev.id}
            className="absolute rounded text-[8px] text-white px-0.5 overflow-hidden leading-tight"
            style={{ ...sty, left: '22px', right: '2px', backgroundColor: EVENT_COLOURS[ev.event_type] ?? '#94A3B8' }}
          >
            {ev.title}
          </div>
        )
      })}
      <div
        className="absolute rounded text-[8px] text-primary-700 dark:text-primary-300 px-0.5 overflow-hidden leading-tight border border-primary-300"
        style={{ ...getSlotStyle(slot.start, slot.end), left: '22px', right: '2px', backgroundColor: 'rgba(79,70,229,0.18)' }}
      >
        ✓ {slot.title}
      </div>
    </div>
  )
}
```

### Fix 5d — Replace `TaskDetailModal` entirely

Replace the entire `TaskDetailModal` function (from `function TaskDetailModal` through
its closing `}`) with:

```typescript
function TaskDetailModal({ task, open, onClose, onSave }: TaskDetailModalProps) {
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
  const [proposals, setProposals]     = useState<ScheduledTask[]>([])

  const qc = useQueryClient()

  const { data: projectsList = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
    enabled: open,
  })

  const { data: events = [] } = useQuery({
    queryKey: ['events'],
    queryFn: () => calendarApi.events(),
    enabled: open,
  })

  const createCalendarEvent = useMutation({
    mutationFn: (body: Parameters<typeof calendarApi.createEvent>[0]) =>
      calendarApi.createEvent(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }),
  })

  useEffect(() => {
    if (task && open) {
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
    }
  }, [task, open])

  function handleFindSlots() {
    if (!task) return
    const taskForSchedule: Task = { ...task, estimated_minutes: estimatedMins ?? task.estimated_minutes }
    const results = findTopSlots(taskForSchedule, events, new Date())
    if (results.length === 0) {
      toast.error('No free slots found in the next 14 days')
    } else {
      setProposals(results)
    }
  }

  async function handleApprove(proposal: ScheduledTask) {
    setScheduledAt(proposal.start.toISOString())
    setProposals([])
    try {
      await createCalendarEvent.mutateAsync({
        title:          task!.title,
        start_datetime: proposal.start.toISOString(),
        end_datetime:   proposal.end.toISOString(),
        event_type:     'task_block',
        task_id:        task!.id,
      })
      toast.success('Slot accepted — calendar event created')
    } catch {
      toast.error('Slot set but calendar event failed')
    }
  }

  function handleSave() {
    if (!task) return
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
    onClose()
  }

  const scheduledDisplay = scheduledAt
    ? new Date(scheduledAt).toLocaleString([], {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : null

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Task</DialogTitle>
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
                  {projectsList.map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.title}</SelectItem>
                  ))}
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
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleFindSlots}
                disabled={createCalendarEvent.isPending}
              >
                Find 3 Time Slots
              </Button>
              {proposals.length > 0 && (
                <div className="space-y-2 mt-1">
                  {proposals.map((p, i) => {
                    const dateLabel = p.start.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
                    const timeLabel = `${p.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${p.end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    return (
                      <div key={i} className="border border-slate-200 dark:border-slate-600 rounded-md p-2 space-y-1">
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
                              disabled={createCalendarEvent.isPending}
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
                        <SlotDayPreview slot={p} events={events} />
                      </div>
                    )
                  })}
                </div>
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
```

### Fix 5e — Add `filterProject` state in `Tasks()`

After `const [view, setView] = useState<'list' | 'kanban'>('list')`, add:
```typescript
  const [filterProject, setFProject] = useState<string>('all')
```

### Fix 5f — Update tasks query to include project filter

Change:
```typescript
  const { data: allTasks = [], isLoading } = useQuery({
    queryKey: ['tasks', filterStatus, filterPriority],
    queryFn: () => tasks.list({
      status:   filterStatus   !== 'all' ? filterStatus   : undefined,
      priority: filterPriority !== 'all' ? filterPriority : undefined,
    }),
  })
```
to:
```typescript
  const { data: allTasks = [], isLoading } = useQuery({
    queryKey: ['tasks', filterStatus, filterPriority, filterProject],
    queryFn: () => tasks.list({
      status:     filterStatus   !== 'all' ? filterStatus             : undefined,
      priority:   filterPriority !== 'all' ? filterPriority           : undefined,
      project_id: filterProject  !== 'all' ? Number(filterProject)    : undefined,
    }),
  })
```

### Fix 5g — Add project filter to toolbar

After the priority `<Select>` (with `filterPriority`) and before the sort `<Select>`, insert:

```tsx
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
```

### Fix 5h — Add Est. Duration to `TaskRow`

In `TaskRow`, after the due date `<span>` and before the status badge, add:
```tsx
      {task.estimated_minutes && (
        <span className="text-xs text-slate-400 hidden md:inline shrink-0">
          {task.estimated_minutes < 60
            ? `${task.estimated_minutes}m`
            : `${task.estimated_minutes / 60}h`}
        </span>
      )}
```

### Fix 5i — Add Est. Duration to `KanbanCard`

In the bottom flex div of `KanbanCard` (alongside priority badge and due date), add:
```tsx
        {task.estimated_minutes && (
          <span className="text-xs text-slate-400">
            {task.estimated_minutes < 60
              ? `${task.estimated_minutes}m`
              : `${task.estimated_minutes / 60}h`}
          </span>
        )}
```

### Fix 5j — SmartSchedulePanel: fix deselect bug

In `SmartSchedulePanel`, change `toggleId` from:
```typescript
  function toggleId(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    setProposed([])
  }
```
to:
```typescript
  function toggleId(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    // Do NOT clear proposals here — only clear on generate/confirm
  }
```

### Fix 5k — SmartSchedulePanel: add `rejectedIds` state

After `const [proposed, setProposed] = useState<ScheduledTask[]>([])`, add:
```typescript
  const [rejectedIds, setRejectedIds] = useState<Set<number>>(new Set())
```

### Fix 5l — SmartSchedulePanel: reset `rejectedIds` on new generation

In `handleSchedule`, after `setProposed(result)`, add:
```typescript
    setRejectedIds(new Set())
```

### Fix 5m — SmartSchedulePanel: add `createEvent` mutation

After the `updateTask` mutation, add:
```typescript
  const createEvent = useMutation({
    mutationFn: (body: Parameters<typeof calendarApi.createEvent>[0]) =>
      calendarApi.createEvent(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }),
  })
```

### Fix 5n — SmartSchedulePanel: replace `handleConfirm` to create events + respect rejections

Replace the entire `handleConfirm` function with:
```typescript
  async function handleConfirm() {
    const toConfirm = proposed.filter(s => !rejectedIds.has(s.taskId))
    if (toConfirm.length === 0) { toast.error('No accepted slots to confirm'); return }
    for (const slot of toConfirm) {
      const task = allTasks.find(t => t.id === slot.taskId)
      await updateTask.mutateAsync({
        id:   slot.taskId,
        data: { scheduled_at: slot.start.toISOString(), current_updated_at: task?.updated_at },
      })
      await createEvent.mutateAsync({
        title:          slot.title,
        start_datetime: slot.start.toISOString(),
        end_datetime:   slot.end.toISOString(),
        event_type:     'task_block',
      })
    }
    toast.success(`Confirmed ${toConfirm.length} task${toConfirm.length !== 1 ? 's' : ''}`)
    setProposed([])
    setRejectedIds(new Set())
    setSelectedIds(new Set())
  }
```

### Fix 5o — SmartSchedulePanel: per-task accept/reject in task list

In `SmartSchedulePanel`, replace the `unscheduledTasks.map(t => ...)` block entirely with:

```tsx
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
```

---

## PHASE 6 — Build verification

```bash
cd /sessions/wonderful-ecstatic-pasteur/mnt/A1/productivity-planner/frontend
npm run build
```

Fix any TypeScript compilation errors before finishing. Common things to watch:
- `calendarApi` must be imported in Tasks.tsx — check `import { tasks, calendar as calendarApi, projects as projectsApi } from '../lib/api'` is present (it already is).
- `getSubProjectColor` must be exported from colors.ts (it is, as a named export added in Phase 2).
- `findTopSlots` must be exported from scheduling.ts (it is, added in Phase 2).
- `useState` is already imported in Projects.tsx so `quickTitle`/`showQuickAdd` state will work.
- In the backend `tools.py`, `crud.get_tasks()` is already imported at the top of the file — no new imports needed.
