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
