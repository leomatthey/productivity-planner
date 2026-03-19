"""
pages/calendar.py — Calendar & Schedule

Features:
  - Metrics strip: Events this week / Today's events / Upcoming (next 7 days)
  - Week navigation: ◀ Prev / Today / Next ▶ with week label
  - Filter: show/hide Google-imported events
  - Create event form (collapsible expander, clear_on_submit)
  - Week grid (7 columns): day headers + event expanders per column
  - Event cards: edit/delete form for local events, read-only badge for Google events
"""

from datetime import date, datetime, time, timedelta
from typing import Optional

import streamlit as st
from streamlit_calendar import calendar as st_calendar

from db import crud
from utils.date_utils import start_of_week, week_days
from utils.toast import show_toast

# ---------------------------------------------------------------------------
#  Constants
# ---------------------------------------------------------------------------

EVENT_TYPE_OPTIONS = ["meeting", "personal", "reminder", "task_block"]
EVENT_TYPE_LABELS  = {
    "meeting":    "🤝 Meeting",
    "personal":   "👤 Personal",
    "reminder":   "🔔 Reminder",
    "task_block": "🧱 Task Block",
}
EVENT_TYPE_ICONS = {
    "meeting":    "🤝",
    "personal":   "👤",
    "reminder":   "🔔",
    "task_block": "🧱",
}

SOURCE_ICONS = {
    "local":  "📅",
    "google": "🌐",
}

DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


# ---------------------------------------------------------------------------
#  Session state bootstrap
# ---------------------------------------------------------------------------

EVENT_TYPE_COLORS = {
    "meeting":      "#3b82f6",   # blue
    "personal":     "#8b5cf6",   # violet
    "reminder":     "#f59e0b",   # amber
    "task_block":   "#10b981",   # emerald
    "google_import":"#94a3b8",   # slate — read-only events
}

CALENDAR_OPTIONS = {
    "editable":    False,
    "selectable":  False,
    "headerToolbar": {
        "left":   "prev,next today",
        "center": "title",
        "right":  "timeGridWeek,timeGridDay,listWeek",
    },
    "initialView":    "timeGridWeek",
    "slotMinTime":    "07:00:00",
    "slotMaxTime":    "22:00:00",
    "allDaySlot":     True,
    "firstDay":       1,           # week starts Monday
    "nowIndicator":   True,
    "weekNumbers":    False,
    "height":         700,
    "eventTimeFormat": {
        "hour":   "2-digit",
        "minute": "2-digit",
        "hour12": False,
    },
}


def _init_state() -> None:
    defaults = {
        "cal_show_google":       True,
        "cal_selected_event_id": None,
    }
    for k, v in defaults.items():
        if k not in st.session_state:
            st.session_state[k] = v


# ---------------------------------------------------------------------------
#  Formatting helpers
# ---------------------------------------------------------------------------

def _fmt_time(dt: datetime) -> str:
    return dt.strftime("%H:%M")


def _fmt_duration(start: datetime, end: datetime) -> str:
    mins = int((end - start).total_seconds() / 60)
    if mins <= 0:
        return ""
    if mins < 60:
        return f"{mins}m"
    h, m = divmod(mins, 60)
    return f"{h}h {m}m" if m else f"{h}h"


def _week_label(week_start: date) -> str:
    week_end = week_start + timedelta(days=6)
    if week_start.month == week_end.month:
        return (
            f"{week_start.strftime('%B')} {week_start.day}–{week_end.day}, "
            f"{week_start.year}"
        )
    return (
        f"{week_start.strftime('%b')} {week_start.day} – "
        f"{week_end.strftime('%b')} {week_end.day}, {week_start.year}"
    )


# ---------------------------------------------------------------------------
#  Metrics strip
# ---------------------------------------------------------------------------

def _render_metrics(n_week: int, n_today: int, n_upcoming: int) -> None:
    c1, c2, c3 = st.columns(3)
    c1.metric("Events This Week",  n_week)
    c2.metric("Today's Events",    n_today)
    c3.metric("Upcoming (7 days)", n_upcoming)


# ---------------------------------------------------------------------------
#  Create event form
# ---------------------------------------------------------------------------

