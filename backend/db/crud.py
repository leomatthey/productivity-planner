"""
CRUD helpers shared by the Streamlit UI and the AI agent tools.

Every write operation goes through these functions, guaranteeing a single
consistent data layer.  Soft-deletes are used throughout (deleted_at column);
all queries filter WHERE deleted_at IS NULL by default.

Optimistic locking: update_task and update_goal accept an optional
`current_updated_at` timestamp.  If the row has been modified by a concurrent
operation (e.g. a Streamlit rerun), the update raises ValueError instead of
silently overwriting newer data.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import List, Optional

from sqlalchemy.orm import Session

from db.schema import (
    AIConversationHistory,
    CalendarEvent,
    Goal,
    Habit,
    HabitCompletion,
    Task,
    UserPreferences,
    get_session,
)

# ============================================================================
#  TASKS
# ============================================================================

def get_tasks(
    project_id: Optional[int] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    due_date_from: Optional[date] = None,
    due_date_to: Optional[date] = None,
    tag: Optional[str] = None,
    include_deleted: bool = False,
) -> List[Task]:
    with get_session() as session:
        q = session.query(Task)
        if not include_deleted:
            q = q.filter(Task.deleted_at.is_(None))
        if project_id is not None:
            q = q.filter(Task.project_id == project_id)
        if status:
            q = q.filter(Task.status == status)
        if priority:
            q = q.filter(Task.priority == priority)
        if due_date_from:
            q = q.filter(Task.due_date >= due_date_from)
        if due_date_to:
            q = q.filter(Task.due_date <= due_date_to)
        if tag:
            q = q.filter(Task.tags.contains(tag))
        return q.order_by(Task.due_date.asc().nullslast()).all()


def create_task(
    title: str,
    description: Optional[str] = None,
    status: str = "todo",
    priority: str = "medium",
    due_date: Optional[date] = None,
    project_id: Optional[int] = None,
    scheduled_at: Optional[datetime] = None,
    estimated_minutes: Optional[int] = None,
    energy_level: Optional[str] = None,
    tags: Optional[str] = None,
) -> Task:
    with get_session() as session:
        task = Task(
            title=title,
            description=description,
            status=status,
            priority=priority,
            due_date=due_date,
            project_id=project_id,
            scheduled_at=scheduled_at,
            estimated_minutes=estimated_minutes,
            energy_level=energy_level,
            tags=tags,
        )
        session.add(task)
        session.flush()
        return task


VALID_TASK_STATUSES = {'todo', 'in_progress', 'scheduled', 'done'}


def update_task(
    task_id: int,
    current_updated_at: Optional[datetime] = None,
    **fields,
) -> Task:
    if 'status' in fields and fields['status'] not in VALID_TASK_STATUSES:
        raise ValueError(f"Invalid status: {fields['status']}")
    with get_session() as session:
        q = session.query(Task).filter(
            Task.id == task_id,
            Task.deleted_at.is_(None),
        )
        if current_updated_at is not None:
            q = q.filter(Task.updated_at == current_updated_at)
        task = q.first()
        if task is None:
            raise ValueError(
                f"Task {task_id} not found, already deleted, or modified by a concurrent operation."
            )
        for key, value in fields.items():
            if hasattr(task, key):
                setattr(task, key, value)
        task.updated_at = datetime.utcnow()
        session.flush()
        if "status" in fields and task.project_id:
            _recalculate_goal_progress(session, task.project_id)
        return task


def delete_task(task_id: int) -> Task:
    with get_session() as session:
        task = session.query(Task).filter(
            Task.id == task_id,
            Task.deleted_at.is_(None),
        ).first()
        if task is None:
            raise ValueError(f"Task {task_id} not found or already deleted.")
        task.deleted_at = datetime.utcnow()
        task.updated_at = datetime.utcnow()
        session.flush()
        if task.project_id:
            _recalculate_goal_progress(session, task.project_id)
        return task


# ============================================================================
#  GOALS
# ============================================================================

def get_goals(
    status: Optional[str] = None,
    parent_id: Optional[int] = None,
    top_level_only: bool = False,
    include_deleted: bool = False,
) -> List[Goal]:
    with get_session() as session:
        q = session.query(Goal)
        if not include_deleted:
            q = q.filter(Goal.deleted_at.is_(None))
        if status:
            q = q.filter(Goal.status == status)
        if parent_id is not None:
            q = q.filter(Goal.parent_id == parent_id)
        if top_level_only:
            q = q.filter(Goal.parent_id.is_(None))
        goals = q.order_by(Goal.target_date.asc().nullslast()).all()
        for goal in goals:
            if goal.progress_mode == "auto":
                _recalculate_goal_progress(session, goal.id)
        return goals


def create_goal(
    title: str,
    description: Optional[str] = None,
    status: str = "active",
    target_date: Optional[date] = None,
    progress_pct: int = 0,
    progress_mode: str = "manual",
    parent_id: Optional[int] = None,
    color: Optional[str] = None,
) -> Goal:
    with get_session() as session:
        goal = Goal(
            title=title,
            description=description,
            status=status,
            target_date=target_date,
            progress_pct=progress_pct,
            progress_mode=progress_mode,
            parent_id=parent_id,
            color=color,
        )
        session.add(goal)
        session.flush()
        return goal


def update_goal(
    goal_id: int,
    current_updated_at: Optional[datetime] = None,
    **fields,
) -> Goal:
    with get_session() as session:
        q = session.query(Goal).filter(
            Goal.id == goal_id,
            Goal.deleted_at.is_(None),
        )
        if current_updated_at is not None:
            q = q.filter(Goal.updated_at == current_updated_at)
        goal = q.first()
        if goal is None:
            raise ValueError(
                f"Goal {goal_id} not found, already deleted, or modified by a concurrent operation."
            )
        for key, value in fields.items():
            if hasattr(goal, key):
                setattr(goal, key, value)
        goal.updated_at = datetime.utcnow()
        session.flush()
        return goal


def delete_goal(goal_id: int) -> Goal:
    with get_session() as session:
        goal = session.query(Goal).filter(
            Goal.id == goal_id,
            Goal.deleted_at.is_(None),
        ).first()
        if goal is None:
            raise ValueError(f"Goal {goal_id} not found or already deleted.")
        goal.deleted_at = datetime.utcnow()
        goal.updated_at = datetime.utcnow()
        session.flush()
        return goal


def _recalculate_goal_progress(session: Session, goal_id: int) -> None:
    """Recompute progress_pct for auto-mode goals from linked task completion."""
    goal = session.query(Goal).filter(
        Goal.id == goal_id,
        Goal.deleted_at.is_(None),
    ).first()
    if goal is None or goal.progress_mode != "auto":
        return
    total = session.query(Task).filter(
        Task.project_id == goal_id,
        Task.deleted_at.is_(None),
    ).count()
    if total == 0:
        goal.progress_pct = 0
        return
    done = session.query(Task).filter(
        Task.project_id == goal_id,
        Task.status == "done",
        Task.deleted_at.is_(None),
    ).count()
    goal.progress_pct = int((done / total) * 100)


# ============================================================================
#  CALENDAR EVENTS
# ============================================================================

def get_events(
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
    source: Optional[str] = None,       # "local" | "google" | None = all
    include_stale: bool = False,
    include_deleted: bool = False,
) -> List[CalendarEvent]:
    with get_session() as session:
        q = session.query(CalendarEvent)
        if not include_deleted:
            q = q.filter(CalendarEvent.deleted_at.is_(None))
        if not include_stale:
            q = q.filter(
                (CalendarEvent.sync_stale == False) | CalendarEvent.sync_stale.is_(None)
            )
        if start:
            q = q.filter(CalendarEvent.end_datetime >= start)
        if end:
            q = q.filter(CalendarEvent.start_datetime <= end)
        if source:
            q = q.filter(CalendarEvent.source == source)
        return q.order_by(CalendarEvent.start_datetime.asc()).all()


def create_event(
    title: str,
    start_datetime: datetime,
    end_datetime: datetime,
    description: Optional[str] = None,
    event_type: str = "personal",
    location: Optional[str] = None,
    task_id: Optional[int] = None,
    is_recurring: bool = False,
    recurrence_rule: Optional[str] = None,
    source: str = "local",
    google_event_id: Optional[str] = None,
    google_calendar_id: Optional[str] = None,
    is_read_only: bool = False,
    sync_stale: bool = False,
) -> CalendarEvent:
    with get_session() as session:
        event = CalendarEvent(
            title=title,
            start_datetime=start_datetime,
            end_datetime=end_datetime,
            description=description,
            event_type=event_type,
            location=location,
            task_id=task_id,
            is_recurring=is_recurring,
            recurrence_rule=recurrence_rule,
            source=source,
            google_event_id=google_event_id,
            google_calendar_id=google_calendar_id,
            is_read_only=is_read_only,
            sync_stale=sync_stale,
        )
        session.add(event)
        session.flush()
        return event


def update_event(event_id: int, **fields) -> CalendarEvent:
    with get_session() as session:
        event = session.query(CalendarEvent).filter(
            CalendarEvent.id == event_id,
            CalendarEvent.deleted_at.is_(None),
        ).first()
        if event is None:
            raise ValueError(f"Event {event_id} not found or already deleted.")
        if event.is_read_only:
            raise PermissionError(
                f"Event {event_id} is a read-only Google Calendar event and cannot be modified."
            )
        for key, value in fields.items():
            if hasattr(event, key):
                setattr(event, key, value)
        session.flush()
        return event


def move_event(
    event_id: int,
    start_datetime: datetime,
    end_datetime: datetime,
) -> CalendarEvent:
    """Atomically move/resize an event. Updates linked task's scheduled_at too."""
    with get_session() as session:
        event = session.query(CalendarEvent).filter(
            CalendarEvent.id == event_id,
            CalendarEvent.deleted_at.is_(None),
        ).first()
        if event is None:
            raise ValueError(f"Event {event_id} not found or deleted.")
        if event.is_read_only:
            raise PermissionError(f"Event {event_id} is read-only.")
        event.start_datetime = start_datetime
        event.end_datetime = end_datetime
        if event.event_type == "task_block" and event.task_id:
            task = session.query(Task).filter(Task.id == event.task_id).first()
            if task:
                task.scheduled_at = start_datetime
                task.updated_at = datetime.utcnow()
        session.flush()
        return event


