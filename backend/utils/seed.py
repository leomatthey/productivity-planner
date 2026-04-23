"""
utils/seed.py — Demo-grade seed data for the Productivity Planner.

`seed_demo_data(reset=True)` wipes all local data (preserving Google-synced
events and user preferences) and repopulates the DB with a realistic dataset
shaped to showcase every feature of the app on first load:

- 7 projects (5 top-level + 2 subprojects) with colours.
- ~35 tasks across todo / in_progress / scheduled / done with historical
  timestamps distributed over the last 8 weeks (feeds the trend chart and
  velocity calculations).
- 4 habits with 30 days of completion history shaped to expose both a
  healthy pattern and a slipping pattern (feeds the habit-rate chart and
  the LLM "consistency dropped" insight).
- Local calendar events (meetings, personal, reminders) and task_block
  events, all scheduled in free slots that don't conflict with any
  existing Google Calendar events.
- Default work-hour preferences (only if not already set).

The `reset=False` path is a backwards-compatible no-op when the DB already
has data — matching the original `seed_database()` first-run behaviour.
"""

from __future__ import annotations

import random
from datetime import date, datetime, time as time_, timedelta
from typing import Dict, Optional

from db import crud
from db.schema import (
    CalendarEvent, Goal, Habit, HabitCompletion, Task, get_session,
)
from utils.scheduling import find_free_slots
from utils.tz import from_user_naive


# ---------------------------------------------------------------------------
#  Reset — hard-delete local data, preserve Google events + preferences
# ---------------------------------------------------------------------------

def _reset_local_data() -> None:
    """Wipe tasks, goals, habits, habit completions, and local events.

    Order respects FK references (child rows first). User preferences
    and Google-synced events (source='google') are preserved.
    """
    with get_session() as session:
        # Habit completions → habits
        session.query(HabitCompletion).delete(synchronize_session=False)
        session.query(Habit).delete(synchronize_session=False)

        # Local calendar events (keep Google-synced)
        session.query(CalendarEvent).filter(
            CalendarEvent.source == "local"
        ).delete(synchronize_session=False)

        # Tasks → goals. Tasks first because they reference goals.
        session.query(Task).delete(synchronize_session=False)

        # Goal children first (self-referential FK), then parents.
        session.query(Goal).filter(Goal.parent_id.isnot(None)).delete(synchronize_session=False)
        session.query(Goal).delete(synchronize_session=False)


def _tables_empty() -> bool:
    return (
        len(crud.get_tasks()) == 0
        and len(crud.get_goals()) == 0
        and len(crud.get_habits(include_inactive=True)) == 0
    )


# ---------------------------------------------------------------------------
#  Helpers
# ---------------------------------------------------------------------------

def _backdate_task(task_id: int, created_at: datetime, updated_at: datetime) -> None:
    """Override the auto-stamped created_at / updated_at on a task.

    Needed for historical tasks so the 8-week trend chart and 4-week
    velocity calculations have realistic distributions.
    """
    with get_session() as session:
        t = session.query(Task).filter(Task.id == task_id).first()
        if t is not None:
            t.created_at = created_at
            t.updated_at = updated_at


def _is_slot_free(start_dt: datetime, end_dt: datetime) -> bool:
    """True when no existing (Google or local) event overlaps [start, end)."""
    for e in crud.get_events(include_stale=True):
        if e.start_datetime < end_dt and e.end_datetime > start_dt:
            return False
    return True


def _try_create_local_event(
    title: str,
    day_offset: int,
    start_hour: int,
    duration_min: int,
    event_type: str,
    location: Optional[str] = None,
    description: Optional[str] = None,
    today: Optional[date] = None,
) -> bool:
    """Create a local event at a fixed local time if the slot is free.

    Returns True if created; False if the slot was busy (Google event there,
    already-placed seed event, etc.) — seed silently skips conflicts.
    """
    if today is None:
        today = date.today()
    day = today + timedelta(days=day_offset)
    start_local = datetime.combine(day, time_(start_hour, 0))
    end_local   = start_local + timedelta(minutes=duration_min)
    start_utc = from_user_naive(start_local)
    end_utc   = from_user_naive(end_local)
    if not _is_slot_free(start_utc, end_utc):
        return False
    crud.create_event(
        title=title,
        start_datetime=start_utc,
        end_datetime=end_utc,
        event_type=event_type,
        location=location,
        description=description,
    )
    return True


