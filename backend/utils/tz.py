"""
utils/tz.py — Timezone boundary helpers for the AI agent.

The DB stores all datetimes as naive UTC. The agent (and the model it talks to)
should reason in the user's local timezone to avoid the 2-hour-offset class of
bugs. This module is the single conversion point used by `agent/tools.py` and
`agent/agent.py`.

The user's timezone is read from the `TZ` environment variable (set in
docker-compose.yml). Falls back to UTC if unset.
"""

from __future__ import annotations

import os
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo


def user_tz() -> ZoneInfo:
    """Return the user's timezone, derived from the TZ env var (UTC fallback)."""
    return ZoneInfo(os.environ.get("TZ", "UTC"))


def utc_now_naive() -> datetime:
    """Current time as a naive UTC datetime — matches DB storage convention."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def to_local_date(naive_utc: datetime) -> date:
    """Naive-UTC datetime → calendar date in the user's local timezone."""
    return (
        naive_utc.replace(tzinfo=timezone.utc)
        .astimezone(user_tz())
        .date()
    )


def to_user_iso(naive_utc: datetime) -> str:
    """Naive-UTC datetime → ISO-8601 string with the user's local offset."""
    return (
        naive_utc.replace(tzinfo=timezone.utc)
        .astimezone(user_tz())
        .isoformat()
    )


def from_user_iso(s: str) -> datetime:
    """
    ISO-8601 string → naive-UTC datetime suitable for DB writes.

    Inputs with an explicit offset are converted to UTC. Naive inputs (no
    offset) are interpreted as user-local time — matching what the model is
    instructed to emit by the agent's system prompt.
    """
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=user_tz())
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def from_user_naive(local_naive: datetime) -> datetime:
    """
    Naive datetime interpreted as user-local → naive-UTC for DB writes/queries.

    Use this when the agent constructs a datetime from local-intent components
    (e.g. apply_schedule combining a date + HH:MM string from the model, or
    today-overview building local-day boundaries for an event-fetch query).
    """
    return (
        local_naive.replace(tzinfo=user_tz())
        .astimezone(timezone.utc)
        .replace(tzinfo=None)
    )
