"""
backend/main.py — FastAPI application entry point.

Run with:
    cd backend
    uvicorn main:app --reload --port 8000
"""

import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

load_dotenv()

from db.schema import db_init
from routers import tasks, goals, habits, calendar, ai, analytics, preferences
from utils.seed import seed_database


@asynccontextmanager
async def lifespan(app: FastAPI):
    engine, _ = db_init(db_path=os.environ.get("DB_PATH", "./data/planner.db"))
    # Idempotent migration: add color column to goals table if missing
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(goals)"))]
        if "color" not in cols:
            conn.execute(text("ALTER TABLE goals ADD COLUMN color TEXT"))
            conn.commit()
    # Seed demo data on first run (no-op if data already exists)
    seed_database()
    # Warn if AI features will be unavailable
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("\n⚠️  WARNING: ANTHROPIC_API_KEY is not set.")
        print("   AI Assistant and Analytics Insights will not work.")
        print("   Copy backend/.env.example to backend/.env and add your key.\n")
    yield


app = FastAPI(
    title="Productivity Planner API",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tasks.router,       prefix="/api/tasks",      tags=["tasks"])
app.include_router(goals.router,       prefix="/api/projects",   tags=["projects"])
app.include_router(habits.router,      prefix="/api/habits",     tags=["habits"])
app.include_router(calendar.router,    prefix="/api/calendar",   tags=["calendar"])
app.include_router(ai.router,          prefix="/api/ai",         tags=["ai"])
app.include_router(analytics.router,   prefix="/api/analytics",  tags=["analytics"])
app.include_router(preferences.router, prefix="/api/preferences",tags=["preferences"])


@app.get("/api/health")
def health():
    return {"status": "ok"}
