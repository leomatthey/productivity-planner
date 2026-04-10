"""
backend/routers/calendar.py — Calendar events + Google Calendar integration.
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

import db.crud as crud

router = APIRouter()


# ---------------------------------------------------------------------------
#  Pydantic models
# ---------------------------------------------------------------------------

class EventOut(BaseModel):
    id:                 int
    title:              str
    description:        Optional[str]
    event_type:         str
    start_datetime:     datetime
    end_datetime:       datetime
    location:           Optional[str]
    task_id:            Optional[int]
    is_recurring:       bool
    recurrence_rule:    Optional[str]
    source:             str
    google_event_id:    Optional[str]
    google_calendar_id: Optional[str]
    is_read_only:       bool
    sync_stale:         bool
    created_at:         datetime
    deleted_at:         Optional[datetime]

    class Config:
        from_attributes = True


class CreateEventRequest(BaseModel):
    title:           str
    start_datetime:  datetime
    end_datetime:    datetime
    description:     Optional[str] = None
    event_type:      str            = "personal"
    location:        Optional[str]  = None
    task_id:         Optional[int]  = None


class UpdateEventRequest(BaseModel):
    title:          Optional[str]      = None
    description:    Optional[str]      = None
    event_type:     Optional[str]      = None
    location:       Optional[str]      = None
    start_datetime: Optional[datetime] = None
    end_datetime:   Optional[datetime] = None
    task_id:        Optional[int]      = None


class ExchangeCodeRequest(BaseModel):
    code: str


# ---------------------------------------------------------------------------
#  Event endpoints
# ---------------------------------------------------------------------------

@router.get("/events", response_model=List[EventOut])
def list_events(
    start:         Optional[datetime] = Query(None),
    end:           Optional[datetime] = Query(None),
    source:        Optional[str]      = Query(None),
    include_stale: bool               = Query(False),
):
    return crud.get_events(start=start, end=end, source=source, include_stale=include_stale)


@router.post("/events", response_model=EventOut, status_code=201)
def create_event(body: CreateEventRequest):
    # For task_block events, use POST /api/tasks/{id}/schedule instead —
    # it atomically creates the event AND updates the task status.
    return crud.create_event(
        title=body.title,
        start_datetime=body.start_datetime,
        end_datetime=body.end_datetime,
        description=body.description,
        event_type=body.event_type,
        location=body.location,
        task_id=body.task_id,
    )


@router.put("/events/{event_id}", response_model=EventOut)
def update_event(event_id: int, body: UpdateEventRequest):
    fields = body.model_dump(exclude_none=True)
    try:
        return crud.update_event(event_id, **fields)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


class MoveEventRequest(BaseModel):
    start_datetime: datetime
    end_datetime: datetime


@router.put("/events/{event_id}/move", response_model=EventOut)
def move_event(event_id: int, body: MoveEventRequest):
    """Atomically move/resize an event. Also updates linked task's scheduled_at."""
    try:
        return crud.move_event(event_id, body.start_datetime, body.end_datetime)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.delete("/events/{event_id}")
def delete_event(event_id: int):
    try:
        crud.delete_event(event_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {"ok": True}


# ---------------------------------------------------------------------------
#  Google Calendar endpoints
# ---------------------------------------------------------------------------

@router.get("/status")
def google_status():
    try:
        from integrations.google_calendar import is_authenticated, has_client_secrets
        return {
            "authenticated":    is_authenticated(),
            "has_secrets_file": has_client_secrets(),
        }
    except ImportError:
        return {"authenticated": False, "has_secrets_file": False, "error": "google libraries not installed"}


@router.get("/auth-url")
def google_auth_url(redirect_uri: str = Query(...)):
    try:
        from integrations.google_calendar import get_auth_url
        url = get_auth_url(redirect_uri)
        return {"url": url}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/exchange-code")
def google_exchange_code(body: ExchangeCodeRequest):
    try:
        from integrations.google_calendar import exchange_code
        exchange_code(body.code)
        return {"ok": True}
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/disconnect")
def google_disconnect():
    try:
        from integrations.google_calendar import revoke_token
        revoke_token()
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/list")
def google_list_calendars():
    try:
        from integrations.google_calendar import list_calendars
        return list_calendars()
    except RuntimeError as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/sync-all")
def google_sync_all():
    """Sync every calendar in the user's Google Calendar account."""
    try:
        from integrations.google_calendar import list_calendars, sync_calendar
        calendars = list_calendars()
        total_fetched = 0
        created = 0
        updated = 0
        stale_marked = 0
        for cal in calendars:
            result = sync_calendar(cal["id"])
            total_fetched += result["total_fetched"]
            created       += result["created"]
            updated       += result["updated"]
            stale_marked  += result["stale_marked"]
        return {
            "calendars_synced": len(calendars),
            "total_fetched":    total_fetched,
            "created":          created,
            "updated":          updated,
            "stale_marked":     stale_marked,
        }
    except RuntimeError as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/sync/{calendar_id:path}")
def google_sync(calendar_id: str):
    try:
        from integrations.google_calendar import sync_calendar
        result = sync_calendar(calendar_id)
        return result
    except RuntimeError as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
