# Productivity Planner — Claude Code Briefing

This file is the authoritative context document for this codebase.
Read it fully at the start of every new session before touching any file.

---

## What to Build This Session

**All 11 phases are complete.** The productivity planner is fully implemented.

### Reminder: session workflow

At the end of every phase, update this file before closing the window:
1. Mark the phase ✅ **COMPLETE** in the Build Phases table
2. Add implementation notes to the Pages section
3. Update agent tools table if tools were added
4. Update "What to Build This Session" to the next phase

Then open a **new Claude Code window** for the next phase. Each phase fits comfortably in a
single window; do not carry multiple phases in one window.

---

## Build Phases — Status

| Phase | What | Status |
|---|---|---|
| **1** | `db/schema.py`, `db/crud.py` — all 6 tables, CRUD, soft deletes, optimistic locking | ✅ **COMPLETE** |
| **2** | `app.py`, Streamlit skeleton, sidebar nav, page stubs, `utils/toast.py`, `utils/date_utils.py` | ✅ **COMPLETE** |
| **3** | `pages/tasks.py` (full), `agent/tools.py` (task tools), `agent/__init__.py` | ✅ **COMPLETE** |
| **4** | `pages/dashboard.py` — Today at a Glance, task/habit/goal/calendar widgets, quick actions | ✅ **COMPLETE** |
| **5** | `pages/goals.py` (full) + goal agent tools in `agent/tools.py` | ✅ **COMPLETE** |
| **6** | `pages/habits.py` (full) + habit agent tools in `agent/tools.py` | ✅ **COMPLETE** |
| **7** | `pages/calendar.py` (full) + calendar agent tools in `agent/tools.py` | ✅ **COMPLETE** |
| **8** | Aggregate tools: `get_today_overview`, `get_weekly_summary`, `suggest_schedule` | ✅ **COMPLETE** |
| **9** | `pages/ai_chat.py` (full) + `agent/agent.py` — Claude client, system prompt, tool loop | ✅ **COMPLETE** |
| **10** | `pages/settings.py` (full) + seed data + `assets/style.css` + global polish | ✅ **COMPLETE** |
| **11** | `integrations/google_calendar.py` — OAuth, event fetch, sync; wire into all tools | ✅ **COMPLETE** |

---

## How to Run

```bash
python3 -m streamlit run app.py   # NOTE: streamlit not on $PATH — always use python3 -m
python3 test_db.py                # Phase 1 DB smoke tests (7 tests, all passing)
```

**Secrets:** `.env` in project root contains `ANTHROPIC_API_KEY`. `data/` is git-ignored (holds `planner.db` and `google_token.json`).

---

## Critical Rules — Read Before Writing Any Code

- **Python 3.9 — never `X | None`:** Use `Optional[X]` from `typing` everywhere. No `X | Y` union syntax. No `from __future__ import annotations` workaround — it masks the problem.
- **`st.cache_data.clear()` after every write:** Keeps the sidebar overdue badge fresh. Required in every page that writes to the DB, not just tasks.
- **Optimistic locking:** UI pages MUST pass `current_updated_at=obj.updated_at` to `update_task()` / `update_goal()`. Agent tool executors never pass it.
- **`st.date_input` returns `()` not `None`:** Guard every date input: `val if isinstance(val, date) else None`.
- **`is_read_only` in the UI:** Never render edit/delete controls when `event.is_read_only == True`. The CRUD layer also raises `PermissionError` — catch it explicitly alongside general exceptions.
- **All DB access via `crud.py`:** No direct ORM queries outside `db/crud.py` — in pages or agent tools.
- **Expander open-state after writes:** Set `st.session_state[f"expanded_{id}"] = True` before `st.rerun()` to keep the expander open with fresh data.
- **`app.py` bootstrap order:** `load_dotenv()` → `db_init()` → `st.set_page_config()` (must be the first Streamlit call) → sidebar content → `pg.run()`. Order is mandatory.
- **Habits use `is_active`, not `deleted_at`:** Archival = `archive_habit()` sets `is_active=False`. Tasks, Goals, and CalendarEvents use soft-delete (`deleted_at`). Do not mix these up.
- **`execute_tool()` never raises:** Always returns `{"error": "..."}` on failure. The agent loop passes this to Claude as a tool result without crashing.

---

## Project Overview

A local-first, all-in-one personal productivity planner built with Streamlit + SQLite + Claude AI.
Single-user, no cloud sync, no auth. All data lives in `./data/planner.db`.
The AI agent has full read/write access to all planning data via the same CRUD layer as the UI.

**Spec file:** `productivity_planner_spec_v2.1.docx` in the project root.
Read it for authoritative UI/feature requirements. This CLAUDE.md captures implementation decisions on top of it.

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Python | CPython | **3.9.6** |
| UI | Streamlit | 1.50.0 |
| Database | SQLite via SQLAlchemy ORM | SQLAlchemy 2.x |
| AI Agent | Anthropic Claude API | `claude-sonnet-4-6` |
| Agent framework | Native tool use (function calling) | — |
| Date/time | Python `datetime` + `arrow` | — |
| Auth/secrets | `python-dotenv` | — |
| Google Calendar | `google-api-python-client`, `google-auth-oauthlib`, `google-auth-httplib2` | Phase 11 only |

---

## File Structure

