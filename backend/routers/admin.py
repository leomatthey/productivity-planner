"""
backend/routers/admin.py — Admin-level endpoints.

Currently exposes a single endpoint: POST /admin/seed?reset=true — wipes all
local data (keeps Google-synced events and user preferences) and repopulates
the DB with demo-grade sample data via `utils.seed.seed_demo_data`.
"""

from __future__ import annotations

from fastapi import APIRouter

from utils.seed import seed_demo_data

router = APIRouter()


@router.post("/seed")
def run_seed(reset: bool = True) -> dict:
    """Reset-and-seed the database with demo data.

    Query params:
        reset: when True (default), wipes local tasks/projects/habits/events
               first. Google-synced events and user preferences are never
               touched. When False, the seed is a no-op if data already exists.

    Returns a dict of counts of inserted rows.
    """
    return seed_demo_data(reset=reset)