def delete_event(event_id: int) -> CalendarEvent:
    with get_session() as session:
        event = session.query(CalendarEvent).filter(
            CalendarEvent.id == event_id,
            CalendarEvent.deleted_at.is_(None),
        ).first()
        if event is None:
            raise ValueError(f"Event {event_id} not found or already deleted.")
        if event.is_read_only:
            raise PermissionError(
                f"Event {event_id} is a read-only Google Calendar event and cannot be deleted."
            )
        event.deleted_at = datetime.utcnow()

        # Cascade: if this was a task_block with a linked task, reset the task
        if event.event_type == "task_block" and event.task_id:
            # Check if the task has any OTHER non-deleted task_block events
            other_events = session.query(CalendarEvent).filter(
                CalendarEvent.task_id == event.task_id,
                CalendarEvent.event_type == "task_block",
                CalendarEvent.deleted_at.is_(None),
                CalendarEvent.id != event_id,
            ).count()
            if other_events == 0:
                task = session.query(Task).filter(Task.id == event.task_id).first()
                if task and task.status == "scheduled":
                    task.status = "todo"
                    task.scheduled_at = None
                    task.updated_at = datetime.utcnow()

        session.flush()
        return event


def update_google_event(event_id: int, **fields) -> CalendarEvent:
    """
    Update a Google Calendar event during a sync operation.

    Unlike ``update_event()``, this function bypasses the ``is_read_only`` guard
    because the data originates from the authoritative external source (Google).
    Only the sync integration module should call this function.
    """
    with get_session() as session:
        event = session.query(CalendarEvent).filter(
            CalendarEvent.id == event_id,
        ).first()
        if event is None:
            raise ValueError(f"Event {event_id} not found.")
        for key, value in fields.items():
            if hasattr(event, key):
                setattr(event, key, value)
        session.flush()
        return event


