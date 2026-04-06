"""
backend/routers/habits.py — Habit CRUD and completion endpoints.
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

class HabitOut(BaseModel):
    id:             int
    title:          str
    description:    Optional[str]
    frequency:      str
    target_days:    Optional[str]
    time_of_day:    str
    streak_current: int
    streak_best:    int
    is_active:      bool
    created_at:     datetime
    today_done:     bool = False  # populated by the endpoint

    class Config:
        from_attributes = True


class HabitCompletionOut(BaseModel):
    id:             int
    habit_id:       int
    completed_date: date
    completed_at:   datetime
    note:           Optional[str]

    class Config:
        from_attributes = True


class CreateHabitRequest(BaseModel):
    title:       str
    description: Optional[str] = None
    frequency:   str            = "daily"
    target_days: Optional[str]  = None
    time_of_day: str            = "anytime"


class UpdateHabitRequest(BaseModel):
    title:       Optional[str] = None
    description: Optional[str] = None
    frequency:   Optional[str] = None
    target_days: Optional[str] = None
    time_of_day: Optional[str] = None
    is_active:   Optional[bool] = None


class CompleteHabitRequest(BaseModel):
    completed_date: date          = None  # defaults to today
    note:           Optional[str] = None

    def resolve_date(self) -> date:
        return self.completed_date or date.today()


# ---------------------------------------------------------------------------
#  Endpoints
# ---------------------------------------------------------------------------

@router.get("", response_model=List[HabitOut])
def list_habits(
    include_inactive: bool           = Query(False),
    time_of_day:      Optional[str]  = Query(None),
):
    habits = crud.get_habits(include_inactive=include_inactive, time_of_day=time_of_day)
    # Bulk-fetch completions for today — single query, no N+1
    habit_ids   = [h.id for h in habits]
    done_today  = set(crud.get_habit_completions_bulk(habit_ids, date.today()))

    out = []
    for h in habits:
        d = HabitOut.model_validate(h)
        d.today_done = h.id in done_today
        out.append(d)
    return out


@router.post("", response_model=HabitOut, status_code=201)
def create_habit(body: CreateHabitRequest):
    h = crud.create_habit(
        title=body.title,
        description=body.description,
        frequency=body.frequency,
        target_days=body.target_days,
        time_of_day=body.time_of_day,
    )
    d = HabitOut.model_validate(h)
    d.today_done = False
    return d


@router.put("/{habit_id}", response_model=HabitOut)
def update_habit(habit_id: int, body: UpdateHabitRequest):
    fields = body.model_dump(exclude_none=True)
    try:
        h = crud.update_habit(habit_id, **fields)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    done_today = set(crud.get_habit_completions_bulk([habit_id], date.today()))
    d = HabitOut.model_validate(h)
    d.today_done = habit_id in done_today
    return d


@router.delete("/{habit_id}")
def archive_habit(habit_id: int):
    try:
        crud.archive_habit(habit_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {"ok": True}


@router.post("/{habit_id}/complete", response_model=HabitCompletionOut)
def mark_complete(habit_id: int, body: CompleteHabitRequest):
    try:
        return crud.mark_habit_complete(
            habit_id=habit_id,
            completed_date=body.resolve_date(),
            note=body.note,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/{habit_id}/complete")
def unmark_complete(habit_id: int, completed_date: Optional[date] = Query(None)):
    d = completed_date or date.today()
    removed = crud.unmark_habit_complete(habit_id, d)
    return {"ok": removed}


@router.get("/{habit_id}/completions", response_model=List[HabitCompletionOut])
def get_completions(
    habit_id:  int,
    from_date: Optional[date] = Query(None),
    to_date:   Optional[date] = Query(None),
):
    return crud.get_habit_completions(habit_id, from_date=from_date, to_date=to_date)
