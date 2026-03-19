import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Plus, CheckCircle2, Circle, Pencil, Trash2, Target,
  ChevronDown, ChevronRight,
} from 'lucide-react'
import { AppShell } from '../components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { projects, tasks } from '../lib/api'
import { PROJECT_COLORS } from '../lib/colors'
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

function projectColorFor(project: Goal): string {
  if (project.color) return project.color
  return PROJECT_COLORS[project.id % PROJECT_COLORS.length]
}

// ---------------------------------------------------------------------------
// Project form dialog
// ---------------------------------------------------------------------------

interface ProjectFormProps {
  open: boolean
  onClose: () => void
  onSave: (data: Partial<Goal> & { color: string }, projectId?: number) => void
  initial?: Goal | null
}

function ProjectFormDialog({ open, onClose, onSave, initial }: ProjectFormProps) {
  const [title, setTitle]         = useState('')
  const [description, setDesc]    = useState('')
  const [targetDate, setTgtDate]  = useState('')
  const [status, setStatus]       = useState<GoalStatus>('active')
  const [progressMode, setMode]   = useState<'manual' | 'auto'>('manual')
  const [progressPct, setPct]     = useState(0)
  const [colour, setColour]       = useState(PROJECT_COLORS[0])

  useEffect(() => {
    if (initial) {
      setTitle(initial.title)
      setDesc(initial.description ?? '')
      setTgtDate(initial.target_date ?? '')
      setStatus(initial.status as GoalStatus)
      setMode(initial.progress_mode as 'manual' | 'auto')
      setPct(initial.progress_pct)
      setColour(initial.color ?? PROJECT_COLORS[initial.id % PROJECT_COLORS.length])
    } else {
      setTitle(''); setDesc(''); setTgtDate('')
      setStatus('active'); setMode('manual'); setPct(0)
      setColour(PROJECT_COLORS[0])
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
      color: colour,
    }, initial?.id)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md dark:bg-slate-800">
        <DialogHeader>
          <DialogTitle className="dark:text-slate-100">
            {initial ? 'Edit Project' : 'New Project'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Title</label>
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="mt-1 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-100"
              placeholder="Project name"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Description</label>
            <Textarea
              value={description}
              onChange={e => setDesc(e.target.value)}
              rows={3}
              className="mt-1 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-100"
            />
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
              <Input
                type="date"
                value={targetDate}
                onChange={e => setTgtDate(e.target.value)}
                className="mt-1 h-8 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-100"
              />
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
            <div className="flex gap-2 mt-1 flex-wrap">
              {PROJECT_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColour(c)}
                  className="w-6 h-6 rounded-full border-2 transition-all"
                  style={{
                    backgroundColor: c,
                    borderColor: colour === c ? '#0F172A' : 'transparent',
                    outline: colour === c ? '2px solid #E2E8F0' : 'none',
                    outlineOffset: '1px',
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
// Sub-project row (inside expanded parent card)
// ---------------------------------------------------------------------------

interface SubProjectRowProps {
  project: Goal
  linkedTasks: Task[]
  onEdit: (p: Goal) => void
  onToggle: (p: Goal) => void
  onDelete: (p: Goal) => void
}

function SubProjectRow({ project, linkedTasks, onEdit, onToggle, onDelete }: SubProjectRowProps) {
  const [expanded, setExpanded] = useState(false)
  const done = project.status === 'completed'
  const color = projectColorFor(project)

  return (
    <div className="border border-slate-100 dark:border-slate-700 rounded-md mt-2 overflow-hidden">
      {/* Color bar */}
      <div className="h-0.5 w-full" style={{ backgroundColor: color }} />

      <div className="px-3 py-2">
        {/* Header row */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onToggle(project)}
            className="shrink-0 text-slate-300 hover:text-primary"
          >
            {done
              ? <CheckCircle2 size={13} className="text-success" />
              : <Circle size={13} />
            }
          </button>

          {/* Colour chip */}
          <span
            className="shrink-0 w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: color }}
          />

          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="flex-1 flex items-center gap-1 text-left"
          >
            <span className={`text-sm font-medium ${done ? 'line-through text-slate-400' : 'text-slate-700 dark:text-slate-300'}`}>
              {project.title}
            </span>
            {expanded
              ? <ChevronDown size={12} className="text-slate-400 shrink-0" />
              : <ChevronRight size={12} className="text-slate-400 shrink-0" />
            }
          </button>

          <span className={statusClass(project.status as GoalStatus)}>
            {STATUS_LABELS[project.status as GoalStatus]}
          </span>

          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={() => onEdit(project)}
              className="p-1 text-slate-300 hover:text-slate-600"
            >
              <Pencil size={11} />
            </button>
            <button
              type="button"
              onClick={() => onDelete(project)}
              className="p-1 text-slate-300 hover:text-danger"
            >
              <Trash2 size={11} />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-1.5 ml-7">
          <Progress value={project.progress_pct} className="h-1" />
        </div>

        {/* Expanded body */}
        {expanded && (
          <div className="mt-2 ml-7 space-y-1.5">
            {project.description && (
              <p className="text-xs text-slate-500 dark:text-slate-400">{project.description}</p>
            )}
            {linkedTasks.length > 0 && (
              <div className="space-y-0.5">
                {linkedTasks.map(t => (
                  <div key={t.id} className="flex items-center gap-1.5">
                    {t.status === 'done'
                      ? <CheckCircle2 size={11} className="text-success shrink-0" />
                      : <Circle size={11} className="text-slate-300 shrink-0" />
                    }
                    <span className={`text-xs ${t.status === 'done' ? 'line-through text-slate-400' : 'text-slate-600 dark:text-slate-300'}`}>
                      {t.title}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Project card
// ---------------------------------------------------------------------------

interface ProjectCardProps {
  project: Goal
  subProjects: Goal[]
  linkedTasks: Task[]
  allTasks: Task[]
  onEdit: (p: Goal) => void
  onDelete: (p: Goal) => void
  onAddSubProject: (parentId: number) => void
  onToggleSubProject: (p: Goal) => void
  onDeleteSubProject: (p: Goal) => void
  onEditSubProject: (p: Goal) => void
}

function ProjectCard({
  project, subProjects, linkedTasks, allTasks,
  onEdit, onDelete, onAddSubProject,
  onToggleSubProject, onDeleteSubProject, onEditSubProject,
}: ProjectCardProps) {
  const [expanded, setExpanded] = useState(false)
  const color = projectColorFor(project)

  return (
    <div className="card overflow-hidden dark:bg-slate-800 dark:border-slate-700">
      {/* Coloured top bar */}
      <div className="h-1 w-full" style={{ backgroundColor: color }} />

      {/* Card header — click to expand */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full text-left p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0">
            {/* Colour chip */}
            <span
              className="shrink-0 w-3.5 h-3.5 rounded-full mt-0.5"
              style={{ backgroundColor: color }}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <h3 className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {project.title}
                </h3>
                {expanded
                  ? <ChevronDown size={14} className="text-slate-400 shrink-0" />
                  : <ChevronRight size={14} className="text-slate-400 shrink-0" />
                }
              </div>
              {!expanded && project.description && (
                <p className="text-sm text-slate-500 mt-0.5 line-clamp-1">{project.description}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
            <span className={statusClass(project.status as GoalStatus)}>
              {STATUS_LABELS[project.status as GoalStatus]}
            </span>
            <button
              type="button"
              onClick={() => onEdit(project)}
              className="p-1 text-slate-400 hover:text-slate-700"
            >
              <Pencil size={13} />
            </button>
            <button
              type="button"
              onClick={() => onDelete(project)}
              className="p-1 text-slate-400 hover:text-danger"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* Progress */}
        <div className="mt-3 pl-5">
          <div className="flex justify-between text-xs text-slate-500 mb-1">
            <span>Progress</span>
            <span>{project.progress_pct}%</span>
          </div>
          <Progress value={project.progress_pct} className="h-1.5" />
        </div>

        {project.target_date && (
          <p className="text-xs text-slate-400 mt-2 pl-5">
            Target: {project.target_date}
          </p>
        )}
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-slate-100 dark:border-slate-700">
          {project.description && (
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-3 mb-2">
              {project.description}
            </p>
          )}

          {/* Linked tasks */}
          {linkedTasks.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">
                Tasks ({linkedTasks.length})
              </p>
              <div className="space-y-1">
                {linkedTasks.map(t => (
                  <div key={t.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-50 dark:hover:bg-slate-700/50">
                    {t.status === 'done'
                      ? <CheckCircle2 size={13} className="text-success shrink-0" />
                      : <Circle size={13} className="text-slate-300 shrink-0" />
                    }
                    <span className={`text-sm ${t.status === 'done' ? 'line-through text-slate-400' : 'text-slate-700 dark:text-slate-300'}`}>
                      {t.title}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sub-projects */}
          <div>
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
              Sub-projects ({subProjects.length})
            </p>
            {subProjects.length === 0 ? (
              <p className="text-xs text-slate-400 px-2">No sub-projects yet</p>
            ) : (
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
            )}
            <button
              type="button"
              onClick={() => onAddSubProject(project.id)}
              className="flex items-center gap-1 mt-2 px-2 py-1.5 text-xs text-slate-400 hover:text-primary"
            >
              <Plus size={12} /> Add sub-project
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function Projects() {
  const qc = useQueryClient()
  const [formOpen, setFormOpen]           = useState(false)
  const [editing, setEditing]             = useState<Goal | null>(null)
  const [parentForNew, setParentForNew]   = useState<number | null>(null)

  const { data: allProjects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projects.list(),
  })

  const { data: allTasks = [] } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => tasks.list(),
  })

  const createProject = useMutation({
    mutationFn: (body: Parameters<typeof projects.create>[0]) => projects.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      toast.success('Project created')
    },
    onError: () => toast.error('Failed to create project'),
  })

  const updateProject = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof projects.update>[1] }) =>
      projects.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
    onError: (err) => {
      const e = err as Error & { status?: number }
      if (e.status === 409) {
        toast.error('Someone else edited this project. Please refresh.')
      } else {
        toast.error('Failed to update project')
      }
    },
  })

  const deleteProject = useMutation({
    mutationFn: (id: number) => projects.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      toast.success('Project deleted')
    },
    onError: () => toast.error('Failed to delete project'),
  })

  function handleSave(data: Partial<Goal> & { color: string }, id?: number) {
    if (id) {
      const existing = allProjects.find(p => p.id === id)
      updateProject.mutate({
        id,
        data: { ...data, current_updated_at: existing?.updated_at },
      })
      toast.success('Project updated')
    } else {
      createProject.mutate({
        title:        data.title!,
        description:  data.description,
        status:       data.status,
        target_date:  data.target_date,
        progress_pct: data.progress_pct,
        progress_mode: data.progress_mode as 'manual' | 'auto',
        parent_id:    parentForNew ?? undefined,
        color:        data.color,
      })
    }
    setParentForNew(null)
  }

  function handleToggleSubProject(p: Goal) {
    updateProject.mutate({
      id: p.id,
      data: {
        status: p.status === 'completed' ? 'active' : 'completed',
        current_updated_at: p.updated_at,
      },
    })
  }

  const topLevel   = allProjects.filter(p => !p.parent_id && !p.deleted_at)
  const subOf      = (parentId: number) => allProjects.filter(p => p.parent_id === parentId && !p.deleted_at)

  const action = (
    <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true) }}>
      <Plus size={14} className="mr-1" /> New Project
    </Button>
  )

  return (
    <AppShell title="Projects" action={action}>
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="card animate-pulse h-48 dark:bg-slate-800" />
          ))}
        </div>
      ) : topLevel.length === 0 ? (
        <div className="card p-12 text-center dark:bg-slate-800 dark:border-slate-700">
          <Target size={32} className="text-slate-200 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">No projects yet — create your first one!</p>
          <Button size="sm" className="mt-4" onClick={() => setFormOpen(true)}>
            <Plus size={14} className="mr-1" /> New Project
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {topLevel.map(p => (
            <ProjectCard
              key={p.id}
              project={p}
              subProjects={subOf(p.id)}
              linkedTasks={allTasks.filter(t => t.project_id === p.id && !t.deleted_at)}
              allTasks={allTasks.filter(t => !t.deleted_at)}
              onEdit={p => { setEditing(p); setFormOpen(true) }}
              onDelete={p => deleteProject.mutate(p.id)}
              onAddSubProject={parentId => {
                setParentForNew(parentId)
                setEditing(null)
                setFormOpen(true)
              }}
              onToggleSubProject={handleToggleSubProject}
              onDeleteSubProject={p => deleteProject.mutate(p.id)}
              onEditSubProject={p => { setEditing(p); setFormOpen(true) }}
            />
          ))}
        </div>
      )}

      <ProjectFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null) }}
        onSave={handleSave}
        initial={editing}
      />
    </AppShell>
  )
}
