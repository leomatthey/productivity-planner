"""
agent/tools.py — Agent tool definitions and executors.

Each tool definition follows the Anthropic tool-use (function calling) JSON Schema.
Each executor maps 1-to-1 with a CRUD helper in db/crud.py — the same functions
the UI uses.  This guarantees the agent and UI always operate on the same data layer.

Timezone convention (see utils/tz.py):
  - DB stores naive UTC.
  - Tool inputs/outputs use ISO-8601 in the user's local timezone.
  - Conversion happens at this boundary only; CRUD never sees TZ logic.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Callable, Optional

from db import crud
from utils.date_utils import start_of_week
from utils.tz import to_user_iso, from_user_iso, from_user_naive, to_local_date

# ---------------------------------------------------------------------------
#  Serialisation helpers
# ---------------------------------------------------------------------------

def _date_str(d: Optional[date]) -> Optional[str]:
    return d.isoformat() if d else None

def _dt_str(dt: Optional[datetime]) -> Optional[str]:
    """Naive-UTC DB datetime → ISO-8601 in user's local timezone (with offset)."""
    return to_user_iso(dt) if dt else None

def _parse_date(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        return date.fromisoformat(str(s))
    except (ValueError, TypeError):
        return None

def _parse_dt(s: Optional[str]) -> Optional[datetime]:
    """ISO-8601 string from the model → naive-UTC datetime for the DB.

    Inputs with an explicit offset are converted to UTC; naive inputs are
    interpreted as user-local (matching what the system prompt instructs)."""
    if not s:
        return None
    try:
        return from_user_iso(str(s))
    except (ValueError, TypeError):
        return None

def _task_to_dict(task) -> dict:
    return {
        "id":                task.id,
        "title":             task.title,
        "description":       task.description,
        "status":            task.status,
        "priority":          task.priority,
        "due_date":          _date_str(task.due_date),
        "project_id":        task.project_id,
        "scheduled_at":      _dt_str(task.scheduled_at),
        "estimated_minutes": task.estimated_minutes,
        "energy_level":      task.energy_level,
        "tags":              task.tags,
        "created_at":        _dt_str(task.created_at),
        "updated_at":        _dt_str(task.updated_at),
    }


def _goal_to_dict(goal) -> dict:
    return {
        "id":            goal.id,
        "title":         goal.title,
        "description":   goal.description,
        "status":        goal.status,
        "target_date":   _date_str(goal.target_date),
        "progress_pct":  goal.progress_pct,
        "progress_mode": goal.progress_mode,
        "parent_id":     goal.parent_id,
        "color":         goal.color,
        "created_at":    _dt_str(goal.created_at),
        "updated_at":    _dt_str(goal.updated_at),
    }


def _habit_to_dict(habit) -> dict:
    return {
        "id":             habit.id,
        "title":          habit.title,
        "description":    habit.description,
        "frequency":      habit.frequency,
        "target_days":    habit.target_days,
        "time_of_day":    habit.time_of_day,
        "streak_current": habit.streak_current,
        "streak_best":    habit.streak_best,
        "is_active":      habit.is_active,
        "created_at":     _dt_str(habit.created_at),
    }


def _event_to_dict(event) -> dict:
    return {
        "id":               event.id,
        "title":            event.title,
        "description":      event.description,
        "event_type":       event.event_type,
        "start_datetime":   _dt_str(event.start_datetime),
        "end_datetime":     _dt_str(event.end_datetime),
        "location":         event.location,
        "task_id":          event.task_id,
        "is_recurring":     event.is_recurring,
        "recurrence_rule":  event.recurrence_rule,
        "source":           event.source,
        "google_event_id":  event.google_event_id,
        "is_read_only":     event.is_read_only,
        "sync_stale":       event.sync_stale,
        "created_at":       _dt_str(event.created_at),
    }


# ---------------------------------------------------------------------------
#  Task tool definitions  (Anthropic tool-use schema)
# ---------------------------------------------------------------------------

_GET_TASKS: dict = {
    "name": "get_tasks",
    "description": (
        "Retrieve tasks from the planner with optional filters. "
        "Returns only active (non-deleted) tasks by default. "
        "Use this to check what the user has on their plate, find overdue items, "
        "or list tasks linked to a specific project."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "project_id": {
                "type": "integer",
                "description": "Filter tasks belonging to this goal/project ID.",
            },
            "status": {
                "type": "string",
                "enum": ["todo", "in_progress", "scheduled", "done"],
                "description": "Filter by task status.",
            },
            "priority": {
                "type": "string",
                "enum": ["low", "medium", "high", "urgent"],
                "description": "Filter by priority level.",
            },
            "due_date_from": {
                "type": "string",
                "description": "ISO-8601 date (YYYY-MM-DD). Return tasks due on or after this date.",
            },
            "due_date_to": {
                "type": "string",
                "description": "ISO-8601 date (YYYY-MM-DD). Return tasks due on or before this date.",
            },
            "tag": {
                "type": "string",
                "description": "Return tasks whose tags field contains this string.",
            },
            "include_deleted": {
                "type": "boolean",
                "description": "Set true to include soft-deleted tasks. Defaults to false.",
            },
        },
        "required": [],
    },
}

_CREATE_TASK: dict = {
    "name": "create_task",
    "description": (
        "Create a new task in the planner. "
        "Provide estimated_minutes and energy_level whenever possible to enable "
        "smart time-blocking later."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "Task title (required).",
            },
            "description": {
                "type": "string",
                "description": "Optional longer description or notes.",
            },
            "status": {
                "type": "string",
                "enum": ["todo", "in_progress", "scheduled", "done"],
                "description": "Initial status. Defaults to 'todo'.",
            },
            "priority": {
                "type": "string",
                "enum": ["low", "medium", "high", "urgent"],
                "description": "Priority level. Defaults to 'medium'.",
            },
            "due_date": {
                "type": "string",
                "description": "ISO-8601 date (YYYY-MM-DD). Optional due date.",
            },
            "project_id": {
                "type": "integer",
                "description": "Link this task to a goal/project by its ID.",
            },
            "estimated_minutes": {
                "type": "integer",
                "description": "Estimated duration in minutes. Used for time-blocking.",
            },
            "energy_level": {
                "type": "string",
                "enum": ["low", "medium", "high"],
                "description": "Required energy level — used to match tasks to peak-hour slots.",
            },
            "tags": {
                "type": "string",
                "description": "Comma-separated tags, e.g. 'work,urgent'.",
            },
        },
        "required": ["title"],
    },
}

