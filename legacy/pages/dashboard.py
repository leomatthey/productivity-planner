"""
pages/dashboard.py — Today at a Glance Dashboard

Widgets:
  - Overdue Alert: prominent error banner when tasks are past due
  - Today at a Glance: date, day-of-week, brief computed summary
  - Today's Tasks: up to 5 tasks due/scheduled today, one-click mark-done
  - Habit Check-in: all active habits sorted by time_of_day, mark-complete
  - Goals Progress: active goals with auto-recalculated progress bars
  - This Week's Calendar: compact Mon-Fri view of local + Google events
  - AI Quick Chat: mini chat widget powered by the full AI agent
"""

import uuid
from collections import defaultdict
from datetime import date, datetime, time as dt_time
from typing import Optional, Set

import streamlit as st

from agent.agent import run_agent
from db import crud
from utils.date_utils import friendly_date, is_overdue, week_days
from utils.toast import show_toast

# ---------------------------------------------------------------------------
#  Constants
# ---------------------------------------------------------------------------

PRIORITY_RANK  = {"urgent": 4, "high": 3, "medium": 2, "low": 1}
PRIORITY_ICONS = {"urgent": "🔴", "high": "🟠", "medium": "", "low": ""}

TOD_ICONS = {
    "morning":   "🌅",
    "afternoon": "☀️",
    "evening":   "🌙",
    "anytime":   "⏰",
}


# ---------------------------------------------------------------------------
#  Data helpers (pure computation on already-loaded lists)
# ---------------------------------------------------------------------------

def _filter_overdue(all_tasks: list) -> list:
    today_ = date.today()
    return [
        t for t in all_tasks
        if t.due_date
        and t.due_date < today_
        and t.status not in ("done", "cancelled")
    ]


def _filter_today_tasks(all_tasks: list) -> list:
    """Return up to 5 active tasks due or scheduled today, sorted by priority."""
    today_ = date.today()
    due_today = []
    for t in all_tasks:
        if t.status in ("done", "cancelled"):
            continue
        sched_today = t.scheduled_at and t.scheduled_at.date() == today_
        if t.due_date == today_ or sched_today:
            due_today.append(t)
    return sorted(
        due_today,
        key=lambda t: (-PRIORITY_RANK.get(t.priority, 0), t.due_date or date.max),
    )[:5]


def _get_completed_habit_ids_today(habits: list) -> Set[int]:
    """Return the set of habit IDs already logged as complete for today."""
    today_ = date.today()
    completed: Set[int] = set()
    for h in habits:
        comps = crud.get_habit_completions(h.id, from_date=today_, to_date=today_)
        if comps:
            completed.add(h.id)
    return completed


def _get_week_events() -> list:
    """Return non-stale events spanning Mon-Fri of the current week."""
    week = week_days()
    start = datetime.combine(week[0], dt_time(0, 0, 0))
    end   = datetime.combine(week[4], dt_time(23, 59, 59))
    return crud.get_events(start=start, end=end)


# ---------------------------------------------------------------------------
#  Overdue Alert
# ---------------------------------------------------------------------------

def _render_overdue_alert(overdue: list) -> None:
    if not overdue:
        return
    n = len(overdue)
    st.error(
        f"⚠️  **{n} overdue task{'s' if n > 1 else ''}** — "
        "open the **Tasks & To-dos** page to review and reschedule them."
    )


# ---------------------------------------------------------------------------
#  Today at a Glance card
# ---------------------------------------------------------------------------

def _build_summary(today_tasks: list, habits: list, overdue: list) -> str:
    day_name = date.today().strftime("%A")
    parts = []
    if overdue:
        n = len(overdue)
        parts.append(f"{n} overdue item{'s' if n > 1 else ''} need{'s' if n == 1 else ''} attention")
    if today_tasks:
        n = len(today_tasks)
        parts.append(f"{n} task{'s' if n > 1 else ''} due today")
    if habits:
        n = len(habits)
        parts.append(f"{n} habit{'s' if n > 1 else ''} to check off")
    if not parts:
        return f"Happy {day_name}! Nothing on your plate — a great time to plan ahead."
    return f"Happy {day_name}! You have " + ", ".join(parts) + "."


