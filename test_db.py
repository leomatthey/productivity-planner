"""
Phase 1 smoke test: insert one row into every table, read it back,
soft-delete where applicable, and verify the row disappears from default queries.

Run from the project root:
    python test_db.py
"""

import sys
import os
from datetime import datetime, date, timedelta

sys.path.insert(0, os.path.dirname(__file__))

from db.schema import db_init
from db import crud


# ---------------------------------------------------------------------------
#  Test runner
# ---------------------------------------------------------------------------

_results: list[bool] = []


def test(name: str):
    """Decorator: catch exceptions, print PASS / FAIL, record result."""
    def decorator(fn):
        def wrapper():
            try:
                fn()
                print(f"  [PASS] {name}")
                _results.append(True)
            except Exception as exc:
                print(f"  [FAIL] {name}")
                print(f"         {type(exc).__name__}: {exc}")
                _results.append(False)
        return wrapper
    return decorator


# ---------------------------------------------------------------------------
#  Individual table tests
# ---------------------------------------------------------------------------

@test("Tasks — create / read / update (optimistic lock) / soft-delete")
def test_tasks():
    task = crud.create_task(
        title="Buy groceries",
        description="Milk, eggs, bread",
        priority="high",
        due_date=date.today(),
        estimated_minutes=30,
        energy_level="low",
        tags="errands,personal",
    )
    assert task.id is not None, "task.id should be set after insert"
    assert task.status == "todo"

    # Read back — must appear in default query
    tasks = crud.get_tasks()
    assert any(t.id == task.id for t in tasks), "task should be visible in get_tasks()"

    # Update with optimistic lock (should succeed)
    updated = crud.update_task(task.id, current_updated_at=task.updated_at, status="done")
    assert updated.status == "done"

    # Soft-delete
    deleted = crud.delete_task(task.id)
    assert deleted.deleted_at is not None, "deleted_at should be set"

    # Must NOT appear in default query after soft-delete
    tasks_after = crud.get_tasks()
    assert not any(t.id == task.id for t in tasks_after), \
        "soft-deleted task should be hidden from get_tasks()"

    # Must appear when include_deleted=True
    all_tasks = crud.get_tasks(include_deleted=True)
    assert any(t.id == task.id for t in all_tasks), \
        "soft-deleted task should be visible with include_deleted=True"


@test("Goals — create / read / update (optimistic lock) / soft-delete")
def test_goals():
    goal = crud.create_goal(
        title="Launch MVP",
        description="Ship v1 to first users",
        target_date=date.today() + timedelta(days=60),
        progress_mode="manual",
        progress_pct=10,
    )
    assert goal.id is not None

    goals = crud.get_goals()
    assert any(g.id == goal.id for g in goals)

    updated = crud.update_goal(goal.id, current_updated_at=goal.updated_at, status="paused")
    assert updated.status == "paused"

    deleted = crud.delete_goal(goal.id)
    assert deleted.deleted_at is not None

    goals_after = crud.get_goals()
    assert not any(g.id == goal.id for g in goals_after), \
        "soft-deleted goal should be hidden"


@test("Goals — auto progress recalculates from linked tasks")
def test_goal_auto_progress():
    goal = crud.create_goal(title="Auto-progress goal", progress_mode="auto")

    t1 = crud.create_task(title="Sub-task 1", project_id=goal.id)
    t2 = crud.create_task(title="Sub-task 2", project_id=goal.id)

    # Mark one of two tasks done; progress should become 50
    crud.update_task(t1.id, status="done")

    goals = crud.get_goals()
    refreshed = next(g for g in goals if g.id == goal.id)
    assert refreshed.progress_pct == 50, \
        f"Expected 50 % auto-progress, got {refreshed.progress_pct}"

    # Clean up
    crud.delete_task(t1.id)
    crud.delete_task(t2.id)
    crud.delete_goal(goal.id)


@test("Calendar Events — create / read / update / soft-delete (local)")
def test_calendar_events():
    now = datetime.utcnow()
    event = crud.create_event(
        title="Team sync",
        start_datetime=now,
        end_datetime=now + timedelta(hours=1),
        event_type="meeting",
        location="https://zoom.us/j/example",
    )
    assert event.id is not None
    assert event.source == "local"
    assert event.is_read_only is False

    events = crud.get_events()
    assert any(e.id == event.id for e in events)

    updated = crud.update_event(event.id, title="Team sync (updated)", location="Office")
    assert updated.title == "Team sync (updated)"

    deleted = crud.delete_event(event.id)
    assert deleted.deleted_at is not None

    events_after = crud.get_events()
    assert not any(e.id == event.id for e in events_after), \
        "soft-deleted event should be hidden"