_UPDATE_TASK: dict = {
    "name": "update_task",
    "description": (
        "Update one or more fields of an existing task. "
        "Only provide the fields you want to change — omitted fields are left as-is. "
        "IMPORTANT: Cannot set status to 'scheduled' — use apply_schedule instead. "
        "Cannot change status from 'scheduled' — use unschedule_task instead."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "task_id": {
                "type": "integer",
                "description": "ID of the task to update (required).",
            },
            "title":       {"type": "string"},
            "description": {"type": "string"},
            "status": {
                "type": "string",
                "enum": ["todo", "in_progress", "done"],
                "description": "Cannot set to 'scheduled' here — use apply_schedule tool.",
            },
            "priority": {
                "type": "string",
                "enum": ["low", "medium", "high", "urgent"],
            },
            "due_date": {
                "type": "string",
                "description": "ISO-8601 date (YYYY-MM-DD), or null to clear the due date.",
            },
            "project_id": {
                "type": "integer",
                "description": "Link to a goal/project ID, or null to unlink.",
            },
            "estimated_minutes": {"type": "integer"},
            "energy_level": {
                "type": "string",
                "enum": ["low", "medium", "high"],
            },
            "tags": {"type": "string"},
        },
        "required": ["task_id"],
    },
}

_DELETE_TASK: dict = {
    "name": "delete_task",
    "description": (
        "Soft-delete a task by ID. The task is hidden from normal queries but not "
        "permanently removed — it can be recovered. "
        "IMPORTANT: Always describe what you are about to delete and ask the user to "
        "confirm before calling this tool."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "task_id": {
                "type": "integer",
                "description": "ID of the task to delete.",
            },
        },
        "required": ["task_id"],
    },
}


# ---------------------------------------------------------------------------
#  Goal tool definitions  (Anthropic tool-use schema)
# ---------------------------------------------------------------------------

_GET_GOALS: dict = {
    "name": "get_goals",
    "description": (
        "Retrieve goals/projects from the planner with optional filters. "
        "Returns only active (non-deleted) goals by default. "
        "Use this to check the user's goals, find goals by status, or list "
        "sub-goals belonging to a specific parent."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "status": {
                "type": "string",
                "enum": ["active", "paused", "completed", "archived"],
                "description": "Filter by goal status.",
            },
            "parent_id": {
                "type": "integer",
                "description": "Return only sub-goals of this parent goal ID.",
            },
            "top_level_only": {
                "type": "boolean",
                "description": "If true, return only top-level goals (no sub-goals). Defaults to false.",
            },
            "include_deleted": {
                "type": "boolean",
                "description": "Set true to include soft-deleted goals. Defaults to false.",
            },
        },
        "required": [],
    },
}

_CREATE_GOAL: dict = {
    "name": "create_goal",
    "description": (
        "Create a new goal or project in the planner. "
        "Set progress_mode to 'auto' to have progress calculated automatically "
        "from linked task completion, or 'manual' to control it via progress_pct."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "Goal title (required).",
            },
            "description": {
                "type": "string",
                "description": "Optional description or success criteria.",
            },
            "status": {
                "type": "string",
                "enum": ["active", "paused", "completed", "archived"],
                "description": "Goal status. Defaults to 'active'.",
            },
            "target_date": {
                "type": "string",
                "description": "ISO-8601 date (YYYY-MM-DD). Optional target completion date.",
            },
            "progress_pct": {
                "type": "integer",
                "description": "Initial progress 0–100. Only applies when progress_mode is 'manual'.",
            },
            "progress_mode": {
                "type": "string",
                "enum": ["manual", "auto"],
                "description": (
                    "'auto' recalculates progress from linked task completion. "
                    "'manual' lets you set progress_pct directly. Defaults to 'manual'."
                ),
            },
            "parent_id": {
                "type": "integer",
                "description": "Nest this goal under a parent goal ID (one level of nesting).",
            },
            "color": {
                "type": "string",
                "description": "Optional hex colour (e.g. '#4F46E5') used by the UI to tint the project.",
            },
        },
        "required": ["title"],
    },
}

_UPDATE_GOAL: dict = {
    "name": "update_goal",
    "description": (
        "Update one or more fields of an existing goal. "
        "Only provide the fields you want to change — omitted fields are left as-is. "
        "Use this to update status, adjust progress, change target dates, etc."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "goal_id": {
                "type": "integer",
                "description": "ID of the goal to update (required).",
            },
            "title":       {"type": "string"},
            "description": {"type": "string"},
            "status": {
                "type": "string",
                "enum": ["active", "paused", "completed", "archived"],
            },
            "target_date": {
                "type": "string",
                "description": "ISO-8601 date (YYYY-MM-DD), or null to clear.",
            },
            "progress_pct": {
                "type": "integer",
                "description": "Progress 0–100. Only effective when progress_mode is 'manual'.",
            },
            "progress_mode": {
                "type": "string",
                "enum": ["manual", "auto"],
                "description": "Switch between manual and auto progress calculation.",
            },
            "parent_id": {
                "type": "integer",
                "description": "Move under a different parent, or null to make top-level.",
            },
            "color": {
                "type": "string",
                "description": "Hex colour (e.g. '#4F46E5') used by the UI to tint the project.",
            },
        },
        "required": ["goal_id"],
    },
}

