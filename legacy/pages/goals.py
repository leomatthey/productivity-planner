"""
pages/goals.py — Goals & Projects

Features:
  - Goal cards with title, status badge, target date, and progress bar
  - Quick-complete and quick-pause action buttons on each card (no form needed)
  - Auto progress mode: calculated from linked task completion
  - Manual progress mode: slider in edit form (hidden when mode is Auto)
  - Quick progress mode toggle button on each card
  - Expandable cards with tabs: Edit / Linked Tasks / Sub-goals
  - Inline "Add task" form inside the Linked Tasks tab
  - Sub-goals support (one level of nesting, parent_id selector in create & edit forms)
  - Status workflow: Active / Paused / Completed / Archived
  - Create goal form (collapsible, clear_on_submit)
  - Toast confirmations on all writes
"""

from __future__ import annotations

from datetime import date

import streamlit as st

from db import crud
from utils.date_utils import friendly_date
from utils.toast import show_toast

# ---------------------------------------------------------------------------
#  Constants
# ---------------------------------------------------------------------------

GOAL_STATUS_OPTIONS = ["active", "paused", "completed", "archived"]
GOAL_STATUS_LABELS = {
    "active":    "Active",
    "paused":    "Paused",
    "completed": "Completed",
    "archived":  "Archived",
}
GOAL_STATUS_ICONS = {
    "active":    "▶",
    "paused":    "⏸",
    "completed": "✅",
    "archived":  "📦",
}

TASK_STATUS_ICONS = {
    "todo":        "○",
    "in_progress": "◑",
    "done":        "✅",
    "cancelled":   "❌",
}
TASK_PRIORITY_ICONS = {
    "urgent": "🔴",
    "high":   "🟠",
    "medium": "",
    "low":    "",
}

# ---------------------------------------------------------------------------
#  Session-state bootstrap
# ---------------------------------------------------------------------------

def _init_state() -> None:
    defaults: dict = {
        "goal_filter_status": [],
        "goal_show_archived": False,
    }
    for k, v in defaults.items():
        if k not in st.session_state:
            st.session_state[k] = v


# ---------------------------------------------------------------------------
#  Card label helper
# ---------------------------------------------------------------------------

def _goal_card_label(goal) -> str:
    icon  = GOAL_STATUS_ICONS.get(goal.status, "")
    parts = [f"{icon}  **{goal.title}**"]
    if goal.target_date:
        parts.append(f"*{friendly_date(goal.target_date)}*")
    pct = goal.progress_pct or 0
    parts.append(f"*{pct}%*")
    return "   ·   ".join(parts)


# ---------------------------------------------------------------------------
#  Metrics strip
# ---------------------------------------------------------------------------

def _render_metrics(goals: list) -> None:
    total     = len(goals)
    active    = sum(1 for g in goals if g.status == "active")
    completed = sum(1 for g in goals if g.status == "completed")
    paused    = sum(1 for g in goals if g.status == "paused")

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Total", total)
    c2.metric("Active", active)
    c3.metric("Completed", completed)
    c4.metric("Paused", paused)


# ---------------------------------------------------------------------------
#  Filters
# ---------------------------------------------------------------------------

def _render_filters() -> None:
    with st.expander("🔍 Filters", expanded=False):
        c1, c2 = st.columns(2)
        with c1:
            st.multiselect(
                "Status",
                GOAL_STATUS_OPTIONS,
                format_func=lambda s: f"{GOAL_STATUS_ICONS[s]}  {GOAL_STATUS_LABELS[s]}",
                key="goal_filter_status",
            )
        with c2:
            st.checkbox("Show archived", key="goal_show_archived")

        if st.button("✖ Clear filters", key="clear_goal_filters"):
            st.session_state.goal_filter_status = []
            st.session_state.goal_show_archived = False
            st.rerun()


