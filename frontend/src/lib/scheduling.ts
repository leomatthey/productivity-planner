/**
 * scheduling.ts — Rule-based slot-finding engine (pure TypeScript, no React deps).
 *
 * findFreeSlots  — given existing calendar events on a day, returns open time slots.
 * scheduleBatch  — greedily assigns tasks to free slots across multiple days.
 */

import type { CalendarEvent, Task } from '../types'
import { parseUTCDate } from './datetime'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TimeSlot {
  start: Date
  end: Date
  durationMinutes: number
}

export interface ScheduledTask {
  taskId: number
  title: string
  start: Date
  end: Date
}

export interface FindFreeSlotsOptions {
  /** Start of workday in hours (24h). Default: 9 */
  workdayStart?: number
  /** End of workday in hours (24h). Default: 18 */
  workdayEnd?: number
  /** Buffer in minutes added before/after each event. Default: 15 */
  bufferMinutes?: number
  /** Ignore slots shorter than this many minutes. Default: 30 */
  minSlotMinutes?: number
}

export interface ScheduleBatchOptions extends FindFreeSlotsOptions {
  /** Maximum days ahead to search for slots. Default: 7 */
  maxDaysAhead?: number
  /** Skip Saturday and Sunday. Default: false */
  skipWeekends?: boolean
}

// ---------------------------------------------------------------------------
// findFreeSlots
// ---------------------------------------------------------------------------

/**
 * Returns all free time slots on a given calendar day.
 * Events that fall outside the workday are clamped to workday boundaries.
 * For today, slots before the current time are excluded.
 */
export function findFreeSlots(
  events: CalendarEvent[],
  date: Date,
  opts: FindFreeSlotsOptions = {},
): TimeSlot[] {
  const {
    workdayStart   = 9,
    workdayEnd     = 18,
    bufferMinutes  = 15,
    minSlotMinutes = 30,
  } = opts

  // Build workday start/end as timestamps for the target date
  const dayStart = new Date(date)
  dayStart.setHours(workdayStart, 0, 0, 0)
  const dayEnd = new Date(date)
  dayEnd.setHours(workdayEnd, 0, 0, 0)

  // Clamp dayStart to "now" for today — don't suggest past time slots
  const now = new Date()
  if (dayStart.toDateString() === now.toDateString() && now > dayStart) {
    // Round up to next 15-minute mark for cleaner slot boundaries
    const rounded = new Date(now)
    const mins = rounded.getMinutes()
    const roundUp = Math.ceil(mins / 15) * 15
    rounded.setMinutes(roundUp, 0, 0)
    dayStart.setTime(rounded.getTime())
  }

  // If the workday is already over for today, no slots available
  if (dayStart >= dayEnd) return []

  // Filter events that overlap the workday window using proper UTC parsing
  const dayEvents = events.filter(e => {
    const evStart = parseUTCDate(e.start_datetime)
    const evEnd   = parseUTCDate(e.end_datetime)
    return evStart < dayEnd && evEnd > dayStart
  })

  // Build list of busy intervals (clamped to workday, with buffer)
  const busy: Array<{ start: Date; end: Date }> = dayEvents
    .map(e => {
      const s = new Date(parseUTCDate(e.start_datetime).getTime() - bufferMinutes * 60_000)
      const en = new Date(parseUTCDate(e.end_datetime).getTime() + bufferMinutes * 60_000)
      return {
        start: s < dayStart ? dayStart : s,
        end:   en > dayEnd  ? dayEnd   : en,
      }
    })
    .filter(b => b.start < b.end)
    .sort((a, b) => a.start.getTime() - b.start.getTime())

  // Merge overlapping busy intervals
  const merged: Array<{ start: Date; end: Date }> = []
  for (const interval of busy) {
    if (merged.length === 0) {
      merged.push({ ...interval })
    } else {
      const last = merged[merged.length - 1]
      if (interval.start <= last.end) {
        if (interval.end > last.end) last.end = interval.end
      } else {
        merged.push({ ...interval })
      }
    }
  }

  // Collect gaps between busy intervals
  const slots: TimeSlot[] = []
  let cursor = dayStart

  for (const busy of merged) {
    if (busy.start > cursor) {
      const durationMs = busy.start.getTime() - cursor.getTime()
      const durationMinutes = Math.floor(durationMs / 60_000)
      if (durationMinutes >= minSlotMinutes) {
        slots.push({ start: new Date(cursor), end: new Date(busy.start), durationMinutes })
      }
    }
    if (busy.end > cursor) cursor = new Date(busy.end)
  }

  // Gap after last busy period to end of workday
  if (cursor < dayEnd) {
    const durationMs = dayEnd.getTime() - cursor.getTime()
    const durationMinutes = Math.floor(durationMs / 60_000)
    if (durationMinutes >= minSlotMinutes) {
      slots.push({ start: new Date(cursor), end: new Date(dayEnd), durationMinutes })
    }
  }

  return slots
}

// ---------------------------------------------------------------------------
// scheduleBatch
// ---------------------------------------------------------------------------

/**
 * Greedily assigns tasks to free time slots across multiple days, starting
 * from startDate. Tasks without estimated_minutes are assumed to take 30 min.
 * Returns one ScheduledTask per input task (tasks that couldn't be scheduled
 * within maxDaysAhead are omitted).
 */
export function scheduleBatch(
  tasks: Task[],
  events: CalendarEvent[],
  startDate: Date,
  opts: ScheduleBatchOptions = {},
): ScheduledTask[] {
  const {
    maxDaysAhead  = 7,
    skipWeekends  = false,
    workdayStart  = 9,
    workdayEnd    = 18,
    bufferMinutes = 15,
    minSlotMinutes = 30,
  } = opts

  const slotOpts: FindFreeSlotsOptions = { workdayStart, workdayEnd, bufferMinutes, minSlotMinutes }

  // Build list of candidate days
  const days: Date[] = []
  for (let i = 0; i < maxDaysAhead; i++) {
    const d = new Date(startDate)
    d.setDate(d.getDate() + i)
    d.setHours(0, 0, 0, 0)
    if (skipWeekends) {
      const dow = d.getDay() // 0=Sun, 6=Sat
      if (dow === 0 || dow === 6) continue
    }
    days.push(d)
  }

  const results: ScheduledTask[] = []
  // Work on a mutable copy of the task queue
  const queue = [...tasks]

  for (const day of days) {
    if (queue.length === 0) break

    const slots = findFreeSlots(events, day, slotOpts)

    // Cursor within the current day's slots
    for (const slot of slots) {
      if (queue.length === 0) break

      let slotCursor = new Date(slot.start)

      while (queue.length > 0) {
        const task = queue[0]
        const needed = task.estimated_minutes ?? 30

        const available = Math.floor(
          (slot.end.getTime() - slotCursor.getTime()) / 60_000,
        )

        if (available < needed) break // slot too small for next task

        const taskEnd = new Date(slotCursor.getTime() + needed * 60_000)
        results.push({
          taskId: task.id,
          title:  task.title,
          start:  new Date(slotCursor),
          end:    taskEnd,
        })

        slotCursor = taskEnd
        queue.shift()
      }
    }
  }

  return results
}

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