_DELETE_GOAL: dict = {
    "name": "delete_goal",
    "description": (
        "Soft-delete a goal by ID. The goal is hidden from normal queries but not "
        "permanently removed. Linked tasks are NOT deleted — they remain but lose "
        "the project association. "
        "IMPORTANT: Always describe what you are about to delete and ask the user to "
        "confirm before calling this tool."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "goal_id": {
                "type": "integer",
                "description": "ID of the goal to delete.",
            },
        },
        "required": ["goal_id"],
    },
}


# ---------------------------------------------------------------------------
#  Habit tool definitions  (Anthropic tool-use schema)
# ---------------------------------------------------------------------------

_GET_HABITS: dict = {
    "name": "get_habits",
    "description": (
        "Retrieve habits from the planner. Returns only active habits by default. "
        "Use this to check the user's habits, find habits by time of day, or review "
        "streak information."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "include_inactive": {
                "type": "boolean",
                "description": "Set true to include archived (inactive) habits. Defaults to false.",
            },
            "time_of_day": {
                "type": "string",
                "enum": ["morning", "afternoon", "evening", "anytime"],
                "description": "Filter habits by their scheduled time of day.",
            },
        },
        "required": [],
    },
}

_MARK_HABIT_COMPLETE: dict = {
    "name": "mark_habit_complete",
    "description": (
        "Log a habit completion for a given date. Idempotent — safe to call even if "
        "the habit was already logged for that date. Returns already_logged=true if "
        "a completion record already existed."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "habit_id": {
                "type": "integer",
                "description": "ID of the habit to mark complete.",
            },
            "completed_date": {
                "type": "string",
                "description": "ISO-8601 date (YYYY-MM-DD) for which to log the completion.",
            },
            "note": {
                "type": "string",
                "description": "Optional note to attach to this completion (e.g. duration, mood).",
            },
        },
        "required": ["habit_id", "completed_date"],
    },
}

_UNMARK_HABIT_COMPLETE: dict = {
    "name": "unmark_habit_complete",
    "description": (
        "Remove a habit completion record for a given date. Returns deleted=true if "
        "a record was removed, deleted=false if no record existed for that date."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "habit_id": {
                "type": "integer",
                "description": "ID of the habit.",
            },
            "completed_date": {
                "type": "string",
                "description": "ISO-8601 date (YYYY-MM-DD) of the completion to remove.",
            },
        },
        "required": ["habit_id", "completed_date"],
    },
}

_CREATE_HABIT: dict = {
    "name": "create_habit",
    "description": (
        "Create a new habit. Defaults to daily frequency, anytime time-of-day. "
        "Use this when the user wants to start tracking a new recurring behaviour."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "Habit title (required).",
            },
            "description": {
                "type": "string",
                "description": "Optional notes — what the habit means or why it matters.",
            },
            "frequency": {
                "type": "string",
                "enum": ["daily", "weekdays", "weekly", "custom"],
                "description": "How often the habit recurs. Defaults to 'daily'.",
            },
            "target_days": {
                "type": "string",
                "description": (
                    "JSON array of day indices (0=Mon … 6=Sun) for 'weekly' or 'custom' "
                    "frequencies, e.g. '[0,2,4]' for Mon/Wed/Fri."
                ),
            },
            "time_of_day": {
                "type": "string",
                "enum": ["morning", "afternoon", "evening", "anytime"],
                "description": "Preferred time of day. Defaults to 'anytime'.",
            },
        },
        "required": ["title"],
    },
}

_UPDATE_HABIT: dict = {
    "name": "update_habit",
    "description": (
        "Update one or more fields of an existing habit. "
        "Only provide the fields you want to change — omitted fields are left as-is. "
        "To archive (soft-delete) a habit, use archive_habit instead."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "habit_id": {
                "type": "integer",
                "description": "ID of the habit to update (required).",
            },
            "title":       {"type": "string"},
            "description": {"type": "string"},
            "frequency": {
                "type": "string",
                "enum": ["daily", "weekdays", "weekly", "custom"],
            },
            "target_days": {
                "type": "string",
                "description": "JSON array of day indices (0=Mon … 6=Sun).",
            },
            "time_of_day": {
                "type": "string",
                "enum": ["morning", "afternoon", "evening", "anytime"],
            },
        },
        "required": ["habit_id"],
    },
}

_ARCHIVE_HABIT: dict = {
    "name": "archive_habit",
    "description": (
        "Archive a habit by setting is_active=false. The habit is hidden from "
        "active queries but its history is preserved. "
        "IMPORTANT: Always confirm with the user before calling this tool."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "habit_id": {
                "type": "integer",
                "description": "ID of the habit to archive.",
            },
        },
        "required": ["habit_id"],
    },
}


# ---------------------------------------------------------------------------
#  Calendar event tool definitions  (Anthropic tool-use schema)
# ---------------------------------------------------------------------------

_GET_EVENTS: dict = {
    "name": "get_events",
    "description": (
        "Retrieve calendar events with optional date-range and source filters. "
        "Returns only active (non-deleted, non-stale) events by default. "
        "Use this to check the user's schedule, find upcoming meetings, "
        "or list events in a specific time window."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "start": {
                "type": "string",
                "description": (
                    "ISO-8601 datetime in the user's local timezone "
                    "(naive YYYY-MM-DDTHH:MM:SS is fine — interpreted as local). "
                    "Return events that end on or after this time."
                ),
            },
            "end": {
                "type": "string",
                "description": (
                    "ISO-8601 datetime in the user's local timezone "
                    "(naive YYYY-MM-DDTHH:MM:SS is fine — interpreted as local). "
                    "Return events that start on or before this time."
                ),
            },
            "source": {
                "type": "string",
                "enum": ["local", "google"],
                "description": "Filter by event source. Omit to return all sources.",
            },
            "include_stale": {
                "type": "boolean",
                "description": "Include stale Google Calendar events. Defaults to false.",
            },
            "include_deleted": {
                "type": "boolean",
                "description": "Include soft-deleted events. Defaults to false.",
            },
        },
        "required": [],
    },
}

