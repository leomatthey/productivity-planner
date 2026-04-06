"""
pages/tasks.py — Tasks & To-dos

Features:
  - Smart quick-add bar with NL parsing (dates, priority, #tags)
  - List view with inline quick-complete and expandable task cards
  - Active tasks grouped by urgency: Overdue / Today / This Week / Later / No date
  - Bulk selection via per-task checkboxes + "Select all" / "Clear" buttons
  - Bulk actions bar at the bottom (appears only when tasks are selected)
  - Done & Cancelled section — completed tasks auto-moved here, with restore/delete
  - Kanban board view (4 columns: todo / in-progress / done / cancelled)
  - Filters: status, priority, project, tag
  - Sort: due date, priority, created, duration
  - Toast confirmations on every write operation
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta

import streamlit as st

from db import crud
from utils.date_utils import friendly_date, is_overdue
from utils.toast import show_toast

# ---------------------------------------------------------------------------
#  Constants
# ---------------------------------------------------------------------------

STATUS_OPTIONS = ["todo", "in_progress", "done", "cancelled"]
STATUS_LABELS  = {
    "todo":        "To Do",
    "in_progress": "In Progress",
    "done":        "Done",
    "cancelled":   "Cancelled",
}
STATUS_ICONS = {
    "todo":        "○",
    "in_progress": "◑",
    "done":        "✅",
    "cancelled":   "❌",
}

PRIORITY_OPTIONS = ["low", "medium", "high", "urgent"]
PRIORITY_ICONS   = {"urgent": "🔴", "high": "🟠", "medium": "", "low": ""}
PRIORITY_RANK    = {"urgent": 4, "high": 3, "medium": 2, "low": 1}

ENERGY_OPTIONS = ["", "low", "medium", "high"]

SORT_MAP = {
    "Due date": "due_date",
    "Priority": "priority",
    "Created":  "created",
    "Duration": "duration",
}


# ---------------------------------------------------------------------------
#  Session-state bootstrap
# ---------------------------------------------------------------------------

def _init_state() -> None:
    defaults: dict = {
        "task_filter_status":   [],
        "task_filter_priority": [],
        "task_filter_project":  "All",
        "task_filter_tag":      "",
    }
    for k, v in defaults.items():
        if k not in st.session_state:
            st.session_state[k] = v


# ---------------------------------------------------------------------------
#  Natural-language quick-add parser
# ---------------------------------------------------------------------------

def _parse_quick_add(text: str) -> dict:
    """Parse free-text into structured task fields."""
    working = text.strip()
    result: dict = {
        "title":    working,
        "due_date": None,
        "priority": "medium",
        "tags":     None,
    }

    found_tags = re.findall(r"#(\w+)", working)
    if found_tags:
        result["tags"] = ",".join(t.lower() for t in found_tags)
    working = re.sub(r"#\w+", "", working).strip()

    prio_patterns = [
        (r"\burgent\b",                                      "urgent"),
        (r"\bhigh\s+priority\b|\bpriority\s+high\b",        "high"),
        (r"\bmedium\s+priority\b|\bpriority\s+medium\b",    "medium"),
        (r"\blow\s+priority\b|\bpriority\s+low\b",          "low"),
    ]
    for pattern, prio in prio_patterns:
        if re.search(pattern, working, re.IGNORECASE):
            result["priority"] = prio
            working = re.sub(pattern, "", working, flags=re.IGNORECASE).strip()
            break

    today_ = date.today()
    if re.search(r"\btoday\b", working, re.IGNORECASE):
        result["due_date"] = today_
        working = re.sub(r"\btoday\b", "", working, flags=re.IGNORECASE).strip()
    elif re.search(r"\btomorrow\b", working, re.IGNORECASE):
        result["due_date"] = today_ + timedelta(days=1)
        working = re.sub(r"\btomorrow\b", "", working, flags=re.IGNORECASE).strip()
    else:
        day_map = {
            "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
            "friday": 4, "saturday": 5, "sunday": 6,
        }
        for day_name, weekday_idx in day_map.items():
            if re.search(rf"\b{day_name}\b", working, re.IGNORECASE):
                days_ahead = (weekday_idx - today_.weekday() + 7) % 7
                if days_ahead == 0:
                    days_ahead = 7
                result["due_date"] = today_ + timedelta(days=days_ahead)
                working = re.sub(
                    rf"\b{day_name}\b", "", working, flags=re.IGNORECASE
                ).strip()
                break

    result["title"] = re.sub(r"\s{2,}", " ", working).strip()
    return result


# ---------------------------------------------------------------------------
#  Sort & filter
# ---------------------------------------------------------------------------

def _sort_tasks(tasks: list, sort_key: str) -> list:
    if sort_key == "priority":
        return sorted(
            tasks,
            key=lambda t: (-PRIORITY_RANK.get(t.priority, 0), t.due_date or date.max),
        )
    if sort_key == "created":
        return sorted(tasks, key=lambda t: t.created_at or datetime.min, reverse=True)
    if sort_key == "duration":
        return sorted(tasks, key=lambda t: t.estimated_minutes or 9_999)
    return sorted(tasks, key=lambda t: (t.due_date is None, t.due_date or date.max))


def _filter_tasks(tasks: list, goals: list) -> list:
    """Apply project / tag / status / priority filters from session state."""
    statuses   = st.session_state.task_filter_status
    priorities = st.session_state.task_filter_priority
    project    = st.session_state.task_filter_project
    tag        = st.session_state.task_filter_tag.strip().lower()

    goal_title_to_id = {g.title: g.id for g in goals}
    project_id = goal_title_to_id.get(project) if project != "All" else None

    out = tasks
    if statuses:
        out = [t for t in out if t.status in statuses]
    if priorities:
        out = [t for t in out if t.priority in priorities]
    if project_id is not None:
        out = [t for t in out if t.project_id == project_id]
    if tag:
        out = [t for t in out if tag in (t.tags or "").lower()]
    return out


# ---------------------------------------------------------------------------
#  Quick-add bar
# ---------------------------------------------------------------------------

def _render_quick_add() -> None:
    with st.form("quick_add_form", clear_on_submit=True):
        c1, c2 = st.columns([8, 1])
        with c1:
            raw = st.text_input(
                "quick_add",
                placeholder='e.g. "Prepare slides for Monday  high priority  #work"',
                label_visibility="collapsed",
            )
        with c2:
            submitted = st.form_submit_button(
                "＋ Add", use_container_width=True, type="primary"
            )

        if submitted:
            raw = (raw or "").strip()
            if not raw:
                st.warning("Enter a task description first.")
            else:
                parsed = _parse_quick_add(raw)
                if not parsed["title"]:
                    st.warning("Could not extract a title — try adding more words.")
                else:
                    crud.create_task(**parsed)
                    parts = [f"**{parsed['title']}**"]
                    if parsed["due_date"]:
                        parts.append(f"due {friendly_date(parsed['due_date'])}")
                    if parsed["priority"] != "medium":
                        parts.append(f"{parsed['priority']} priority")
                    if parsed["tags"]:
                        parts.append(
                            "  ".join(f"#{t}" for t in parsed["tags"].split(","))
                        )
                    show_toast("Created: " + "  ·  ".join(parts))
                    st.cache_data.clear()


# ---------------------------------------------------------------------------
#  Controls row (view toggle + sort)
# ---------------------------------------------------------------------------

def _render_controls() -> tuple[str, str]:
    c1, c2, c3 = st.columns([3, 3, 3])
    with c1:
        view_opt = st.segmented_control(
            "View",
            options=["📋 List", "🗂 Kanban"],
            default="📋 List",
            key="task_view_ctrl",
            label_visibility="collapsed",
        )
    with c3:
        sort_label = st.selectbox(
            "Sort by",
            list(SORT_MAP.keys()),
            key="task_sort_ctrl",
            label_visibility="collapsed",
        )
    current_view = "kanban" if view_opt == "🗂 Kanban" else "list"
    return current_view, SORT_MAP.get(sort_label or "Due date", "due_date")


# ---------------------------------------------------------------------------
#  Filters panel
# ---------------------------------------------------------------------------

def _render_filters(goals: list) -> None:
    with st.expander("🔍 Filters", expanded=False):
        c1, c2, c3, c4 = st.columns(4)
        with c1:
            st.multiselect(
                "Status",
                STATUS_OPTIONS,
                format_func=lambda s: f"{STATUS_ICONS[s]}  {STATUS_LABELS[s]}",
                key="task_filter_status",
            )
        with c2:
            st.multiselect(
                "Priority",
                PRIORITY_OPTIONS,
                format_func=lambda p: f"{PRIORITY_ICONS[p]}  {p.title()}",
                key="task_filter_priority",
            )
        with c3:
            goal_titles = ["All"] + [g.title for g in goals]
            cur = st.session_state.task_filter_project
            idx = goal_titles.index(cur) if cur in goal_titles else 0
            st.selectbox("Project", goal_titles, index=idx, key="task_filter_project")
        with c4:
            st.text_input("Tag", key="task_filter_tag", placeholder="e.g. work")

        if st.button("✖ Clear filters", key="clear_task_filters"):
            st.session_state.task_filter_status   = []
            st.session_state.task_filter_priority = []
            st.session_state.task_filter_project  = "All"
            st.session_state.task_filter_tag      = ""
            st.rerun()


# ---------------------------------------------------------------------------
#  Edit form (shared by list cards and Kanban cards)
# ---------------------------------------------------------------------------

def _render_edit_form(task, goals: list) -> None:
    goal_none_label = "— None —"
    goal_id_to_title = {None: goal_none_label, **{g.id: g.title for g in goals}}
    goal_title_to_id = {v: k for k, v in goal_id_to_title.items()}
    proj_titles      = list(goal_id_to_title.values())

    with st.form(key=f"edit_form_{task.id}"):
        new_title = st.text_input(
            "Title *", value=task.title, key=f"f_title_{task.id}"
        )

        c1, c2, c3, c4 = st.columns(4)
        with c1:
            new_status = st.selectbox(
                "Status",
                STATUS_OPTIONS,
                index=STATUS_OPTIONS.index(task.status),
                format_func=lambda s: f"{STATUS_ICONS[s]}  {STATUS_LABELS[s]}",
                key=f"f_status_{task.id}",
            )
        with c2:
            new_priority = st.selectbox(
                "Priority",
                PRIORITY_OPTIONS,
                index=PRIORITY_OPTIONS.index(task.priority),
                format_func=lambda p: f"{PRIORITY_ICONS[p]}  {p.title()}",
                key=f"f_priority_{task.id}",
            )
        with c3:
            new_due = st.date_input(
                "Due date",
                value=task.due_date if task.due_date else None,
                key=f"f_due_{task.id}",
            )
        with c4:
            cur_proj = goal_id_to_title.get(task.project_id, goal_none_label)
            proj_idx = proj_titles.index(cur_proj) if cur_proj in proj_titles else 0
            new_proj_title = st.selectbox(
                "Project",
                proj_titles,
                index=proj_idx,
                key=f"f_proj_{task.id}",
            )

        c5, c6, c7 = st.columns(3)
        with c5:
            new_minutes = st.number_input(
                "Duration (min)",
                min_value=0,
                step=5,
                value=int(task.estimated_minutes) if task.estimated_minutes else 0,
                key=f"f_mins_{task.id}",
            )
        with c6:
            cur_energy = task.energy_level or ""
            energy_idx = ENERGY_OPTIONS.index(cur_energy) if cur_energy in ENERGY_OPTIONS else 0
            new_energy = st.selectbox(
                "Energy level",
                ENERGY_OPTIONS,
                index=energy_idx,
                format_func=lambda e: e.title() if e else "— Not set —",
                key=f"f_energy_{task.id}",
            )
        with c7:
            new_tags = st.text_input(
                "Tags",
                value=task.tags or "",
                placeholder="work, home, urgent",
                key=f"f_tags_{task.id}",
            )

        new_desc = st.text_area(
            "Notes",
            value=task.description or "",
            height=80,
            key=f"f_desc_{task.id}",
        )

        bc1, bc2, _ = st.columns([2, 2, 6])
        with bc1:
            save = st.form_submit_button(
                "💾 Save", type="primary", use_container_width=True
            )
        with bc2:
            delete = st.form_submit_button("🗑️ Delete", use_container_width=True)

    if save:
        title_clean = (new_title or "").strip()
        if not title_clean:
            st.error("Title cannot be empty.")
        else:
            due_clean = new_due if isinstance(new_due, date) else None
            crud.update_task(
                task.id,
                current_updated_at=task.updated_at,
                title=title_clean,
                description=(new_desc or "").strip() or None,
                status=new_status,
                priority=new_priority,
                due_date=due_clean,
                project_id=goal_title_to_id.get(new_proj_title),
                estimated_minutes=int(new_minutes) if new_minutes else None,
                energy_level=new_energy or None,
                tags=(new_tags or "").strip() or None,
            )
            st.session_state[f"expanded_{task.id}"] = True
            show_toast(f"Saved: {title_clean}")
            st.cache_data.clear()
            st.rerun()

    if delete:
        crud.delete_task(task.id)
        st.session_state.pop(f"expanded_{task.id}", None)
        show_toast(f"Deleted: {task.title}", icon="🗑️")
        st.cache_data.clear()
        st.rerun()


# ---------------------------------------------------------------------------
#  Task row (active tasks — checkbox + card + quick-complete)
# ---------------------------------------------------------------------------

def _task_expander_label(task) -> str:
    prio  = PRIORITY_ICONS.get(task.priority, "")
    stat  = STATUS_ICONS.get(task.status, "")
    title_part = f"{prio} {stat}  **{task.title}**".strip()

    meta = []
    if task.due_date:
        overdue_marker = (
            " ⚠️"
            if is_overdue(task.due_date) and task.status not in ("done", "cancelled")
            else ""
        )
        meta.append(f"*{friendly_date(task.due_date)}{overdue_marker}*")
    if task.estimated_minutes:
        meta.append(f"*{task.estimated_minutes} min*")
    if task.tags:
        tag_str = "  ".join(
            f"`#{t.strip()}`" for t in task.tags.split(",") if t.strip()
        )
        meta.append(tag_str)

    if meta:
        return f"{title_part}   ·   " + "   ·   ".join(meta)
    return title_part


def _render_task_row(task, goals: list) -> None:
    """Checkbox  |  expandable card  |  quick-complete button."""
    c_check, c_card, c_done = st.columns([0.04, 0.82, 0.14])
    with c_check:
        st.checkbox("", key=f"bulk_{task.id}", label_visibility="collapsed")
    with c_card:
        expanded = st.session_state.get(f"expanded_{task.id}", False)
        with st.expander(_task_expander_label(task), expanded=expanded):
            _render_edit_form(task, goals)
    with c_done:
        if st.button(
            "✅",
            key=f"quick_done_{task.id}",
            help=f"Mark done: {task.title}",
            use_container_width=True,
        ):
            crud.update_task(task.id, status="done")
            show_toast(f"Done: {task.title}")
            st.cache_data.clear()
            st.rerun()


# ---------------------------------------------------------------------------
#  Section header helper
# ---------------------------------------------------------------------------

def _section_header(label: str, count: int) -> None:
    st.markdown(
        f"<div style='font-size:0.75rem;font-weight:700;letter-spacing:0.07em;"
        f"text-transform:uppercase;color:#6B7280;padding:0.75rem 0 0.2rem 0;"
        f"border-top:1px solid #E8EAED;margin-top:0.25rem'>"
        f"{label}&ensp;<span style='font-weight:400;color:#9CA3AF'>{count}</span>"
        f"</div>",
        unsafe_allow_html=True,
    )


# ---------------------------------------------------------------------------
#  Active task list — grouped by urgency / time
# ---------------------------------------------------------------------------

def _render_list_view(active_tasks: list, goals: list) -> None:
    """Render only active (todo / in_progress) tasks, grouped by time horizon."""
    if not active_tasks:
        st.info("No active tasks — use the quick-add bar above to create one.")
        return

    today_   = date.today()
    week_end = today_ + timedelta(days=(6 - today_.weekday()))  # end of this Sun

    overdue_t, today_t, week_t, later_t, nodate_t = [], [], [], [], []

    for t in active_tasks:
        if t.due_date is None:
            nodate_t.append(t)
        elif t.due_date < today_:
            overdue_t.append(t)
        elif t.due_date == today_:
            today_t.append(t)
        elif t.due_date <= week_end:
            week_t.append(t)
        else:
            later_t.append(t)

    groups = [
        (overdue_t, "🔴  Overdue"),
        (today_t,   "📅  Today"),
        (week_t,    "📆  This Week"),
        (later_t,   "🗓  Upcoming"),
        (nodate_t,  "○  No Due Date"),
    ]

    for group_tasks, label in groups:
        if not group_tasks:
            continue
        _section_header(label, len(group_tasks))
        for task in group_tasks:
            _render_task_row(task, goals)


# ---------------------------------------------------------------------------
#  Selection controls (above the list, button-based — no persistent state)
# ---------------------------------------------------------------------------

def _render_selection_controls(active_tasks: list) -> None:
    """Select all / Clear all buttons. Uses buttons to avoid checkbox state conflicts."""
    if not active_tasks:
        return

    selected_count = sum(
        1 for t in active_tasks if st.session_state.get(f"bulk_{t.id}", False)
    )

    c1, c2, _ = st.columns([1.3, 1.5, 7])
    with c1:
        if st.button("☑ Select all", key="select_all_btn", use_container_width=True):
            for t in active_tasks:
                st.session_state[f"bulk_{t.id}"] = True
            st.rerun()
    with c2:
        if selected_count > 0:
            if st.button(
                f"☐ Clear ({selected_count})", key="clear_sel_btn",
                use_container_width=True,
            ):
                for t in active_tasks:
                    st.session_state[f"bulk_{t.id}"] = False
                st.rerun()


# ---------------------------------------------------------------------------
#  Bulk-action bar — shown at the bottom when ≥1 task is selected
# ---------------------------------------------------------------------------

def _render_bulk_actions(active_tasks: list) -> None:
    selected_ids = [
        t.id for t in active_tasks
        if st.session_state.get(f"bulk_{t.id}", False)
    ]
    if not selected_ids:
        return

    n = len(selected_ids)
    with st.container(border=True):
        st.caption(f"**{n} task{'s' if n > 1 else ''} selected** — choose an action:")
        c1, c2, c3, _ = st.columns([2, 2, 2, 4])
        with c1:
            if st.button("✅ Mark Done", key="bulk_mark_done", type="primary",
                         use_container_width=True):
                for tid in selected_ids:
                    crud.update_task(tid, status="done")
                for t in active_tasks:
                    st.session_state[f"bulk_{t.id}"] = False
                show_toast(f"Marked {n} task(s) as done")
                st.cache_data.clear()
                st.rerun()
        with c2:
            new_prio = st.selectbox(
                "priority_bulk",
                PRIORITY_OPTIONS,
                format_func=lambda p: f"{PRIORITY_ICONS[p]}  {p.title()}",
                key="bulk_priority_select",
                label_visibility="collapsed",
            )
        with c3:
            if st.button("Set Priority", key="bulk_set_prio", use_container_width=True):
                for tid in selected_ids:
                    crud.update_task(tid, priority=new_prio)
                for t in active_tasks:
                    st.session_state[f"bulk_{t.id}"] = False
                show_toast(f"Set '{new_prio}' priority on {n} task(s)")
                st.cache_data.clear()
                st.rerun()


# ---------------------------------------------------------------------------
#  Done & Cancelled archive section
# ---------------------------------------------------------------------------

def _render_archived_task_row(task) -> None:
    """Compact read-only row with restore and delete buttons."""
    c_title, c_restore, c_del = st.columns([6, 0.7, 0.7])
    with c_title:
        title_md = f"~~{task.title}~~" if task.status == "done" else task.title
        meta = []
        if task.due_date:
            meta.append(friendly_date(task.due_date))
        if task.tags:
            meta.append(", ".join(
                f"#{t.strip()}" for t in task.tags.split(",") if t.strip()
            ))
        suffix = f"   *{' · '.join(meta)}*" if meta else ""
        st.markdown(f"{title_md}{suffix}")
    with c_restore:
        if st.button(
            "↩", key=f"restore_{task.id}",
            help="Restore to To Do",
            use_container_width=True,
        ):
            crud.update_task(task.id, status="todo")
            show_toast(f"Restored: {task.title}")
            st.cache_data.clear()
            st.rerun()
    with c_del:
        if st.button(
            "🗑", key=f"del_arc_{task.id}",
            help="Delete permanently",
            use_container_width=True,
        ):
            crud.delete_task(task.id)
            show_toast(f"Deleted: {task.title}", icon="🗑️")
            st.cache_data.clear()
            st.rerun()


def _render_done_cancelled_section(done_tasks: list, cancelled_tasks: list) -> None:
    """Collapsed archive section for completed and cancelled tasks."""
    total = len(done_tasks) + len(cancelled_tasks)
    if total == 0:
        return

    label = f"✅  Completed & Cancelled  ·  {total}"
    with st.expander(label, expanded=False):

        # ── Completed ─────────────────────────────────────────────────────────
        if done_tasks:
            c1, c2 = st.columns([4, 1])
            with c1:
                st.markdown(
                    f"<span style='font-size:0.78rem;font-weight:700;"
                    f"letter-spacing:0.05em;text-transform:uppercase;"
                    f"color:#6B7280'>✅ Completed — {len(done_tasks)}</span>",
                    unsafe_allow_html=True,
                )
            with c2:
                if st.button(
                    "🗑 Clear all", key="clear_all_done",
                    use_container_width=True,
                    help="Permanently delete all completed tasks",
                ):
                    for t in done_tasks:
                        crud.delete_task(t.id)
                    show_toast(f"Deleted {len(done_tasks)} completed tasks", icon="🗑️")
                    st.cache_data.clear()
                    st.rerun()

            for task in done_tasks:
                _render_archived_task_row(task)

        # ── Cancelled ─────────────────────────────────────────────────────────
        if cancelled_tasks:
            if done_tasks:
                st.divider()
            c1, c2 = st.columns([4, 1])
            with c1:
                st.markdown(
                    f"<span style='font-size:0.78rem;font-weight:700;"
                    f"letter-spacing:0.05em;text-transform:uppercase;"
                    f"color:#6B7280'>❌ Cancelled — {len(cancelled_tasks)}</span>",
                    unsafe_allow_html=True,
                )
            with c2:
                if st.button(
                    "🗑 Clear all", key="clear_all_cancelled",
                    use_container_width=True,
                    help="Permanently delete all cancelled tasks",
                ):
                    for t in cancelled_tasks:
                        crud.delete_task(t.id)
                    show_toast(f"Deleted {len(cancelled_tasks)} cancelled tasks", icon="🗑️")
                    st.cache_data.clear()
                    st.rerun()

            for task in cancelled_tasks:
                _render_archived_task_row(task)


# ---------------------------------------------------------------------------
#  Kanban view (all statuses — unchanged)
# ---------------------------------------------------------------------------

def _render_kanban_card(task, goals: list) -> None:
    prio     = PRIORITY_ICONS.get(task.priority, "")
    label    = f"{prio}  **{task.title}**"
    expanded = st.session_state.get(f"expanded_{task.id}", False)
    with st.expander(label, expanded=expanded):
        caption_parts = []
        if task.due_date:
            marker = (
                " ⚠️"
                if is_overdue(task.due_date) and task.status not in ("done", "cancelled")
                else ""
            )
            caption_parts.append(f"{friendly_date(task.due_date)}{marker}")
        if task.estimated_minutes:
            caption_parts.append(f"{task.estimated_minutes} min")
        if caption_parts:
            st.caption("  ·  ".join(caption_parts))
        _render_edit_form(task, goals)


def _render_kanban_view(tasks: list, goals: list) -> None:
    columns_cfg = [
        ("○ To Do",        "todo"),
        ("◑ In Progress",  "in_progress"),
        ("✅ Done",         "done"),
        ("❌ Cancelled",    "cancelled"),
    ]
    cols = st.columns(4)
    for col_widget, (col_label, status_key) in zip(cols, columns_cfg):
        col_tasks = [t for t in tasks if t.status == status_key]
        with col_widget:
            st.markdown(f"**{col_label}**")
            st.caption(f"{len(col_tasks)} task{'s' if len(col_tasks) != 1 else ''}")
            st.divider()
            if not col_tasks:
                st.caption("*Empty*")
            else:
                for task in col_tasks:
                    _render_kanban_card(task, goals)


# ---------------------------------------------------------------------------
#  Metrics strip
# ---------------------------------------------------------------------------

def _render_metrics(all_tasks: list) -> None:
    today_ = date.today()
    total     = sum(1 for t in all_tasks if t.status in ("todo", "in_progress"))
    overdue_n = sum(
        1 for t in all_tasks
        if t.due_date and t.due_date < today_ and t.status not in ("done", "cancelled")
    )
    in_prog   = sum(1 for t in all_tasks if t.status == "in_progress")
    done_n    = sum(1 for t in all_tasks if t.status == "done")

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Active", total)
    c2.metric(
        "Overdue", overdue_n,
        delta=f"−{overdue_n}" if overdue_n else None,
        delta_color="inverse",
    )
    c3.metric("In Progress", in_prog)
    c4.metric("Completed", done_n)


# ---------------------------------------------------------------------------
#  Page entry point
# ---------------------------------------------------------------------------

_init_state()

st.title("✅ Tasks & To-dos")

goals     = crud.get_goals()
all_tasks = crud.get_tasks()

# ── Quick-add bar ─────────────────────────────────────────────────────────────
_render_quick_add()

# ── Metrics ───────────────────────────────────────────────────────────────────
_render_metrics(all_tasks)

# ── View / sort controls + filters ───────────────────────────────────────────
current_view, sort_key = _render_controls()
_render_filters(goals)

with st.expander("ℹ️ Icon guide", expanded=False):
    st.caption(
        "Priority: 🔴 Urgent · 🟠 High · *(no badge)* Medium / Low  \n"
        "Status: ○ To Do · ◑ In Progress · ✅ Done · ❌ Cancelled"
    )

st.divider()

# Apply filters to the full task list
all_filtered = _filter_tasks(all_tasks, goals)
all_filtered = _sort_tasks(all_filtered, sort_key)

# Split into active (main list) and archived (done / cancelled section)
active_tasks    = [t for t in all_filtered if t.status in ("todo", "in_progress")]
done_tasks      = [t for t in all_filtered if t.status == "done"]
cancelled_tasks = [t for t in all_filtered if t.status == "cancelled"]

# ── Main list ─────────────────────────────────────────────────────────────────
if current_view == "list":
    # Selection controls: Select all / Clear buttons (button-based, no state conflicts)
    _render_selection_controls(active_tasks)
    _render_list_view(active_tasks, goals)
    # Bulk action bar appears here — AFTER the checkboxes have rendered
    _render_bulk_actions(active_tasks)
else:
    _render_kanban_view(all_filtered, goals)  # Kanban shows all columns

# ── Completed & Cancelled archive ─────────────────────────────────────────────
st.divider()
_render_done_cancelled_section(done_tasks, cancelled_tasks)