```
productivity-planner/
│
├── app.py                        Entry point — bootstrap, routing, sidebar nav
│
├── db/
│   ├── __init__.py
│   ├── schema.py                 SQLAlchemy ORM models + db_init() + get_session()
│   └── crud.py                   All CRUD helpers (shared by UI pages and agent tools)
│
├── pages/                        Streamlit page modules (run by st.navigation())
│   ├── dashboard.py
│   ├── tasks.py
│   ├── goals.py
│   ├── calendar.py
│   ├── habits.py
│   ├── ai_chat.py
│   └── settings.py
│
├── agent/
│   ├── __init__.py
│   ├── tools.py                  Tool definitions + executors
│   └── agent.py                  (Phase 9)
│
├── integrations/
│   └── google_calendar.py        (Phase 11)
│
├── utils/
│   ├── __init__.py
│   ├── toast.py                  show_toast() wrapper around st.toast()
│   └── date_utils.py             today(), week_days(), friendly_date(), is_overdue(), start_of_week()
│
├── assets/
│   └── style.css                 (Phase 10)
│
├── data/                         Git-ignored runtime directory
│   ├── planner.db                SQLite database (auto-created by db_init())
│   └── google_token.json         OAuth token (Phase 11)
│
├── test_db.py                    Phase 1 smoke tests (7 tests)
├── requirements.txt
├── .env                          Git-ignored — contains ANTHROPIC_API_KEY
└── CLAUDE.md                     This file
```

---

## Database Schema (`./data/planner.db`)

All models are in `db/schema.py`. SQLAlchemy classic declarative style (`declarative_base()`).
`db_init(path)` creates all tables; safe to call multiple times (`checkfirst=True`).
Session factory: `expire_on_commit=False` so ORM objects remain accessible after session closes.

### Table: `tasks`

| Column | SQLAlchemy Type | Notes |
|---|---|---|
| `id` | Integer PK | autoincrement |
| `title` | Text | NOT NULL |
| `description` | Text | optional notes |
| `status` | Text | `todo` \| `in_progress` \| `done` \| `cancelled` — default `todo` |
| `priority` | Text | `low` \| `medium` \| `high` \| `urgent` — default `medium` |
| `due_date` | Date | optional |
| `project_id` | Integer FK → `goals.id` | nullable |
| `scheduled_at` | DateTime | set when agent time-blocks the task |
| `estimated_minutes` | Integer | duration estimate for time-blocking |
| `energy_level` | Text | `low` \| `medium` \| `high` — for smart scheduling |
| `tags` | Text | comma-separated string |
| `created_at` | DateTime | auto-set on insert |
| `updated_at` | DateTime | auto-updated; used for **optimistic locking** |
| `deleted_at` | DateTime | NULL = active; set = soft-deleted |

Relationships: `project` → `Goal`, `calendar_events` → `[CalendarEvent]`

### Table: `goals`

| Column | SQLAlchemy Type | Notes |
|---|---|---|
| `id` | Integer PK | autoincrement |
| `title` | Text | NOT NULL |
| `description` | Text | |
| `status` | Text | `active` \| `paused` \| `completed` \| `archived` — default `active` |
| `target_date` | Date | optional deadline |
| `progress_pct` | Integer | 0–100 |
| `progress_mode` | Text | `manual` \| `auto` — `auto` recalculates from linked task completion |
| `parent_id` | Integer FK → `goals.id` | self-referential; one level of nesting for prototype |
| `created_at` | DateTime | |
| `updated_at` | DateTime | auto-updated; used for **optimistic locking** |
| `deleted_at` | DateTime | soft delete |

Relationships: `tasks` → `[Task]`, `subgoals` → `[Goal]`, `parent` → `Goal`

Self-referential relationship uses string-based foreign_keys to avoid class-not-yet-defined issues:
```python
subgoals = relationship("Goal", back_populates="parent", foreign_keys="Goal.parent_id")
parent   = relationship("Goal", back_populates="subgoals", remote_side="Goal.id", foreign_keys="Goal.parent_id")
```

### Table: `calendar_events`

| Column | SQLAlchemy Type | Notes |
|---|---|---|
| `id` | Integer PK | |
| `title` | Text | NOT NULL |
| `description` | Text | |
| `event_type` | Text | `task_block` \| `meeting` \| `personal` \| `reminder` \| `google_import` |
| `start_datetime` | DateTime | NOT NULL |
| `end_datetime` | DateTime | NOT NULL |
| `location` | Text | Zoom link, address, etc. |
| `task_id` | Integer FK → `tasks.id` | nullable — links time block to a task |
| `is_recurring` | Boolean | default False |
| `recurrence_rule` | Text | simple RRULE string |
| `source` | Text | `local` \| `google` — default `local` |
| `google_event_id` | Text | Google Calendar event ID; NULL for local. Deduplication key on re-sync. |
| `google_calendar_id` | Text | which Google calendar this came from |
| `is_read_only` | Boolean | TRUE for all Google-imported events; **enforced at CRUD layer** |
| `sync_stale` | Boolean | TRUE if event was in a previous sync but absent from latest fetch |
| `created_at` | DateTime | |
| `deleted_at` | DateTime | soft delete — only applies to `source='local'` events |

**Critical:** `update_event` and `delete_event` in `crud.py` raise `PermissionError` if
`is_read_only=True`. This is enforced at the data layer, not just the UI.
The UI does not render edit/delete controls for read-only events.

### Table: `habits`

| Column | SQLAlchemy Type | Notes |
|---|---|---|
| `id` | Integer PK | |
| `title` | Text | NOT NULL |
| `description` | Text | |
| `frequency` | Text | `daily` \| `weekdays` \| `weekly` \| `custom` |
| `target_days` | Text | JSON array of day indices (0=Mon) for `custom` frequency |
| `time_of_day` | Text | `morning` \| `afternoon` \| `evening` \| `anytime` — default `anytime` |
| `streak_current` | Integer | auto-calculated by `_recalculate_streaks()` |
| `streak_best` | Integer | auto-calculated; never decremented |
| `is_active` | Boolean | default True; set False to archive (no `deleted_at`) |
| `created_at` | DateTime | |