_CREATE_EVENT: dict = {
    "name": "create_event",
    "description": (
        "Create a new local calendar event. "
        "Optionally link it to a task via task_id for time-blocking. "
        "Use event_type='task_block' when scheduling focus time for a specific task."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "Event title (required).",
            },
            "start_datetime": {
                "type": "string",
                "description": (
                    "ISO-8601 datetime in the user's local timezone for event start (required). "
                    "Naive YYYY-MM-DDTHH:MM:SS is fine — interpreted as local."
                ),
            },
            "end_datetime": {
                "type": "string",
                "description": (
                    "ISO-8601 datetime in the user's local timezone for event end (required). "
                    "Naive YYYY-MM-DDTHH:MM:SS is fine — interpreted as local."
                ),
            },
            "description": {
                "type": "string",
                "description": "Optional notes, agenda, or details.",
            },
            "event_type": {
                "type": "string",
                "enum": ["task_block", "meeting", "personal", "reminder"],
                "description": "Category of the event. Defaults to 'personal'.",
            },
            "location": {
                "type": "string",
                "description": "Physical location, Zoom link, or address.",
            },
            "task_id": {
                "type": "integer",
                "description": "Link this event to a task by its ID (e.g. for time-blocking).",
            },
        },
        "required": ["title", "start_datetime", "end_datetime"],
    },
}

_UPDATE_EVENT: dict = {
    "name": "update_event",
    "description": (
        "Update one or more fields of an existing local calendar event. "
        "Only provide the fields you want to change — omitted fields are left as-is. "
        "Cannot update Google Calendar events (is_read_only=true)."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "event_id": {
                "type": "integer",
                "description": "ID of the event to update (required).",
            },
            "title":       {"type": "string"},
            "description": {"type": "string"},
            "event_type": {
                "type": "string",
                "enum": ["task_block", "meeting", "personal", "reminder"],
            },
            "start_datetime": {
                "type": "string",
                "description": (
                    "ISO-8601 datetime in the user's local timezone "
                    "(naive YYYY-MM-DDTHH:MM:SS is fine — interpreted as local)."
                ),
            },
            "end_datetime": {
                "type": "string",
                "description": (
                    "ISO-8601 datetime in the user's local timezone "
                    "(naive YYYY-MM-DDTHH:MM:SS is fine — interpreted as local)."
                ),
            },
            "location": {"type": "string"},
            "task_id": {
                "type": "integer",
                "description": "Link to a task ID, or null to unlink.",
            },
        },
        "required": ["event_id"],
    },
}

_DELETE_EVENT: dict = {
    "name": "delete_event",
    "description": (
        "Soft-delete a local calendar event by ID. "
        "Cannot delete Google Calendar events (is_read_only=true). "
        "IMPORTANT: Always confirm with the user before calling this tool."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "event_id": {
                "type": "integer",
                "description": "ID of the event to delete.",
            },
        },
        "required": ["event_id"],
    },
}

_MOVE_EVENT: dict = {
    "name": "move_event",
    "description": (
        "Atomically move and/or resize a local calendar event. If the event is a "
        "task_block linked to a task, the task's scheduled_at is updated to match — "
        "use this instead of delete_event + create_event to keep task and event in sync. "
        "Cannot move Google Calendar events (is_read_only=true)."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "event_id": {
                "type": "integer",
                "description": "ID of the event to move (required).",
            },
            "start_datetime": {
                "type": "string",
                "description": (
                    "New start, ISO-8601 in user's local timezone "
                    "(naive YYYY-MM-DDTHH:MM:SS is fine — interpreted as local)."
                ),
            },
            "end_datetime": {
                "type": "string",
                "description": (
                    "New end, ISO-8601 in user's local timezone "
                    "(naive YYYY-MM-DDTHH:MM:SS is fine — interpreted as local)."
                ),
            },
        },
        "required": ["event_id", "start_datetime", "end_datetime"],
    },
}


# ---------------------------------------------------------------------------
#  Aggregate tool definitions
# ---------------------------------------------------------------------------

_GET_TODAY_OVERVIEW: dict = {
    "name": "get_today_overview",
    "description": (
        "Return a complete snapshot of today: tasks due or scheduled today, "
        "all active habits with today's completion status, and today's calendar events. "
        "Use this at the start of a planning conversation instead of making three "
        "separate tool calls."
    ),
    "input_schema": {
        "type": "object",
        "properties": {},
        "required": [],
    },
}

_GET_WEEKLY_SUMMARY: dict = {
    "name": "get_weekly_summary",
    "description": (
        "Return a week-level overview: tasks due this week, calendar events this week, "
        "and a per-habit completion count for the week. "
        "Useful for weekly planning or review conversations. "
        "week_offset=0 (default) is the current week; -1 is last week; 1 is next week."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "week_offset": {
                "type": "integer",
                "description": (
                    "Week offset relative to the current week. "
                    "0 = this week (default), -1 = last week, 1 = next week."
                ),
            },
        },
        "required": [],
    },
}

_SUGGEST_SCHEDULE: dict = {
    "name": "suggest_schedule",
    "description": (
        "Generate a suggested time-block schedule for a given day using all pending or "
        "in-progress tasks that have an estimated_minutes set. "
        "Respects existing calendar events as busy time. "
        "Returns a list of proposed time blocks. "
        "IMPORTANT: after calling this tool, apply the schedule by calling apply_schedule "
        "with the returned slots. This atomically sets task status and creates calendar "
        "events. Do NOT use update_task to set scheduled status — it will be rejected."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "date": {
                "type": "string",
                "description": "ISO-8601 date (YYYY-MM-DD) to schedule for. Defaults to today.",
            },
            "start_hour": {
                "type": "integer",
                "description": "Hour (0–23) to start scheduling from. Defaults to 9.",
            },
            "end_hour": {
                "type": "integer",
                "description": "Hour (0–23) to stop scheduling at. Defaults to 18.",
            },
        },
        "required": [],
    },
}


# ---------------------------------------------------------------------------
#  Task executors
# ---------------------------------------------------------------------------

