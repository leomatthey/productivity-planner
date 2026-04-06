import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, CheckCircle2, Circle, Pencil, Trash2, Target } from 'lucide-react'
import { AppShell } from '../components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { goals, tasks } from '../lib/api'
import type { Goal, GoalStatus, Task } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<GoalStatus, string> = {
  active: 'Active', paused: 'Paused', completed: 'Completed', archived: 'Archived',
}

function statusClass(s: GoalStatus): string {
  return s === 'active'    ? 'badge-active'
       : s === 'paused'    ? 'badge-paused'
       : s === 'completed' ? 'badge-completed'
       : 'badge-archived'
}

const COLOUR_OPTIONS = [
  '#4F46E5', '#059669', '#3B82F6', '#D97706', '#8B5CF6', '#DC2626',
]

// ---------------------------------------------------------------------------
// Goal form dialog
// ---------------------------------------------------------------------------
interface GoalFormProps {
  open: boolean
  onClose: () => void
  onSave: (data: Partial<Goal>, goalId?: number) => void
  initial?: Goal | null
}

function GoalFormDialog({ open, onClose, onSave, initial }: GoalFormProps) {
  const [title, setTitle]         = useState('')
  const [description, setDesc]    = useState('')
  const [targetDate, setTgtDate]  = useState('')
  const [status, setStatus]       = useState<GoalStatus>('active')
  const [progressMode, setMode]   = useState<'manual' | 'auto'>('manual')
  const [progressPct, setPct]     = useState(0)
  const [colour, setColour]       = useState(COLOUR_OPTIONS[0])

  useEffect(() => {
    if (initial) {
      setTitle(initial.title)
      setDesc(initial.description ?? '')
      setTgtDate(initial.target_date ?? '')
      setStatus(initial.status as GoalStatus)
      setMode(initial.progress_mode as 'manual' | 'auto')
      setPct(initial.progress_pct)
    } else {
      setTitle(''); setDesc(''); setTgtDate('')
      setStatus('active'); setMode('manual'); setPct(0)
      setColour(COLOUR_OPTIONS[0])
    }
  }, [initial, open])

  function handleSave() {
    if (!title.trim()) { toast.error('Title is required'); return }
    onSave({
      title,
      description: description || undefined,
      target_date: targetDate || undefined,
      status,
      progress_mode: progressMode,
      progress_pct: progressPct,
    }, initial?.id)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit Goal' : 'New Goal'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Title</label>
            <Input value={title} onChange={e => setTitle(e.target.value)} className="mt-1" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Description</label>
            <Textarea value={description} onChange={e => setDesc(e.target.value)} rows={3} className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Status</label>
              <Select value={status} onValueChange={v => setStatus(v as GoalStatus)}>
                <SelectTrigger className="mt-1 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(STATUS_LABELS) as GoalStatus[]).map(s => (
                    <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Target Date</label>
              <Input type="date" value={targetDate} onChange={e => setTgtDate(e.target.value)} className="mt-1 h-8" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Progress Mode</label>
            <Select value={progressMode} onValueChange={v => setMode(v as 'manual' | 'auto')}>
              <SelectTrigger className="mt-1 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="auto">Auto (from tasks)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {progressMode === 'manual' && (
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                Progress ({progressPct}%)
              </label>
              <input
                type="range" min={0} max={100} step={5}
                value={progressPct}
                onChange={e => setPct(Number(e.target.value))}
                className="w-full mt-1"
              />
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Colour</label>
            <div className="flex gap-2 mt-1">
              {COLOUR_OPTIONS.map(c => (
                <button
                  key={c}
                  onClick={() => setColour(c)}
                  className="w-6 h-6 rounded-full border-2 transition-all"
                  style={{
                    backgroundColor: c,
                    borderColor: colour === c ? '#0F172A' : 'transparent',
                  }}
                />
              ))}
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
// Sub-goal row
// ---------------------------------------------------------------------------
function SubGoalRow({ goal, onToggle, onDelete }: {
  goal: Goal
  onToggle: (g: Goal) => void
  onDelete: (g: Goal) => void
}) {
  const done = goal.status === 'completed'
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded hover:bg-slate-50 group">
      <button onClick={() => onToggle(goal)} className="shrink-0 text-slate-300 hover:text-primary">
        {done ? <CheckCircle2 size={14} className="text-success" /> : <Circle size={14} />}
      </button>
      <span className={`flex-1 text-sm ${done ? 'line-through text-slate-400' : 'text-slate-700'}`}>
        {goal.title}
      </span>
      <span className={statusClass(goal.status as GoalStatus)}>{STATUS_LABELS[goal.status as GoalStatus]}</span>
      <button
        onClick={() => onDelete(goal)}
        className="text-slate-300 hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Goal card
// ---------------------------------------------------------------------------
interface GoalCardProps {
  goal: Goal
  subgoals: Goal[]
  linkedTasks: Task[]
  onEdit: (g: Goal) => void
  onDelete: (g: Goal) => void
  onAddSubgoal: (parentId: number) => void
  onToggleSubgoal: (g: Goal) => void
  onDeleteSubgoal: (g: Goal) => void
}

function GoalCard({
  goal, subgoals, linkedTasks,
  onEdit, onDelete, onAddSubgoal, onToggleSubgoal, onDeleteSubgoal,
}: GoalCardProps) {
  const [activeTab, setActiveTab] = useState('overview')

  return (
    <div className="card overflow-hidden">
      {/* Header bar */}
      <div className="h-1 w-full bg-primary" style={{ backgroundColor: '#4F46E5' }} />

      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <Target size={16} className="text-primary mt-0.5 shrink-0" />
            <div>
              <h3 className="font-semibold text-slate-900">{goal.title}</h3>
              {goal.description && (
                <p className="text-sm text-slate-500 mt-0.5 line-clamp-2">{goal.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <span className={statusClass(goal.status as GoalStatus)}>
              {STATUS_LABELS[goal.status as GoalStatus]}
            </span>
            <button onClick={() => onEdit(goal)} className="p-1 text-slate-400 hover:text-slate-700">
              <Pencil size={13} />
            </button>
            <button onClick={() => onDelete(goal)} className="p-1 text-slate-400 hover:text-danger">
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* Progress */}
        <div className="mt-3">
          <div className="flex justify-between text-xs text-slate-500 mb-1">
            <span>Progress</span>
            <span>{goal.progress_pct}%</span>
          </div>
          <Progress value={goal.progress_pct} className="h-1.5" />
        </div>

        {goal.target_date && (
          <p className="text-xs text-slate-400 mt-2">Target: {goal.target_date}</p>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full rounded-none border-t border-slate-100 bg-transparent h-8 px-4 justify-start gap-4">
          <TabsTrigger value="overview" className="text-xs h-full px-0 data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none">
            Sub-goals ({subgoals.length})
          </TabsTrigger>
          <TabsTrigger value="tasks" className="text-xs h-full px-0 data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none">
            Tasks ({linkedTasks.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="m-0">
          <div className="px-2 pb-2">
            {subgoals.length === 0 ? (
              <p className="px-3 py-2 text-xs text-slate-400">No sub-goals yet</p>
            ) : (
              subgoals.map(sg => (
                <SubGoalRow
                  key={sg.id}
                  goal={sg}
                  onToggle={onToggleSubgoal}
                  onDelete={onDeleteSubgoal}
                />
              ))
            )}
            <button
              onClick={() => onAddSubgoal(goal.id)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs text-slate-400 hover:text-primary"
            >
              <Plus size={12} /> Add sub-goal
            </button>
          </div>
        </TabsContent>

        <TabsContent value="tasks" className="m-0">
          <div className="px-2 pb-2">
            {linkedTasks.length === 0 ? (
              <p className="px-3 py-2 text-xs text-slate-400">No linked tasks</p>
            ) : (
              linkedTasks.map(t => (
                <div key={t.id} className="flex items-center gap-2 px-3 py-1.5">
                  {t.status === 'done'
                    ? <CheckCircle2 size={13} className="text-success shrink-0" />
                    : <Circle size={13} className="text-slate-300 shrink-0" />}
                  <span className={`text-sm ${t.status === 'done' ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                    {t.title}
                  </span>
                </div>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export function Goals() {
  const qc = useQueryClient()
  const [formOpen, setFormOpen]     = useState(false)
  const [editing, setEditing]       = useState<Goal | null>(null)
  const [parentForNew, setParentForNew] = useState<number | null>(null)

  const { data: allGoals = [], isLoading } = useQuery({
    queryKey: ['goals'],
    queryFn: () => goals.list(),
  })

  const { data: allTasks = [] } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => tasks.list(),
  })

  const createGoal = useMutation({
    mutationFn: (body: Parameters<typeof goals.create>[0]) => goals.create(body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['goals'] }); toast.success('Goal created') },
    onError: () => toast.error('Failed to create goal'),
  })

  const updateGoal = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof goals.update>[1] }) =>
      goals.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
    onError: (err) => {
      const e = err as Error & { status?: number }
      if (e.status === 409) {
        toast.error('Someone else edited this goal. Please refresh.')
      } else {
        toast.error('Failed to update goal')
      }
    },
  })

  const deleteGoal = useMutation({
    mutationFn: (id: number) => goals.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['goals'] }); toast.success('Goal deleted') },
    onError: () => toast.error('Failed to delete goal'),
  })

  function handleSave(data: Partial<Goal>, id?: number) {
    if (id) {
      const existing = allGoals.find(g => g.id === id)
      updateGoal.mutate({ id, data: { ...data, current_updated_at: existing?.updated_at } })
      toast.success('Goal updated')
    } else {
      createGoal.mutate({
        title: data.title!,
        description: data.description,
        status: data.status,
        target_date: data.target_date,
        progress_pct: data.progress_pct,
        progress_mode: data.progress_mode as 'manual' | 'auto',
        parent_id: parentForNew ?? undefined,
      })
    }
    setParentForNew(null)
  }

  function handleToggleSubgoal(g: Goal) {
    updateGoal.mutate({
      id: g.id,
      data: {
        status: g.status === 'completed' ? 'active' : 'completed',
        current_updated_at: g.updated_at,
      },
    })
  }

  const topLevel = allGoals.filter(g => !g.parent_id && !g.deleted_at)
  const subgoals  = (parentId: number) => allGoals.filter(g => g.parent_id === parentId && !g.deleted_at)

  const action = (
    <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true) }}>
      <Plus size={14} className="mr-1" /> New Goal
    </Button>
  )

  return (
    <AppShell title="Goals" action={action}>
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="card animate-pulse h-48" />
          ))}
        </div>
      ) : topLevel.length === 0 ? (
        <div className="card p-12 text-center">
          <Target size={32} className="text-slate-200 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">No goals yet — create your first one!</p>
          <Button size="sm" className="mt-4" onClick={() => setFormOpen(true)}>
            <Plus size={14} className="mr-1" /> New Goal
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {topLevel.map(g => (
            <GoalCard
              key={g.id}
              goal={g}
              subgoals={subgoals(g.id)}
              linkedTasks={allTasks.filter(t => t.project_id === g.id)}
              onEdit={g => { setEditing(g); setFormOpen(true) }}
              onDelete={g => deleteGoal.mutate(g.id)}
              onAddSubgoal={parentId => { setParentForNew(parentId); setEditing(null); setFormOpen(true) }}
              onToggleSubgoal={handleToggleSubgoal}
              onDeleteSubgoal={g => deleteGoal.mutate(g.id)}
            />
          ))}
        </div>
      )}

      <GoalFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null) }}
        onSave={handleSave}
        initial={editing}
      />
    </AppShell>
  )
}