def _apply_filters(goals: list) -> list:
    statuses      = st.session_state.goal_filter_status
    show_archived = st.session_state.goal_show_archived
    out = goals
    if not show_archived:
        out = [g for g in out if g.status != "archived"]
    if statuses:
        out = [g for g in out if g.status in statuses]
    return out


# ---------------------------------------------------------------------------
#  Create Goal form
# ---------------------------------------------------------------------------

def _render_create_form(top_level_goals: list) -> None:
    with st.expander("➕ Create New Goal", expanded=False):
        with st.form("create_goal_form", clear_on_submit=True):
            new_title = st.text_input(
                "Title *", placeholder="e.g. Launch my product by Q3"
            )

            c1, c2 = st.columns(2)
            with c1:
                new_status = st.selectbox(
                    "Status",
                    GOAL_STATUS_OPTIONS,
                    format_func=lambda s: f"{GOAL_STATUS_ICONS[s]}  {GOAL_STATUS_LABELS[s]}",
                )
            with c2:
                new_target = st.date_input("Target date", value=None)

            c3, c4 = st.columns(2)
            with c3:
                new_mode = st.selectbox(
                    "Progress mode",
                    ["manual", "auto"],
                    format_func=lambda m: "📊 Auto (from tasks)" if m == "auto" else "🎚️ Manual",
                    help="Auto recalculates progress from linked task completion.",
                )
            with c4:
                parent_labels = ["— None (top-level) —"] + [g.title for g in top_level_goals]
                new_parent_label = st.selectbox(
                    "Parent goal",
                    parent_labels,
                    help="Nest this goal one level under an existing goal.",
                )

            new_desc = st.text_area(
                "Description",
                height=80,
                placeholder="Optional notes or success criteria…",
            )
            init_pct = st.slider(
                "Initial progress (%)",
                0, 100, 0, step=5,
                help="Only applied when progress mode is Manual.",
            )

            submitted = st.form_submit_button("✅ Create Goal", type="primary")

            if submitted:
                title_clean = (new_title or "").strip()
                if not title_clean:
                    st.error("Title cannot be empty.")
                else:
                    parent_id = None
                    if new_parent_label != "— None (top-level) —":
                        matched = [g for g in top_level_goals if g.title == new_parent_label]
                        if matched:
                            parent_id = matched[0].id

                    target_clean = new_target if isinstance(new_target, date) else None
                    pct = init_pct if new_mode == "manual" else 0

                    crud.create_goal(
                        title=title_clean,
                        description=(new_desc or "").strip() or None,
                        status=new_status,
                        target_date=target_clean,
                        progress_pct=pct,
                        progress_mode=new_mode,
                        parent_id=parent_id,
                    )
                    show_toast(f"Goal created: {title_clean}")
                    st.cache_data.clear()


# ---------------------------------------------------------------------------
#  Linked tasks widget (with inline quick-add)
# ---------------------------------------------------------------------------

def _render_linked_tasks(goal) -> None:
    tasks = crud.get_tasks(project_id=goal.id)
    if not tasks:
        st.caption("*No tasks linked to this goal yet.*")
        st.caption("Add a task below, or set the Project field on an existing task.")
    else:
        total = len(tasks)
        done  = sum(1 for t in tasks if t.status == "done")
        st.caption(f"{done} / {total} tasks completed")
        st.divider()

        for task in tasks:
            prio  = TASK_PRIORITY_ICONS.get(task.priority, "")
            stat  = TASK_STATUS_ICONS.get(task.status, "")
            parts = [f"{prio} {stat}  **{task.title}**"]
            if task.due_date:
                parts.append(f"*{friendly_date(task.due_date)}*")
            if task.estimated_minutes:
                parts.append(f"*{task.estimated_minutes} min*")
            st.markdown("   ·   ".join(parts))

    # ── Inline quick-add task ─────────────────────────────────────────────────
    st.divider()
    with st.form(f"add_task_goal_{goal.id}", clear_on_submit=True):
        c1, c2 = st.columns([5, 1])
        with c1:
            new_task_title = st.text_input(
                "new_task_for_goal",
                placeholder="Add a task to this goal…",
                label_visibility="collapsed",
            )
        with c2:
            add_task = st.form_submit_button("＋ Add", use_container_width=True)

    if add_task and (new_task_title or "").strip():
        crud.create_task(
            title=new_task_title.strip(),
            project_id=goal.id,
        )
        show_toast(f"Task added: {new_task_title.strip()}")
        st.session_state[f"goal_expanded_{goal.id}"] = True
        st.cache_data.clear()
        st.rerun()