def _render_create_form(tasks: list) -> None:
    with st.expander("➕ Add New Event", expanded=False):
        with st.form("create_event_form", clear_on_submit=True):
            new_title = st.text_input("Title *", placeholder="e.g. Team standup")
            new_desc  = st.text_area("Description", placeholder="Optional notes or agenda")

            c1, c2 = st.columns(2)
            with c1:
                new_type = st.selectbox(
                    "Event type", EVENT_TYPE_OPTIONS,
                    format_func=lambda x: EVENT_TYPE_LABELS[x],
                    key="create_evt_type",
                )
            with c2:
                new_loc = st.text_input("Location / Link", placeholder="Room, Zoom URL, …")

            c3, c4 = st.columns(2)
            with c3:
                new_date = st.date_input("Date *", value=date.today(), key="create_evt_date")
            with c4:
                # Active tasks only for linking
                task_opts: dict = {None: "— none —"}
                for t in tasks:
                    if t.status not in ("done", "cancelled"):
                        task_opts[t.id] = t.title
                new_task_id = st.selectbox(
                    "Linked task",
                    options=list(task_opts.keys()),
                    format_func=lambda x: task_opts[x],
                    key="create_evt_task",
                )

            c5, c6 = st.columns(2)
            with c5:
                new_start_time = st.time_input("Start time *", value=time(9, 0), key="create_evt_start")
            with c6:
                new_end_time   = st.time_input("End time *",   value=time(10, 0), key="create_evt_end")

            submitted = st.form_submit_button("Create Event", type="primary")
            if submitted:
                if not new_title.strip():
                    st.error("Title is required.")
                elif not isinstance(new_date, date):
                    st.error("Date is required.")
                elif new_start_time >= new_end_time:
                    st.error("Start time must be before end time.")
                else:
                    try:
                        start_dt = datetime.combine(new_date, new_start_time)
                        end_dt   = datetime.combine(new_date, new_end_time)
                        crud.create_event(
                            title=new_title.strip(),
                            start_datetime=start_dt,
                            end_datetime=end_dt,
                            description=new_desc.strip() or None,
                            event_type=new_type,
                            location=new_loc.strip() or None,
                            task_id=new_task_id,
                        )
                        show_toast(f"Event created: {new_title.strip()}")
                        st.cache_data.clear()
                        st.rerun()
                    except Exception as exc:
                        st.error(f"Error creating event: {exc}")


# ---------------------------------------------------------------------------
#  FullCalendar event builder
# ---------------------------------------------------------------------------

def _event_color(event) -> str:
    if event.is_read_only or event.source == "google":
        return EVENT_TYPE_COLORS["google_import"]
    return EVENT_TYPE_COLORS.get(event.event_type or "personal", "#3b82f6")


def _events_to_fullcalendar(events: list) -> list:
    fc = []
    for e in events:
        fc.append({
            "id":              str(e.id),
            "title":           e.title,
            "start":           e.start_datetime.isoformat(),
            "end":             e.end_datetime.isoformat(),
            "backgroundColor": _event_color(e),
            "borderColor":     _event_color(e),
        })
    return fc


# ---------------------------------------------------------------------------
#  Event detail panel (shown below calendar on click)
# ---------------------------------------------------------------------------

def _render_event_detail(event, tasks: list) -> None:
    source_icon = SOURCE_ICONS.get(event.source or "local", "📅")
    dur         = _fmt_duration(event.start_datetime, event.end_datetime)
    type_icon   = EVENT_TYPE_ICONS.get(event.event_type or "personal", "📌")
    type_lbl    = EVENT_TYPE_LABELS.get(event.event_type or "personal", "")

    with st.container(border=True):
        hdr_col, close_col = st.columns([9, 1])
        with hdr_col:
            st.markdown(
                f"### {source_icon} {event.title}\n"
                f"{type_icon} {type_lbl}  ·  "
                f"**{_fmt_time(event.start_datetime)} – {_fmt_time(event.end_datetime)}**"
                f"{'  ·  ⏱ ' + dur if dur else ''}"
                f"{'  ·  📍 ' + event.location if event.location else ''}"
            )
        with close_col:
            if st.button("✕", key="cal_close_detail", help="Close"):
                st.session_state["cal_selected_event_id"] = None
                st.rerun()

        if event.description:
            st.markdown(event.description)

        if event.is_read_only:
            st.info("🔒 Google Calendar event — read-only")
            return

        with st.form(f"event_detail_edit_{event.id}"):
            edit_title = st.text_input("Title", value=event.title)
            edit_desc  = st.text_area("Description", value=event.description or "")

            ec1, ec2 = st.columns(2)
            with ec1:
                cur_type_idx = (
                    EVENT_TYPE_OPTIONS.index(event.event_type)
                    if event.event_type in EVENT_TYPE_OPTIONS else 1
                )
                edit_type = st.selectbox(
                    "Event type", EVENT_TYPE_OPTIONS,
                    index=cur_type_idx,
                    format_func=lambda x: EVENT_TYPE_LABELS[x],
                    key=f"det_type_{event.id}",
                )
            with ec2:
                edit_loc = st.text_input(
                    "Location / Link", value=event.location or "",
                    key=f"det_loc_{event.id}",
                )

            ed1, ed2 = st.columns(2)
            with ed1:
                edit_date = st.date_input(
                    "Date", value=event.start_datetime.date(),
                    key=f"det_date_{event.id}",
                )
            with ed2:
                task_opts: dict = {None: "— none —"}
                for t in tasks:
                    if t.status not in ("done", "cancelled"):
                        task_opts[t.id] = t.title
                if event.task_id is not None and event.task_id not in task_opts:
                    for t in tasks:
                        if t.id == event.task_id:
                            task_opts[t.id] = t.title
                            break
                cur_task_idx = (
                    list(task_opts.keys()).index(event.task_id)
                    if event.task_id in task_opts else 0
                )
                edit_task_id = st.selectbox(
                    "Linked task",
                    options=list(task_opts.keys()),
                    index=cur_task_idx,
                    format_func=lambda x: task_opts[x],
                    key=f"det_task_{event.id}",
                )

            et1, et2 = st.columns(2)
            with et1:
                edit_start = st.time_input(
                    "Start", value=event.start_datetime.time(),
                    key=f"det_start_{event.id}",
                )
            with et2:
                edit_end = st.time_input(
                    "End", value=event.end_datetime.time(),
                    key=f"det_end_{event.id}",
                )

            save_col, del_col = st.columns(2)
            with save_col:
                saved = st.form_submit_button("💾 Save", type="primary", use_container_width=True)
            with del_col:
                deleted = st.form_submit_button("🗑️ Delete", use_container_width=True)

            if saved:
                if not edit_title.strip():
                    st.error("Title is required.")
                elif not isinstance(edit_date, date):
                    st.error("Date is required.")
                elif edit_start >= edit_end:
                    st.error("Start time must be before end time.")
                else:
                    try:
                        crud.update_event(
                            event.id,
                            title=edit_title.strip(),
                            description=edit_desc.strip() or None,
                            event_type=edit_type,
                            location=edit_loc.strip() or None,
                            start_datetime=datetime.combine(edit_date, edit_start),
                            end_datetime=datetime.combine(edit_date, edit_end),
                            task_id=edit_task_id,
                        )
                        show_toast(f"Event updated: {edit_title.strip()}")
                        st.cache_data.clear()
                        st.rerun()
                    except PermissionError as exc:
                        st.error(f"Cannot edit: {exc}")
                    except Exception as exc:
                        st.error(f"Error saving: {exc}")

            if deleted:
                try:
                    crud.delete_event(event.id)
                    st.session_state["cal_selected_event_id"] = None
                    show_toast(f"Event deleted: {event.title}", icon="🗑️")
                    st.cache_data.clear()
                    st.rerun()
                except PermissionError as exc:
                    st.error(f"Cannot delete: {exc}")
                except Exception as exc:
                    st.error(f"Error deleting: {exc}")


