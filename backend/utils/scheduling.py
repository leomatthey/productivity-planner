"""
utils/scheduling.py — Shared scheduling engine.

Single source of truth for finding free time slots and assigning tasks.
Used by both the API endpoints and the AI agent tools.
"""

from datetime import date, datetime, time as time_, timedelta
from typing import List, Optional, Tuple

from db import crud


def find_free_slots(
    target_date: date,
    duration_minutes: int = 30,
    work_start_hour: int = 9,
    work_end_hour: int = 18,
    buffer_minutes: int = 15,
) -> List[dict]:
    """
    Find free time slots on a given day that can fit at least `duration_minutes`.

    Returns list of {"start": datetime, "end": datetime, "duration_minutes": int}.
    Respects existing calendar events AND already-scheduled tasks as busy time.
    For today, skips past times (rounds up to next 15-min mark).
    """
    day_start_dt = datetime.combine(target_date, time_.min)
    day_end_dt = datetime.combine(target_date, time_.max)

    work_start_min = work_start_hour * 60
    work_end_min = work_end_hour * 60

    # For today: clamp work start to current time
    # Use local time (Docker TZ must be set to user's timezone)
    now = datetime.now()
    effective_start_min = work_start_min
    if target_date == now.date():
        now_min = now.hour * 60 + now.minute
        if now_min > work_start_min:
            # Round up to next 15-minute mark
            rounded = ((now_min + 14) // 15) * 15
            effective_start_min = min(rounded, work_end_min)

    if effective_start_min >= work_end_min:
        return []

    # Build busy intervals from calendar events
    events = crud.get_events(start=day_start_dt, end=day_end_dt, include_stale=True)
    raw_busy: List[Tuple[int, int]] = []

    for e in events:
        e_s = e.start_datetime.hour * 60 + e.start_datetime.minute
        e_e = e.end_datetime.hour * 60 + e.end_datetime.minute
        # Add buffer around events
        e_s = max(e_s - buffer_minutes, effective_start_min)
        e_e = min(e_e + buffer_minutes, work_end_min)
        if e_e > effective_start_min and e_s < work_end_min:
            raw_busy.append((max(e_s, effective_start_min), min(e_e, work_end_min)))

    raw_busy.sort()

    # Merge overlapping intervals
    merged: List[List[int]] = []
    for b_s, b_e in raw_busy:
        if merged and b_s <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b_e)
        else:
            merged.append([b_s, b_e])

    # Find free gaps
    free_slots: List[dict] = []
    cursor = effective_start_min
    for b_s, b_e in merged:
        if cursor < b_s:
            gap = b_s - cursor
            if gap >= duration_minutes:
                free_slots.append({
                    "start": datetime.combine(target_date, time_(cursor // 60, cursor % 60)),
                    "end": datetime.combine(target_date, time_(b_s // 60, b_s % 60)),
                    "duration_minutes": gap,
                })
        cursor = max(cursor, b_e)

    if cursor < work_end_min:
        gap = work_end_min - cursor
        if gap >= duration_minutes:
            free_slots.append({
                "start": datetime.combine(target_date, time_(cursor // 60, cursor % 60)),
                "end": datetime.combine(target_date, time_(work_end_min // 60, work_end_min % 60)),
                "duration_minutes": gap,
            })

    return free_slots


def find_slots_for_task(
    task_id: int,
    count: int = 3,
    start_date: Optional[date] = None,
    max_days_ahead: int = 14,
) -> List[dict]:
    """
    Find up to `count` scheduling proposals for a single task.
    Returns one slot per day for variety. Reads work hours from user preferences.

    Returns list of {"start": datetime, "end": datetime, "date": str}.
    """
    if start_date is None:
        start_date = date.today()

    task = crud.get_tasks()
    task_obj = next((t for t in task if t.id == task_id and t.deleted_at is None), None)
    if task_obj is None:
        raise ValueError(f"Task {task_id} not found or deleted")

    duration = task_obj.estimated_minutes or 30

    # Read user preferences
    work_start = int(crud.get_preference("work_start_hour", "9"))
    work_end = int(crud.get_preference("work_end_hour", "18"))
    buffer = int(crud.get_preference("schedule_buffer_minutes", "15"))

    results: List[dict] = []
    for i in range(max_days_ahead):
        if len(results) >= count:
            break
        d = start_date + timedelta(days=i)
        slots = find_free_slots(d, duration, work_start, work_end, buffer)
        if slots:
            slot = slots[0]  # first available slot on this day
            results.append({
                "start": slot["start"],
                "end": datetime.combine(d, time_.min) + timedelta(
                    hours=slot["start"].hour,
                    minutes=slot["start"].minute + duration,
                ),
                "date": d.isoformat(),
            })

    return results


def schedule_batch_auto(
    task_ids: List[int],
    start_date: Optional[date] = None,
    max_days_ahead: int = 7,
) -> List[dict]:
    """
    Auto-assign time slots to multiple tasks. Greedy first-fit by priority.
    Does NOT write to DB — returns proposals only.

    Returns list of {"task_id": int, "title": str, "start": datetime, "end": datetime}.
    """
    if start_date is None:
        start_date = date.today()

    all_tasks = crud.get_tasks()
    task_map = {t.id: t for t in all_tasks if t.deleted_at is None}
    tasks_to_schedule = [task_map[tid] for tid in task_ids if tid in task_map]

    # Sort: priority (urgent first), then due_date (earliest first, None last)
    priority_order = {"urgent": 0, "high": 1, "medium": 2, "low": 3}
    tasks_to_schedule.sort(key=lambda t: (
        priority_order.get(t.priority or "medium", 2),
        t.due_date or date.max,
    ))

    work_start = int(crud.get_preference("work_start_hour", "9"))
    work_end = int(crud.get_preference("work_end_hour", "18"))
    buffer = int(crud.get_preference("schedule_buffer_minutes", "15"))

    results: List[dict] = []
    # Track additionally-busy intervals from already-assigned tasks in this batch
    extra_busy: List[Tuple[date, int, int]] = []  # (date, start_min, end_min)

    for task in tasks_to_schedule:
        duration = task.estimated_minutes or 30
        placed = False

        for i in range(max_days_ahead):
            if placed:
                break
            d = start_date + timedelta(days=i)
            slots = find_free_slots(d, duration, work_start, work_end, buffer)

            # Subtract slots already claimed in this batch
            for slot in slots:
                slot_s = slot["start"].hour * 60 + slot["start"].minute
                slot_e = slot_s + slot["duration_minutes"]

                # Check against batch-local busy intervals on this day
                conflict = False
                for bd, bs, be in extra_busy:
                    if bd == d and bs < slot_s + duration and be > slot_s:
                        conflict = True
                        break

                if not conflict and (slot_e - slot_s) >= duration:
                    start_dt = slot["start"]
                    end_dt = datetime.combine(d, time_(
                        (slot_s + duration) // 60,
                        (slot_s + duration) % 60,
                    ))
                    results.append({
                        "task_id": task.id,
                        "title": task.title,
                        "start": start_dt,
                        "end": end_dt,
                    })
                    extra_busy.append((d, slot_s, slot_s + duration))
                    placed = True
                    break

    return results
