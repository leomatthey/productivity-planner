// Typed API client — all paths are relative (/api/...) — Vite proxies to localhost:8000
// All API calls from components must go through this module only.

import type {
  Task,
  Goal,
  Habit,
  HabitCompletion,
  CalendarEvent,
  UserPreference,
  CreateTaskRequest,
  UpdateTaskRequest,
  CreateGoalRequest,
  CreateEventRequest,
  CreateHabitRequest,
} from '../types'

const BASE = '/api'

// ---------------------------------------------------------------------------
// Core HTTP helpers
// ---------------------------------------------------------------------------

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`)
  return res.json()
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }))
    const err = new Error(`POST ${path} failed: ${res.status}`) as Error & { status: number; detail: string }
    err.status = res.status
    err.detail = detail?.detail ?? res.statusText
    throw err
  }
  return res.json()
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }))
    const err = new Error(`PUT ${path} failed: ${res.status}`) as Error & { status: number; detail: string }
    err.status = res.status
    err.detail = detail?.detail ?? res.statusText
    throw err
  }
  return res.json()
}

async function del(path: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`)
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export interface TaskFilters {
  status?: string
  priority?: string
  tag?: string
  due_date_from?: string
  due_date_to?: string
  project_id?: number
}

function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&')
  return q ? `?${q}` : ''
}

export const tasks = {
  list: (filters: TaskFilters = {}) =>
    get<Task[]>(`/tasks${buildQuery(filters as Record<string, string | number | boolean | undefined>)}`),

  create: (body: CreateTaskRequest) =>
    post<Task>('/tasks', body),

  update: (id: number, body: UpdateTaskRequest) =>
    put<Task>(`/tasks/${id}`, body),

  delete: (id: number) =>
    del(`/tasks/${id}`),

  parseDate: (text: string) =>
    post<{ date: string }>('/tasks/parse-date', { text }),

  // Scheduling — atomic backend operations
  findSlots: (body: { task_id: number; count?: number; start_date?: string }) =>
    post<{ slots: Array<{ start: string; end: string; date: string }> }>('/tasks/find-slots', body),

  findSlotsBatch: (body: { task_ids: number[]; start_date?: string }) =>
    post<{ proposals: Array<{ task_id: number; title: string; start: string; end: string }>; unscheduled: Array<{ task_id: number; error: string }> }>('/tasks/find-slots-batch', body),

  schedule: (taskId: number, body: { start_datetime: string; end_datetime: string }) =>
    post<{ task: Task; event: CalendarEvent }>(`/tasks/${taskId}/schedule`, body),

  scheduleBatch: (body: { items?: Array<{ task_id: number; start_datetime: string; end_datetime: string }>; task_ids?: number[]; start_date?: string }) =>
    post<{ scheduled: Array<{ task: Task; event: CalendarEvent }>; failed: Array<{ task_id: number; error: string }> }>('/tasks/schedule-batch', body),

  unschedule: (taskId: number) =>
    post<{ task: Task; deleted_event_ids: number[] }>(`/tasks/${taskId}/unschedule`, {}),
}

// ---------------------------------------------------------------------------
// Projects (internal DB table stays "goals"; API route is /api/projects)
// ---------------------------------------------------------------------------

export interface GoalFilters {
  status?: string
  parent_id?: number
  top_level_only?: boolean
}

export interface UpdateGoalRequest {
  title?: string
  description?: string
  status?: string
  target_date?: string
  progress_pct?: number
  progress_mode?: string
  parent_id?: number
  color?: string
  current_updated_at?: string
}

export const projects = {
  list: (filters: GoalFilters = {}) =>
    get<Goal[]>(`/projects${buildQuery(filters as Record<string, string | number | boolean | undefined>)}`),

  create: (body: CreateGoalRequest) =>
    post<Goal>('/projects', body),

  update: (id: number, body: UpdateGoalRequest) =>
    put<Goal>(`/projects/${id}`, body),

  delete: (id: number) =>
    del(`/projects/${id}`),
}

// ---------------------------------------------------------------------------
// Habits
// ---------------------------------------------------------------------------

export interface HabitOut extends Habit {
  today_done: boolean
}

export interface UpdateHabitRequest {
  title?: string
  description?: string
  frequency?: string
  target_days?: string
  time_of_day?: string
  is_active?: boolean
}