def _exec_get_tasks(args: dict) -> dict:
    tasks = crud.get_tasks(
        project_id=args.get("project_id"),
        status=args.get("status"),
        priority=args.get("priority"),
        due_date_from=_parse_date(args.get("due_date_from")),
        due_date_to=_parse_date(args.get("due_date_to")),
        tag=args.get("tag"),
        include_deleted=args.get("include_deleted", False),
    )
    return {"tasks": [_task_to_dict(t) for t in tasks], "count": len(tasks)}


def _exec_create_task(args: dict) -> dict:
    task = crud.create_task(
        title=args["title"],
        description=args.get("description"),
        status=args.get("status", "todo"),
        priority=args.get("priority", "medium"),
        due_date=_parse_date(args.get("due_date")),
        project_id=args.get("project_id"),
        estimated_minutes=args.get("estimated_minutes"),
        energy_level=args.get("energy_level"),
        tags=args.get("tags"),
    )
    return {"created": _task_to_dict(task)}


def _exec_update_task(args: dict) -> dict:
    args = dict(args)  # copy — never mutate caller's dict
    task_id = args.pop("task_id")
    args.pop("scheduled_at", None)  # scheduling goes through apply_schedule
    if "due_date" in args:
        args["due_date"] = _parse_date(args["due_date"])
    task = crud.update_task(task_id, **args)
    return {"updated": _task_to_dict(task)}


def _exec_delete_task(args: dict) -> dict:
    task = crud.delete_task(args["task_id"])
    return {"deleted": {"id": task.id, "title": task.title}}


# ---------------------------------------------------------------------------
#  Goal executors
# ---------------------------------------------------------------------------

def _exec_get_goals(args: dict) -> dict:
    goals = crud.get_goals(
        status=args.get("status"),
        parent_id=args.get("parent_id"),
        top_level_only=args.get("top_level_only", False),
        include_deleted=args.get("include_deleted", False),
    )
    return {"goals": [_goal_to_dict(g) for g in goals], "count": len(goals)}


def _exec_create_goal(args: dict) -> dict:
    goal = crud.create_goal(
        title=args["title"],
        description=args.get("description"),
        status=args.get("status", "active"),
        target_date=_parse_date(args.get("target_date")),
        progress_pct=args.get("progress_pct", 0),
        progress_mode=args.get("progress_mode", "manual"),
        parent_id=args.get("parent_id"),
        color=args.get("color"),
    )
    return {"created": _goal_to_dict(goal)}


def _exec_update_goal(args: dict) -> dict:
    args = dict(args)  # copy — never mutate caller's dict
    goal_id = args.pop("goal_id")
    if "target_date" in args:
        args["target_date"] = _parse_date(args["target_date"])
    goal = crud.update_goal(goal_id, **args)
    return {"updated": _goal_to_dict(goal)}


def _exec_delete_goal(args: dict) -> dict:
    goal = crud.delete_goal(args["goal_id"])
    return {"deleted": {"id": goal.id, "title": goal.title}}


# ---------------------------------------------------------------------------
#  Habit executors
# ---------------------------------------------------------------------------

def _exec_get_habits(args: dict) -> dict:
    habits = crud.get_habits(
        include_inactive=args.get("include_inactive", False),
        time_of_day=args.get("time_of_day"),
    )
    return {"habits": [_habit_to_dict(h) for h in habits], "count": len(habits)}


def _exec_mark_habit_complete(args: dict) -> dict:
    habit_id       = args["habit_id"]
    completed_date = _parse_date(args["completed_date"])
    note           = args.get("note")

    # Check for existing completion before calling CRUD (idempotency detection)
    existing = crud.get_habit_completions(
        habit_id, from_date=completed_date, to_date=completed_date
    )
    already_logged = len(existing) > 0

    completion = crud.mark_habit_complete(habit_id, completed_date, note=note)
    return {
        "completion": {
            "id":             completion.id,
            "habit_id":       completion.habit_id,
            "completed_date": _date_str(completion.completed_date),
            "note":           completion.note,
        },
        "already_logged": already_logged,
    }


def _exec_unmark_habit_complete(args: dict) -> dict:
    habit_id       = args["habit_id"]
    completed_date = _parse_date(args["completed_date"])
    deleted        = crud.unmark_habit_complete(habit_id, completed_date)
    return {"deleted": deleted, "habit_id": habit_id, "completed_date": _date_str(completed_date)}


def _exec_create_habit(args: dict) -> dict:
    habit = crud.create_habit(
        title=args["title"],
        description=args.get("description"),
        frequency=args.get("frequency", "daily"),
        target_days=args.get("target_days"),
        time_of_day=args.get("time_of_day", "anytime"),
    )
    return {"created": _habit_to_dict(habit)}


def _exec_update_habit(args: dict) -> dict:
    args = dict(args)  # copy — never mutate caller's dict
    habit_id = args.pop("habit_id")
    habit = crud.update_habit(habit_id, **args)
    return {"updated": _habit_to_dict(habit)}


def _exec_archive_habit(args: dict) -> dict:
    habit = crud.archive_habit(args["habit_id"])
    return {"archived": _habit_to_dict(habit)}


# ---------------------------------------------------------------------------
#  Calendar event executors
# ---------------------------------------------------------------------------

def _exec_get_events(args: dict) -> dict:
    events = crud.get_events(
        start=_parse_dt(args.get("start")),
        end=_parse_dt(args.get("end")),
        source=args.get("source"),
        include_stale=args.get("include_stale", False),
        include_deleted=args.get("include_deleted", False),
    )
    return {"events": [_event_to_dict(e) for e in events], "count": len(events)}


def _exec_create_event(args: dict) -> dict:
    event = crud.create_event(
        title=args["title"],
        start_datetime=_parse_dt(args["start_datetime"]),
        end_datetime=_parse_dt(args["end_datetime"]),
        description=args.get("description"),
        event_type=args.get("event_type", "personal"),
        location=args.get("location"),
        task_id=args.get("task_id"),
    )
    return {"created": _event_to_dict(event)}