# ============================================================================
#  HABITS
# ============================================================================

_TOD_ORDER = {"morning": 0, "afternoon": 1, "evening": 2, "anytime": 3}


def get_habits(
    include_inactive: bool = False,
    time_of_day: Optional[str] = None,
) -> List[Habit]:
    """Return habits sorted by time_of_day (morning first)."""
    with get_session() as session:
        q = session.query(Habit)
        if not include_inactive:
            q = q.filter(Habit.is_active == True)
        if time_of_day:
            q = q.filter(Habit.time_of_day == time_of_day)
        habits = q.all()
        return sorted(habits, key=lambda h: _TOD_ORDER.get(h.time_of_day or "anytime", 3))


def create_habit(
    title: str,
    description: Optional[str] = None,
    frequency: str = "daily",
    target_days: Optional[str] = None,
    time_of_day: str = "anytime",
) -> Habit:
    with get_session() as session:
        habit = Habit(
            title=title,
            description=description,
            frequency=frequency,
            target_days=target_days,
            time_of_day=time_of_day,
        )
        session.add(habit)
        session.flush()
        return habit


def update_habit(habit_id: int, **fields) -> Habit:
    with get_session() as session:
        habit = session.query(Habit).filter(Habit.id == habit_id).first()
        if habit is None:
            raise ValueError(f"Habit {habit_id} not found.")
        for key, value in fields.items():
            if hasattr(habit, key):
                setattr(habit, key, value)
        session.flush()
        return habit