**No `deleted_at`**: habits use `is_active=False` for archival (history preserved).
`get_habits()` sorts by `time_of_day` order: morning → afternoon → evening → anytime.

### Table: `habit_completions`

| Column | SQLAlchemy Type | Notes |
|---|---|---|
| `id` | Integer PK | |
| `habit_id` | Integer FK → `habits.id` | NOT NULL |
| `completed_date` | Date | NOT NULL |
| `completed_at` | DateTime | exact completion timestamp |
| `note` | Text | optional note |

`mark_habit_complete()` is **idempotent** — returns existing row if already logged for that date.
`unmark_habit_complete()` returns `True` if deleted, `False` if no row existed.

### Table: `ai_conversation_history`

| Column | SQLAlchemy Type | Notes |
|---|---|---|
| `id` | Integer PK | |
| `session_id` | Text | groups messages in a conversation |
| `role` | Text | `user` \| `assistant` \| `tool` — NOT NULL |
| `content` | Text | message text or tool call JSON |
| `tool_name` | Text | set when `role='tool'` |
| `token_count` | Integer | tracked for context window management |
| `created_at` | DateTime | |

---

## CRUD Layer (`db/crud.py`)

**Rule:** All reads and writes by both the UI and the agent go through `crud.py`. No direct ORM
queries outside this file. This guarantees a single consistent data layer.

### Session pattern

```python
# get_session() is a contextmanager in db/schema.py
with get_session() as session:
    # ... queries ...
    session.flush()      # write to DB within transaction
    return obj           # obj is still accessible (expire_on_commit=False)
# session.commit() on exit, session.rollback() on exception
```

### Available functions

**Tasks:** `get_tasks()`, `create_task()`, `update_task()`, `delete_task()`
**Goals:** `get_goals()`, `create_goal()`, `update_goal()`, `delete_goal()`
**Calendar Events:** `get_events()`, `create_event()`, `update_event()`, `delete_event()`
**Habits:** `get_habits()`, `create_habit()`, `update_habit()`, `archive_habit()`
**Habit Completions:** `mark_habit_complete()`, `unmark_habit_complete()`, `get_habit_completions()`
**AI History:** `add_message()`, `get_conversation()`, `get_sessions()`

### Optimistic locking (Tasks + Goals only)

```python
# UI passes the updated_at it read from DB; if row changed since, raises ValueError
crud.update_task(task_id, current_updated_at=task.updated_at, status="done")
crud.update_goal(goal_id, current_updated_at=goal.updated_at, progress_pct=75)

# Agent does NOT pass current_updated_at (no locking needed — agent is primary writer)
crud.update_task(task_id, status="done")
```

### Auto progress (Goals)

When `goal.progress_mode == "auto"`, `_recalculate_goal_progress(session, goal_id)` sets
`progress_pct` = (done tasks / total tasks) × 100. Called automatically on:
- `update_task()` when `status` is in the changed fields
- `delete_task()` when the task has a `project_id`
- `get_goals()` for every auto-mode goal on read

### Streak calculation (Habits)

`_recalculate_streaks(session, habit_id)` called automatically after `mark_habit_complete()`
and `unmark_habit_complete()`. Current streak resets to 0 if most recent completion is more
than 1 day ago. Best streak never decrements.

---

## Routing & Navigation (`app.py`)

Uses `st.navigation()` + `st.Page()` (Streamlit 1.37+, available in 1.50.0).
This **disables** Streamlit's automatic pages/ directory discovery — the nav is fully controlled.

```python
pg = st.navigation([
    st.Page("pages/dashboard.py",  title="Dashboard",          icon="🏠", default=True),
    st.Page("pages/tasks.py",      title=tasks_label,           icon="✅"),   # dynamic label
    st.Page("pages/goals.py",      title="Goals & Projects",    icon="🎯"),
    st.Page("pages/calendar.py",   title="Calendar & Schedule", icon="📅"),
    st.Page("pages/habits.py",     title="Habits & Routines",   icon="🔄"),
    st.Page("pages/ai_chat.py",    title="AI Assistant",        icon="🤖"),
    st.Page("pages/settings.py",   title="Settings",            icon="⚙️"),
])
pg.run()
```

**Overdue badge:** `_overdue_count()` is `@st.cache_data(ttl=60)` cached. The Tasks nav label
becomes `"Tasks & To-dos  •  N overdue"` when N > 0.
After any write that could change the overdue count, call `st.cache_data.clear()`.

**Bootstrap order in app.py (order matters):**
1. `load_dotenv()` — non-Streamlit, safe before set_page_config
2. `db_init()` — non-Streamlit, safe before set_page_config
3. `st.set_page_config(...)` — **must be the FIRST Streamlit call**
4. `@st.cache_data` functions — decorating is fine here
5. `st.sidebar` content added **before** `pg.run()` appears **above** the nav widget
6. `pg.run()` — executes the current page script

---

## Agent Tools (`agent/tools.py`)

### Architecture

Each tool is a dict following the Anthropic tool-use JSON Schema format.
Each executor function calls the corresponding `crud.py` function directly.
`execute_tool(name, args)` dispatches by name and catches all exceptions into `{"error": "..."}`.

```python
from agent.tools import ALL_TOOLS, execute_tool

# Pass to Claude API:
response = client.messages.create(..., tools=ALL_TOOLS, ...)

# Execute a tool call from the response:
result = execute_tool(tool_name, tool_input_dict)
```

### Tools currently in ALL_TOOLS (Phases 3–7)

