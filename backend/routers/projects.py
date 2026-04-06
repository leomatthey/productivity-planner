"""
backend/routers/projects.py — Project CRUD endpoints (renamed from goals).

The underlying SQLite table is still named 'goals'.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

import db.crud as crud

router = APIRouter()


# ---------------------------------------------------------------------------
#  Pydantic models
# ---------------------------------------------------------------------------

class ProjectOut(BaseModel):
    id:            int
    title:         str
    description:   Optional[str]
    status:        str
    target_date:   Optional[date]
    progress_pct:  int
    progress_mode: str
    parent_id:     Optional[int]
    color:         Optional[str]
    created_at:    datetime
    updated_at:    datetime
    deleted_at:    Optional[datetime]

    class Config:
        from_attributes = True


class CreateProjectRequest(BaseModel):
    title:         str
    description:   Optional[str] = None
    status:        str            = "active"
    target_date:   Optional[date] = None
    progress_pct:  int            = 0
    progress_mode: str            = "manual"
    parent_id:     Optional[int]  = None
    color:         Optional[str]  = None


class UpdateProjectRequest(BaseModel):
    title:              Optional[str]      = None
    description:        Optional[str]      = None
    status:             Optional[str]      = None
    target_date:        Optional[date]     = None
    progress_pct:       Optional[int]      = None
    progress_mode:      Optional[str]      = None
    parent_id:          Optional[int]      = None
    color:              Optional[str]      = None
    current_updated_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
#  Endpoints
# ---------------------------------------------------------------------------

@router.get("", response_model=List[ProjectOut])
def list_projects(
    status:         Optional[str]  = Query(None),
    parent_id:      Optional[int]  = Query(None),
    top_level_only: bool           = Query(False),
):
    return crud.get_goals(
        status=status,
        parent_id=parent_id,
        top_level_only=top_level_only,
    )


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(body: CreateProjectRequest):
    return crud.create_goal(
        title=body.title,
        description=body.description,
        status=body.status,
        target_date=body.target_date,
        progress_pct=body.progress_pct,
        progress_mode=body.progress_mode,
        parent_id=body.parent_id,
        color=body.color,
    )


@router.put("/{project_id}", response_model=ProjectOut)
def update_project(project_id: int, body: UpdateProjectRequest):
    fields = body.model_dump(exclude_none=True, exclude={"current_updated_at"})
    try:
        return crud.update_goal(
            goal_id=project_id,
            current_updated_at=body.current_updated_at,
            **fields,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.delete("/{project_id}")
def delete_project(project_id: int):
    try:
        crud.delete_goal(project_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {"ok": True}