def archive_habit(habit_id: int) -> Habit:
    return update_habit(habit_id, is_active=False)


# ============================================================================
#  HABIT COMPLETIONS
# ============================================================================

def get_habit_completions_bulk(
    habit_ids: List[int],
    for_date: date,
) -> List[int]:
    """Return habit_ids that have a completion on for_date. Single query — no N+1."""
    if not habit_ids:
        return []
    with get_session() as session:
        rows = (
            session.query(HabitCompletion.habit_id)
            .filter(
                HabitCompletion.habit_id.in_(habit_ids),
                HabitCompletion.completed_date == for_date,
            )
            .all()
        )
        return [r.habit_id for r in rows]


def mark_habit_complete(
    habit_id: int,
    completed_date: date,
    note: Optional[str] = None,
) -> HabitCompletion:
    """Idempotent: returns the existing row if already logged for this date."""
    with get_session() as session:
        existing = session.query(HabitCompletion).filter(
            HabitCompletion.habit_id == habit_id,
            HabitCompletion.completed_date == completed_date,
        ).first()
        if existing:
            return existing
        completion = HabitCompletion(
            habit_id=habit_id,
            completed_date=completed_date,
            note=note,
        )
        session.add(completion)
        session.flush()
        _recalculate_streaks(session, habit_id)
        return completion


def unmark_habit_complete(habit_id: int, completed_date: date) -> bool:
    """Remove a habit completion. Returns True if a row was deleted, False if none existed."""
    with get_session() as session:
        completion = session.query(HabitCompletion).filter(
            HabitCompletion.habit_id == habit_id,
            HabitCompletion.completed_date == completed_date,
        ).first()
        if completion is None:
            return False
        session.delete(completion)
        session.flush()
        _recalculate_streaks(session, habit_id)
        return True


def get_habit_completions(
    habit_id: int,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
) -> List[HabitCompletion]:
    with get_session() as session:
        q = session.query(HabitCompletion).filter(
            HabitCompletion.habit_id == habit_id
        )
        if from_date:
            q = q.filter(HabitCompletion.completed_date >= from_date)
        if to_date:
            q = q.filter(HabitCompletion.completed_date <= to_date)
        return q.order_by(HabitCompletion.completed_date.desc()).all()


