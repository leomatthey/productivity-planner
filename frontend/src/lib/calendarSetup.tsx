/**
 * calendarSetup.ts — Shared react-big-calendar configuration.
 *
 * Single source of truth for the DnD calendar component, event conversion,
 * and color helpers. Used by both the main Calendar page and the
 * SmartSchedulePanel in Tasks.
 */

import type { ComponentType } from 'react'
import { Calendar as BigCalendar, dateFnsLocalizer, type View } from 'react-big-calendar'
// Rolldown-safe CJS import: namespace import + explicit .default access
// (Rolldown ignores __esModule flag when importer has "type": "module")
import * as DnDAddon from 'react-big-calendar/lib/addons/dragAndDrop'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import { enUS } from 'date-fns/locale'

import { getProjectColor, NO_PROJECT_COLOR } from './colors'
import { parseUTCDate } from './datetime'
import type { CalendarEvent, Task, Goal } from '../types'

// ---------------------------------------------------------------------------
// Localizer (Monday start)
// ---------------------------------------------------------------------------

const locales = { 'en-US': enUS }

export const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales,
})

// ---------------------------------------------------------------------------
// DnD calendar component — Rolldown CJS workaround
// ---------------------------------------------------------------------------

/**
 * Typed props for the DnD-wrapped calendar. The HOC erases generics,
 * so we maintain an explicit interface for type safety.
 */
export interface DnDCalendarProps {
  localizer: ReturnType<typeof dateFnsLocalizer>
  events: BigCalEvent[]
  view: View
  date: Date
  onView: (v: View) => void
  onNavigate: (d: Date) => void
  onSelectEvent?: (event: object, e: React.SyntheticEvent) => void
  onSelectSlot?: (slot: { start: Date; end: Date }) => void
  onEventDrop?: (args: { event: BigCalEvent; start: string | Date; end: string | Date }) => void
  onEventResize?: (args: { event: BigCalEvent; start: string | Date; end: string | Date }) => void
  draggableAccessor?: (event: BigCalEvent) => boolean
  resizable?: boolean
  selectable?: boolean
  toolbar?: boolean
  style?: React.CSSProperties
  eventPropGetter?: (e: object) => { style: React.CSSProperties }
  components?: object
  formats?: object
  views?: View[]
  popup?: boolean
  min?: Date
  max?: Date
  step?: number
  timeslots?: number
  scrollToTime?: Date
}

// Rolldown double-nests CJS default exports: DnDAddon.default.default is the actual function.
// Walk the .default chain until we find the function.
let dndHoc = DnDAddon as unknown
while (dndHoc && typeof dndHoc !== 'function' && typeof (dndHoc as Record<string, unknown>).default !== 'undefined') {
  dndHoc = (dndHoc as Record<string, unknown>).default
}
const withDragAndDrop = dndHoc as (cal: typeof BigCalendar) => ComponentType<DnDCalendarProps>

export const DnDCalendar = withDragAndDrop(BigCalendar)

// ---------------------------------------------------------------------------
// Event type — shared between Calendar page and SmartSchedulePanel
// ---------------------------------------------------------------------------

export interface BigCalEvent {
  id: number
  title: string
  start: Date
  end: Date
  allDay?: boolean
  resource: CalendarEvent & {
    isProposal?: boolean
    proposalColor?: string
  }
}

// ---------------------------------------------------------------------------
// Event conversion
// ---------------------------------------------------------------------------

export function toBigCalEvent(e: CalendarEvent): BigCalEvent {
  const start = parseUTCDate(e.start_datetime)
  const end   = parseUTCDate(e.end_datetime)

  // All-day detection: backend stores all-day events as midnight-to-midnight UTC.
  const rawStart = e.start_datetime
  const rawEnd = e.end_datetime
  const isAllDay = rawStart.includes('T00:00:00') && rawEnd.includes('T00:00:00') && rawStart !== rawEnd

  if (isAllDay) {
    const startDate = new Date(rawStart.slice(0, 10) + 'T00:00:00')
    const endDate = new Date(rawEnd.slice(0, 10) + 'T00:00:00')
    return { id: e.id, title: e.title, start: startDate, end: endDate, allDay: true, resource: e }
  }

  return { id: e.id, title: e.title, start, end, allDay: false, resource: e }
}

// ---------------------------------------------------------------------------
// Event block component (compact: time + title)
// ---------------------------------------------------------------------------

export function CalendarEventBlock({ event }: { event: BigCalEvent }) {
  return (
    <div className="h-full overflow-hidden leading-tight px-0.5 py-0.5">
      <div className="text-[11px] font-medium truncate">{event.title}</div>
      {!event.allDay && <div className="text-[10px] opacity-70 truncate">{format(event.start, 'HH:mm')}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Event color helpers
// ---------------------------------------------------------------------------

export const GOOGLE_CAL_COLOR       = '#94A3B8'
export const GOOGLE_CAL_COLOR_OTHER = '#B0BEC5'

export const EVENT_COLOURS: Record<string, string> = {
  meeting:       '#3B82F6',
  personal:      '#8B5CF6',
  reminder:      '#F59E0B',
  task_block:    '#10B981',
  google_import: '#94A3B8',
}

export function getEventColor(
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
      if (task && task.project_id != null) {
        return getProjectColor(task.project_id, projectsList)
      }
    }
    return NO_PROJECT_COLOR
  }
  return EVENT_COLOURS[event.event_type] ?? '#94A3B8'
}
