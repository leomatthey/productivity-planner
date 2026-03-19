"""
pages/habits.py — Habits & Routines

Features:
  - Metrics strip: active count, completed today, best streak
  - Filter: show/hide archived habits
  - Create habit form (collapsible, clear_on_submit)
  - Habit cards (expandable): mark/unmark complete, edit form, 30-day history grid
  - Archive habit (sets is_active=False, preserves history)
"""

import json
from datetime import date, timedelta
from typing import Optional, Set

import streamlit as st

from db import crud
from utils.toast import show_toast

# ---------------------------------------------------------------------------
#  Constants
# ---------------------------------------------------------------------------

TOD_ICONS = {
    "morning":   "🌅",
    "afternoon": "☀️",
    "evening":   "🌙",
    "anytime":   "⏰",
}

FREQ_LABELS = {
    "daily":    "Every day",
    "weekdays": "Mon–Fri",
    "weekly":   "Once a week",
    "custom":   "Custom days",
}

DAY_NAMES  = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
DAY_ABBREV = ["M", "T", "W", "T", "F", "S", "S"]

FREQ_OPTS = ["daily", "weekdays", "weekly", "custom"]
TOD_OPTS  = ["morning", "afternoon", "evening", "anytime"]


# ---------------------------------------------------------------------------
#  Data helpers
# ---------------------------------------------------------------------------

def _get_completed_habit_ids_today(habits: list) -> Set[int]:
    today_ = date.today()
    completed: Set[int] = set()
    for h in habits:
        comps = crud.get_habit_completions(h.id, from_date=today_, to_date=today_)
        if comps:
            completed.add(h.id)
    return completed


# ---------------------------------------------------------------------------
#  Metrics strip
# ---------------------------------------------------------------------------

def _render_metrics(habits_active: list, completed_ids: Set[int]) -> None:
    best = max((h.streak_best or 0 for h in habits_active), default=0)
    done_count = sum(1 for h in habits_active if h.id in completed_ids)

    c1, c2, c3 = st.columns(3)
    c1.metric("Active Habits", len(habits_active))
    c2.metric("Completed Today", f"{done_count} / {len(habits_active)}")
    c3.metric("Best Streak Ever", f"🔥 {best}" if best > 0 else "0")


# ---------------------------------------------------------------------------
#  Create habit form
# ---------------------------------------------------------------------------

def _render_create_form() -> None:
    with st.expander("➕ Add New Habit", expanded=False):
        with st.form("create_habit_form", clear_on_submit=True):
            new_title = st.text_input("Title *", placeholder="e.g. Morning run")
            new_desc  = st.text_area("Description", placeholder="Optional notes")

            col1, col2 = st.columns(2)
            with col1:
                new_freq = st.selectbox(
                    "Frequency", FREQ_OPTS,
                    format_func=lambda x: FREQ_LABELS[x],
                    key="create_freq",
                )
            with col2:
                new_tod = st.selectbox(
                    "Time of day", TOD_OPTS,
                    format_func=lambda x: TOD_ICONS[x] + " " + x.capitalize(),
                    key="create_tod",
                )

            target_days_json: Optional[str] = None
            if new_freq == "custom":
                selected = st.multiselect(
                    "Days of week", DAY_NAMES,
                    default=["Mon", "Wed", "Fri"],
                    key="create_target_days",
                )
                target_days_json = json.dumps([DAY_NAMES.index(d) for d in selected])

            submitted = st.form_submit_button("✅ Create Habit", type="primary")
            if submitted:
                if not new_title.strip():
                    st.error("Title is required.")
                else:
                    try:
                        crud.create_habit(
                            title=new_title.strip(),
                            description=new_desc.strip() or None,
                            frequency=new_freq,
                            target_days=target_days_json,
                            time_of_day=new_tod,
                        )
                        show_toast(f"Habit created: {new_title.strip()}")
                        st.rerun()
                    except Exception as exc:
                        st.error(f"Error creating habit: {exc}")


# ---------------------------------------------------------------------------
#  Completions history grid (last 30 days)
# ---------------------------------------------------------------------------