**Task tools (Phase 3):**

| Tool | Required params | Optional params |
|---|---|---|
| `get_tasks` | none | `project_id`, `status`, `priority`, `due_date_from`, `due_date_to`, `tag`, `include_deleted` |
| `create_task` | `title` | `description`, `status`, `priority`, `due_date`, `project_id`, `estimated_minutes`, `energy_level`, `tags` |
| `update_task` | `task_id` | any Task field (only changed fields needed) |
| `delete_task` | `task_id` | — |

**Goal tools (Phase 5):**

| Tool | Required params | Optional params |
|---|---|---|
| `get_goals` | none | `status`, `parent_id`, `top_level_only`, `include_deleted` |
| `create_goal` | `title` | `description`, `status`, `target_date`, `progress_pct`, `progress_mode`, `parent_id` |
| `update_goal` | `goal_id` | any Goal field (only changed fields needed) |
| `delete_goal` | `goal_id` | — |

**Date handling in tools:** All dates go in/out as ISO-8601 strings (`YYYY-MM-DD`).
Executors convert with `_parse_date()` / `_date_str()`.
`update_task` / `update_goal` executors pop the ID key from args before passing `**args` to crud.
`_goal_to_dict()` serialises goal objects same pattern as `_task_to_dict()`.

**Habit tools (Phase 6):**

| Tool | Required params | Optional params |
|---|---|---|
| `get_habits` | none | `include_inactive`, `time_of_day` |
| `mark_habit_complete` | `habit_id`, `completed_date` | `note` |
| `unmark_habit_complete` | `habit_id`, `completed_date` | — |

`mark_habit_complete` executor checks for an existing completion via `get_habit_completions`
before calling the CRUD helper; returns `{"already_logged": true/false, "completion": {...}}`.
`_habit_to_dict()` serialises all Habit fields including `streak_current`, `streak_best`, `is_active`.

**Calendar tools (Phase 7):**

| Tool | Required params | Optional params |
|---|---|---|
| `get_events` | none | `start`, `end`, `source`, `include_stale`, `include_deleted` |
| `create_event` | `title`, `start_datetime`, `end_datetime` | `description`, `event_type`, `location`, `task_id` |
| `update_event` | `event_id` | any writable CalendarEvent field |
| `delete_event` | `event_id` | — |

`_event_to_dict()` serialises all CalendarEvent fields including `is_read_only`, `source`, `google_event_id`.
All datetimes go in/out as ISO-8601 strings via `_parse_dt()` / `_dt_str()`.
`update_event` and `delete_event` executors raise `PermissionError` for read-only events —
caught by the top-level `execute_tool()` exception handler and returned as `{"error": "..."}`.

**Aggregate tools (Phase 8):**

| Tool | Required params | Optional params |
|---|---|---|
| `get_today_overview` | none | — |
| `get_weekly_summary` | none | `week_offset` (int, default 0) |
| `suggest_schedule` | none | `date`, `start_hour` (default 9), `end_hour` (default 18) |

**Phase 11 tools:**

| Tool | Required params | Optional params |
|---|---|---|
| `sync_google_calendar` | none | `calendar_id` (default `"primary"`) |

`ALL_TOOLS` now has **19 tools** total.

---

## Pages — Implementation Status

### `pages/tasks.py` — COMPLETE (Phase 3)

**Features implemented:**
- NL quick-add bar (`st.form`, `clear_on_submit=True`) — parses `today`, `tomorrow`, weekday
  names (next occurrence, never today), `urgent` / `(high|medium|low) priority`, `#tag` patterns
- List view: `st.expander` per task, label shows priority icon + status icon + title + due date
  (with ⚠️ if overdue) + duration + tags
- Kanban view: 4 columns (To Do / In Progress / Done / Cancelled), toggled with
  `st.segmented_control` (Streamlit 1.44+)
- Edit form: `st.form` inside expander, all task fields editable. Two `st.form_submit_button`s
  (Save, Delete) — each returns True only when that specific button clicked.
- Optimistic lock passed on Save: `current_updated_at=task.updated_at`
- Expander stays open after Save: `st.session_state[f"expanded_{task.id}"] = True` before
  `st.rerun()`
- Bulk actions: checkbox per task + "select all" header checkbox; "Mark Done" + "Set Priority"
- Filters: `st.multiselect` for status/priority, `st.selectbox` for project, text for tag —
  all stored in `st.session_state` via widget `key=`
- Sort: due date / priority / created / duration — Python-side sort on fetched list
- Metrics strip: total active, overdue, in progress, done
- `st.cache_data.clear()` called after every write to refresh the overdue badge in the sidebar

**Session state keys used by tasks page:**
```
task_filter_status      list[str]   multiselect values
task_filter_priority    list[str]
task_filter_project     str         goal title or "All"
task_filter_tag         str
task_view_ctrl          str         "📋 List" | "🗂 Kanban" (segmented_control key)
task_sort_ctrl          str         sort label (selectbox key)
bulk_{task_id}          bool        per-task checkbox
expanded_{task_id}      bool        persists expander open state across reruns
```

**st.date_input quirk:** Returns a `date` object or an empty tuple `()` when no date is selected
(not `None`). Always guard: `due_clean = new_due if isinstance(new_due, date) else None`

### `pages/dashboard.py` — COMPLETE (Phase 4)

