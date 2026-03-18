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
}

// ---------------------------------------------------------------------------
// Goals
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
  current_updated_at?: string
}

export const goals = {
  list: (filters: GoalFilters = {}) =>
    get<Goal[]>(`/goals${buildQuery(filters as Record<string, string | number | boolean | undefined>)}`),

  create: (body: CreateGoalRequest) =>
    post<Goal>('/goals', body),

  update: (id: number, body: UpdateGoalRequest) =>
    put<Goal>(`/goals/${id}`, body),

  delete: (id: number) =>
    del(`/goals/${id}`),
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

  deleteEvent: (id: number) =>
    del(`/calendar/events/${id}`),

  status: () =>
    get<GoogleCalendarStatus>('/calendar/status'),

  authUrl: (redirect_uri: string) =>
    get<{ url: string }>(`/calendar/auth-url?redirect_uri=${encodeURIComponent(redirect_uri)}`),

  sync: (calendar_id = 'primary') =>
    post<{ synced: number }>(`/calendar/sync/${calendar_id}`, {}),

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
  // Returns a raw Response so the caller can consume the SSE stream
  chatStream: (message: string, session_id: string): Promise<Response> =>
    fetch(`${BASE}/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, session_id }),
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

/** Legacy shape — kept for any component that still references it. */
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

// Rich aggregated stats returned by GET /api/analytics/stats (Sprint 4)
export interface WeekStat {
  week: string
  total: number
  completed: number
  rate: number
}

export interface HabitStat {
  id: number
  title: string
  completion_rate_30d: number
  completions_30d: number
  streak_current: number
  streak_best: number
  best_day_of_week: string | null
}

export interface AnalyticsStats {
  tasks: {
    total: number
    completed: number
    in_progress: number
    todo: number
    cancelled: number
    overdue: number
    completion_rate: number
    completion_by_week: WeekStat[]
    avg_completion_hours: number
    priority_breakdown: Record<string, number>
    tag_breakdown: Record<string, number>
  }
  habits: {
    habits: HabitStat[]
    total_active: number
  }
  goals: {
    total: number
    completed: number
    in_progress: number
    paused: number
    avg_progress_pct: number
    progress_distribution: Record<string, number>
  }
  calendar: {
    total_events: number
    by_type: Record<string, number>
    busiest_days: { day: string; count: number }[]
    busiest_hours: { hour: number; count: number }[]
  }
}

// LLM insights response schema (POST /api/analytics/insights)
export type InsightTrend = 'up' | 'down' | 'neutral'
export type InsightSeverity = 'positive' | 'neutral' | 'warning'
export type InsightPriority = 'high' | 'medium' | 'low'

/**
 * Metric keys returned by Claude — each key maps 1-to-1 to a chart card
 * so the frontend can add a visual ring highlight driven by LLM output.
 */
export type InsightMetricKey =
  | 'task_completion_rate'
  | 'habit_completion_rate'
  | 'goal_progress'
  | 'overdue_tasks'
  | 'tasks_this_week'
  | 'top_habit_streak'

export interface InsightHighlight {
  metric: InsightMetricKey
  value: string
  trend: InsightTrend
  insight: string
}

export interface InsightPattern {
  title: string
  description: string
  severity: InsightSeverity
}

export interface InsightRecommendation {
  action: string
  rationale: string
  priority: InsightPriority
}

export interface InsightFocusSuggestion {
  area: string
  reason: string
}

export interface AnalyticsInsights {
  highlights: InsightHighlight[]
  patterns: InsightPattern[]
  recommendations: InsightRecommendation[]
  focus_suggestion: InsightFocusSuggestion
}

export const analytics = {
  stats: () => get<AnalyticsStats>('/analytics/stats'),
  insights: (stats: AnalyticsStats) =>
    post<AnalyticsInsights>('/analytics/insights', { stats }),
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
// Legacy export for backwards compat (Sprint 0 used api.get/post directly)
// ---------------------------------------------------------------------------
export const api = { get, post, put, del }
