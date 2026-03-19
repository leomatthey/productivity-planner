"""
app.py — Entry point for the Productivity Planner.

Responsibilities:
  - Load environment variables and initialise the database on startup.
  - Define the sidebar navigation using st.navigation() / st.Page().
  - Inject the overdue-task badge counter into the Tasks nav label.
  - Route to the appropriate page module.
"""

import os
from datetime import date
from pathlib import Path

import streamlit as st
from dotenv import load_dotenv

from db.schema import db_init
from db import crud

# ---------------------------------------------------------------------------
#  Bootstrap (non-Streamlit, safe to run before set_page_config)
# ---------------------------------------------------------------------------
load_dotenv()
db_init()

# ---------------------------------------------------------------------------
#  Page config — MUST be the first Streamlit call
# ---------------------------------------------------------------------------
st.set_page_config(
    page_title="Productivity Planner",
    page_icon="📋",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ---------------------------------------------------------------------------
#  Global CSS injection
# ---------------------------------------------------------------------------
_css_path = Path(__file__).parent / "assets" / "style.css"
if _css_path.exists():
    st.markdown(f"<style>{_css_path.read_text()}</style>", unsafe_allow_html=True)

# ---------------------------------------------------------------------------
#  Google Calendar OAuth callback handler
#  (runs on every page load so it works regardless of which page the
#   user lands on after Google's redirect back to http://localhost:8501)
# ---------------------------------------------------------------------------
_gc_code = st.query_params.get("code")
if _gc_code:
    # Only attempt exchange if we have a pending auth state file to match
    _pending_path = os.path.join("data", "google_auth_pending.json")
    if os.path.isfile(_pending_path):
        try:
            from integrations.google_calendar import exchange_code as _gc_exchange
            _gc_exchange(_gc_code)
            st.query_params.clear()
            st.cache_data.clear()
            st.toast("Google Calendar connected!", icon="✅")
            st.rerun()
        except Exception as _gc_exc:
            st.query_params.clear()
            st.error(f"Google Calendar connection failed: {_gc_exc}")

# ---------------------------------------------------------------------------
#  Overdue badge counter (cached 60 s so every rerun doesn't hit the DB)
# ---------------------------------------------------------------------------
@st.cache_data(ttl=60)
def _overdue_count() -> int:
    tasks = crud.get_tasks()
    today = date.today()
    return sum(
        1 for t in tasks
        if t.due_date
        and t.due_date < today
        and t.status not in ("done", "cancelled")
    )

overdue = _overdue_count()
tasks_label = f"Tasks & To-dos ({overdue} overdue)" if overdue > 0 else "Tasks & To-dos"

# ---------------------------------------------------------------------------
#  Sidebar branding (content added before pg.run() appears above the nav)
# ---------------------------------------------------------------------------
with st.sidebar:
    st.markdown(
        """
        <div style="padding: 0.6rem 0 1.1rem 0.25rem;">
          <div style="font-size: 1.35rem; font-weight: 700; letter-spacing: -0.5px;
                      color: #1E2028; display: flex; align-items: center; gap: 0.4rem;">
            📋 Planner
          </div>
          <div style="font-size: 0.72rem; color: #6B7280; margin-top: 3px;
                      letter-spacing: 0.04em; text-transform: uppercase; font-weight: 500;">
            Personal Productivity System
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )
    st.divider()

# ---------------------------------------------------------------------------
#  Navigation
# ---------------------------------------------------------------------------
pg = st.navigation(
    [
        st.Page("pages/dashboard.py",  title="Dashboard",           icon="🏠", default=True),
        st.Page("pages/tasks.py",      title=tasks_label,            icon="✅"),
        st.Page("pages/goals.py",      title="Goals & Projects",     icon="🎯"),
        st.Page("pages/calendar.py",   title="Calendar & Schedule",  icon="📅"),
        st.Page("pages/habits.py",     title="Habits & Routines",    icon="🔄"),
        st.Page("pages/ai_chat.py",    title="AI Assistant",         icon="🤖"),
        st.Page("pages/settings.py",   title="Settings",             icon="⚙️"),
    ]
)

pg.run()
