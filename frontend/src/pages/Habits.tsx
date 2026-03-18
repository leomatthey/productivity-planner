import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Flame, CheckCircle2, Circle, Pencil, Archive, Repeat2 } from 'lucide-react'
import { AppShell } from '../components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { habits } from '../lib/api'
import type { HabitOut } from '../lib/api'
import type { HabitFrequency, TimeOfDay } from '../types'

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function todayStr(): string {
  return new Date().toISOString().split('T')[0]
}

/** Returns ISO date strings for the past N days (inclusive of today, descending) */
function pastNDays(n: number): string[] {
  const days: string[] = []
  const base = new Date()
  for (let i = 0; i < n; i++) {
    const d = new Date(base)
    d.setDate(d.getDate() - i)
    days.push(d.toISOString().split('T')[0])
  }
  return days.reverse() // oldest → newest
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  return d.getDate().toString()
}

// ---------------------------------------------------------------------------
// 30-day history grid cell
// ---------------------------------------------------------------------------
interface CellProps {
  date: string
  completed: boolean
  isToday: boolean
  onToggle?: () => void
}

function HistoryCell({ date, completed, isToday, onToggle }: CellProps) {
  let cellClass = ''
  if (isToday) {
    cellClass = completed ? 'habit-cell-today-done' : 'habit-cell-today-pending'
  } else {
    cellClass = completed ? 'habit-cell-done' : 'habit-cell-missed'
  }

  return (
    <button
      title={date}
      onClick={isToday && !completed ? onToggle : undefined}
      className={`w-5 h-5 rounded-sm text-xs flex items-center justify-center transition-all
                  ${cellClass}
                  ${isToday && !completed ? 'cursor-pointer hover:scale-110' : 'cursor-default'}`}
    >
      {dayLabel(date)}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Habit form dialog
// ---------------------------------------------------------------------------
interface HabitFormProps {
  open: boolean
  onClose: () => void
  onSave: (data: Partial<HabitOut>, id?: number) => void
  initial?: HabitOut | null
}

function HabitFormDialog({ open, onClose, onSave, initial }: HabitFormProps) {
  const [title, setTitle]         = useState('')
  const [description, setDesc]    = useState('')
  const [frequency, setFrequency] = useState<HabitFrequency>('daily')
  const [timeOfDay, setTOD]       = useState<TimeOfDay>('anytime')

  useEffect(() => {
    if (initial) {
      setTitle(initial.title)
      setDesc(initial.description ?? '')
      setFrequency(initial.frequency as HabitFrequency)
      setTOD(initial.time_of_day as TimeOfDay)
    } else {
      setTitle(''); setDesc(''); setFrequency('daily'); setTOD('anytime')
    }
  }, [initial, open])

  function handleSave() {
    if (!title.trim()) { toast.error('Title is required'); return }
    onSave({ title, description: description || undefined, frequency, time_of_day: timeOfDay }, initial?.id)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit Habit' : 'New Habit'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Name</label>
            <Input value={title} onChange={e => setTitle(e.target.value)} className="mt-1" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Description</label>
            <Textarea value={description} onChange={e => setDesc(e.target.value)} rows={2} className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Frequency</label>
              <Select value={frequency} onValueChange={v => setFrequency(v as HabitFrequency)}>
                <SelectTrigger className="mt-1 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekdays">Weekdays</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Time of Day</label>
              <Select value={timeOfDay} onValueChange={v => setTOD(v as TimeOfDay)}>
                <SelectTrigger className="mt-1 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="morning">Morning</SelectItem>
                  <SelectItem value="afternoon">Afternoon</SelectItem>
                  <SelectItem value="evening">Evening</SelectItem>
                  <SelectItem value="anytime">Anytime</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button onClick={handleSave} className="flex-1">Save</Button>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Habit card
// ---------------------------------------------------------------------------
interface HabitCardProps {
  habit: HabitOut
  completedDates: Set<string>
  onComplete: () => void
  onEdit: () => void
  onArchive: () => void
}

function HabitCard({ habit, completedDates, onComplete, onEdit, onArchive }: HabitCardProps) {
  const days = pastNDays(30)
  const today = todayStr()

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-start gap-2">
          <button
            onClick={habit.today_done ? undefined : onComplete}
            className="shrink-0 mt-0.5"
            aria-label={habit.today_done ? 'Done today' : 'Mark complete'}
          >
            {habit.today_done
              ? <CheckCircle2 size={18} className="text-success" />
              : <Circle size={18} className="text-slate-300 hover:text-primary transition-colors" />}
          </button>
          <div>
            <h3 className="font-semibold text-slate-900 leading-tight">{habit.title}</h3>
            {habit.description && (
              <p className="text-xs text-slate-500 mt-0.5">{habit.description}</p>
            )}
            <div className="flex items-center gap-3 mt-1">
              <span className="text-xs text-slate-400">{habit.frequency}</span>
              <span className="text-xs text-slate-400">{habit.time_of_day}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Streak badge */}
          {habit.streak_current > 0 && (
            <div className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-warning-light text-warning text-xs font-semibold">
              <Flame size={11} />
              {habit.streak_current}
            </div>
          )}
          <button onClick={onEdit} className="p-1 text-slate-400 hover:text-slate-700">
            <Pencil size={13} />
          </button>
          <button onClick={onArchive} className="p-1 text-slate-400 hover:text-danger">
            <Archive size={13} />
          </button>
        </div>
      </div>

      {/* 30-day grid */}
      <div className="flex flex-wrap gap-0.5">
        {days.map(d => (
          <HistoryCell
            key={d}
            date={d}
            completed={completedDates.has(d)}
            isToday={d === today}
            onToggle={onComplete}
          />
        ))}
      </div>

      {/* Streak info */}
      <div className="flex gap-4 mt-2 text-xs text-slate-400">
        <span>Current: <strong className="text-slate-700">{habit.streak_current}</strong></span>
        <span>Best: <strong className="text-slate-700">{habit.streak_best}</strong></span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export function Habits() {
  const qc = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing]   = useState<HabitOut | null>(null)
  // Map habitId → Set of completed date strings
  const [completionMap, setCompletionMap] = useState<Record<number, Set<string>>>({})

  const { data: allHabits = [], isLoading } = useQuery({
    queryKey: ['habits'],
    queryFn: () => habits.list(),
  })

  // Fetch 30-day completions for each habit
  const thirtyDaysAgo = (() => {
    const d = new Date(); d.setDate(d.getDate() - 29)
    return d.toISOString().split('T')[0]
  })()

  useEffect(() => {
    if (allHabits.length === 0) return
    const today = todayStr()
    Promise.all(
      allHabits.map(h =>
        habits.completions(h.id, thirtyDaysAgo, today)
          .then(cs => ({ id: h.id, dates: new Set(cs.map(c => c.completed_date)) }))
      )
    ).then(results => {
      const map: Record<number, Set<string>> = {}
      for (const r of results) map[r.id] = r.dates
      setCompletionMap(map)
    })
  }, [allHabits, thirtyDaysAgo])

  const createHabit = useMutation({
    mutationFn: (body: Parameters<typeof habits.create>[0]) => habits.create(body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['habits'] }); toast.success('Habit created') },
    onError: () => toast.error('Failed to create habit'),
  })

  const updateHabit = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof habits.update>[1] }) =>
      habits.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['habits'] }); toast.success('Habit updated') },
    onError: () => toast.error('Failed to update habit'),
  })

  const archiveHabit = useMutation({
    mutationFn: (id: number) => habits.archive(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['habits'] }); toast.success('Habit archived') },
    onError: () => toast.error('Failed to archive habit'),
  })

  const completeHabit = useMutation({
    mutationFn: (id: number) => habits.complete(id),
    onSuccess: (data, id) => {
      qc.invalidateQueries({ queryKey: ['habits'] })
      setCompletionMap(prev => ({
        ...prev,
        [id]: new Set([...(prev[id] ?? []), data.completed_date]),
      }))
      toast.success('Habit checked!')
    },
    onError: () => toast.error('Failed to complete habit'),
  })

  function handleSave(data: Partial<HabitOut>, id?: number) {
    if (id) {
      updateHabit.mutate({ id, data })
    } else {
      createHabit.mutate({
        title: data.title!,
        description: data.description,
        frequency: data.frequency,
        time_of_day: data.time_of_day,
      })
    }
  }

  const action = (
    <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true) }}>
      <Plus size={14} className="mr-1" /> New Habit
    </Button>
  )

  return (
    <AppShell title="Habits" action={action}>
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="card animate-pulse h-40" />
          ))}
        </div>
      ) : allHabits.length === 0 ? (
        <div className="card p-12 text-center">
          <Repeat2 size={32} className="text-slate-200 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">No habits yet — start building yours!</p>
          <Button size="sm" className="mt-4" onClick={() => setFormOpen(true)}>
            <Plus size={14} className="mr-1" /> New Habit
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {allHabits.map(h => (
            <HabitCard
              key={h.id}
              habit={h}
              completedDates={completionMap[h.id] ?? new Set()}
              onComplete={() => completeHabit.mutate(h.id)}
              onEdit={() => { setEditing(h); setFormOpen(true) }}
              onArchive={() => archiveHabit.mutate(h.id)}
            />
          ))}
        </div>
      )}

      <HabitFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null) }}
        onSave={handleSave}
        initial={editing}
      />
    </AppShell>
  )
}
