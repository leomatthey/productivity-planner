"""
backend/routers/tasks.py — Task CRUD endpoints.

All DB access goes through db.crud — no direct ORM here.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

import db.crud as crud
from utils.date_utils import parse_nl_date
from utils.scheduling import find_slots_for_task, schedule_batch_auto

router = APIRouter()


# ---------------------------------------------------------------------------
#  Pydantic models
# ---------------------------------------------------------------------------

class TaskOut(BaseModel):
    id:                 int
    title:              str
    description:        Optional[str]
    status:             str
    priority:           str
    due_date:           Optional[date]
    project_id:         Optional[int]
    scheduled_at:       Optional[datetime]
    estimated_minutes:  Optional[int]
    energy_level:       Optional[str]
    tags:               Optional[str]
    created_at:         datetime
    updated_at:         datetime
    deleted_at:         Optional[datetime]

    class Config:
        from_attributes = True


class CreateTaskRequest(BaseModel):
    title:              str
    description:        Optional[str] = None
    status:             str           = "todo"
    priority:           str           = "medium"
    due_date:           Optional[date] = None
    project_id:         Optional[int]  = None
    estimated_minutes:  Optional[int]  = None
    energy_level:       Optional[str]  = None
    tags:               Optional[str]  = None


class UpdateTaskRequest(BaseModel):
    title:              Optional[str]      = None
    description:        Optional[str]      = None
    status:             Optional[str]      = None
    priority:           Optional[str]      = None
    due_date:           Optional[date]     = None
    project_id:         Optional[int]      = None
    scheduled_at:       Optional[datetime] = None
    estimated_minutes:  Optional[int]      = None
    energy_level:       Optional[str]      = None
    tags:               Optional[str]      = None
    current_updated_at: Optional[datetime] = None


class ParseDateRequest(BaseModel):
    text: str


# ---------------------------------------------------------------------------
#  Endpoints
# ---------------------------------------------------------------------------

@router.get("", response_model=List[TaskOut])
def list_tasks(
    project_id:    Optional[int] = Query(None),
    status:        Optional[str] = Query(None),
    priority:      Optional[str] = Query(None),
    due_date_from: Optional[date] = Query(None),
    due_date_to:   Optional[date] = Query(None),
    tag:           Optional[str] = Query(None),
):
    return crud.get_tasks(
        project_id=project_id,
        status=status,
        priority=priority,
        due_date_from=due_date_from,
        due_date_to=due_date_to,
        tag=tag,
    )


@router.post("", response_model=TaskOut, status_code=201)
def create_task(body: CreateTaskRequest):
    return crud.create_task(
        title=body.title,
        description=body.description,
        status=body.status,
        priority=body.priority,
        due_date=body.due_date,
        project_id=body.project_id,
        estimated_minutes=body.estimated_minutes,
        energy_level=body.energy_level,
        tags=body.tags,
    )


@router.put("/{task_id}", response_model=TaskOut)
def update_task(task_id: int, body: UpdateTaskRequest):
    fields = body.model_dump(exclude_none=True, exclude={"current_updated_at"})
    try:
        return crud.update_task(
            task_id=task_id,
            current_updated_at=body.current_updated_at,
            **fields,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.delete("/{task_id}")
def delete_task(task_id: int):
    try:
        crud.delete_task(task_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {"ok": True}


@router.post("/parse-date")
def parse_date(body: ParseDateRequest):
    """Parse a natural-language date string into ISO format."""
    result = parse_nl_date(body.text)
    if result is None:
        raise HTTPException(status_code=422, detail=f"Cannot parse date: {body.text!r}")
    return {"date": result.isoformat()}


# ---------------------------------------------------------------------------
#  Scheduling endpoints — atomic operations
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


class ScheduleTaskRequest(BaseModel):
    start_datetime: datetime
    end_datetime: datetime


class FindSlotsRequest(BaseModel):
    task_id: int
    count: int = 3
    start_date: Optional[date] = None


class ScheduleBatchItem(BaseModel):
    task_id: int
    start_datetime: datetime
    end_datetime: datetime


class ScheduleBatchRequest(BaseModel):
    items: Optional[List[ScheduleBatchItem]] = None
    task_ids: Optional[List[int]] = None
    start_date: Optional[date] = None


class ScheduleResult(BaseModel):
    task: TaskOut
    event: EventOut


@router.post("/find-slots")
def find_slots(body: FindSlotsRequest):
    """Find free time slots for a task. Returns proposals only, no DB writes."""
    try:
        slots = find_slots_for_task(
            task_id=body.task_id,
            count=body.count,
            start_date=body.start_date,
        )
        return {
            "slots": [
                {
                    "start": s["start"].isoformat(),
                    "end": s["end"].isoformat(),
                    "date": s["date"],
                }
                for s in slots
            ]
        }
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


class FindSlotsBatchRequest(BaseModel):
    task_ids: List[int]
    start_date: Optional[date] = None


@router.post("/find-slots-batch")
def find_slots_batch(body: FindSlotsBatchRequest):
    """Find scheduling proposals for multiple tasks. Returns proposals only, no DB writes."""
    proposals = schedule_batch_auto(task_ids=body.task_ids, start_date=body.start_date)
    scheduled_ids = {p["task_id"] for p in proposals}
    return {
        "proposals": [
            {
                "task_id": p["task_id"],
                "title": p["title"],
                "start": p["start"].isoformat(),
                "end": p["end"].isoformat(),
            }
            for p in proposals
        ],
        "unscheduled": [
            {"task_id": tid, "error": "No slot found"}
            for tid in body.task_ids
            if tid not in scheduled_ids
        ],
    }


@router.post("/{task_id}/schedule", response_model=ScheduleResult)
def schedule_task(task_id: int, body: ScheduleTaskRequest):
    """Atomically schedule a task: update status + create calendar event."""
    try:
        task, event = crud.schedule_task(
            task_id=task_id,
            start_datetime=body.start_datetime,
            end_datetime=body.end_datetime,
        )
        return {"task": task, "event": event}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/schedule-batch")
def schedule_batch(body: ScheduleBatchRequest):
    """Schedule multiple tasks atomically."""
    try:
        if body.items:
            # Explicit mode: use provided start/end times
            batch_items = [
                (item.task_id, item.start_datetime, item.end_datetime)
                for item in body.items
            ]
            results = crud.schedule_task_batch(batch_items)
            return {
                "scheduled": [
                    {"task": TaskOut.model_validate(t), "event": EventOut.model_validate(e)}
                    for t, e in results
                ],
                "failed": [],
            }
        elif body.task_ids:
            # Auto mode: find slots automatically, then schedule
            proposals = schedule_batch_auto(
                task_ids=body.task_ids,
                start_date=body.start_date,
            )
            if not proposals:
                return {"scheduled": [], "failed": [{"task_id": tid, "error": "No slot found"} for tid in body.task_ids]}

            batch_items = [
                (p["task_id"], p["start"], p["end"])
                for p in proposals
            ]
            results = crud.schedule_task_batch(batch_items)

            scheduled_ids = {t.id for t, _ in results}
            failed = [
                {"task_id": tid, "error": "No slot found"}
                for tid in body.task_ids if tid not in scheduled_ids
            ]
            return {
                "scheduled": [
                    {"task": TaskOut.model_validate(t), "event": EventOut.model_validate(e)}
                    for t, e in results
                ],
                "failed": failed,
            }
        else:
            raise HTTPException(status_code=422, detail="Provide either 'items' or 'task_ids'")
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.post("/{task_id}/unschedule")
def unschedule_task(task_id: int):
    """Atomically unschedule a task: delete events + reset status."""
    try:
        task, deleted_ids = crud.unschedule_task(task_id)
        return {
            "task": TaskOut.model_validate(task),
            "deleted_event_ids": deleted_ids,
        }
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