def _recalculate_streaks(session: Session, habit_id: int) -> None:
    """Update streak_current and streak_best, respecting habit frequency."""
    import json as _json

    habit = session.query(Habit).filter(Habit.id == habit_id).first()
    if habit is None:
        return

    rows = (
        session.query(HabitCompletion.completed_date)
        .filter(HabitCompletion.habit_id == habit_id)
        .all()
    )
    dates = sorted({r.completed_date for r in rows})

    if not dates:
        habit.streak_current = 0
        return

    today_ = date.today()
    freq   = habit.frequency or "daily"

    if freq == "weekly":
        # Streak counts consecutive calendar weeks with at least one completion.
        import calendar as _cal
        def _iso_week(d: date):
            return d.isocalendar()[:2]  # (year, week)

        weeks = sorted({_iso_week(d) for d in dates})
        if not weeks:
            habit.streak_current = 0
            return

        # Best streak: consecutive weeks
        best, run = 0, 1
        for i in range(1, len(weeks)):
            y1, w1 = weeks[i - 1]
            y2, w2 = weeks[i]
            # Weeks are consecutive if they are adjacent ISO weeks
            prev_end = date.fromisocalendar(y1, w1, 7)
            next_start = date.fromisocalendar(y2, w2, 1)
            if (next_start - prev_end).days == 1:
                run += 1
            else:
                run = 1
            best = max(best, run)
        best = max(best, 1)
        habit.streak_best = max(best, habit.streak_best or 0)

        # Current streak: must include this week or last week
        this_week = _iso_week(today_)
        last_week_date = today_ - timedelta(days=7)
        last_week = _iso_week(last_week_date)
        if weeks[-1] not in (this_week, last_week):
            habit.streak_current = 0
            return
        current = 1
        for i in range(len(weeks) - 2, -1, -1):
            y1, w1 = weeks[i]
            y2, w2 = weeks[i + 1]
            prev_end   = date.fromisocalendar(y1, w1, 7)
            next_start = date.fromisocalendar(y2, w2, 1)
            if (next_start - prev_end).days == 1:
                current += 1
            else:
                break
        habit.streak_current = current
        return

    if freq == "weekdays":
        # Only Mon–Fri count; skip Sat/Sun.
        def _prev_weekday(d: date) -> date:
            d = d - timedelta(days=1)
            while d.weekday() >= 5:  # 5=Sat, 6=Sun
                d = d - timedelta(days=1)
            return d

        weekday_dates = sorted({d for d in dates if d.weekday() < 5})
        if not weekday_dates:
            habit.streak_current = 0
            return

        today_wd = today_
        if today_wd.weekday() >= 5:
            # Today is weekend — check last Friday
            while today_wd.weekday() >= 5:
                today_wd = today_wd - timedelta(days=1)
        yesterday_wd = _prev_weekday(today_wd)

        if weekday_dates[-1] < yesterday_wd:
            habit.streak_current = 0
        else:
            current = 0
            expected = weekday_dates[-1]
            for d in reversed(weekday_dates):
                if d == expected:
                    current += 1
                    expected = _prev_weekday(expected)
                else:
                    break
            habit.streak_current = current

        # Best streak over weekdays
        best, run, prev = 0, 0, None
        for d in weekday_dates:
            if prev is None or d == prev + timedelta(days=1) or (
                d.weekday() == 0 and prev.weekday() == 4 and (d - prev).days == 3
            ):
                run += 1
            else:
                run = 1
            best = max(best, run)
            prev = d
        habit.streak_best = max(best, habit.streak_best or 0)
        return

    # Default: daily (also used for custom as a safe fallback)
    today_d    = today_
    yesterday  = today_d - timedelta(days=1)

    if dates[-1] < yesterday:
        habit.streak_current = 0
    else:
        current  = 0
        expected = dates[-1]
        for d in reversed(dates):
            if d == expected:
                current += 1
                expected = expected - timedelta(days=1)
            else:
                break
        habit.streak_current = current

    best, run, prev = 0, 0, None
    for d in dates:
        if prev is None or d == prev + timedelta(days=1):
            run += 1
        else:
            run = 1
        best = max(best, run)
        prev = d
    habit.streak_best = max(best, habit.streak_best or 0)


# ============================================================================
#  AI CONVERSATION HISTORY
# ============================================================================

def add_message(
    session_id: str,
    role: str,
    content: Optional[str] = None,
    tool_name: Optional[str] = None,
    token_count: Optional[int] = None,
) -> AIConversationHistory:
    with get_session() as session:
        msg = AIConversationHistory(
            session_id=session_id,
            role=role,
            content=content,
            tool_name=tool_name,
            token_count=token_count,
        )
        session.add(msg)
        session.flush()
        return msg


def get_conversation(
    session_id: str,
    limit: Optional[int] = None,
) -> List[AIConversationHistory]:
    with get_session() as session:
        q = (
            session.query(AIConversationHistory)
            .filter(AIConversationHistory.session_id == session_id)
            .order_by(AIConversationHistory.created_at.asc())
        )
        if limit:
            q = q.limit(limit)
        return q.all()


