"""
integrations/google_calendar.py — Google Calendar OAuth 2.0 + event sync.

One-time setup (per installation):
  1. Go to https://console.cloud.google.com and create a project.
  2. Enable the **Google Calendar API**.
  3. Under **Credentials**, create an **OAuth 2.0 Client ID** (Web Application type).
  4. Add `http://localhost:8501` (or your Streamlit URL) as an Authorized redirect URI.
  5. Download the credentials JSON and save it as `data/google_client_secrets.json`.

OAuth state is persisted in `data/google_auth_pending.json` between the initial
redirect and the callback render so it survives the browser navigation.

The access token is cached in `data/google_token.json` and auto-refreshed when expired.
"""

import json
import os
from datetime import date as date_, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build

from db import crud

# ---------------------------------------------------------------------------
#  Paths and constants
# ---------------------------------------------------------------------------

_BASE_DIR    = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR     = os.path.join(_BASE_DIR, "data")
TOKEN_FILE   = os.path.join(DATA_DIR, "google_token.json")
SECRETS_FILE = os.path.join(DATA_DIR, "google_client_secrets.json")
SYNC_FILE    = os.path.join(DATA_DIR, "google_sync_info.json")
PENDING_FILE = os.path.join(DATA_DIR, "google_auth_pending.json")

SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]

# Events fetched from SYNC_DAYS_BACK ago to SYNC_DAYS_FORWARD in the future.
SYNC_DAYS_BACK    = 30
SYNC_DAYS_FORWARD = 90


# ---------------------------------------------------------------------------
#  Client-secrets helpers
# ---------------------------------------------------------------------------

def has_client_secrets() -> bool:
    """Return True if the OAuth client secrets file exists."""
    return os.path.isfile(SECRETS_FILE)


# ---------------------------------------------------------------------------
#  Credential helpers
# ---------------------------------------------------------------------------

def is_authenticated() -> bool:
    """Return True if a valid or refreshable token exists."""
    creds = _load_credentials()
    if creds is None:
        return False
    if creds.valid:
        return True
    if creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            _save_credentials(creds)
            return True
        except Exception:
            return False
    return False


def _load_credentials() -> Optional[Credentials]:
    if not os.path.isfile(TOKEN_FILE):
        return None
    try:
        return Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
    except Exception:
        return None


def _save_credentials(creds: Credentials) -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(TOKEN_FILE, "w") as fh:
        fh.write(creds.to_json())


def _get_service():
    """Return an authenticated Google Calendar API service object."""
    creds = _load_credentials()
    if creds is None:
        raise RuntimeError("Not authenticated. Connect Google Calendar in Settings first.")
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        _save_credentials(creds)
    if not creds.valid:
        raise RuntimeError("Token is invalid and cannot be refreshed. Reconnect in Settings.")
    return build("calendar", "v3", credentials=creds)


# ---------------------------------------------------------------------------
#  OAuth 2.0 flow
# ---------------------------------------------------------------------------

def get_auth_url(redirect_uri: str) -> str:
    """
    Generate an OAuth authorisation URL and persist the OAuth state.

    Saves the state and redirect_uri to `data/google_auth_pending.json` so that
    `exchange_code()` can reconstruct the flow after the browser redirect.

    Returns the URL the user must visit to authorise the app.
    """
    if not has_client_secrets():
        raise FileNotFoundError(
            f"Client secrets missing: {SECRETS_FILE}. "
            "Download from Google Cloud Console (see Settings for instructions)."
        )
    flow = Flow.from_client_secrets_file(
        SECRETS_FILE, scopes=SCOPES, redirect_uri=redirect_uri
    )
    auth_url, state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(PENDING_FILE, "w") as fh:
        json.dump({"state": state, "redirect_uri": redirect_uri}, fh)
    return auth_url


def has_pending_auth() -> bool:
    """Return True if an OAuth flow was started and is awaiting a callback."""
    return os.path.isfile(PENDING_FILE)


