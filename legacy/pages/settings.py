"""
pages/settings.py — Settings & Data Management.

Sections:
  - Database: row-count stats, JSON export, and nuclear clear
  - Seed Data: one-click realistic demo data insertion
  - About: app version, dependency versions, spec file link
"""

import json
import os
import platform
import sys
from datetime import date, datetime
from typing import Any, Dict

import sqlalchemy
import streamlit as st

from db import crud
from utils.seed import seed_database

st.title("⚙️ Settings")

# ============================================================================
#  1. DATABASE SECTION
# ============================================================================

st.header("🗄️ Database")

stats = crud.get_db_stats()

# Row-count metrics (two rows of three)
c1, c2, c3 = st.columns(3)
c1.metric("Tasks (active)", stats["tasks_active"],
          delta=f"{stats['tasks_total']} total (incl. deleted)",
          delta_color="off")
c2.metric("Goals (active)", stats["goals_active"],
          delta=f"{stats['goals_total']} total (incl. deleted)",
          delta_color="off")
c3.metric("Habits (active)", stats["habits_active"],
          delta=f"{stats['habits_total']} total (incl. archived)",
          delta_color="off")

c4, c5, c6 = st.columns(3)
c4.metric("Calendar Events", stats["events_active"],
          delta=f"{stats['events_total']} total (incl. deleted)",
          delta_color="off")
c5.metric("Habit Completions", stats["habit_completions"])
c6.metric("AI Messages", stats["ai_messages"])

st.divider()

# ------------------------------------------------------------------  Export

st.subheader("Export Data")
st.caption("Download all planning data as a single JSON file.")


def _obj_to_dict(obj: Any) -> Dict:
    """Serialise an ORM row to a plain dict (dates → ISO-8601 strings)."""
    d: Dict = {}
    for col in obj.__table__.columns:
        val = getattr(obj, col.name)
        if isinstance(val, (date, datetime)):
            d[col.name] = val.isoformat()
        else:
            d[col.name] = val
    return d


def _build_export_json() -> str:
    tasks = crud.get_tasks(include_deleted=True)
    goals = crud.get_goals(include_deleted=True)
    habits = crud.get_habits(include_inactive=True)
    events = crud.get_events(include_deleted=True, include_stale=True)

    completions = []
    for h in habits:
        completions.extend(crud.get_habit_completions(h.id))

    ai_messages = []
    for sid in crud.get_sessions():
        ai_messages.extend(crud.get_conversation(sid))

    payload = {
        "exported_at": datetime.utcnow().isoformat(),
        "tasks": [_obj_to_dict(t) for t in tasks],
        "goals": [_obj_to_dict(g) for g in goals],
        "habits": [_obj_to_dict(h) for h in habits],
        "habit_completions": [_obj_to_dict(c) for c in completions],
        "calendar_events": [_obj_to_dict(e) for e in events],
        "ai_conversation_history": [_obj_to_dict(m) for m in ai_messages],
    }
    return json.dumps(payload, indent=2)


# Lazy export: only serialise when the user clicks "Prepare Export".
if "settings_export_json" not in st.session_state:
    if st.button("Prepare Export", key="btn_prepare_export"):
        with st.spinner("Serialising data…"):
            st.session_state["settings_export_json"] = _build_export_json()
        st.rerun()
else:
    export_filename = f"planner_export_{date.today().isoformat()}.json"
    st.download_button(
        label="⬇️ Download JSON",
        data=st.session_state["settings_export_json"],
        file_name=export_filename,
        mime="application/json",
    )
    if st.button("Cancel", key="btn_cancel_export"):
        del st.session_state["settings_export_json"]
        st.rerun()

st.divider()

# ----------------------------------------------------------------  Clear all

st.subheader("Clear All Data")
st.warning(
    "⚠️ **This permanently deletes ALL tasks, goals, habits, calendar events, "
    "and AI conversation history.** This action cannot be undone."
)

confirmed = st.checkbox(
    "I understand this will permanently delete all data",
    key="settings_clear_confirm",
)
if confirmed:
    if st.button("🗑️ Clear All Data", type="primary", key="btn_clear_all"):
        with st.spinner("Deleting all records…"):
            crud.clear_all_data()
        st.cache_data.clear()
        # Reset the confirmation checkbox and any cached export
        for k in ("settings_clear_confirm", "settings_export_json"):
            st.session_state.pop(k, None)
        st.success(
            "All data has been cleared. "
            "Refresh the AI Assistant page to start a new conversation."
        )
        st.rerun()