def get_sessions() -> List[dict]:
    """Return sessions that have at least one completed assistant response, most recent first."""
    from sqlalchemy import func
    with get_session() as session:
        valid_ids = {
            r.session_id for r in session.query(AIConversationHistory.session_id)
            .filter(
                AIConversationHistory.role == 'assistant',
                AIConversationHistory.tool_name.is_(None),
                AIConversationHistory.content.isnot(None),
            ).distinct().all()
        }
        if not valid_ids:
            return []

        stats = (
            session.query(
                AIConversationHistory.session_id,
                func.count(AIConversationHistory.id).label('message_count'),
                func.max(AIConversationHistory.created_at).label('updated_at'),
            )
            .filter(AIConversationHistory.session_id.in_(valid_ids))
            .group_by(AIConversationHistory.session_id)
            .order_by(func.max(AIConversationHistory.created_at).desc())
            .all()
        )

        results = []
        for stat in stats:
            first_user = (
                session.query(AIConversationHistory)
                .filter(
                    AIConversationHistory.session_id == stat.session_id,
                    AIConversationHistory.role == 'user',
                    AIConversationHistory.content.isnot(None),
                )
                .order_by(AIConversationHistory.created_at.asc())
                .first()
            )
            results.append({
                'session_id': stat.session_id,
                'last_message': (first_user.content or '')[:60] if first_user else '',
                'message_count': stat.message_count,
                'updated_at': stat.updated_at.isoformat() if stat.updated_at else None,
            })
        return results


# ============================================================================
#  ADMIN / STATS
# ============================================================================

def get_analytics_stats() -> dict:
    """
    Return rich aggregated analytics data for the Analytics page.

    Covers: task stats (weekly trend, priority, tags), habit stats (30-day
    completion rate, streaks, best day), goal stats (status + progress
    distribution), and calendar stats (by type, busiest hours/days).
    """
    today = date.today()

    with get_session() as session:
        # ---- TASK STATS ----
        all_tasks = session.query(Task).filter(Task.deleted_at.is_(None)).all()
        task_total = len(all_tasks)
        task_completed = sum(1 for t in all_tasks if t.status == "done")
        task_in_progress = sum(1 for t in all_tasks if t.status == "in_progress")
        task_todo = sum(1 for t in all_tasks if t.status == "todo")
        task_overdue = sum(
            1 for t in all_tasks
            if t.due_date and t.due_date < today and t.status != "done"
        )

        # Completion by week — last 8 complete weeks (Mon → Sun)
        completion_by_week = []
        for i in range(7, -1, -1):
            week_start = today - timedelta(days=today.weekday()) - timedelta(weeks=i)
            week_end = week_start + timedelta(days=6)
            week_tasks = [
                t for t in all_tasks
                if t.created_at and week_start <= t.created_at.date() <= week_end
            ]
            week_done = sum(1 for t in week_tasks if t.status == "done")
            completion_by_week.append({
                "week": week_start.strftime("%b %d"),
                "total": len(week_tasks),
                "completed": week_done,
                "rate": round((week_done / len(week_tasks) * 100) if week_tasks else 0, 1),
            })

        # Avg completion time: created_at → updated_at for done tasks
        done_tasks_timed = [
            t for t in all_tasks
            if t.status == "done" and t.created_at and t.updated_at
        ]
        if done_tasks_timed:
            total_secs = sum(
                (t.updated_at - t.created_at).total_seconds() for t in done_tasks_timed
            )
            avg_completion_hours = round(total_secs / len(done_tasks_timed) / 3600, 1)
        else:
            avg_completion_hours = 0.0

        # Priority breakdown
        priority_breakdown = {}  # type: dict
        for t in all_tasks:
            p = t.priority or "medium"
            priority_breakdown[p] = priority_breakdown.get(p, 0) + 1

        # Tag breakdown
        tag_breakdown = {}  # type: dict
        for t in all_tasks:
            if t.tags:
                for tag in [x.strip() for x in t.tags.split(",") if x.strip()]:
                    tag_breakdown[tag] = tag_breakdown.get(tag, 0) + 1

        # ---- HABIT STATS ----
        habits = session.query(Habit).filter(Habit.is_active == True).all()
        period_start = today - timedelta(days=29)  # last 30 days inclusive
        habit_stats = []
        dow_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        for habit in habits:
            completions = (
                session.query(HabitCompletion)
                .filter(
                    HabitCompletion.habit_id == habit.id,
                    HabitCompletion.completed_date >= period_start,
                    HabitCompletion.completed_date <= today,
                )
                .all()
            )
            completed_days = {c.completed_date for c in completions}
            dow_counts = {}  # type: dict
            for c in completions:
                dow = c.completed_date.weekday()
                dow_counts[dow] = dow_counts.get(dow, 0) + 1
            best_dow = max(dow_counts, key=lambda k: dow_counts[k]) if dow_counts else None
            habit_stats.append({
                "id": habit.id,
                "title": habit.title,
                "completion_rate_30d": round(len(completed_days) / 30 * 100, 1),
                "completions_30d": len(completed_days),
                "streak_current": habit.streak_current or 0,
                "streak_best": habit.streak_best or 0,
                "best_day_of_week": dow_names[best_dow] if best_dow is not None else None,
            })

        # ---- GOAL STATS ----
        all_goals = session.query(Goal).filter(Goal.deleted_at.is_(None)).all()
        goal_total = len(all_goals)
        goal_completed = sum(1 for g in all_goals if g.status == "completed")
        goal_in_progress = sum(1 for g in all_goals if g.status == "active")
        goal_paused = sum(1 for g in all_goals if g.status == "paused")
        avg_progress = (
            round(sum(g.progress_pct or 0 for g in all_goals) / goal_total, 1)
            if goal_total else 0.0
        )
        progress_distribution = {"0-25": 0, "26-50": 0, "51-75": 0, "76-100": 0}
        for g in all_goals:
            pct = g.progress_pct or 0
            if pct <= 25:
                progress_distribution["0-25"] += 1
            elif pct <= 50:
                progress_distribution["26-50"] += 1
            elif pct <= 75:
                progress_distribution["51-75"] += 1
            else:
                progress_distribution["76-100"] += 1

        # ---- CALENDAR STATS ----
        events = session.query(CalendarEvent).filter(CalendarEvent.deleted_at.is_(None)).all()
        event_by_type = {}  # type: dict
        for e in events:
            et = e.event_type or "personal"
            event_by_type[et] = event_by_type.get(et, 0) + 1

        day_counts_cal = {i: 0 for i in range(7)}
        hour_counts_cal = {i: 0 for i in range(24)}
        for e in events:
            if e.start_datetime:
                day_counts_cal[e.start_datetime.weekday()] += 1
                hour_counts_cal[e.start_datetime.hour] += 1

        cal_dow_labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        busiest_days = [
            {"day": cal_dow_labels[i], "count": day_counts_cal[i]} for i in range(7)
        ]
        busiest_hours = [
            {"hour": i, "count": hour_counts_cal[i]} for i in range(24)
        ]

        return {
            "tasks": {
                "total": task_total,
                "completed": task_completed,
                "in_progress": task_in_progress,
                "todo": task_todo,
                "cancelled": 0,  # Deprecated: cancelled status removed, tasks are deleted instead
                "overdue": task_overdue,
                "completion_rate": round(task_completed / task_total * 100, 1) if task_total else 0.0,
                "completion_by_week": completion_by_week,
                "avg_completion_hours": avg_completion_hours,
                "priority_breakdown": priority_breakdown,
                "tag_breakdown": tag_breakdown,
            },
            "habits": {
                "habits": habit_stats,
                "total_active": len(habits),
            },
            "goals": {
                "total": goal_total,
                "completed": goal_completed,
                "in_progress": goal_in_progress,
                "paused": goal_paused,
                "avg_progress_pct": avg_progress,
                "progress_distribution": progress_distribution,
            },
            "calendar": {
                "total_events": len(events),
                "by_type": event_by_type,
                "busiest_days": busiest_days,
                "busiest_hours": busiest_hours,
            },
        }