def _render_history(habit_id: int) -> None:
    today_     = date.today()
    from_date  = today_ - timedelta(days=29)
    completions = crud.get_habit_completions(habit_id, from_date=from_date, to_date=today_)
    done_dates  = {c.completed_date for c in completions}

    st.caption("Last 30 days")

    # Align to the Monday that starts the first week in range
    week_start = from_date - timedelta(days=from_date.weekday())

    # Day-of-week header
    hdr_cols = st.columns(7)
    for i, abbr in enumerate(DAY_ABBREV):
        hdr_cols[i].markdown(
            f"<div style='text-align:center;font-size:0.75em;color:gray'>{abbr}</div>",
            unsafe_allow_html=True,
        )

    # Week rows
    cursor = week_start
    while cursor <= today_:
        week_cols = st.columns(7)
        for i in range(7):
            day = cursor + timedelta(days=i)
            if day < from_date or day > today_:
                week_cols[i].markdown(
                    "<div style='text-align:center;font-size:0.8em;color:transparent'>·</div>",
                    unsafe_allow_html=True,
                )
            elif day in done_dates:
                week_cols[i].markdown(
                    f"<div style='text-align:center;background:#4CAF50;border-radius:4px;"
                    f"color:white;font-size:0.8em;padding:2px 0'>{day.day}</div>",
                    unsafe_allow_html=True,
                )
            else:
                week_cols[i].markdown(
                    f"<div style='text-align:center;background:#f0f0f0;border-radius:4px;"
                    f"font-size:0.8em;padding:2px 0'>{day.day}</div>",
                    unsafe_allow_html=True,
                )
        cursor += timedelta(days=7)

    completed_count = len(done_dates)
    st.caption(f"{completed_count} / 30 days completed")


# ---------------------------------------------------------------------------
#  Habit card
# ---------------------------------------------------------------------------