def _render_today_glance(today_tasks: list, habits: list, overdue: list) -> None:
    today_ = date.today()
    day_name = date.today().strftime("%A")
    date_str = today_.strftime("%B %-d, %Y")

    with st.container(border=True):
        st.markdown(f"### {day_name}  ·  {date_str}")
        st.markdown(_build_summary(today_tasks, habits, overdue))


# ---------------------------------------------------------------------------
#  Today's Tasks widget
# ---------------------------------------------------------------------------

def _render_today_tasks(today_tasks: list) -> None:
    st.subheader("📋 Today's Tasks")

    if not today_tasks:
        st.caption("No tasks due or scheduled for today. Enjoy the calm!")
        return

    for t in today_tasks:
        prio  = PRIORITY_ICONS.get(t.priority, "")
        label = f"{prio} {t.title}"
        if t.estimated_minutes:
            label += f"  *({t.estimated_minutes} min)*"

        c1, c2 = st.columns([0.85, 0.15])
        with c1:
            st.markdown(label)
        with c2:
            if st.button(
                "✅", key=f"dash_done_{t.id}",
                help=f"Mark done: {t.title}",
                use_container_width=True,
            ):
                crud.update_task(t.id, status="done")
                show_toast(f"Done: {t.title}")
                st.cache_data.clear()
                st.rerun()

    if len(today_tasks) == 5:
        st.caption("Showing top 5 — open Tasks & To-dos for the full list.")


# ---------------------------------------------------------------------------
#  Habit Check-in widget
# ---------------------------------------------------------------------------

def _render_habit_checkin(habits: list, completed_ids: Set[int]) -> None:
    st.subheader("🔄 Habit Check-in")
    today_ = date.today()

    if not habits:
        st.caption("No active habits yet — add some on the Habits & Routines page.")
        return

    for h in habits:
        done     = h.id in completed_ids
        tod_icon = TOD_ICONS.get(h.time_of_day or "anytime", "⏰")
        streak   = f"  🔥 {h.streak_current}" if (h.streak_current or 0) > 1 else ""
        title_md = f"~~{h.title}~~" if done else h.title
        label    = f"{tod_icon} {title_md}{streak}"

        c1, c2 = st.columns([0.85, 0.15])
        with c1:
            st.markdown(label)
        with c2:
            if done:
                if st.button(
                    "↩️", key=f"dash_unmark_{h.id}",
                    help=f"Unmark: {h.title}",
                    use_container_width=True,
                ):
                    crud.unmark_habit_complete(h.id, today_)
                    show_toast(f"Unmarked: {h.title}", icon="↩️")
                    st.rerun()
            else:
                if st.button(
                    "✓", key=f"dash_mark_{h.id}",
                    help=f"Complete: {h.title}",
                    use_container_width=True,
                ):
                    crud.mark_habit_complete(h.id, today_)
                    show_toast(f"Logged: {h.title}")
                    st.rerun()


# ---------------------------------------------------------------------------
#  Goals Progress widget
# ---------------------------------------------------------------------------

def _render_goals_progress(goals: list) -> None:
    st.subheader("🎯 Goals Progress")
    active = [g for g in goals if g.status == "active"]

    if not active:
        st.caption("No active goals yet — add some on the Goals & Projects page.")
        return

    for g in active[:6]:
        pct    = g.progress_pct or 0
        target = f"  ·  target {friendly_date(g.target_date)}" if g.target_date else ""
        st.markdown(f"**{g.title}**{target}")
        st.progress(pct / 100, text=f"{pct}%")

    if len(active) > 6:
        st.caption(f"…and {len(active) - 6} more — open Goals & Projects for the full list.")


# ---------------------------------------------------------------------------
#  This Week's Calendar widget
# ---------------------------------------------------------------------------

