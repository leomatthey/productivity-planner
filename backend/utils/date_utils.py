"""
Date and time helpers used across pages and agent tools.
Populated incrementally as each phase requires new utilities.
"""

from datetime import date, datetime, timedelta
from typing import List, Optional

import arrow


def today() -> date:
    return date.today()


def now() -> datetime:
    return datetime.utcnow()


def start_of_week(d: Optional[date] = None, start_monday: bool = True) -> date:
    """Return the Monday (or Sunday) that begins the week containing *d*."""
    d = d or date.today()
    offset = d.weekday() if start_monday else (d.weekday() + 1) % 7
    return d - timedelta(days=offset)


def end_of_week(d: Optional[date] = None, start_monday: bool = True) -> date:
    return start_of_week(d, start_monday) + timedelta(days=6)


def week_days(d: Optional[date] = None, start_monday: bool = True) -> List[date]:
    """Return a list of 7 dates for the week containing *d*."""
    start = start_of_week(d, start_monday)
    return [start + timedelta(days=i) for i in range(7)]


def friendly_date(d: date) -> str:
    """Return a human-readable label: 'Today', 'Tomorrow', 'Mon 3 Feb', etc."""
    today_ = date.today()
    if d == today_:
        return "Today"
    if d == today_ + timedelta(days=1):
        return "Tomorrow"
    if d == today_ - timedelta(days=1):
        return "Yesterday"
    return arrow.get(d).format("ddd D MMM")


def is_overdue(d: Optional[date]) -> bool:
    return d is not None and d < date.today()


def parse_nl_date(text: str) -> Optional[date]:
    """
    Parse a natural-language date string into a date object.

    Handles:
      - "today", "tomorrow", "yesterday"
      - "next week"  → next Monday
      - "in X days"  → today + X days
      - "in X weeks" → today + X weeks
      - ISO date strings: "YYYY-MM-DD"

    Returns None if the text cannot be parsed.
    """
    import re as _re

    text = text.strip().lower()
    today_ = date.today()

    if text in ("today", "now"):
        return today_
    if text == "tomorrow":
        return today_ + timedelta(days=1)
    if text == "yesterday":
        return today_ - timedelta(days=1)
    if text == "next week":
        # Next Monday
        days_until_monday = (7 - today_.weekday()) % 7
        if days_until_monday == 0:
            days_until_monday = 7
        return today_ + timedelta(days=days_until_monday)

    # "in X days"
    m = _re.fullmatch(r"in (\d+) days?", text)
    if m:
        return today_ + timedelta(days=int(m.group(1)))

    # "in X weeks"
    m = _re.fullmatch(r"in (\d+) weeks?", text)
    if m:
        return today_ + timedelta(weeks=int(m.group(1)))

    # ISO date YYYY-MM-DD
    try:
        return date.fromisoformat(text)
    except (ValueError, TypeError):
        pass

    # Arrow fallback for common named formats
    try:
        return arrow.get(text, ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"]).date()
    except Exception:
        pass

    return None