def _render_habit_card(habit, completed_ids: Set[int]) -> None:
    today_    = date.today()
    done      = habit.id in completed_ids
    tod_icon  = TOD_ICONS.get(habit.time_of_day or "anytime", "⏰")
    streak_md = f"  🔥 {habit.streak_current}" if (habit.streak_current or 0) > 1 else ""
    archived  = "  *[archived]*" if not habit.is_active else ""
    freq_lbl  = FREQ_LABELS.get(habit.frequency, habit.frequency)
    title_md  = f"~~{habit.title}~~" if (done and habit.is_active) else habit.title

    header   = f"{tod_icon} {title_md}{streak_md}  ·  *{freq_lbl}*{archived}"
    expanded = st.session_state.get(f"habit_expanded_{habit.id}", False)

    with st.expander(header, expanded=expanded):

        # ── Mark / unmark row ───────────────────────────────────────────────
        if habit.is_active:
            info_col, btn_col = st.columns([0.75, 0.25])
            with info_col:
                cur = habit.streak_current or 0
                best = habit.streak_best or 0
                cur_txt  = f"🔥 {cur} day streak" if cur > 0 else "No active streak"
                best_txt = f"  ·  best: {best} days" if best > 0 else ""
                st.caption(cur_txt + best_txt)
            with btn_col:
                if done:
                    if st.button(
                        "↩️ Unmark", key=f"habit_unmark_{habit.id}",
                        use_container_width=True,
                        help=f"Unmark today's completion for {habit.title}",
                    ):
                        crud.unmark_habit_complete(habit.id, today_)
                        show_toast(f"Unmarked: {habit.title}", icon="↩️")
                        st.session_state[f"habit_expanded_{habit.id}"] = True
                        st.rerun()
                else:
                    if st.button(
                        "✓ Done", key=f"habit_mark_{habit.id}",
                        use_container_width=True,
                        type="primary",
                        help=f"Log today's completion for {habit.title}",
                    ):
                        crud.mark_habit_complete(habit.id, today_)
                        show_toast(f"Logged: {habit.title}")
                        st.session_state[f"habit_expanded_{habit.id}"] = True
                        st.rerun()
        else:
            best = habit.streak_best or 0
            st.caption(f"Archived — best streak: {best} days")

        # ── Tabs: Edit | History ────────────────────────────────────────────
        tab_edit, tab_hist = st.tabs(["✏️ Edit", "📅 History"])

        with tab_edit:
            with st.form(f"habit_edit_{habit.id}"):
                edit_title = st.text_input("Title", value=habit.title)
                edit_desc  = st.text_area("Description", value=habit.description or "")

                col1, col2 = st.columns(2)
                with col1:
                    cur_freq_idx = FREQ_OPTS.index(habit.frequency) if habit.frequency in FREQ_OPTS else 0
                    edit_freq = st.selectbox(
                        "Frequency", FREQ_OPTS,
                        index=cur_freq_idx,
                        format_func=lambda x: FREQ_LABELS[x],
                        key=f"edit_freq_{habit.id}",
                    )
                with col2:
                    cur_tod_idx = TOD_OPTS.index(habit.time_of_day) if habit.time_of_day in TOD_OPTS else 3
                    edit_tod = st.selectbox(
                        "Time of day", TOD_OPTS,
                        index=cur_tod_idx,
                        format_func=lambda x: TOD_ICONS[x] + " " + x.capitalize(),
                        key=f"edit_tod_{habit.id}",
                    )

                edit_target_days: Optional[str] = habit.target_days
                if edit_freq == "custom":
                    current_day_names = []
                    if habit.target_days:
                        try:
                            current_day_names = [DAY_NAMES[i] for i in json.loads(habit.target_days)]
                        except (json.JSONDecodeError, IndexError, ValueError):
                            current_day_names = []
                    sel_days = st.multiselect(
                        "Days of week", DAY_NAMES,
                        default=current_day_names,
                        key=f"edit_days_{habit.id}",
                    )
                    edit_target_days = json.dumps([DAY_NAMES.index(d) for d in sel_days])

                save_col, archive_col = st.columns(2)
                with save_col:
                    saved = st.form_submit_button("💾 Save", type="primary", use_container_width=True)
                with archive_col:
                    if habit.is_active:
                        archive_clicked = st.form_submit_button("🗄️ Archive", use_container_width=True)
                    else:
                        st.form_submit_button("(archived)", disabled=True, use_container_width=True)
                        archive_clicked = False

                if saved:
                    if not edit_title.strip():
                        st.error("Title is required.")
                    else:
                        try:
                            crud.update_habit(
                                habit.id,
                                title=edit_title.strip(),
                                description=edit_desc.strip() or None,
                                frequency=edit_freq,
                                time_of_day=edit_tod,
                                target_days=edit_target_days if edit_freq == "custom" else None,
                            )
                            show_toast(f"Habit updated: {edit_title.strip()}")
                            st.session_state[f"habit_expanded_{habit.id}"] = True
                            st.rerun()
                        except Exception as exc:
                            st.error(f"Error saving habit: {exc}")

                if archive_clicked:
                    try:
                        crud.archive_habit(habit.id)
                        show_toast(f"Archived: {habit.title}", icon="🗄️")
                        st.rerun()
                    except Exception as exc:
                        st.error(f"Error archiving habit: {exc}")

        with tab_hist:
            _render_history(habit.id)


# ---------------------------------------------------------------------------
#  Page entry point
# ---------------------------------------------------------------------------

st.title("🔄 Habits & Routines")

# ── Filter control ────────────────────────────────────────────────────────────
show_archived = st.checkbox(
    "Show archived habits",
    value=False,
    key="habit_show_archived",
)

# ── Load data ─────────────────────────────────────────────────────────────────
habits        = crud.get_habits(include_inactive=show_archived)
habits_active = [h for h in habits if h.is_active]
completed_ids = _get_completed_habit_ids_today(habits_active)

# ── Metrics ───────────────────────────────────────────────────────────────────
_render_metrics(habits_active, completed_ids)

st.divider()

# ── Create form ───────────────────────────────────────────────────────────────
_render_create_form()

st.divider()

# ── Habit list ────────────────────────────────────────────────────────────────
if not habits:
    if show_archived:
        st.info("No habits found. Create your first habit above!")
    else:
        st.info(
            "No active habits yet. Create your first habit above, "
            "or tick **Show archived habits** to see archived ones."
        )
else:
    for habit in habits:
        _render_habit_card(habit, completed_ids)
