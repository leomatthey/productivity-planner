// Mirrors the Python SQLAlchemy schema exactly

export type TaskStatus = 'todo' | 'in_progress' | 'scheduled' | 'done'
export type Priority = 'low' | 'medium' | 'high' | 'urgent'
export type EnergyLevel = 'low' | 'medium' | 'high'
export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived'
/** @deprecated Use ProjectStatus */
export type GoalStatus = ProjectStatus
export type ProgressMode = 'manual' | 'auto'
export type HabitFrequency = 'daily' | 'weekdays' | 'weekly' | 'custom'
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'anytime'
export type EventType = 'task_block' | 'meeting' | 'personal' | 'reminder' | 'google_import'
export type EventSource = 'local' | 'google'
export type MessageRole = 'user' | 'assistant' | 'tool'

export interface Task {
  id: number
  title: string
  description?: string
  status: TaskStatus
  priority: Priority
  due_date?: string          // ISO date: YYYY-MM-DD
  project_id?: number
  scheduled_at?: string      // ISO datetime
  estimated_minutes?: number
  energy_level?: EnergyLevel
  tags?: string              // comma-separated
  created_at: string
  updated_at: string
  deleted_at?: string
}

export interface Project {
  id: number
  title: string
  description?: string
  status: ProjectStatus
  target_date?: string
  progress_pct: number
  progress_mode: ProgressMode
  parent_id?: number
  color?: string
  created_at: string
  updated_at: string
  deleted_at?: string
  tasks?: Task[]
  subgoals?: Project[]
}

/** @deprecated Use Project */
export type Goal = Project

export interface CalendarEvent {
  id: number
  title: string
  description?: string
  event_type: EventType
  start_datetime: string
  end_datetime: string
  location?: string
  task_id?: number
  is_recurring: boolean
  recurrence_rule?: string
  source: EventSource
  google_event_id?: string
  google_calendar_id?: string
  is_read_only: boolean
  sync_stale: boolean
  created_at: string
  deleted_at?: string
}

export interface Habit {
  id: number
  title: string
  description?: string
  frequency: HabitFrequency
  target_days?: string       // JSON array of day indices 0=Mon
  time_of_day: TimeOfDay
  streak_current: number
  streak_best: number
  is_active: boolean
  created_at: string
}

export interface HabitCompletion {
  id: number
  habit_id: number
  completed_date: string     // ISO date
  completed_at: string
  note?: string
}

export interface UserPreference {
  key: string
  value: string
  updated_at: string
}

export interface AIMessage {
  role: MessageRole
  content: string
}

// API request/response shapes
export interface CreateTaskRequest {
  title: string
  description?: string
  status?: TaskStatus
  priority?: Priority
  due_date?: string
  project_id?: number
  estimated_minutes?: number
  energy_level?: EnergyLevel
  tags?: string
}

export interface UpdateTaskRequest extends Partial<CreateTaskRequest> {
  scheduled_at?: string
  current_updated_at?: string
}

export interface CreateProjectRequest {
  title: string
  description?: string
  status?: ProjectStatus
  target_date?: string
  progress_pct?: number
  progress_mode?: ProgressMode
  parent_id?: number
  color?: string
}

/** @deprecated Use CreateProjectRequest */
export type CreateGoalRequest = CreateProjectRequest

export interface CreateEventRequest {
  title: string
  start_datetime: string
  end_datetime: string
  description?: string
  event_type?: EventType
  location?: string
  task_id?: number
}

export interface CreateHabitRequest {
  title: string
  description?: string
  frequency?: HabitFrequency
  target_days?: string
  time_of_day?: TimeOfDay
}

export interface ChatRequest {
  messages: AIMessage[]
  session_id: string
}
