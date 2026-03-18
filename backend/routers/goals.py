"""
backend/routers/goals.py — Goal CRUD endpoints.
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

class GoalOut(BaseModel):
    id:            int
    title:         str
    description:   Optional[str]
    status:        str
    target_date:   Optional[date]
    progress_pct:  int
    progress_mode: str
    parent_id:     Optional[int]
    created_at:    datetime
    updated_at:    datetime
    deleted_at:    Optional[datetime]

    class Config:
        from_attributes = True


class CreateGoalRequest(BaseModel):
    title:         str
    description:   Optional[str] = None
    status:        str            = "active"
    target_date:   Optional[date] = None
    progress_pct:  int            = 0
    progress_mode: str            = "manual"
    parent_id:     Optional[int]  = None


class UpdateGoalRequest(BaseModel):
    title:              Optional[str]      = None
    description:        Optional[str]      = None
    status:             Optional[str]      = None
    target_date:        Optional[date]     = None
    progress_pct:       Optional[int]      = None
    progress_mode:      Optional[str]      = None
    parent_id:          Optional[int]      = None
    current_updated_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
#  Endpoints
# ---------------------------------------------------------------------------

@router.get("", response_model=List[GoalOut])
def list_goals(
    status:         Optional[str]  = Query(None),
    parent_id:      Optional[int]  = Query(None),
    top_level_only: bool           = Query(False),
):
    return crud.get_goals(
        status=status,
        parent_id=parent_id,
        top_level_only=top_level_only,
    )


@router.post("", response_model=GoalOut, status_code=201)
def create_goal(body: CreateGoalRequest):
    return crud.create_goal(
        title=body.title,
        description=body.description,
        status=body.status,
        target_date=body.target_date,
        progress_pct=body.progress_pct,
        progress_mode=body.progress_mode,
        parent_id=body.parent_id,
    )


@router.put("/{goal_id}", response_model=GoalOut)
def update_goal(goal_id: int, body: UpdateGoalRequest):
    fields = body.model_dump(exclude_none=True, exclude={"current_updated_at"})
    try:
        return crud.update_goal(
            goal_id=goal_id,
            current_updated_at=body.current_updated_at,
            **fields,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.delete("/{goal_id}")
def delete_goal(goal_id: int):
    try:
        crud.delete_goal(goal_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {"ok": True}
