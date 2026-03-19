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

load_dotenv()

from db.schema import db_init
from routers import tasks, goals, habits, calendar, ai, analytics, preferences


@asynccontextmanager
async def lifespan(app: FastAPI):
    db_init(db_path=os.environ.get("DB_PATH", "./data/planner.db"))
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
app.include_router(goals.router,       prefix="/api/goals",      tags=["goals"])
app.include_router(habits.router,      prefix="/api/habits",     tags=["habits"])
app.include_router(calendar.router,    prefix="/api/calendar",   tags=["calendar"])
app.include_router(ai.router,          prefix="/api/ai",         tags=["ai"])
app.include_router(analytics.router,   prefix="/api/analytics",  tags=["analytics"])
app.include_router(preferences.router, prefix="/api/preferences",tags=["preferences"])


@app.get("/api/health")
def health():
    return {"status": "ok"}