def _render_weekly_calendar(events: list) -> None:
    st.subheader("📅 This Week")
    today_    = date.today()
    work_week = week_days()[:5]   # Mon–Fri

    events_by_date: dict = defaultdict(list)
    for e in events:
        events_by_date[e.start_datetime.date()].append(e)

    for day in work_week:
        day_events = sorted(
            events_by_date.get(day, []),
            key=lambda e: e.start_datetime,
        )
        is_today = day == today_
        count_md = f"  *({len(day_events)})*" if day_events else ""
        hdr_day  = f"**{friendly_date(day)}**" if is_today else friendly_date(day)
        hdr      = f"{hdr_day}{count_md}"

        with st.expander(hdr, expanded=is_today):
            if not day_events:
                st.caption("Nothing scheduled")
            else:
                for e in day_events:
                    time_str = e.start_datetime.strftime("%H:%M")
                    is_google = (e.source == "google" or e.event_type == "google_import")
                    icon      = "🌐" if is_google else "📅"
                    mins = int(
                        (e.end_datetime - e.start_datetime).total_seconds() / 60
                    ) if e.end_datetime else 0
                    duration = f" *({mins} min)*" if mins > 0 else ""
                    st.markdown(f"{icon} **{time_str}**  {e.title}{duration}")


# ---------------------------------------------------------------------------
#  AI Quick Chat
# ---------------------------------------------------------------------------

def _render_ai_quick_chat() -> None:
    """Mini chat widget backed by the full run_agent loop.

    Maintains its own session state keys (dash_*) so it does not interfere
    with the full AI Assistant page's conversation state.
    """
    if "dash_session_id" not in st.session_state:
        st.session_state.dash_session_id = str(uuid.uuid4())
    if "dash_messages" not in st.session_state:
        st.session_state.dash_messages = []
    if "dash_last_response" not in st.session_state:
        st.session_state.dash_last_response = None

    st.subheader("🤖 AI Assistant")

    # Show the most recent assistant response
    if st.session_state.dash_last_response:
        with st.chat_message("assistant"):
            st.markdown(st.session_state.dash_last_response)

    # Input form — clear_on_submit keeps the field empty after sending
    with st.form("dash_chat_form", clear_on_submit=True):
        prompt = st.text_input(
            "dash_prompt",
            placeholder="Ask about your tasks, goals, or schedule…",
            label_visibility="collapsed",
        )
        submitted = st.form_submit_button("Ask →", use_container_width=True)

    if submitted and prompt:
        st.session_state.dash_messages.append({"role": "user", "content": prompt})
        with st.spinner("Thinking…"):
            try:
                response_text, _ = run_agent(
                    st.session_state.dash_messages,
                    st.session_state.dash_session_id,
                )
                st.session_state.dash_messages.append(
                    {"role": "assistant", "content": response_text}
                )
                st.session_state.dash_last_response = response_text
                st.cache_data.clear()
            except Exception as exc:
                st.error(f"Assistant error: {exc}")
        st.rerun()

    st.caption("Full conversation history in the **AI Assistant** page →")


# ---------------------------------------------------------------------------
#  Page entry point
# ---------------------------------------------------------------------------

st.title("🏠 Dashboard")

# ── Load all data once ──────────────────────────────────────────────────────
all_tasks       = crud.get_tasks()
overdue_tasks   = _filter_overdue(all_tasks)
today_tasks     = _filter_today_tasks(all_tasks)
habits          = crud.get_habits()
completed_today = _get_completed_habit_ids_today(habits)
goals           = crud.get_goals()
week_events     = _get_week_events()

# ── Overdue Alert ────────────────────────────────────────────────────────────
_render_overdue_alert(overdue_tasks)

# ── Today at a Glance ────────────────────────────────────────────────────────
_render_today_glance(today_tasks, habits, overdue_tasks)

st.divider()

# ── Two-column main area ─────────────────────────────────────────────────────
left_col, right_col = st.columns(2, gap="large")

with left_col:
    _render_today_tasks(today_tasks)
    st.divider()
    _render_habit_checkin(habits, completed_today)

with right_col:
    _render_goals_progress(goals)
    st.divider()
    _render_weekly_calendar(week_events)

st.divider()

# ── AI Quick Chat stub ────────────────────────────────────────────────────────
_render_ai_quick_chat()