def exchange_code(code: str) -> None:
    """
    Exchange an authorisation code for credentials and persist them.

    Reads the saved state and redirect_uri from `data/google_auth_pending.json`,
    performs the token exchange, and writes the resulting token to
    `data/google_token.json`.

    Raises FileNotFoundError if no pending auth exists.
    Raises ValueError on exchange failure.
    """
    if not os.path.isfile(PENDING_FILE):
        raise FileNotFoundError("No pending OAuth flow found. Please start over.")
    with open(PENDING_FILE) as fh:
        pending = json.load(fh)
    state        = pending["state"]
    redirect_uri = pending["redirect_uri"]
    os.remove(PENDING_FILE)
    try:
        flow = Flow.from_client_secrets_file(
            SECRETS_FILE, scopes=SCOPES, redirect_uri=redirect_uri, state=state
        )
        flow.fetch_token(code=code)
        _save_credentials(flow.credentials)
    except Exception as exc:
        raise ValueError(f"Token exchange failed: {exc}") from exc


def revoke_token() -> None:
    """Delete the token file and any pending auth state."""
    if os.path.isfile(TOKEN_FILE):
        os.remove(TOKEN_FILE)
    if os.path.isfile(PENDING_FILE):
        os.remove(PENDING_FILE)


# ---------------------------------------------------------------------------
#  Google Calendar API wrappers
# ---------------------------------------------------------------------------

def list_calendars() -> List[Dict[str, Any]]:
    """
    Return the user's full calendar list, including URL-subscribed calendars.

    showHidden=True is required to include calendars added via "Subscribe from URL"
    (iCal feeds) — the Google Calendar API marks these as hidden entries and
    excludes them from the default response.

    Also paginates through all result pages (maxResults=250 per page).

    Each item dict has: id, summary, primary, timeZone, accessRole.
    """
    svc        = _get_service()
    items      = []
    page_token = None
    while True:
        result = svc.calendarList().list(
            maxResults=250,
            showHidden=True,
            pageToken=page_token,
        ).execute()
        items.extend(result.get("items", []))
        page_token = result.get("nextPageToken")
        if not page_token:
            break
    return [
        {
            "id":         item.get("id", ""),
            "summary":    item.get("summary", "(no name)"),
            "primary":    item.get("primary", False),
            "timeZone":   item.get("timeZone", ""),
            "accessRole": item.get("accessRole", ""),
        }
        for item in items
    ]