**Layout:** single-column header (Overdue Alert + Today at a Glance), then two equal columns
(`left_col`: Today's Tasks + Habit Check-in; `right_col`: Goals Progress + This Week), then
AI Quick Chat stub at the bottom.

**Widgets:**
- **Overdue Alert** — `st.error()` banner, only shown when overdue count > 0; directs user to Tasks page
- **Today at a Glance** — `st.container(border=True)` card with date, day name, auto-generated
  plain-English summary (counts overdue / today / habits)
- **Today's Tasks** — top 5 tasks due or scheduled today, sorted by priority; ✅ button calls
  `crud.update_task(t.id, status="done")`, `show_toast()`, `st.cache_data.clear()`, `st.rerun()`
- **Habit Check-in** — all active habits sorted by `time_of_day`; ✓ marks complete, ↩️ unmarks;
  streak displayed as 🔥 N when > 1; strikethrough title when done
- **Goals Progress** — up to 6 active goals with `st.progress(pct/100, text=f"{pct}%")`;
  shows target date if set; note when more than 6 exist
- **This Week's Calendar** — Mon–Fri `st.expander` per day (today expanded by default);
  events sorted by start time; 🟣 for Google import events, 🔵 for local
- **AI Quick Chat stub** — disabled `st.text_input` + `st.button`; directs to AI Assistant page

**Data loading:** all DB calls happen once at the top of the page entry point, no caching on
the dashboard itself (it reads fresh every render, which is correct for a live overview).

**Session state keys:** none — dashboard is stateless (buttons trigger `st.rerun()` directly).

### `pages/goals.py` — COMPLETE (Phase 5)

**Features:**
- **Goal cards** (`st.expander`) — header: status icon + title + target date + progress %;
  body: `st.progress(pct/100)`, mode caption, quick mode toggle button, 3-tab layout
- **Progress mode toggle** — button outside edit form calls `crud.update_goal(id, progress_mode=X)`
  directly; expander stays open via `st.session_state[f"goal_expanded_{goal.id}"] = True`
- **Three-tab card layout** — `✏️ Edit` / `📋 Linked Tasks` / `🎯 Sub-goals`
- **Edit form** (`st.form`) — title, status (4 options), target date, progress mode, parent goal
  selector, description, manual progress slider; Save uses optimistic locking
  (`current_updated_at=goal.updated_at`); Delete soft-deletes
- **Manual progress slider** — always rendered; save handler applies `progress_pct` only when
  mode is "manual"; help text clarifies it is ignored for auto mode
- **Linked tasks tab** — `crud.get_tasks(project_id=goal.id)`; shows priority/status icons,
  title, due date, duration; "X / N tasks completed" caption
- **Sub-goals tab** — renders sub-goals as expandable mini-cards (Edit + Linked Tasks tabs only,
  no further nesting); sub-goals shown regardless of active filter
- **Sub-goal cards** — same progress bar + mode toggle + edit form as top-level, minus Sub-goals tab
- **Create form** — `st.expander` with `clear_on_submit=True` form; handler inside form context
  (same pattern as tasks quick-add); all fields including parent selector and initial progress %
- **Filters** — status multiselect + "Show archived" checkbox; sub-goals follow their parent's
  visibility (they're inside parent cards, not in the main filtered list)
- **Metrics strip** — Total / Active / Completed / Paused

**Session state keys used by goals page:**
```
goal_filter_status      list[str]   multiselect values
goal_show_archived      bool        checkbox
goal_expanded_{id}      bool        persists expander open state across reruns
```

**`st.tabs` inside `st.expander`:** supported in Streamlit 1.50.0 and used for the 3-tab layout.
No key conflicts since form keys include the goal ID (`goal_edit_{goal.id}`).

### `pages/habits.py` — COMPLETE (Phase 6)

**Features implemented:**
- **Metrics strip** — Active Habits / Completed Today (N / total) / Best Streak Ever
- **Filter** — "Show archived habits" checkbox (`habit_show_archived` session key); passes
  `include_inactive=True` to `crud.get_habits()` when checked
- **Create form** — collapsible `st.expander`, `clear_on_submit=True`; fields: title,
  description, frequency (daily/weekdays/weekly/custom), time_of_day; custom frequency
  reveals a `st.multiselect` for day names → stored as JSON index array in `target_days`
- **Habit cards** — `st.expander` per habit; header: `time_of_day` icon + title
  (strikethrough when done + active) + streak (🔥 N) + frequency label + archived badge
- **Mark / unmark row** — shown only for active habits; `✓ Done` (primary) / `↩️ Unmark`;
  calls `crud.mark_habit_complete` / `crud.unmark_habit_complete` for `date.today()`;
  streak caption shows current streak + best streak; expander stays open via session state
- **Two-tab card layout** — `✏️ Edit` / `📅 History`
- **Edit form** — title, description, frequency, time_of_day, target_days (custom only);
  Save calls `crud.update_habit(habit_id, **fields)` (no optimistic locking);
  Archive button calls `crud.archive_habit(habit_id)` (sets `is_active=False`)
- **History tab** — 30-day completion grid; week rows × 7 columns aligned to Monday;
  green cell = completed, light-grey = missed, transparent = outside the 30-day window;
  summary caption shows "N / 30 days completed"

**Session state keys used by habits page:**
```
habit_show_archived     bool        "Show archived habits" checkbox
habit_expanded_{id}     bool        persists expander open state across reruns
```

**`target_days` encoding:** stored as a JSON array of day-index integers (0 = Mon … 6 = Sun).
UI converts `DAY_NAMES` selections → indices on save; reverses on load for the multiselect default.

### `pages/calendar.py` — COMPLETE (Phase 7)

**Features implemented:**
- **Metrics strip** — Events This Week / Today's Events / Upcoming (7 days); all three counts
  respect the Google-events filter
- **Week navigation** — `◀ Prev` / `Today` / `Next ▶` buttons adjust `cal_week_offset` (int in
  session state); week label formatted as "February 23–Mar 1, 2026" spanning months correctly
- **Filter** — "Show Google Calendar events" checkbox (`cal_show_google` session key); passes
  `source="local"` to all `crud.get_events()` calls when unchecked
- **Create event form** — collapsible `st.expander`, `clear_on_submit=True`; fields: title,
  description, event_type, location, date, task link (active tasks only), start time, end time;
  validates start < end; uses `datetime.combine(date_, time_obj)` before saving
- **Week grid** — 7 equal columns (Mon–Sun); today's column highlighted in blue;
  events are `st.expander` cards inside each column, sorted by `start_datetime`
- **Event cards** — header: `{source_icon} {HH:MM} {title (≤18 chars)}`; body shows type icon,
  duration, location caption; description shown if present
- **Read-only events** — Google-imported events (`is_read_only=True`) show an info badge with no
  edit/delete controls; enforced in UI before the form is rendered (CRUD layer also enforces)
- **Edit form** — `st.form` inside expander per local event; all fields editable; Save + Delete
  buttons; catches `PermissionError` separately from general exceptions; expander stays open
  via `st.session_state[f"cal_expanded_{event.id}"] = True` before `st.rerun()`
- `st.cache_data.clear()` called after every write to keep the sidebar overdue badge fresh

**Session state keys used by calendar page:**
```
cal_week_offset          int    week offset from current (0 = this week)
cal_show_google          bool   show/hide Google-imported events
cal_expanded_{event.id}  bool   persists expander open state across reruns
```

**Date/time handling:**
- `time.min` / `time.max` (from `datetime.time`) used to build full-day datetime bounds
- `datetime.combine(date_, time_obj)` used for all start/end datetime construction
- `event.start_datetime.time()` used as the default value for `st.time_input`
- `isinstance(val, date)` guard on all `st.date_input` returns (can return empty tuple)

### `agent/tools.py` — Aggregate tools COMPLETE (Phase 8)

**`get_today_overview`:** fetches tasks due today + tasks with `scheduled_at.date() == today`
(deduped by ID), active habits each annotated with `completed_today: bool`, and calendar events
overlapping today. Two separate CRUD calls for tasks (due filter + all-tasks scheduled filter).

**`get_weekly_summary`:** uses `start_of_week()` from `utils.date_utils` + `timedelta(weeks=N)`
for the `week_offset` param. Per-habit summary includes `completions` count, `streak_current`,
and `streak_best` for the week window.

**`suggest_schedule`:** first-fit greedy scheduler. Builds busy intervals from same-day calendar
events, merges overlaps, derives free slots. Tasks sorted by `energy_level` (high→morning,
low→afternoon) then `priority`. Each task scanned against free slots from `cur_minute` forward;
unfit tasks are skipped (not blocking subsequent smaller tasks). Returns `unscheduled_count`
alongside the slots list. Does NOT write to DB — caller must apply via `update_task`/`create_event`.

New import added to `agent/tools.py`: `timedelta` from `datetime` and `start_of_week` from
`utils.date_utils`. `from datetime import time as time_` aliased locally in each executor that
needs it to avoid shadowing the `time` module.

**`AGGREGATE_TOOLS`** list added to registry; `ALL_TOOLS` now has 18 tools total.

### `pages/ai_chat.py` — COMPLETE (Phase 9)

**Features implemented:**
- **Session state:** `chat_session_id` (UUID), `chat_turns` (list of `{role, text, tool_log}`),
  `chat_api_messages` (Anthropic API format for context) — all in `st.session_state`
- **Sidebar session history:** `crud.get_sessions()` lists past sessions (up to 15); each shown
  as a clickable button with timestamp + first-message preview; current session highlighted as
  `type="primary"`; "＋ New conversation" button at top creates a fresh UUID and clears state
- **`_load_session(session_id)`:** reconstructs `chat_turns` and `chat_api_messages` from DB
  records; pairs tool-call records (`role='assistant'`, `tool_name` set) with their tool-result
  records (`role='tool'`) into `tool_log` lists on the assistant turn; flushes pending tool log
  at end of records
- **Chat display loop:** iterates `chat_turns`; renders each turn in `st.chat_message(role)`;
  shows `st.markdown(text)` for message body; calls `_render_tool_log()` for tool entries
- **`_render_tool_log(tool_log)`:** one `st.expander` per entry, label = `🔧 \`tool_name\``;
  shows Input (`st.json(args)`) and Result (`st.json(result)` or `st.error` for error dicts)
- **`st.chat_input`:** returns prompt when submitted; user message displayed immediately in
  current render pass; added to `chat_turns` and `chat_api_messages`; agent called with
  `st.spinner("Thinking…")`; response displayed inline; then stored in session state
- **Error handling:** `try/except` around `run_agent` call; `st.error` shown inline in the
  assistant message bubble on failure
- **ANTHROPIC_API_KEY guard:** `st.warning` shown if env var is missing (checked via `os.environ`)
- **`st.cache_data.clear()`** called after every successful agent response

**Session state keys:**
```
chat_session_id      str         UUID for current conversation
chat_turns           List[dict]  display turns: {role, text, tool_log}
chat_api_messages    List[dict]  Anthropic API-format messages for context
```

### `agent/agent.py` — COMPLETE (Phase 9)

**`_build_system_prompt()`:** embeds today's date (formatted as "Weekday, Month DD, YYYY");
describes assistant role, 5 capability areas, and 18-tool count; instructs agent to always
fetch fresh data and be concise.

**`_block_to_dict(block)`:** converts Anthropic response content blocks to plain dicts;
handles `text`, `tool_use`; falls back to `block.model_dump()` for unknown types.

**`run_agent(messages, session_id)`:**
- Persists the incoming user message (last item in `messages`) via `crud.add_message()`
  before making any API call; strips list-format content to plain text for storage
- **Tool-use loop** (max 10 iterations):
  - `stop_reason == "end_turn"` → extracts text, persists to DB, returns; `break`
  - `stop_reason == "tool_use"` → collects inline text; appends assistant message with
    `[_block_to_dict(b) for b in response.content]` to `working_messages`; for each
    `tool_use` block: calls `execute_tool()`, appends to `tool_calls_log`, persists
    call record (`role='assistant'`, `tool_name=name`) and result record (`role='tool'`),
    builds `tool_result` dict with `tool_use_id`; appends `{role:'user', content:tool_results}`
    to `working_messages`; continues loop
  - Other stop reason → appends stop reason to `response_text`, persists, `break`
  - Loop `else` clause (exhausted iterations) → sets max-iterations message, persists
- Returns `(response_text, tool_calls_log)`; `execute_tool()` never raises so agent never
  crashes on tool failures (errors surface as `{"error": "..."}` in tool results)

### `pages/settings.py` — COMPLETE (Phase 10)

**Features implemented:**
- **Database section** — two rows of `st.metric` showing active + total row counts for tasks,
  goals, habits, calendar events, habit completions, and AI messages; powered by
  `crud.get_db_stats()` (new function added in Phase 10)
- **Export** — "Prepare Export" button serialises all DB records (including soft-deleted and
  inactive rows) via `_build_export_json()` and stores the JSON string in session state;
  `st.download_button` is then rendered to let the user save the file; "Cancel" clears session
  state. `_obj_to_dict()` serialises ORM objects using `obj.__table__.columns` for full fidelity.
- **Clear all data** — `st.warning` banner + checkbox confirmation guard (`settings_clear_confirm`
  key); once checked, primary "Clear All Data" button calls `crud.clear_all_data()` (new function
  added in Phase 10), clears `st.cache_data`, resets session state, shows success, and reruns.
- **Seed Data section** — description table (tasks/goals/habits/events counts); "Force re-seed"
  checkbox; "Seed Database" button calls `seed_database(force=...)` from `utils/seed.py`;
  shows `st.warning` if skipped, `st.success` with counts if inserted; calls
  `st.cache_data.clear()` and `st.rerun()` on success.
- **About section** — two-column layout: app version, Python/Streamlit/SQLAlchemy/platform
  versions; spec file name and DB path.

**New CRUD functions added to `db/crud.py`:**
- `get_db_stats()` — returns dict of active + total counts per table
- `clear_all_data()` — hard-deletes all rows in FK-safe order; returns per-table deleted counts

**`utils/seed.py`:**
- `seed_database(force=False)` — inserts 10 tasks, 6 goals (4 top-level + 2 sub-goals),
  5 habits, 6 calendar events
- "Launch Personal Website" goal uses `progress_mode="auto"` with 4 linked tasks
- All dates are relative to `date.today()` so seed data stays fresh on any run date
- `_tables_empty()` guard checks tasks + goals + habits before inserting when `force=False`
- Returns `{"skipped": True, "reason": "..."}` or `{"tasks": N, "goals": N, ...}`

**`assets/style.css`:**
- Created; loaded by `app.py` via `Path(__file__).parent / "assets" / "style.css"` and
  injected with `st.markdown("<style>…</style>", unsafe_allow_html=True)` after `set_page_config`.
- Tweaks: sidebar width (230–265 px), expander header padding, metric label font size,
  chat bubble padding/radius, progress bar border-radius, form border-radius.

**`app.py` change:**
- Added `from pathlib import Path`; CSS is loaded after `st.set_page_config()` on every render.

**Session state keys used by settings page:**
```
settings_export_json     str     cached JSON string between Prepare/Download clicks
settings_clear_confirm   bool    confirmation checkbox for clear all data
settings_seed_force      bool    force re-seed checkbox
```

### `integrations/google_calendar.py` — COMPLETE (Phase 11)

**Files created/modified:**
- `integrations/__init__.py` — empty package init
- `integrations/google_calendar.py` — full OAuth + sync implementation
- `db/crud.py` — added `update_google_event()` (bypasses `is_read_only` for sync)
- `agent/tools.py` — added `_SYNC_GOOGLE_CALENDAR` tool + `_exec_sync_google_calendar` executor
- `pages/settings.py` — added Google Calendar section (section 2 of 5)
- `app.py` — added global OAuth callback handler (before overdue counter)

**OAuth flow:**
- Client secrets stored in `data/google_client_secrets.json` (user must create via Google Cloud Console)
- Token stored in `data/google_token.json`; auto-refreshed when expired
- OAuth state persisted in `data/google_auth_pending.json` between the initial redirect and callback
- Redirect URI defaults to `http://localhost:8501`; overridable via `STREAMLIT_REDIRECT_URI` env var
- **Global callback handler in `app.py`** detects `?code=` query param on any page, exchanges the
  code, and redirects cleanly — works regardless of which page Streamlit shows after Google's redirect

**Key functions:**
- `has_client_secrets()` — checks for `data/google_client_secrets.json`
- `is_authenticated()` — checks token validity; auto-refreshes if expired
- `get_auth_url(redirect_uri)` — generates OAuth URL; saves state to pending file; returns URL
- `has_pending_auth()` — True if pending auth file exists
- `exchange_code(code)` — reads state from pending file; exchanges code; persists token
- `revoke_token()` — deletes token file and pending file
- `list_calendars()` — returns user's calendar list via API
- `fetch_events(calendar_id, start, end)` — paginates through all events; returns raw dicts
- `sync_calendar(calendar_id)` — full sync: create/update events, mark stale absent events
- `get_last_sync(calendar_id)` / `get_all_synced_calendars()` — reads `data/google_sync_info.json`

**Sync behaviour:**
- Window: 30 days back → 90 days forward from now (UTC)
- Dedup key: `google_event_id`
- New events: `crud.create_event()` with `source='google'`, `is_read_only=True`, `event_type='google_import'`
- Existing events: `crud.update_google_event()` to refresh title/times and clear `sync_stale`
- Absent events: `sync_stale=True` (not deleted, protected against partial-sync data loss)
- Last-sync timestamp written to `data/google_sync_info.json` per calendar

**`pages/settings.py` Google Calendar section:**
- State machine: Setup (no client_secrets) → Not Connected → Connected
- Setup state: collapsible instructions expander with step-by-step Google Cloud Console guide
- Not Connected: "Connect" button generates auth URL + shows clickable link; "Cancel" cleans up
- Connected: calendar selectbox, last-sync caption, synced event count, "Sync Now" (primary),
  "↺ Refresh list" button (clears `gc_calendars` session cache and re-fetches),
  "Disconnect" button; calendar list cached in `st.session_state["gc_calendars"]`

**Bug fixes applied post-Phase 11:**
- `list_calendars()` now passes `showHidden=True` to `calendarList().list()` — required for
  URL-subscribed calendars ("Other calendars" → "Subscribe from URL") which Google marks as
  hidden entries and excludes from the default API response
- `list_calendars()` now paginates (was single-page, missed calendars beyond first 100)
- Settings page: added "↺ Refresh list" button to force-clear the `gc_calendars` session cache

**Session state keys added by settings page (Google Calendar):**
```
gc_auth_url          str        OAuth authorization URL (shown as clickable link)
gc_calendars         List[dict] cached calendar list from API
gc_selected_cal_idx  int        selectbox index for calendar selection
```

**Agent tools added (Phase 11):**

| Tool | Required params | Optional params |
|---|---|---|
| `sync_google_calendar` | none | `calendar_id` (default `"primary"`) |

`sync_google_calendar` executor imports from `integrations.google_calendar` lazily (inside the
function) so the agent module does not hard-depend on the google packages being installed.

---

## Key Implementation Decisions

### Type hints — Python 3.9 compatibility
**Never use `X | Y` union syntax.** Use `Optional[X]` from `typing`.
`from __future__ import annotations` prevents runtime errors but is not a fix — avoid the pattern entirely.
Affected modules must import `Optional` from `typing`.

### Soft deletes
Tasks, Goals, CalendarEvents have `deleted_at DATETIME`. `NULL` = active, set = deleted.
All queries default to `filter(Model.deleted_at.is_(None))`.
Pass `include_deleted=True` to see deleted rows.
Habits do NOT use soft delete — they use `is_active=False` (archive, history preserved).

### Optimistic locking (Tasks + Goals)
`update_task(task_id, current_updated_at=X, ...)` adds `WHERE updated_at = X` to the query.
If the row was modified by another operation since it was last read, the query returns None
and raises `ValueError`. UI pages pass `task.updated_at`; agent does not (no concurrency risk).

### `is_read_only` enforcement at CRUD layer
`update_event()` and `delete_event()` raise `PermissionError` if `event.is_read_only = True`.
Enforced in Python before the SQL — agent cannot bypass this even with a wrong tool call.
Google-imported events have `source='google'`, `is_read_only=True`, `event_type='google_import'`.

### `expire_on_commit=False` in SessionLocal
ORM objects remain accessible after the session closes. Without this, accessing attributes
after `session.commit()` would trigger a lazy-load on a closed session and raise an error.

### `st.navigation()` for routing
Uses Streamlit 1.37+ API. Disables automatic `pages/` directory discovery.
The `pages/*.py` files are executed as scripts (not imported as modules) when their page is active.
`app.py` code runs **before** the page script on every rerun — `db_init()` and `load_dotenv()`
therefore run on every page load, which is intentional and safe.

### `st.cache_data.clear()` after writes
Called after any write in the tasks page (and will be called in all future pages) to force
`_overdue_count()` in `app.py` to recompute on the next rerun, keeping the sidebar badge fresh.

### NL quick-add parser
Pure regex, no AI. Processes text in this order: extract tags → extract priority → extract date →
remaining text = title. Collapsed whitespace at the end. Day names always resolve to the NEXT
occurrence (never today, even if today is that weekday).

### `st.form` inside `st.expander`
Edit forms use `st.form` so field changes do not trigger reruns until Save is clicked.
Two `st.form_submit_button`s (Save, Delete) coexist in one form — each returns `True` only
when that specific button is clicked.
After Save, set `st.session_state[f"expanded_{task.id}"] = True` then call `st.rerun()` to
keep the expander open with fresh data.

### Agent tool executor pattern
```python
def execute_tool(name: str, args: dict) -> dict:
    # Returns {"error": "..."} on any failure — never raises
    # Agent loop receives this as a tool result, surfaces it to Claude
```
All tool executor functions copy the args dict before mutating it (e.g. popping `task_id`).

### Google Calendar columns baked in from Phase 1
`source`, `google_event_id`, `google_calendar_id`, `is_read_only`, `sync_stale` exist on
`calendar_events` from day one. Phase 11 activates them — no migration needed.

### `sync_stale` vs hard delete for Google events
When a Google event is absent from the latest sync but exists locally, set `sync_stale=True`
rather than deleting. Protects against partial-sync data loss. Stale events excluded from
agent context and visually dimmed; not removed until user confirms full re-sync.
