"""
backend/routers/analytics.py — Analytics and statistics endpoints.

# TODO: Sprint 4 — expand with aggregated task/habit/goal stats + LLM insights.
"""

from __future__ import annotations

from fastapi import APIRouter

import db.crud as crud

router = APIRouter()


@router.get("/stats")
def get_stats():
    """Return database row counts for all tables."""
    return crud.get_db_stats()