def _exec_update_event(args: dict) -> dict:
    args = dict(args)  # copy — never mutate caller's dict
    event_id = args.pop("event_id")
    if "start_datetime" in args:
        args["start_datetime"] = _parse_dt(args["start_datetime"])
    if "end_datetime" in args:
        args["end_datetime"] = _parse_dt(args["end_datetime"])
    event = crud.update_event(event_id, **args)
    return {"updated": _event_to_dict(event)}


def _exec_delete_event(args: dict) -> dict:
    event = crud.delete_event(args["event_id"])
    return {"deleted": {"id": event.id, "title": event.title}}


def _exec_move_event(args: dict) -> dict:
    start_dt = _parse_dt(args["start_datetime"])
    end_dt   = _parse_dt(args["end_datetime"])
    event = crud.move_event(args["event_id"], start_dt, end_dt)
    return {"moved": _event_to_dict(event)}


# ---------------------------------------------------------------------------
#  Aggregate executors
# ---------------------------------------------------------------------------

def _exec_get_today_overview(args: dict) -> dict:  # noqa: ARG001
    from datetime import time as time_

    today_ = date.today()
    # Build local-day boundaries, then convert to naive UTC for the DB query.
    today_start = from_user_naive(datetime.combine(today_, time_.min))
    today_end   = from_user_naive(datetime.combine(today_, time_.max))

    # Tasks due today (by due_date)
    due_today = crud.get_tasks(due_date_from=today_, due_date_to=today_)
    due_ids   = {t.id for t in due_today}

    # Tasks scheduled today — convert naive-UTC scheduled_at to local date.
    all_active = crud.get_tasks()
    scheduled_today = [
        t for t in all_active
        if t.scheduled_at and to_local_date(t.scheduled_at) == today_ and t.id not in due_ids
    ]

    tasks = due_today + scheduled_today

    # Active habits with today's completion status
    habits = crud.get_habits(include_inactive=False)
    habit_dicts = []
    for h in habits:
        completions = crud.get_habit_completions(h.id, from_date=today_, to_date=today_)
        hd = _habit_to_dict(h)
        hd["completed_today"] = len(completions) > 0
        habit_dicts.append(hd)

    # Calendar events that overlap with today
    events = crud.get_events(start=today_start, end=today_end)

    return {
        "date":   today_.isoformat(),
        "tasks":  [_task_to_dict(t) for t in tasks],
        "habits": habit_dicts,
        "events": [_event_to_dict(e) for e in events],
    }


def _exec_get_weekly_summary(args: dict) -> dict:
    from datetime import time as time_

    week_offset = int(args.get("week_offset", 0))
    today_      = date.today()
    week_start  = start_of_week(today_) + timedelta(weeks=week_offset)
    week_end    = week_start + timedelta(days=6)

    # Local week bounds → naive UTC for the DB query.
    week_start_dt = from_user_naive(datetime.combine(week_start, time_.min))
    week_end_dt   = from_user_naive(datetime.combine(week_end,   time_.max))

    # Tasks due within the week
    tasks = crud.get_tasks(due_date_from=week_start, due_date_to=week_end)

    # Calendar events overlapping the week
    events = crud.get_events(start=week_start_dt, end=week_end_dt)

    # Per-habit completion count for the week
    habits = crud.get_habits(include_inactive=False)
    habit_summary = []
    for h in habits:
        completions = crud.get_habit_completions(
            h.id, from_date=week_start, to_date=week_end
        )
        habit_summary.append({
            "habit_id":       h.id,
            "title":          h.title,
            "completions":    len(completions),
            "streak_current": h.streak_current,
            "streak_best":    h.streak_best,
        })

    return {
        "week_start":    week_start.isoformat(),
        "week_end":      week_end.isoformat(),
        "tasks":         [_task_to_dict(t) for t in tasks],
        "events":        [_event_to_dict(e) for e in events],
        "habit_summary": habit_summary,
    }


def _exec_suggest_schedule(args: dict) -> dict:
    from utils.scheduling import find_free_slots
    from datetime import time as time_

    target_date = _parse_date(args.get("date")) or date.today()
    # Use user preferences as defaults; explicit args override
    default_start = int(crud.get_preference("work_start_hour", "9"))
    default_end   = int(crud.get_preference("work_end_hour", "18"))
    start_hour  = int(args.get("start_hour", default_start))
    end_hour    = int(args.get("end_hour", default_end))

    # All pending/in_progress tasks that have a duration estimate
    all_tasks   = crud.get_tasks()
    schedulable = [
        t for t in all_tasks
        if t.status in ("todo", "in_progress")
        and t.estimated_minutes
        and t.estimated_minutes > 0
    ]

    # Sort: high-energy → morning, low-energy → afternoon; break ties by priority
    _ENERGY_ORDER   = {"high": 0, "medium": 1, "low": 2}
    _PRIORITY_ORDER = {"urgent": 0, "high": 1, "medium": 2, "low": 3}
    schedulable.sort(key=lambda t: (
        _ENERGY_ORDER.get(t.energy_level or "medium", 1),
        _PRIORITY_ORDER.get(t.priority or "medium", 2),
    ))

    if not schedulable:
        return {
            "date":              target_date.isoformat(),
            "slots":             [],
            "unscheduled_count": 0,
        }

    # Use shared scheduling engine to find free slots
    # Get the smallest task duration to find all potentially usable slots
    min_duration = min(t.estimated_minutes for t in schedulable)
    free = find_free_slots(target_date, min_duration, start_hour, end_hour)

    if not free:
        return {
            "date":              target_date.isoformat(),
            "slots":             [],
            "unscheduled_count": len(schedulable),
        }

    # Greedily place tasks into free slots (first-fit, energy-sorted order)
    schedule   = []
    cur_minute = free[0]["start"].hour * 60 + free[0]["start"].minute

    for task in schedulable:
        duration = task.estimated_minutes
        placed   = False

        for slot in free:
            slot_start = slot["start"].hour * 60 + slot["start"].minute
            slot_end = slot_start + slot["duration_minutes"]
            avail_start = max(cur_minute, slot_start)
            if avail_start >= slot_end:
                continue
            if (slot_end - avail_start) >= duration:
                s_h, s_m = divmod(avail_start, 60)
                e_h, e_m = divmod(avail_start + duration, 60)
                # Build local-naive datetimes, then emit as UTC-via-local-iso.
                start_local = from_user_naive(datetime.combine(target_date, time_(s_h, s_m)))
                end_local   = from_user_naive(datetime.combine(target_date, time_(e_h, e_m)))
                schedule.append({
                    "task_id":           task.id,
                    "title":             task.title,
                    "start":             to_user_iso(start_local),
                    "end":               to_user_iso(end_local),
                    "energy_level":      task.energy_level,
                    "priority":          task.priority,
                    "estimated_minutes": task.estimated_minutes,
                })
                cur_minute = avail_start + duration
                placed = True
                break

    return {
        "date":              target_date.isoformat(),
        "slots":             schedule,
        "unscheduled_count": len(schedulable) - len(schedule),
    }