# ---------------------------------------------------------------------------
#  Public entry point
# ---------------------------------------------------------------------------

def seed_demo_data(reset: bool = False) -> Dict:
    """Populate the database with demo-grade sample data.

    reset=True  → wipe local data first (preserves Google events + prefs).
    reset=False → no-op if the DB already has tasks/goals/habits.
    """
    if reset:
        _reset_local_data()
    elif not _tables_empty():
        return {
            "skipped": True,
            "reason": "Database already contains data. Pass reset=true to replace.",
        }

    random.seed(42)  # deterministic seed output for reproducible demos
    today = date.today()
    counts = {
        "tasks": 0, "goals": 0, "habits": 0,
        "habit_completions": 0, "events": 0, "scheduled_blocks": 0,
    }

    # ─────────── Projects ───────────
    goal_miba = crud.create_goal(
        title="Master's — MiBA",
        description="MBA in Business Analytics at ESADE — coursework, thesis, and capstone submissions.",
        status="active",
        target_date=today + timedelta(days=45),
        progress_mode="auto",
        color="#EF4444",
    ); counts["goals"] += 1

    goal_pdai = crud.create_goal(
        title="PDAI — Planner App",
        description="Prototyping with Data & AI — the app you're looking at right now.",
        status="active",
        target_date=today + timedelta(days=7),
        progress_mode="auto",
        parent_id=goal_miba.id,
    ); counts["goals"] += 1

    goal_twd = crud.create_goal(
        title="Thinking with Data — Final",
        description="Final group project: data analysis deliverable.",
        status="active",
        target_date=today + timedelta(days=28),
        progress_mode="auto",
        parent_id=goal_miba.id,
    ); counts["goals"] += 1

    goal_career = crud.create_goal(
        title="Career Pipeline",
        description="Interviews, applications, portfolio updates.",
        status="active",
        target_date=today + timedelta(days=60),
        progress_mode="auto",
        color="#4F46E5",
    ); counts["goals"] += 1

    goal_health = crud.create_goal(
        title="Health & Fitness",
        description="Consistent training, nutrition, sleep hygiene.",
        status="active",
        target_date=today + timedelta(days=90),
        progress_mode="auto",
        color="#10B981",
    ); counts["goals"] += 1

    goal_spanish = crud.create_goal(
        title="Learn Spanish — B1",
        description="Daily drills, weekly tutor, reach B1 this year.",
        status="active",
        target_date=today + timedelta(days=180),
        progress_mode="manual",
        progress_pct=30,
        color="#F59E0B",
    ); counts["goals"] += 1

    goal_reading = crud.create_goal(
        title="Reading 2026",
        description="12 books — one per month, fiction + non-fiction.",
        status="active",
        target_date=date(today.year, 12, 31),
        progress_mode="manual",
        progress_pct=42,
        color="#8B5CF6",
    ); counts["goals"] += 1

    # ─────────── Historical completed tasks (trend chart + velocity) ───────────
    historical = [
        ("Literature review draft",          goal_twd.id,    "high",   180),
        ("First data cleaning pass",         goal_twd.id,    "medium", 120),
        ("EDA notebook",                     goal_twd.id,    "medium", 150),
        ("Set up model baseline",            goal_twd.id,    "medium", 90),
        ("Thesis outline — v1",              goal_twd.id,    "medium", 60),
        ("Review MLP decks for career fair", goal_career.id, "high",   60),
        ("Mock interview — case",            goal_career.id, "high",   90),
        ("Update portfolio site",            goal_career.id, "low",    60),
        ("Research target companies",        goal_career.id, "medium", 45),
        ("Rewrite CV",                       goal_career.id, "medium", 90),
        ("Strength: squats PR attempt",      goal_health.id, "medium", 75),
        ("Nutrition plan refresh",           goal_health.id, "low",    60),
        ("Spanish — week 3 lesson",          goal_spanish.id,"low",    60),
        ("Spanish — week 4 lesson",          goal_spanish.id,"low",    60),
        ("Finished 'Deep Work'",             goal_reading.id,"low",    30),
        ("PDAI sprint 1 — scaffolding",      goal_pdai.id,   "high",   180),
        ("PDAI — agent tool wiring",         goal_pdai.id,   "high",   120),
        ("PDAI — timezone boundary fix",     goal_pdai.id,   "urgent", 90),
    ]

    for title, project_id, priority, minutes in historical:
        # Spread completions across the last 6 weeks, weighted toward recent.
        # A ~45% chunk lands in the last 4 weeks → non-zero velocity per project.
        if random.random() < 0.45:
            completed_days_ago = random.randint(1, 27)   # within last 4 weeks
        else:
            completed_days_ago = random.randint(28, 55)  # weeks 4-8
        created_days_ago = completed_days_ago + random.randint(1, 7)

        created_at = datetime.combine(today - timedelta(days=created_days_ago), time_(9, 0))
        updated_at = datetime.combine(today - timedelta(days=completed_days_ago), time_(17, 0))

        t = crud.create_task(
            title=title, status="done", priority=priority,
            project_id=project_id, estimated_minutes=minutes,
            energy_level=random.choice(["low", "medium", "high"]),
            due_date=today - timedelta(days=completed_days_ago),
        )
        _backdate_task(t.id, created_at, updated_at)
        counts["tasks"] += 1

    # ─────────── Current tasks — varied statuses ───────────
    # Overdue (Dashboard banner)
    for title, pid, pr, mins, days in [
        ("Refactor streaks algorithm",           goal_pdai.id,   "urgent", 60, 3),
        ("Submit TWD abstract draft",            goal_twd.id,    "high",   90, 2),
        ("Reply to BCG recruiter (follow-up)",   goal_career.id, "medium", 20, 5),
    ]:
        crud.create_task(
            title=title, status="todo", priority=pr,
            due_date=today - timedelta(days=days),
            project_id=pid, estimated_minutes=mins, energy_level="medium",
        )
        counts["tasks"] += 1

    # In progress
    for title, pid, pr, mins, due in [
        ("Ship analytics page polish",   goal_pdai.id,   "urgent", 90, 1),
        ("Draft 'model limitations' section", goal_twd.id, "high", 120, 4),
        ("Finalise BCG case prep deck",  goal_career.id, "high",   60, 3),
    ]:
        crud.create_task(
            title=title, status="in_progress", priority=pr,
            project_id=pid, due_date=today + timedelta(days=due),
            estimated_minutes=mins, energy_level="high",
        )
        counts["tasks"] += 1

    # One task directly on parent project (showcase "direct / aggregated" counts)
    crud.create_task(
        title="MiBA retrospective note (for thesis appendix)",
        status="todo", priority="low",
        project_id=goal_miba.id, estimated_minutes=30,
        energy_level="low", due_date=today + timedelta(days=35),
    ); counts["tasks"] += 1

    # Loose todo tasks
    for title, pid, pr, mins, due in [
        ("Renew gym membership",                 goal_health.id,  "low",    15, 7),
        ("Read 'Thinking in Systems' ch 3-5",    goal_reading.id, "low",    90, 14),
        ("Duolingo — keep the streak",           goal_spanish.id, "low",    20, 1),
        ("Dashboard greeting copy rewrite",      goal_pdai.id,    "low",    15, 5),
        ("Book mechanic appointment",            None,            "low",    15, 6),
        ("Send thank-you notes from career fair",goal_career.id,  "medium", 30, 4),
    ]:
        crud.create_task(
            title=title, status="todo", priority=pr,
            project_id=pid, estimated_minutes=mins,
            energy_level="low" if mins < 30 else "medium",
            due_date=today + timedelta(days=due),
        )
        counts["tasks"] += 1

    # ─────────── Habits ───────────
    habit_exercise = crud.create_habit(
        title="Morning exercise",
        description="30 minutes — gym, run, or cycle.",
        frequency="daily", time_of_day="morning",
    )
    habit_reading = crud.create_habit(
        title="Daily reading",
        description="20–30 min before bed.",
        frequency="daily", time_of_day="evening",
    )
    habit_meditate = crud.create_habit(
        title="Meditate",
        description="10 min mindfulness — right after coffee.",
        frequency="daily", time_of_day="morning",
    )
    habit_review = crud.create_habit(
        title="Weekly review",
        description="Plan the week ahead on Sunday evening.",
        frequency="weekly", target_days="[6]", time_of_day="evening",
    )
    counts["habits"] = 4

    # Completion history — 30 days back, shaped for analytics variety.
    for days_back in range(30):
        d = today - timedelta(days=days_back)
        # Exercise: high consistency (~90%).
        if random.random() < 0.90:
            crud.mark_habit_complete(habit_exercise.id, d)
            counts["habit_completions"] += 1
        # Reading: moderate (~70%).
        if random.random() < 0.70:
            crud.mark_habit_complete(habit_reading.id, d)
            counts["habit_completions"] += 1
        # Meditate: SLIPPING — 80% weeks ago, 30% in last 7 days.
        rate = 0.30 if days_back < 7 else 0.80
        if random.random() < rate:
            crud.mark_habit_complete(habit_meditate.id, d)
            counts["habit_completions"] += 1
        # Weekly review: only on Sundays (weekday 6), consistently.
        if d.weekday() == 6:
            crud.mark_habit_complete(habit_review.id, d)
            counts["habit_completions"] += 1

    # ─────────── Local calendar events (conflict-free with Google) ───────────
    event_specs = [
        # title, day_offset, start_hour (local), duration_min, type, location, description
        ("Spanish tutor",             -3, 18, 60, "personal", "Zoom", None),
        ("Thesis advisor check-in",   -1, 11, 30, "meeting",  "HT-312", "Chapter 2 review"),
        ("Gym — legs day",             0,  7, 60, "personal", None, None),
        ("Advisor sync",               1, 11, 30, "meeting",  "HT-312", None),
        ("Career coaching call",       2, 16, 45, "meeting",  "Zoom", None),
        ("Lunch with Alex",            3, 13, 60, "personal", "Brunch & Cake", None),
        ("BCG virtual open day",       5, 14, 120,"meeting",  "Virtual", None),
        ("PDAI submission deadline",   7, 23, 30, "reminder", None, "Final submission cutoff — don't miss."),
        ("Thesis full-chapter review", 10,10, 60, "meeting",  "HT-312", None),
        ("Spanish tutor",              4, 18, 60, "personal", "Zoom", None),
    ]
    for spec in event_specs:
        if _try_create_local_event(*spec, today=today):
            counts["events"] += 1

    # ─────────── This-week scheduled tasks (with atomic task_block events) ───────────
    scheduled_specs = [
        # title, project_id, priority, minutes, day_offset (from today)
        ("PDAI: write submission README",     goal_pdai.id,    "urgent", 45, 0),
        ("Deep work: thesis chapter 2",       goal_twd.id,     "high",   120,2),
        ("BCG case prep — M&A",               goal_career.id,  "high",   90, 3),
        ("Strength training session",         goal_health.id,  "medium", 60, 1),
        ("Spanish: grammar drill",            goal_spanish.id, "low",    30, 4),
    ]
    for title, pid, pr, mins, day_offset in scheduled_specs:
        t = crud.create_task(
            title=title, status="todo", priority=pr,
            project_id=pid, estimated_minutes=mins,
            energy_level="high" if mins > 60 else "medium",
            due_date=today + timedelta(days=day_offset + 1),
        )
        counts["tasks"] += 1

        target = today + timedelta(days=max(0, day_offset))
        slots = find_free_slots(target, mins, 9, 18)
        if slots:
            slot = slots[0]
            try:
                crud.schedule_task(t.id, slot["start"], slot["end"])
                counts["scheduled_blocks"] += 1
                counts["events"] += 1  # task_block event auto-created
            except Exception:
                pass  # slot taken between fetch and write; task stays todo

    # ─────────── Preferences (only if unset) ───────────
    if crud.get_preference("work_start_hour") is None:
        crud.set_preference("work_start_hour", "9")
    if crud.get_preference("work_end_hour") is None:
        crud.set_preference("work_end_hour", "18")
    if crud.get_preference("schedule_buffer_minutes") is None:
        crud.set_preference("schedule_buffer_minutes", "15")

    return counts


# ---------------------------------------------------------------------------
#  Backward compatibility
# ---------------------------------------------------------------------------

def seed_database(force: bool = False) -> Dict:
    """Back-compat shim for the old name. Prefer `seed_demo_data(reset=...)`."""
    return seed_demo_data(reset=force)
