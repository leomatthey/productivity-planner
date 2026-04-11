/**
 * ScheduleCalendar — Reusable week calendar for scheduling proposals.
 *
 * Fetches its own event data (not dependent on parent queries).
 * Displays 7 consecutive days starting from today + dayOffset.
 * Shows existing events (read-only) and draggable proposal blocks (ghost blocks).
 */

import { useMemo, useRef, useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { CalendarEvent, Task, Goal } from '../types'
import { calendar as calendarApi } from '../lib/api'
import { parseUTCDate } from '../lib/datetime'
import { getProjectColor, getContrastColor, NO_PROJECT_COLOR } from '../lib/colors'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProposalBlock {
  taskId: number
  title: string
  start: Date
  end: Date
  color: string
}

interface ScheduleCalendarProps {
  proposals: ProposalBlock[]
  onProposalMove: (taskId: number, start: Date, end: Date) => void
  tasksList?: Task[]
  projectsList?: Goal[]
  workStartHour?: number
  workEndHour?: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOUR_HEIGHT = 48
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const GOOGLE_COLOR = '#94A3B8'

const EVENT_TYPE_COLORS: Record<string, string> = {
  meeting: '#3B82F6', personal: '#8B5CF6', reminder: '#F59E0B',
  task_block: '#10B981', google_import: GOOGLE_COLOR,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function getSlotStyle(start: Date, end: Date, workStart: number): React.CSSProperties {
  const startMins = (start.getHours() - workStart) * 60 + start.getMinutes()
  const endMins = (end.getHours() - workStart) * 60 + end.getMinutes()
  const clampedStart = Math.max(0, startMins)
  const clampedEnd = Math.min(540, endMins) // 9h max (18-9)
  if (clampedEnd <= clampedStart) return { display: 'none' }
  return {
    position: 'absolute' as const,
    top: `${(clampedStart / 60) * HOUR_HEIGHT}px`,
    height: `${((clampedEnd - clampedStart) / 60) * HOUR_HEIGHT}px`,
  }
}

function getEventColor(event: CalendarEvent, tasksList: Task[], projectsList: Goal[]): string {
  if (event.source === 'google') return GOOGLE_COLOR
  if (event.event_type === 'task_block' && event.task_id) {
    const task = tasksList.find(t => t.id === event.task_id)
    if (task && task.project_id != null) return getProjectColor(task.project_id, projectsList)
    return NO_PROJECT_COLOR
  }
  return EVENT_TYPE_COLORS[event.event_type] ?? '#94A3B8'
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ScheduleCalendar({
  proposals,
  onProposalMove,
  tasksList = [],
  projectsList = [],
  workStartHour = 9,
  workEndHour = 18,
}: ScheduleCalendarProps) {
  const [dayOffset, setDayOffset] = useState(0)

  // Fetch events directly — not dependent on parent queries
  const { data: events = [] } = useQuery({
    queryKey: ['events'],
    queryFn: () => calendarApi.events({ include_stale: true }),
  })

  const firstDay = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + dayOffset)
    d.setHours(0, 0, 0, 0)
    return d
  }, [dayOffset])

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => {
      const d = new Date(firstDay)
      d.setDate(d.getDate() + i)
      return d
    }),
    [firstDay],
  )

  const hours = useMemo(
    () => Array.from({ length: workEndHour - workStartHour }, (_, i) => workStartHour + i),
    [workStartHour, workEndHour],
  )

  const todayStr = localDateStr(new Date())

  function getEventsOnDay(day: Date): CalendarEvent[] {
    const dateStr = localDateStr(day)
    return events.filter(e => {
      const evDate = parseUTCDate(e.start_datetime)
      return localDateStr(evDate) === dateStr
    })
  }

  function getProposalsOnDay(day: Date): ProposalBlock[] {
    const dateStr = localDateStr(day)
    return proposals.filter(p => localDateStr(p.start) === dateStr)
  }

  // Drag state — tracks both vertical (time) and horizontal (day) movement
  const gridRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    taskId: number
    startY: number
    startX: number
    origStart: Date
    origEnd: Date
    origDayIndex: number
  } | null>(null)
  const [dragOffset, setDragOffset] = useState<{ taskId: number; dy: number } | null>(null)

  const handleMouseDown = useCallback((e: React.MouseEvent, proposal: ProposalBlock, dayIndex: number) => {
    e.preventDefault()
    dragRef.current = {
      taskId: proposal.taskId,
      startY: e.clientY,
      startX: e.clientX,
      origStart: proposal.start,
      origEnd: proposal.end,
      origDayIndex: dayIndex,
    }
    setDragOffset({ taskId: proposal.taskId, dy: 0 })

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      setDragOffset({ taskId: dragRef.current.taskId, dy: ev.clientY - dragRef.current.startY })
    }

    const handleMouseUp = (ev: MouseEvent) => {
      if (!dragRef.current || !gridRef.current) return
      const dy = ev.clientY - dragRef.current.startY
      const minuteOffset = Math.round((dy / HOUR_HEIGHT) * 60 / 15) * 15
      const { origStart, origEnd, taskId, origDayIndex } = dragRef.current

      // Calculate which day column the cursor is over
      const gridRect = gridRef.current.getBoundingClientRect()
      const hourLabelWidth = 40 // matches the w-10 hour label column
      const gridContentWidth = gridRect.width - hourLabelWidth
      const colWidth = gridContentWidth / 7
      const relativeX = ev.clientX - gridRect.left - hourLabelWidth
      const newDayIndex = Math.max(0, Math.min(6, Math.floor(relativeX / colWidth)))
      const dayDiff = newDayIndex - origDayIndex

      const newStart = new Date(origStart.getTime() + minuteOffset * 60_000 + dayDiff * 86_400_000)
      const newEnd = new Date(origEnd.getTime() + minuteOffset * 60_000 + dayDiff * 86_400_000)

      if (newStart.getHours() >= workStartHour && newEnd.getHours() <= workEndHour) {
        onProposalMove(taskId, newStart, newEnd)
      }
      dragRef.current = null
      setDragOffset(null)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [onProposalMove, workStartHour, workEndHour])

  const gridHeight = (workEndHour - workStartHour) * HOUR_HEIGHT

  // Navigation label
  const lastDay = days[6]
  const navLabel = `${firstDay.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${lastDay.toLocaleDateString([], { month: 'short', day: 'numeric' })}`

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden bg-white dark:bg-slate-900">
      {/* Day navigation */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
        <button
          onClick={() => setDayOffset(d => Math.max(d - 1, 0))}
          disabled={dayOffset === 0}
          className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded disabled:opacity-30"
        >
          <ChevronLeft size={14} />
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{navLabel}</span>
          {dayOffset !== 0 && (
            <button onClick={() => setDayOffset(0)} className="text-[10px] text-primary hover:underline">Today</button>
          )}
        </div>
        <button onClick={() => setDayOffset(d => d + 1)} className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded">
          <ChevronRight size={14} />
        </button>
      </div>

      <div ref={gridRef} className="flex">
        {/* Hour labels */}
        <div className="shrink-0 w-10 border-r border-slate-100 dark:border-slate-800">
          <div className="h-6" />
          {hours.map(h => (
            <div
              key={h}
              className="text-[9px] text-slate-400 text-right pr-1 border-t border-slate-50 dark:border-slate-800"
              style={{ height: `${HOUR_HEIGHT}px`, lineHeight: `${HOUR_HEIGHT}px` }}
            >
              {`${String(h).padStart(2, '0')}:00`}
            </div>
          ))}
        </div>

        {/* Day columns */}
        {days.map((day, di) => {
          const isToday = localDateStr(day) === todayStr
          const dayEvents = getEventsOnDay(day)
          const dayProposals = getProposalsOnDay(day)

          return (
            <div key={di} className="flex-1 min-w-0 border-l border-slate-50 dark:border-slate-800 first:border-l-0">
              {/* Day header */}
              <div className={`h-6 text-center text-[10px] font-medium leading-6 border-b border-slate-100 dark:border-slate-800 ${isToday ? 'text-primary font-bold bg-primary-50/50 dark:bg-primary-900/10' : 'text-slate-500'}`}>
                {DAY_NAMES[day.getDay()]} {day.getDate()}
              </div>

              {/* Time grid */}
              <div className="relative" style={{ height: `${gridHeight}px` }}>
                {hours.map((_, i) => (
                  <div key={i} className="absolute left-0 right-0 border-t border-slate-50 dark:border-slate-800" style={{ top: `${i * HOUR_HEIGHT}px` }} />
                ))}

                {/* Existing events */}
                {dayEvents.map(ev => {
                  const s = parseUTCDate(ev.start_datetime)
                  const en = parseUTCDate(ev.end_datetime)
                  const sty = getSlotStyle(s, en, workStartHour)
                  const color = getEventColor(ev, tasksList, projectsList)
                  const textColor = getContrastColor(color)
                  const durationMins = (en.getTime() - s.getTime()) / 60_000
                  const heightPx = (durationMins / 60) * HOUR_HEIGHT

                  return (
                    <div
                      key={ev.id}
                      className="absolute left-0.5 right-0.5 rounded overflow-hidden"
                      style={{ ...sty, backgroundColor: color, color: textColor, border: color === NO_PROJECT_COLOR ? '1px solid #CBD5E1' : 'none' }}
                    >
                      {heightPx >= 12 && (
                        <div className={`px-1 leading-tight ${heightPx < 20 ? 'flex items-center h-full' : 'py-0.5'}`}>
                          <div className="text-[9px] font-medium truncate">{ev.title}</div>
                          {heightPx >= 20 && <div className="text-[8px] opacity-70">{formatTime(s)}</div>}
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* Proposal ghost blocks (draggable) */}
                {dayProposals.map(p => {
                  const dy = dragOffset?.taskId === p.taskId ? dragOffset.dy : 0
                  const sty = getSlotStyle(p.start, p.end, workStartHour)
                  const topPx = parseFloat(String(sty.top ?? '0')) + dy
                  const durationMins = (p.end.getTime() - p.start.getTime()) / 60_000
                  const heightPx = (durationMins / 60) * HOUR_HEIGHT

                  return (
                    <div
                      key={p.taskId}
                      className="absolute left-0.5 right-0.5 rounded overflow-hidden cursor-grab active:cursor-grabbing select-none"
                      style={{
                        ...sty,
                        top: `${topPx}px`,
                        backgroundColor: p.color + '25',
                        border: `2px dashed ${p.color}`,
                        color: p.color,
                        zIndex: dragOffset?.taskId === p.taskId ? 20 : 10,
                      }}
                      onMouseDown={e => handleMouseDown(e, p, di)}
                    >
                      {heightPx >= 12 && (
                        <div className={`px-1 leading-tight ${heightPx < 20 ? 'flex items-center h-full' : 'py-0.5'}`}>
                          <div className="text-[9px] font-semibold truncate">{p.title}</div>
                          {heightPx >= 20 && <div className="text-[8px] opacity-70">{formatTime(p.start)} – {formatTime(p.end)}</div>}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