# ---------------------------------------------------------------------------
#  Edit form (shared by top-level cards and sub-goal cards)
# ---------------------------------------------------------------------------

def _render_edit_form(goal, top_level_goals: list) -> None:
    """
    Render the inline save/delete form for a goal.

    The progress slider is hidden when the goal is in Auto mode — it would
    have no effect and showing it is a broken affordance.

    top_level_goals: all non-deleted top-level goals (used to populate parent selector).
    The current goal is excluded from parent candidates to prevent self-parenting.
    """
    # Top-level goals excluding self (can't be own parent)
    parent_candidates = [g for g in top_level_goals if g.id != goal.id]
    goal_none_label   = "— None (top-level) —"
    parent_options    = [goal_none_label] + [g.title for g in parent_candidates]

    # Pre-compute current parent label before entering form context
    cur_parent_label = goal_none_label
    for g in parent_candidates:
        if g.id == goal.parent_id:
            cur_parent_label = g.title
            break

    # Initialise new_parent_label so the save handler always has a value
    new_parent_label = cur_parent_label
    new_pct = int(goal.progress_pct or 0)

    with st.form(key=f"goal_edit_{goal.id}"):
        new_title = st.text_input("Title *", value=goal.title, key=f"ge_title_{goal.id}")

        c1, c2 = st.columns(2)
        with c1:
            new_status = st.selectbox(
                "Status",
                GOAL_STATUS_OPTIONS,
                index=GOAL_STATUS_OPTIONS.index(goal.status),
                format_func=lambda s: f"{GOAL_STATUS_ICONS[s]}  {GOAL_STATUS_LABELS[s]}",
                key=f"ge_status_{goal.id}",
            )
        with c2:
            new_target = st.date_input(
                "Target date",
                value=goal.target_date if goal.target_date else None,
                key=f"ge_target_{goal.id}",
            )

        c3, c4 = st.columns(2)
        with c3:
            new_mode = st.selectbox(
                "Progress mode",
                ["manual", "auto"],
                index=0 if goal.progress_mode == "manual" else 1,
                format_func=lambda m: "📊 Auto (from tasks)" if m == "auto" else "🎚️ Manual",
                key=f"ge_mode_{goal.id}",
                help="Auto recalculates progress from linked task completion.",
            )
        with c4:
            parent_idx = (
                parent_options.index(cur_parent_label)
                if cur_parent_label in parent_options
                else 0
            )
            new_parent_label = st.selectbox(
                "Parent goal",
                parent_options,
                index=parent_idx,
                key=f"ge_parent_{goal.id}",
                help="Move under another goal, or set to None to make top-level.",
            )

        new_desc = st.text_area(
            "Description",
            value=goal.description or "",
            height=80,
            key=f"ge_desc_{goal.id}",
        )

        # Progress slider: only shown for Manual mode.
        # In Auto mode, progress is recalculated from tasks — the slider would be ignored.
        if goal.progress_mode == "manual":
            new_pct = st.slider(
                "Manual progress (%)",
                0, 100,
                value=int(goal.progress_pct or 0),
                step=5,
                key=f"ge_pct_{goal.id}",
            )
        else:
            st.info(
                "📊 Progress is calculated automatically from linked task completion. "
                "Switch to Manual mode to set it directly.",
                icon=None,
            )

        bc1, bc2, _ = st.columns([2, 2, 6])
        with bc1:
            save = st.form_submit_button(
                "💾 Save", type="primary", use_container_width=True
            )
        with bc2:
            delete = st.form_submit_button("🗑️ Delete", use_container_width=True)

    # --- Save ---
    if save:
        title_clean = (new_title or "").strip()
        if not title_clean:
            st.error("Title cannot be empty.")
        else:
            target_clean = new_target if isinstance(new_target, date) else None

            parent_id = None
            if new_parent_label != goal_none_label:
                matched = [g for g in parent_candidates if g.title == new_parent_label]
                if matched:
                    parent_id = matched[0].id

            update_fields: dict = {
                "title":         title_clean,
                "description":   (new_desc or "").strip() or None,
                "status":        new_status,
                "target_date":   target_clean,
                "progress_mode": new_mode,
                "parent_id":     parent_id,
            }
            if new_mode == "manual":
                update_fields["progress_pct"] = new_pct

            crud.update_goal(
                goal.id,
                current_updated_at=goal.updated_at,
                **update_fields,
            )
            st.session_state[f"goal_expanded_{goal.id}"] = True
            show_toast(f"Saved: {title_clean}")
            st.cache_data.clear()
            st.rerun()

    # --- Delete ---
    if delete:
        crud.delete_goal(goal.id)
        st.session_state.pop(f"goal_expanded_{goal.id}", None)
        show_toast(f"Deleted: {goal.title}", icon="🗑️")
        st.cache_data.clear()
        st.rerun()