def get_db_stats() -> dict:
    """Return total and active row counts for every table."""
    with get_session() as session:
        return {
            "tasks_total": session.query(Task).count(),
            "tasks_active": session.query(Task).filter(Task.deleted_at.is_(None)).count(),
            "goals_total": session.query(Goal).count(),
            "goals_active": session.query(Goal).filter(Goal.deleted_at.is_(None)).count(),
            "habits_total": session.query(Habit).count(),
            "habits_active": session.query(Habit).filter(Habit.is_active == True).count(),
            "habit_completions": session.query(HabitCompletion).count(),
            "events_total": session.query(CalendarEvent).count(),
            "events_active": (
                session.query(CalendarEvent)
                .filter(CalendarEvent.deleted_at.is_(None))
                .count()
            ),
            "ai_messages": session.query(AIConversationHistory).count(),
        }


def clear_all_data() -> dict:
    """
    Hard-delete every row from every table. Irreversible.

    Returns a dict with the number of rows deleted per table.
    Deletes in FK-safe order (dependents first).
    """
    with get_session() as session:
        counts = {
            "ai_messages": session.query(AIConversationHistory).delete(
                synchronize_session=False
            ),
            "habit_completions": session.query(HabitCompletion).delete(
                synchronize_session=False
            ),
            "calendar_events": session.query(CalendarEvent).delete(
                synchronize_session=False
            ),
            "tasks": session.query(Task).delete(synchronize_session=False),
            "habits": session.query(Habit).delete(synchronize_session=False),
            "goals": session.query(Goal).delete(synchronize_session=False),
        }
        session.flush()
    return counts