# ---------------------------------------------------------------------------
#  Page entry point
# ---------------------------------------------------------------------------

st.title("📅 Calendar & Schedule")

_init_state()

# ── Load data ──────────────────────────────────────────────────────────────────
all_tasks = crud.get_tasks()

# ── Filter ─────────────────────────────────────────────────────────────────────
show_google: bool = st.checkbox(
    "Show Google Calendar events",
    value=True,
    key="cal_show_google",
)
source_filter: Optional[str] = None if show_google else "local"

# ── Fetch events ───────────────────────────────────────────────────────────────
today_          = date.today()
this_week       = week_days(start_of_week())
week_start_dt   = datetime.combine(this_week[0],  time.min)
week_end_dt     = datetime.combine(this_week[-1], time.max)
today_start_dt  = datetime.combine(today_,                        time.min)
today_end_dt    = datetime.combine(today_,                        time.max)
upcoming_end_dt = datetime.combine(today_ + timedelta(days=7),    time.max)
cal_start_dt    = datetime.combine(today_ - timedelta(days=60),   time.min)
cal_end_dt      = datetime.combine(today_ + timedelta(days=120),  time.max)

week_events     = crud.get_events(start=week_start_dt,  end=week_end_dt,      source=source_filter)
today_events    = crud.get_events(start=today_start_dt, end=today_end_dt,     source=source_filter)
upcoming_events = crud.get_events(start=today_start_dt, end=upcoming_end_dt,  source=source_filter)
cal_events      = crud.get_events(start=cal_start_dt,   end=cal_end_dt,       source=source_filter)

# ── Metrics ────────────────────────────────────────────────────────────────────
_render_metrics(len(week_events), len(today_events), len(upcoming_events))

st.divider()

# ── Create event form ──────────────────────────────────────────────────────────
_render_create_form(all_tasks)

st.divider()

# ── Calendar component ────────────────────────────────────────────────────────
fc_events  = _events_to_fullcalendar(cal_events)
cal_result = st_calendar(events=fc_events, options=CALENDAR_OPTIONS, key="main_calendar")

# Handle event click — store selection in session state
if cal_result and cal_result.get("callback") == "eventClick":
    try:
        eid = int(cal_result["eventClick"]["event"]["id"])
        st.session_state["cal_selected_event_id"] = eid
    except (KeyError, ValueError, TypeError):
        pass

# Colour legend
st.caption(
    "🟦 Meeting  🟪 Personal  🟧 Reminder  🟩 Task block  ⬜ Google Calendar (read-only)  "
    "· Click any event to view or edit"
)

# ── Event detail panel ─────────────────────────────────────────────────────────
selected_id = st.session_state.get("cal_selected_event_id")
if selected_id is not None:
    selected_event = next((e for e in cal_events if e.id == selected_id), None)
    if selected_event:
        st.divider()
        _render_event_detail(selected_event, all_tasks)
    else:
        st.session_state["cal_selected_event_id"] = None