# ---------------------------------------------------------------------------
#  Quick-action buttons (complete / pause / reactivate)
# ---------------------------------------------------------------------------

def _render_quick_actions(goal) -> None:
    """One-click status transitions — visible without opening the Edit tab."""
    status = goal.status
    actions = []

    if status == "active":
        actions = [
            ("✅ Complete", "completed", "primary"),
            ("⏸ Pause",    "paused",    "secondary"),
        ]
    elif status == "paused":
        actions = [
            ("▶ Reactivate", "active",    "primary"),
            ("✅ Complete",   "completed", "secondary"),
        ]
    elif status == "completed":
        actions = [
            ("▶ Reopen", "active", "secondary"),
        ]

    if not actions:
        return

    cols = st.columns(len(actions) + 1)   # +1 spacer
    for col, (label, new_status, btn_type) in zip(cols, actions):
        with col:
            if st.button(
                label,
                key=f"qa_{goal.id}_{new_status}",
                type=btn_type,
                use_container_width=True,
            ):
                crud.update_goal(goal.id, status=new_status)
                st.session_state[f"goal_expanded_{goal.id}"] = True
                show_toast(f"{goal.title} → {new_status}")
                st.cache_data.clear()
                st.rerun()


# ---------------------------------------------------------------------------
#  Sub-goal card (shown inside parent's Sub-goals tab — no further nesting)
# ---------------------------------------------------------------------------

def _render_subgoal_card(sg, top_level_goals: list) -> None:
    expanded = st.session_state.get(f"goal_expanded_{sg.id}", False)
    pct      = sg.progress_pct or 0

    with st.expander(_goal_card_label(sg), expanded=expanded):
        st.progress(pct / 100)

        mode_icon  = "📊" if sg.progress_mode == "auto" else "🎚️"
        mode_label = "Auto (from tasks)" if sg.progress_mode == "auto" else "Manual"

        toggle_label = "Switch to Manual" if sg.progress_mode == "auto" else "Switch to Auto"
        toggle_mode  = "manual" if sg.progress_mode == "auto" else "auto"

        col_info, col_toggle = st.columns([5, 1])
        with col_info:
            st.caption(f"{mode_icon} {mode_label}  ·  {pct}% complete")
        with col_toggle:
            if st.button(
                toggle_label,
                key=f"toggle_mode_{sg.id}",
                use_container_width=True,
            ):
                crud.update_goal(sg.id, progress_mode=toggle_mode)
                st.session_state[f"goal_expanded_{sg.id}"] = True
                show_toast(f"Switched to {toggle_mode} progress mode")
                st.rerun()

        # Quick actions
        _render_quick_actions(sg)

        st.divider()
        tab_edit, tab_tasks = st.tabs(["✏️ Edit", "📋 Linked Tasks"])
        with tab_edit:
            _render_edit_form(sg, top_level_goals)
        with tab_tasks:
            _render_linked_tasks(sg)