def fetch_events(
    calendar_id: str,
    start: datetime,
    end: datetime,
) -> List[Dict[str, Any]]:
    """
    Fetch all events from a Google Calendar between start and end.

    Paginates through all result pages. Returns raw Google event dicts.
    """
    svc      = _get_service()
    time_min = _to_rfc3339(start)
    time_max = _to_rfc3339(end)

    events     = []
    page_token = None
    while True:
        resp = svc.events().list(
            calendarId=calendar_id,
            timeMin=time_min,
            timeMax=time_max,
            singleEvents=True,
            orderBy="startTime",
            pageToken=page_token,
            maxResults=250,
        ).execute()
        events.extend(resp.get("items", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return events


def _to_rfc3339(dt: datetime) -> str:
    """Convert a naive (assumed UTC) or timezone-aware datetime to RFC3339 UTC."""
    if dt.tzinfo is None:
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_google_dt(dt_dict: Dict[str, Any]) -> Optional[datetime]:
    """
    Parse a Google Calendar start/end dict into a naive UTC datetime.

    Handles both dateTime (with timezone) and date (all-day) formats.
    Python 3.9's fromisoformat does not handle the 'Z' suffix — we normalise it.
    """
    if not dt_dict:
        return None

    dt_str = dt_dict.get("dateTime")
    if dt_str:
        try:
            if dt_str.endswith("Z"):
                dt_str = dt_str[:-1] + "+00:00"
            dt = datetime.fromisoformat(dt_str)
            if dt.tzinfo is not None:
                dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
            return dt
        except (ValueError, TypeError):
            return None

    date_str = dt_dict.get("date")
    if date_str:
        try:
            d = date_.fromisoformat(date_str)
            return datetime(d.year, d.month, d.day, 0, 0, 0)
        except (ValueError, TypeError):
            return None

    return None


# ---------------------------------------------------------------------------
#  Sync
# ---------------------------------------------------------------------------

def sync_calendar(calendar_id: str) -> Dict[str, Any]:
    """
    Sync a Google Calendar into the local ``calendar_events`` table.

    Sync window: SYNC_DAYS_BACK days ago → SYNC_DAYS_FORWARD days forward.
    Deduplication key: ``google_event_id``.

    Behaviour:
    - New google_event_id  → ``crud.create_event()`` with source='google',
      is_read_only=True, event_type='google_import'.
    - Existing google_event_id → ``crud.update_google_event()`` to refresh
      title / times and clear sync_stale.
    - DB events absent from the latest fetch → ``sync_stale=True``.

    Returns:
        {calendar_id, total_fetched, created, updated, stale_marked}
    """
    now        = datetime.utcnow()
    sync_start = now - timedelta(days=SYNC_DAYS_BACK)
    sync_end   = now + timedelta(days=SYNC_DAYS_FORWARD)

    google_events = fetch_events(calendar_id, sync_start, sync_end)
    fetched_ids   = {e["id"] for e in google_events if "id" in e}

    # Existing Google events for this calendar already in the DB
    all_google = crud.get_events(source="google", include_stale=True)
    existing_by_gid = {
        ev.google_event_id: ev
        for ev in all_google
        if ev.google_calendar_id == calendar_id and ev.google_event_id
    }

    created      = 0
    updated      = 0
    stale_marked = 0

    for g_evt in google_events:
        g_id = g_evt.get("id")
        if not g_id:
            continue

        title       = g_evt.get("summary") or "(no title)"
        description = g_evt.get("description")
        location    = g_evt.get("location")
        start_dt    = _parse_google_dt(g_evt.get("start", {}))
        end_dt      = _parse_google_dt(g_evt.get("end", {}))

        if start_dt is None or end_dt is None:
            continue  # Skip events with unparseable times

        if g_id in existing_by_gid:
            db_evt = existing_by_gid[g_id]
            crud.update_google_event(
                event_id=db_evt.id,
                title=title,
                description=description,
                location=location,
                start_datetime=start_dt,
                end_datetime=end_dt,
                sync_stale=False,
            )
            updated += 1
        else:
            crud.create_event(
                title=title,
                start_datetime=start_dt,
                end_datetime=end_dt,
                description=description,
                event_type="google_import",
                location=location,
                source="google",
                google_event_id=g_id,
                google_calendar_id=calendar_id,
                is_read_only=True,
                sync_stale=False,
            )
            created += 1

    # Mark events present in DB but absent from the latest fetch as stale
    for g_id, db_evt in existing_by_gid.items():
        if g_id not in fetched_ids and not db_evt.sync_stale:
            crud.update_google_event(event_id=db_evt.id, sync_stale=True)
            stale_marked += 1

    _record_sync(calendar_id)

    return {
        "calendar_id":   calendar_id,
        "total_fetched": len(google_events),
        "created":       created,
        "updated":       updated,
        "stale_marked":  stale_marked,
    }


# ---------------------------------------------------------------------------
#  Sync metadata
# ---------------------------------------------------------------------------

def _load_sync_info() -> Dict[str, str]:
    if not os.path.isfile(SYNC_FILE):
        return {}
    try:
        with open(SYNC_FILE) as fh:
            return json.load(fh)
    except Exception:
        return {}


def _record_sync(calendar_id: str) -> None:
    info = _load_sync_info()
    info[calendar_id] = datetime.utcnow().isoformat()
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(SYNC_FILE, "w") as fh:
        json.dump(info, fh, indent=2)


def get_last_sync(calendar_id: str) -> Optional[str]:
    """Return the ISO-8601 UTC timestamp of the last sync for this calendar, or None."""
    return _load_sync_info().get(calendar_id)


def get_all_synced_calendars() -> Dict[str, str]:
    """Return {calendar_id: last_sync_timestamp} for all previously synced calendars."""
    return _load_sync_info()