# ============================================================================
#  USER PREFERENCES
# ============================================================================

def get_preferences() -> dict:
    """Return all preferences as {key: value}."""
    with get_session() as session:
        rows = session.query(UserPreferences).all()
        return {r.key: r.value for r in rows}


def get_preference(key: str, default: Optional[str] = None) -> Optional[str]:
    """Return a single preference value, or *default* if not set."""
    with get_session() as session:
        row = session.query(UserPreferences).filter(UserPreferences.key == key).first()
        return row.value if row else default


def set_preference(key: str, value: str) -> UserPreferences:
    """Upsert a preference row."""
    with get_session() as session:
        row = session.query(UserPreferences).filter(UserPreferences.key == key).first()
        if row:
            row.value      = value
            row.updated_at = datetime.utcnow()
        else:
            row = UserPreferences(key=key, value=value)
            session.add(row)
        session.flush()
        return row


# ---------------------------------------------------------------------------
#  Atomic scheduling operations
# ---------------------------------------------------------------------------

def schedule_task(
    task_id: int,
    start_datetime: datetime,
    end_datetime: datetime,
) -> tuple:
    """
    Atomically schedule a task: update task status + create calendar event.
    Returns (task, event) tuple. Rolls back both if either fails.
    """
    with get_session() as session:
        task = session.query(Task).filter(
            Task.id == task_id,
            Task.deleted_at.is_(None),
        ).first()
        if task is None:
            raise ValueError(f"Task {task_id} not found or deleted.")

        # Update task
        task.status = "scheduled"
        task.scheduled_at = start_datetime
        task.updated_at = datetime.utcnow()

        # Create calendar event
        event = CalendarEvent(
            title=task.title,
            start_datetime=start_datetime,
            end_datetime=end_datetime,
            event_type="task_block",
            task_id=task_id,
            source="local",
            is_read_only=False,
            sync_stale=False,
            is_recurring=False,
        )
        session.add(event)
        session.flush()

        if task.project_id:
            _recalculate_goal_progress(session, task.project_id)

        return (task, event)


def unschedule_task(task_id: int) -> tuple:
    """
    Atomically unschedule a task: delete task_block events + reset task status.
    Returns (task, deleted_event_ids) tuple.
    """
    with get_session() as session:
        task = session.query(Task).filter(
            Task.id == task_id,
            Task.deleted_at.is_(None),
        ).first()
        if task is None:
            raise ValueError(f"Task {task_id} not found or deleted.")

        # Soft-delete all task_block events for this task
        events = session.query(CalendarEvent).filter(
            CalendarEvent.task_id == task_id,
            CalendarEvent.event_type == "task_block",
            CalendarEvent.deleted_at.is_(None),
        ).all()
        deleted_ids = []
        for event in events:
            event.deleted_at = datetime.utcnow()
            deleted_ids.append(event.id)

        # Reset task
        task.status = "todo"
        task.scheduled_at = None
        task.updated_at = datetime.utcnow()
        session.flush()

        if task.project_id:
            _recalculate_goal_progress(session, task.project_id)

        return (task, deleted_ids)


def schedule_task_batch(
    items: list,
) -> list:
    """
    Atomically schedule multiple tasks. Each item is (task_id, start_datetime, end_datetime).
    Returns list of (task, event) tuples. All or nothing.
    """
    with get_session() as session:
        results = []
        for task_id, start_dt, end_dt in items:
            task = session.query(Task).filter(
                Task.id == task_id,
                Task.deleted_at.is_(None),
            ).first()
            if task is None:
                raise ValueError(f"Task {task_id} not found or deleted.")

            task.status = "scheduled"
            task.scheduled_at = start_dt
            task.updated_at = datetime.utcnow()

            event = CalendarEvent(
                title=task.title,
                start_datetime=start_dt,
                end_datetime=end_dt,
                event_type="task_block",
                task_id=task_id,
                source="local",
                is_read_only=False,
                sync_stale=False,
                is_recurring=False,
            )
            session.add(event)
            session.flush()

            if task.project_id:
                _recalculate_goal_progress(session, task.project_id)

            results.append((task, event))
        return results