# ---------------------------------------------------------------------------
#  Scheduling tools
#  unschedule_task: atomic reverse of schedule_task.
#  apply_schedule: batch-schedule N tasks in one call (replaces N update_task calls).
# ---------------------------------------------------------------------------

_UNSCHEDULE_TASK: dict = {
    "name": "unschedule_task",
    "description": (
        "Atomically unschedule a task: deletes its task_block calendar events "
        "and resets the task status from 'scheduled' back to 'todo'. "
        "Use this when the user wants to remove a scheduled task from their day "
        "(rather than calling update_task or delete_event individually)."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "task_id": {
                "type": "integer",
                "description": "ID of the task to unschedule (required).",
            },
        },
        "required": ["task_id"],
    },
}

_APPLY_SCHEDULE: dict = {
    "name": "apply_schedule",
    "description": (
        "Apply a schedule to multiple tasks in a single batch call. "
        "Accepts a list of {task_id, scheduled_date, scheduled_time?} objects and "
        "sets the scheduled_at field on each task. "
        "Use this instead of calling update_task N times — it avoids hitting the "
        "tool-call iteration limit when scheduling a full day's worth of tasks. "
        "Returns a summary with updated and error counts."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "description": "List of task schedule entries to apply.",
                "items": {
                    "type": "object",
                    "properties": {
                        "task_id": {
                            "type": "integer",
                            "description": "ID of the task to schedule.",
                        },
                        "scheduled_date": {
                            "type": "string",
                            "description": (
                                "Local date (YYYY-MM-DD) for the scheduled day, "
                                "in the user's timezone."
                            ),
                        },
                        "scheduled_time": {
                            "type": "string",
                            "description": (
                                "Optional local time (HH:MM) for the start time, "
                                "in the user's timezone. Defaults to 09:00 if omitted."
                            ),
                        },
                    },
                    "required": ["task_id", "scheduled_date"],
                },
            },
        },
        "required": ["items"],
    },
}


def _exec_unschedule_task(args: dict) -> dict:
    task, deleted_event_ids = crud.unschedule_task(args["task_id"])
    return {
        "unscheduled": _task_to_dict(task),
        "deleted_event_ids": list(deleted_event_ids),
    }


def _exec_apply_schedule(args: dict) -> dict:
    items = args.get("items", [])
    if not items:
        return {"error": "No items provided to apply_schedule."}

    updated = []
    errors = []

    for item in items:
        task_id = item.get("task_id")
        scheduled_date_str = item.get("scheduled_date")
        scheduled_time_str = item.get("scheduled_time", "09:00")

        if not task_id or not scheduled_date_str:
            errors.append(
                f"Missing task_id or scheduled_date in item: {item}"
            )
            continue

        try:
            date_obj = _parse_date(scheduled_date_str)
            if not date_obj:
                errors.append(
                    f"Invalid scheduled_date '{scheduled_date_str}' for task {task_id}."
                )
                continue

            try:
                parts = (scheduled_time_str or "09:00").split(":")
                hour = int(parts[0])
                minute = int(parts[1]) if len(parts) > 1 else 0
            except Exception:
                hour, minute = 9, 0

            from datetime import time as time_
            # Treat scheduled_date+time as user-local; convert to naive UTC for the DB.
            start_dt = from_user_naive(datetime.combine(date_obj, time_(hour, minute)))

            # Get task duration to calculate end time
            all_tasks = crud.get_tasks()
            task_obj = next((t for t in all_tasks if t.id == task_id), None)
            duration = (task_obj.estimated_minutes if task_obj and task_obj.estimated_minutes else 30)
            end_dt = start_dt + timedelta(minutes=duration)

            # Use atomic schedule_task: sets status + creates calendar event
            task, event = crud.schedule_task(task_id, start_dt, end_dt)
            updated.append({
                "task_id": task_id,
                "title": task.title,
                "scheduled_at": _dt_str(task.scheduled_at),
                "event_id": event.id,
            })

        except Exception as exc:
            errors.append(f"Failed to schedule task {task_id}: {exc}")

    return {
        "updated_count": len(updated),
        "updated": updated,
        "error_count": len(errors),
        "errors": errors,
    }


# ---------------------------------------------------------------------------
#  Google Calendar sync tool definition
# ---------------------------------------------------------------------------

_SYNC_GOOGLE_CALENDAR: dict = {
    "name": "sync_google_calendar",
    "description": (
        "Sync events from a Google Calendar into the local planner. "
        "Fetches events from 30 days ago to 90 days in the future, creates new "
        "local events for any unseen google_event_id, refreshes existing ones, "
        "and marks events absent from the latest fetch as stale. "
        "Returns a summary with counts of created, updated, and stale-marked events. "
        "Requires Google Calendar to be connected in Settings first."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "calendar_id": {
                "type": "string",
                "description": (
                    "Google Calendar ID to sync. "
                    "Use 'primary' for the user's main calendar (default). "
                    "Other IDs can be found by listing calendars in Settings."
                ),
            },
        },
        "required": [],
    },
}