st.divider()

# ============================================================================
#  2. GOOGLE CALENDAR SECTION
# ============================================================================

st.header("📅 Google Calendar")

try:
    import integrations.google_calendar as _gc
    _gc_available = True
except ImportError:
    _gc_available = False

if not _gc_available:
    st.error(
        "Google Calendar integration requires `google-api-python-client` and "
        "`google-auth-oauthlib`. Run: `pip install -r requirements.txt`"
    )
else:
    # The redirect URI must match an Authorized redirect URI in Google Cloud Console.
    _redirect_uri = os.getenv("STREAMLIT_REDIRECT_URI", "http://localhost:8501")

    if not _gc.has_client_secrets():
        # ── Setup instructions ──────────────────────────────────────────────
        st.info(
            "Connect Google Calendar to import your events into the planner. "
            "Complete the one-time setup below, then click **Connect**."
        )
        with st.expander("Setup instructions (click to expand)"):
            st.markdown(
                """
**Steps to enable Google Calendar sync:**

1. Go to [Google Cloud Console](https://console.cloud.google.com) and create (or select) a project.
2. Navigate to **APIs & Services → Library** and enable the **Google Calendar API**.
3. Navigate to **APIs & Services → Credentials**.
4. Click **Create Credentials → OAuth 2.0 Client ID**.
5. Select **Web Application** as the application type.
6. Under **Authorized redirect URIs**, add exactly: `http://localhost:8501`
   *(or the value of the `STREAMLIT_REDIRECT_URI` env var if you changed it)*
7. Click **Create**, then click **Download JSON** for the new credential.
8. Rename the downloaded file to `google_client_secrets.json` and place it in the
   `data/` folder of this project.
9. Refresh this page — the Connect button will appear.
                """
            )
        st.caption(f"Expected file location: `{_gc.SECRETS_FILE}`")

    elif not _gc.is_authenticated():
        # ── Client secrets present but no valid token ────────────────────────
        st.info("Not connected to Google Calendar.")

        if "gc_auth_url" in st.session_state:
            st.markdown(
                f"**[Click here to authorize Google Calendar access]"
                f"({st.session_state['gc_auth_url']})**"
            )
            st.caption(
                f"After authorizing on Google, you will be redirected back to the app "
                f"automatically (`{_redirect_uri}`)."
            )
            if st.button("Cancel", key="btn_gc_cancel_auth"):
                del st.session_state["gc_auth_url"]
                _gc.revoke_token()
                st.rerun()
        else:
            if st.button(
                "Connect Google Calendar", key="btn_gc_connect", type="primary"
            ):
                try:
                    _auth_url = _gc.get_auth_url(_redirect_uri)
                    st.session_state["gc_auth_url"] = _auth_url
                    st.rerun()
                except Exception as _exc:
                    st.error(f"Could not start OAuth flow: {_exc}")
            st.caption(
                "Clicking Connect will open Google's authorization page in your browser."
            )

    else:
        # ── Connected ────────────────────────────────────────────────────────
        st.session_state.pop("gc_auth_url", None)
        st.success("Connected")

        # Load calendar list once per session; "Refresh" button clears the cache
        _col_status, _col_refresh = st.columns([4, 1])
        with _col_refresh:
            if st.button("↺ Refresh list", key="btn_gc_refresh_cals"):
                st.session_state.pop("gc_calendars", None)
                st.rerun()

        if "gc_calendars" not in st.session_state:
            try:
                with st.spinner("Loading your calendars…"):
                    st.session_state["gc_calendars"] = _gc.list_calendars()
            except Exception as _exc:
                st.error(f"Could not load calendars: {_exc}")
                st.session_state["gc_calendars"] = []

        _calendars = [
            c for c in st.session_state.get("gc_calendars", [])
            if "#weeknum" not in c["id"]
        ]

        if not _calendars:
            st.warning("No calendars found. Check that the Calendar API is enabled.")
        else:
            # Calendar selector
            _cal_labels = [
                f"{'★ ' if c['primary'] else ''}{c['summary']}"
                for c in _calendars
            ]
            _cal_ids = [c["id"] for c in _calendars]
            _sel_idx = st.selectbox(
                "Calendar to sync",
                options=range(len(_cal_labels)),
                format_func=lambda i: _cal_labels[i],
                key="gc_selected_cal_idx",
            )
            _sel_cal_id = _cal_ids[_sel_idx]

            # Sync metadata
            _last_sync = _gc.get_last_sync(_sel_cal_id)
            if _last_sync:
                try:
                    _ls_dt = datetime.fromisoformat(_last_sync)
                    st.caption(
                        f"Last synced: {_ls_dt.strftime('%b %d, %Y at %H:%M UTC')}"
                    )
                except Exception:
                    st.caption(f"Last synced: {_last_sync}")
            else:
                st.caption("Not yet synced")

            # Synced event count for this calendar
            _synced = [
                e for e in crud.get_events(source="google", include_stale=True)
                if e.google_calendar_id == _sel_cal_id
            ]
            if _synced:
                _stale_n = sum(1 for e in _synced if e.sync_stale)
                _label   = f"{len(_synced)} events synced"
                if _stale_n:
                    _label += f" ({_stale_n} stale)"
                st.caption(_label)

            # Sync Now
            if st.button("Sync Now", key="btn_gc_sync", type="primary"):
                with st.spinner(
                    f"Syncing '{_cal_labels[_sel_idx]}'…"
                ):
                    try:
                        _res = _gc.sync_calendar(_sel_cal_id)
                        st.cache_data.clear()
                        st.success(
                            f"Sync complete — "
                            f"{_res['total_fetched']} fetched, "
                            f"{_res['created']} new, "
                            f"{_res['updated']} updated, "
                            f"{_res['stale_marked']} marked stale."
                        )
                        # Force calendar list refresh on next render
                        st.session_state.pop("gc_calendars", None)
                        st.rerun()
                    except Exception as _exc:
                        st.error(f"Sync failed: {_exc}")

        st.divider()

        # Disconnect
        if st.button("Disconnect Google Calendar", key="btn_gc_disconnect"):
            _gc.revoke_token()
            st.session_state.pop("gc_calendars", None)
            st.cache_data.clear()
            st.success("Google Calendar disconnected.")
            st.rerun()