export interface CompleteHabitRequest {
  completed_date?: string
  note?: string
}

export const habits = {
  list: (include_inactive = false) =>
    get<HabitOut[]>(`/habits${buildQuery({ include_inactive })}`),

  create: (body: CreateHabitRequest) =>
    post<HabitOut>('/habits', body),

  update: (id: number, body: UpdateHabitRequest) =>
    put<HabitOut>(`/habits/${id}`, body),

  archive: (id: number) =>
    del(`/habits/${id}`),

  complete: (id: number, body: CompleteHabitRequest = {}) =>
    post<HabitCompletion>(`/habits/${id}/complete`, body),

  uncomplete: (id: number, completed_date?: string) =>
    del(`/habits/${id}/complete${completed_date ? `?completed_date=${completed_date}` : ''}`),

  completions: (id: number, from_date?: string, to_date?: string) =>
    get<HabitCompletion[]>(`/habits/${id}/completions${buildQuery({ from_date, to_date })}`),
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export interface EventFilters {
  start?: string
  end?: string
  source?: string
  include_stale?: boolean
}

export interface UpdateEventRequest {
  title?: string
  description?: string
  event_type?: string
  location?: string
  start_datetime?: string
  end_datetime?: string
  task_id?: number
}

export interface GoogleCalendarStatus {
  authenticated: boolean
  has_secrets_file: boolean
  error?: string
}

export const calendar = {
  events: (filters: EventFilters = {}) =>
    get<CalendarEvent[]>(`/calendar/events${buildQuery(filters as Record<string, string | number | boolean | undefined>)}`),

  createEvent: (body: CreateEventRequest) =>
    post<CalendarEvent>('/calendar/events', body),

  updateEvent: (id: number, body: UpdateEventRequest) =>
    put<CalendarEvent>(`/calendar/events/${id}`, body),

  moveEvent: (id: number, body: { start_datetime: string; end_datetime: string }) =>
    put<CalendarEvent>(`/calendar/events/${id}/move`, body),

  deleteEvent: (id: number) =>
    del(`/calendar/events/${id}`),

  status: () =>
    get<GoogleCalendarStatus>('/calendar/status'),

  listCalendars: () =>
    get<{ id: string; summary: string; primary: boolean; backgroundColor: string }[]>('/calendar/list'),

  authUrl: (redirect_uri: string) =>
    get<{ url: string }>(`/calendar/auth-url?redirect_uri=${encodeURIComponent(redirect_uri)}`),

  exchangeCode: (code: string) =>
    post<{ ok: boolean }>('/calendar/exchange-code', { code }),

  syncAll: () =>
    post<{ calendars_synced: number; total_fetched: number; created: number; updated: number; stale_marked: number }>('/calendar/sync-all', {}),

  sync: (calendar_id = 'primary') =>
    post<{ calendar_id: string; total_fetched: number; created: number; updated: number; stale_marked: number }>(`/calendar/sync/${calendar_id}`, {}),

  disconnect: () =>
    del('/calendar/disconnect'),
}

// ---------------------------------------------------------------------------
// AI Chat
// ---------------------------------------------------------------------------

export interface SessionRecord {
  session_id: string
  last_message: string
  message_count: number
  updated_at: string
}

export interface ChatMessageRecord {
  id: number
  role: string
  content: string | null
  tool_name: string | null
  created_at: string
}

export const ai = {
  // Returns a raw Response so the caller can consume the SSE stream.
  // panel_context optionally scopes the agent — e.g. "projects" filters out
  // create/update/delete-goal tools so the in-page panel can only operate on
  // tasks within existing projects.
  chatStream: (
    message: string,
    session_id: string,
    panel_context?: string,
  ): Promise<Response> =>
    fetch(`${BASE}/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, session_id, panel_context }),
    }),

  sessions: () =>
    get<SessionRecord[]>('/ai/sessions'),

  session: (session_id: string) =>
    get<ChatMessageRecord[]>(`/ai/sessions/${session_id}`),

  deleteSession: (session_id: string) =>
    del(`/ai/sessions/${session_id}`),
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export interface DbStats {
  tasks_total: number
  tasks_active: number
  goals_total: number
  goals_active: number
  habits_total: number
  habits_active: number
  habit_completions: number
  events_total: number
  events_active: number
  ai_messages: number
}

export type InsightMetricKey =
  | 'task_completion_rate'
  | 'tasks_this_week'
  | 'overdue_tasks'
  | 'habit_completion_rate'
  | 'top_habit_streak'
  | 'goal_progress'
  | 'project_health'
  | 'time_allocation'

export interface InsightHighlight {
  metric: InsightMetricKey
  value: string
  trend: 'up' | 'down' | 'neutral'
  insight: string
}

export interface InsightPattern {
  title: string
  description: string
  severity: 'positive' | 'neutral' | 'warning'
}

export interface InsightRecommendation {
  action: string
  rationale: string
  priority: 'high' | 'medium' | 'low'
}

export interface AnalyticsInsights {
  headline: string
  highlights: InsightHighlight[]
  patterns: InsightPattern[]
  recommendations: InsightRecommendation[]
  focus_suggestion: { area: string; reason: string }
}

// Full analytics stats shape returned by /analytics/full
export interface AnalyticsTaskStats {
  total: number
  completed: number
  in_progress: number
  todo: number
  cancelled: number
  overdue: number
  completion_rate: number
  completion_by_week: { week: string; total: number; completed: number }[]
  avg_completion_hours: number
  priority_breakdown: Record<string, number>
  tag_breakdown: Record<string, number>
}

export interface AnalyticsHabitEntry {
  id: number
  title: string
  completion_rate_30d: number
  completion_rate_7d: number
  streak_current: number
  streak_best: number
}

export type ProjectHealthStatus = 'on_track' | 'at_risk' | 'off_track' | 'no_deadline'

export interface AnalyticsProject {
  id: number
  title: string
  color: string | null
  progress_pct: number
  target_date: string | null
  days_to_target: number | null
  task_total: number       // aggregated (own + subprojects)
  task_done: number        // aggregated
  task_remaining: number   // aggregated
  velocity_per_week: number
  projected_finish_date: string | null
  status: ProjectHealthStatus
  subprojects: AnalyticsProject[]   // child projects' OWN unaggregated metrics
  direct_task_total: number          // tasks directly on this goal (no children)
  direct_task_done: number
}

export interface TimeAllocationEntry {
  project_id: number | null
  title: string
  color: string | null
  minutes: number
  hours: number
}

export interface TimeAllocationWeek {
  by_project: TimeAllocationEntry[]
  total_minutes: number
  total_hours: number
  last_week_total_minutes: number
  last_week_total_hours: number
  week_start: string
  week_end: string
}

export interface AnalyticsHabitStats {
  habits: AnalyticsHabitEntry[]
  total_active: number
}

export interface AnalyticsGoalStats {
  total: number
  completed: number
  in_progress: number
  paused: number
  avg_progress_pct: number
  progress_distribution: Record<string, number>
}

export interface AnalyticsCalendarStats {
  total_events: number
  by_type: Record<string, number>
  busiest_days: { day: string; count: number }[]
  busiest_hours: { hour: number; count: number }[]
}

export interface AnalyticsStats {
  tasks: AnalyticsTaskStats
  habits: AnalyticsHabitStats
  goals: AnalyticsGoalStats
  calendar: AnalyticsCalendarStats
  projects: AnalyticsProject[]
  time_allocation_week: TimeAllocationWeek
}

export const analytics = {
  /** Flat DB stats used by Settings page */
  stats: () => get<DbStats>('/analytics/stats'),
  /** Full nested analytics used by Analytics page */
  full: () => get<AnalyticsStats>('/analytics/full'),
  insights: (stats: AnalyticsStats) =>
    post<AnalyticsInsights>('/analytics/insights', stats),
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export const preferences = {
  getAll: () => get<Record<string, string>>('/preferences'),
  set: (key: string, value: string) =>
    put<UserPreference>(`/preferences/${key}`, { value }),
}

// ---------------------------------------------------------------------------
// Alias: Goals.tsx uses "goals", API route is /api/projects
// ---------------------------------------------------------------------------
export const goals = projects

// Legacy export for backwards compat (Sprint 0 used api.get/post directly)
// ---------------------------------------------------------------------------
export const api = { get, post, put, del }