# ---------------------------------------------------------------------------
#  Google Calendar sync executor
# ---------------------------------------------------------------------------

def _exec_sync_google_calendar(args: dict) -> dict:
    from integrations.google_calendar import is_authenticated, sync_calendar

    if not is_authenticated():
        return {
            "error": (
                "Google Calendar is not connected. "
                "Visit Settings → Google Calendar to connect."
            )
        }
    calendar_id = args.get("calendar_id", "primary")
    return sync_calendar(calendar_id)


# ---------------------------------------------------------------------------
#  User preference tool definitions
# ---------------------------------------------------------------------------

_GET_USER_PREFERENCE: dict = {
    "name": "get_user_preference",
    "description": (
        "Look up a single user-preference value by key. Returns null if unset. "
        "Common keys: 'work_start_hour', 'work_end_hour', 'schedule_buffer_minutes'."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "key": {
                "type": "string",
                "description": "Preference key (required).",
            },
        },
        "required": ["key"],
    },
}

_SET_USER_PREFERENCE: dict = {
    "name": "set_user_preference",
    "description": (
        "Set or update a single user-preference value. Upsert — creates the key "
        "if missing, otherwise replaces the existing value. "
        "Common keys: 'work_start_hour' (e.g. '9'), 'work_end_hour' (e.g. '18'), "
        "'schedule_buffer_minutes' (e.g. '15'). Values are stored as strings."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "key":   {"type": "string", "description": "Preference key (required)."},
            "value": {"type": "string", "description": "Preference value (required, stored as string)."},
        },
        "required": ["key", "value"],
    },
}


def _exec_get_user_preference(args: dict) -> dict:
    value = crud.get_preference(args["key"])
    return {"key": args["key"], "value": value}


def _exec_set_user_preference(args: dict) -> dict:
    pref = crud.set_preference(args["key"], str(args["value"]))
    return {"key": pref.key, "value": pref.value}


# ---------------------------------------------------------------------------
#  Tool registry
# ---------------------------------------------------------------------------

TASK_TOOLS: list[dict]        = [_GET_TASKS, _CREATE_TASK, _UPDATE_TASK, _DELETE_TASK]
GOAL_TOOLS: list[dict]        = [_GET_GOALS, _CREATE_GOAL, _UPDATE_GOAL, _DELETE_GOAL]
HABIT_TOOLS: list[dict]       = [
    _GET_HABITS, _CREATE_HABIT, _UPDATE_HABIT, _ARCHIVE_HABIT,
    _MARK_HABIT_COMPLETE, _UNMARK_HABIT_COMPLETE,
]
CALENDAR_TOOLS: list[dict]    = [_GET_EVENTS, _CREATE_EVENT, _UPDATE_EVENT, _DELETE_EVENT, _MOVE_EVENT]
AGGREGATE_TOOLS: list[dict]   = [_GET_TODAY_OVERVIEW, _GET_WEEKLY_SUMMARY, _SUGGEST_SCHEDULE]
INTEGRATION_TOOLS: list[dict] = [_SYNC_GOOGLE_CALENDAR]
SCHEDULING_TOOLS: list[dict]  = [_APPLY_SCHEDULE, _UNSCHEDULE_TASK]
PREFERENCE_TOOLS: list[dict]  = [_GET_USER_PREFERENCE, _SET_USER_PREFERENCE]

# Flat list passed to the Claude API `tools` parameter
ALL_TOOLS: list[dict] = [
    *TASK_TOOLS,
    *GOAL_TOOLS,
    *HABIT_TOOLS,
    *CALENDAR_TOOLS,
    *AGGREGATE_TOOLS,
    *INTEGRATION_TOOLS,
    *SCHEDULING_TOOLS,
    *PREFERENCE_TOOLS,
]

_EXECUTORS: dict[str, Callable[[dict], dict]] = {
    "get_tasks":               _exec_get_tasks,
    "create_task":             _exec_create_task,
    "update_task":             _exec_update_task,
    "delete_task":             _exec_delete_task,
    "get_goals":               _exec_get_goals,
    "create_goal":             _exec_create_goal,
    "update_goal":             _exec_update_goal,
    "delete_goal":             _exec_delete_goal,
    "get_habits":              _exec_get_habits,
    "create_habit":            _exec_create_habit,
    "update_habit":            _exec_update_habit,
    "archive_habit":           _exec_archive_habit,
    "mark_habit_complete":     _exec_mark_habit_complete,
    "unmark_habit_complete":   _exec_unmark_habit_complete,
    "get_events":              _exec_get_events,
    "create_event":            _exec_create_event,
    "update_event":            _exec_update_event,
    "delete_event":            _exec_delete_event,
    "move_event":              _exec_move_event,
    "get_today_overview":      _exec_get_today_overview,
    "get_weekly_summary":      _exec_get_weekly_summary,
    "suggest_schedule":        _exec_suggest_schedule,
    "sync_google_calendar":    _exec_sync_google_calendar,
    "apply_schedule":          _exec_apply_schedule,
    "unschedule_task":         _exec_unschedule_task,
    "get_user_preference":     _exec_get_user_preference,
    "set_user_preference":     _exec_set_user_preference,
}


def execute_tool(name: str, args: dict) -> dict:
    """
    Dispatch a tool call by name and return a JSON-serialisable result dict.

    All exceptions are caught and returned as {"error": "..."} so the agent
    loop can surface them to Claude as tool results without crashing.
    """
    if name not in _EXECUTORS:
        return {
            "error": f"Unknown tool '{name}'. Available tools: {list(_EXECUTORS.keys())}"
        }
    try:
        return _EXECUTORS[name](args)
    except PermissionError as exc:
        return {"error": f"Permission denied — {exc}"}
    except ValueError as exc:
        return {"error": f"Invalid input — {exc}"}
    except Exception as exc:
        return {"error": f"Tool '{name}' failed: {type(exc).__name__}: {exc}"}