st.divider()

# ============================================================================
#  3. SEED DATA SECTION
# ============================================================================

st.header("🌱 Seed Data")

st.markdown(
    """
Populate the database with realistic sample data so the app can be explored
immediately after a fresh install.

What gets inserted:

| Type | Count | Details |
|---|---|---|
| Tasks | 10 | Mix of statuses (todo/in\_progress/done), priorities, and due dates |
| Goals | 6 | 4 top-level + 2 sub-goals; one goal uses **auto-progress** from linked tasks |
| Habits | 5 | Daily morning routine, evening reading, weekly review |
| Calendar events | 6 | Some in the past, some today, some in the future |
"""
)

force_seed = st.checkbox(
    "Force re-seed (insert even if data already exists)",
    key="settings_seed_force",
)
if st.button("🌱 Seed Database", key="btn_seed"):
    with st.spinner("Inserting sample data…"):
        result = seed_database(force=force_seed)

    if result.get("skipped"):
        st.warning(f"Skipped: {result['reason']}")
    else:
        st.cache_data.clear()
        st.success(
            f"Database seeded — "
            f"{result['tasks']} tasks, "
            f"{result['goals']} goals (incl. sub-goals), "
            f"{result['habits']} habits, "
            f"{result['events']} calendar events."
        )
        st.rerun()

# ============================================================================
#  4. ABOUT SECTION
# ============================================================================

st.header("ℹ️ About")

col_a, col_b = st.columns(2)

with col_a:
    st.markdown("**App version:** 1.0.0")
    st.markdown(f"**Python:** {sys.version.split()[0]}")
    st.markdown(f"**Streamlit:** {st.__version__}")
    st.markdown(f"**SQLAlchemy:** {sqlalchemy.__version__}")
    st.markdown(f"**Platform:** {platform.system()} {platform.release()}")

with col_b:
    st.markdown("**Spec file:** `productivity_planner_spec_v2.1.docx`")
    st.caption("Located in the project root directory.")
    st.markdown("**Database:** `./data/planner.db` (SQLite)")
    st.caption("Stored locally — no cloud sync, no authentication.")