def _render_subgoals_tab(parent_goal, all_goals: list, top_level_goals: list) -> None:
    # Sub-goals are always shown regardless of the current filter
    subgoals = [g for g in all_goals if g.parent_id == parent_goal.id]
    if not subgoals:
        st.caption("*No sub-goals.*")
        st.caption(
            "Create a sub-goal using the **Create New Goal** form above "
            "and select this goal as the parent."
        )
        return

    for sg in subgoals:
        _render_subgoal_card(sg, top_level_goals)


# ---------------------------------------------------------------------------
#  Top-level goal card
# ---------------------------------------------------------------------------

def _render_goal_card(goal, all_goals: list, top_level_goals: list) -> None:
    expanded = st.session_state.get(f"goal_expanded_{goal.id}", False)
    pct      = goal.progress_pct or 0

    with st.expander(_goal_card_label(goal), expanded=expanded):
        # Progress bar (full width)
        st.progress(pct / 100)

        # Mode indicator + quick toggle
        mode_icon  = "📊" if goal.progress_mode == "auto" else "🎚️"
        mode_label = "Auto (from tasks)" if goal.progress_mode == "auto" else "Manual"

        toggle_label = "Switch to Manual" if goal.progress_mode == "auto" else "Switch to Auto"
        toggle_mode  = "manual" if goal.progress_mode == "auto" else "auto"

        col_info, col_toggle = st.columns([5, 1])
        with col_info:
            st.caption(f"{mode_icon} {mode_label}  ·  {pct}% complete")
        with col_toggle:
            if st.button(
                toggle_label,
                key=f"toggle_mode_{goal.id}",
                use_container_width=True,
            ):
                crud.update_goal(goal.id, progress_mode=toggle_mode)
                st.session_state[f"goal_expanded_{goal.id}"] = True
                show_toast(f"Switched to {toggle_mode} progress mode")
                st.rerun()

        # Quick-action buttons (complete / pause / reactivate)
        _render_quick_actions(goal)

        st.divider()

        tab_edit, tab_tasks, tab_subgoals = st.tabs(
            ["✏️ Edit", "📋 Linked Tasks", "🎯 Sub-goals"]
        )
        with tab_edit:
            _render_edit_form(goal, top_level_goals)
        with tab_tasks:
            _render_linked_tasks(goal)
        with tab_subgoals:
            _render_subgoals_tab(goal, all_goals, top_level_goals)


# ---------------------------------------------------------------------------
#  Page entry point
# ---------------------------------------------------------------------------

_init_state()

st.title("🎯 Goals & Projects")

# get_goals() recalculates auto-mode progress on read
all_goals       = crud.get_goals()
top_level_goals = [g for g in all_goals if g.parent_id is None]

_render_create_form(top_level_goals)

_render_metrics(all_goals)

_render_filters()

st.divider()

# Filter applies to top-level goals only;
# sub-goals are shown inside their parent's card tab regardless of filter.
visible_goals = _apply_filters(all_goals)
visible_top   = [g for g in visible_goals if g.parent_id is None]

if not visible_top:
    if all_goals:
        st.info("No goals match the current filters.")
    else:
        st.info("No goals yet — create your first goal using the form above.")
else:
    for goal in visible_top:
        _render_goal_card(goal, all_goals, top_level_goals)
