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
