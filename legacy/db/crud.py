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

from datetime import date, datetime
from typing import List, Optional

from sqlalchemy.orm import Session

from db.schema import (
    AIConversationHistory,
    CalendarEvent,
    Goal,
    Habit,
    HabitCompletion,
    Task,
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


def update_task(
    task_id: int,
    current_updated_at: Optional[datetime] = None,
    **fields,
) -> Task:
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
    """Update streak_current and streak_best on the Habit row."""
    habit = session.query(Habit).filter(Habit.id == habit_id).first()
    if habit is None:
        return

    rows = (
        session.query(HabitCompletion.completed_date)
        .filter(HabitCompletion.habit_id == habit_id)
        .all()
    )
    dates = sorted({r.completed_date for r in rows}, reverse=True)

    if not dates:
        habit.streak_current = 0
        return

    today = date.today()
    yesterday = date.fromordinal(today.toordinal() - 1)

    # Current streak: must start from today or yesterday
    if dates[0] < yesterday:
        habit.streak_current = 0
    else:
        current = 0
        expected = dates[0]
        for d in dates:
            if d == expected:
                current += 1
                expected = date.fromordinal(expected.toordinal() - 1)
            else:
                break
        habit.streak_current = current

    # Best streak: scan all dates in ascending order
    best, run, prev = 0, 0, None
    for d in sorted(dates):
        if prev is None or d == date.fromordinal(prev.toordinal() + 1):
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


def get_sessions() -> List[str]:
    """Return distinct session IDs, most recent first."""
    with get_session() as session:
        rows = (
            session.query(AIConversationHistory.session_id)
            .distinct()
            .order_by(AIConversationHistory.created_at.desc())
            .all()
        )
        return [r.session_id for r in rows]


# ============================================================================
#  ADMIN / STATS
# ============================================================================

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