@test("Calendar Events — Google read-only enforcement (update + delete both rejected)")
def test_google_event_readonly():
    now = datetime.utcnow()
    g_event = crud.create_event(
        title="All-hands meeting",
        start_datetime=now + timedelta(hours=2),
        end_datetime=now + timedelta(hours=3),
        event_type="google_import",
        source="google",
        google_event_id="google-evt-abc123",
        google_calendar_id="primary",
        is_read_only=True,
    )
    assert g_event.is_read_only is True

    # update_event must raise PermissionError
    raised = False
    try:
        crud.update_event(g_event.id, title="Hijacked title")
    except PermissionError:
        raised = True
    assert raised, "update_event on a read-only event should raise PermissionError"

    # delete_event must raise PermissionError
    raised = False
    try:
        crud.delete_event(g_event.id)
    except PermissionError:
        raised = True
    assert raised, "delete_event on a read-only event should raise PermissionError"


@test("Habits — create / read / complete / unmark / archive + streak calculation")
def test_habits():
    habit = crud.create_habit(
        title="Morning run",
        frequency="daily",
        time_of_day="morning",
    )
    assert habit.id is not None

    habits = crud.get_habits()
    assert any(h.id == habit.id for h in habits)

    # Habits are sorted morning-first
    morning_habits = [h for h in habits if h.time_of_day == "morning"]
    other_habits   = [h for h in habits if h.time_of_day != "morning"]
    if morning_habits and other_habits:
        first_morning_idx = habits.index(morning_habits[0])
        first_other_idx   = habits.index(other_habits[0])
        assert first_morning_idx < first_other_idx, \
            "morning habits should come before non-morning habits"

    today = date.today()

    # Mark complete — idempotent
    c1 = crud.mark_habit_complete(habit.id, today, note="Felt great")
    c2 = crud.mark_habit_complete(habit.id, today)  # duplicate — should return same row
    assert c1.id == c2.id, "duplicate mark_habit_complete should be idempotent"

    completions = crud.get_habit_completions(habit.id)
    assert any(c.completed_date == today for c in completions)

    # Check streak was updated
    habits_after = crud.get_habits()
    h = next(h for h in habits_after if h.id == habit.id)
    assert h.streak_current >= 1, "streak_current should be at least 1 after completion"

    # Unmark
    result = crud.unmark_habit_complete(habit.id, today)
    assert result is True

    completions_after = crud.get_habit_completions(habit.id)
    assert not any(c.completed_date == today for c in completions_after), \
        "completion should be removed after unmark"

    # Unmark non-existent — must return False
    assert crud.unmark_habit_complete(habit.id, today) is False

    # Archive (sets is_active=False, preserves history)
    archived = crud.archive_habit(habit.id)
    assert archived.is_active is False
    assert not any(h.id == habit.id for h in crud.get_habits()), \
        "archived habit should be hidden from default get_habits()"
    assert any(h.id == habit.id for h in crud.get_habits(include_inactive=True)), \
        "archived habit should appear with include_inactive=True"


@test("AI Conversation History — add messages / read back in order")
def test_ai_conversation():
    session_id = f"test-session-{datetime.utcnow().timestamp()}"

    m1 = crud.add_message(session_id, role="user",
                          content="Plan my week", token_count=8)
    m2 = crud.add_message(session_id, role="tool",
                          content='{"tasks": []}',
                          tool_name="get_weekly_summary", token_count=42)
    m3 = crud.add_message(session_id, role="assistant",
                          content="Here is your weekly plan …", token_count=95)

    assert m1.id is not None
    assert m2.tool_name == "get_weekly_summary"

    history = crud.get_conversation(session_id)
    assert len(history) == 3, f"Expected 3 messages, got {len(history)}"
    assert history[0].role == "user"
    assert history[1].role == "tool"
    assert history[2].role == "assistant"

    # Token counts preserved
    assert history[1].token_count == 42

    # Session appears in get_sessions()
    sessions = crud.get_sessions()
    assert session_id in sessions


# ---------------------------------------------------------------------------
#  Main
# ---------------------------------------------------------------------------

def main():
    print("Initialising database at ./data/planner.db …")
    db_init()
    print("Database ready.\n")

    # Run all decorated test functions in definition order
    for fn in [
        test_tasks,
        test_goals,
        test_goal_auto_progress,
        test_calendar_events,
        test_google_event_readonly,
        test_habits,
        test_ai_conversation,
    ]:
        fn()

    print()
    print("─" * 55)
    passed = sum(_results)
    total  = len(_results)
    print(f"Result: {passed}/{total} tests passed")
    if passed < total:
        sys.exit(1)


if __name__ == "__main__":
    main()
