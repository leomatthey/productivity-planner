"""
backend/routers/preferences.py — User preferences endpoints.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import db.crud as crud

router = APIRouter()


# ---------------------------------------------------------------------------
#  Pydantic models
# ---------------------------------------------------------------------------

class PreferenceOut(BaseModel):
    key:        str
    value:      str
    updated_at: datetime

    class Config:
        from_attributes = True


class SetPreferenceRequest(BaseModel):
    value: str


# ---------------------------------------------------------------------------
#  Endpoints
# ---------------------------------------------------------------------------

@router.get("")
def get_all_preferences():
    """Return all user preferences as {key: value}."""
    return crud.get_preferences()


@router.get("/{key}")
def get_preference(key: str):
    value = crud.get_preference(key)
    if value is None:
        raise HTTPException(status_code=404, detail=f"Preference {key!r} not set.")
    return {"key": key, "value": value}


@router.put("/{key}", response_model=PreferenceOut)
def set_preference(key: str, body: SetPreferenceRequest):
    return crud.set_preference(key, body.value)
