"""
utils/seed.py — Seed data for demo and testing purposes.

Call seed_database() from pages/settings.py to populate the DB with
realistic sample data. When force=False (default) the function is a
no-op if any active tasks, goals, or habits already exist.
"""

from datetime import date, datetime, time, timedelta
from typing import Dict

from db import crud


# ---------------------------------------------------------------------------
#  Guard helper
# ---------------------------------------------------------------------------

def _tables_empty() -> bool:
    """Return True when there are no active tasks, goals, or habits."""
    return (
        len(crud.get_tasks()) == 0
        and len(crud.get_goals()) == 0
        and len(crud.get_habits(include_inactive=True)) == 0
    )


# ---------------------------------------------------------------------------
#  Public entry point
# ---------------------------------------------------------------------------

def seed_database(force: bool = False) -> Dict:
    """
    Populate the database with realistic sample data.

    Parameters
    ----------
    force : bool
        When True, insert seed data even when the tables already have rows.

    Returns
    -------
    dict
        Keys: tasks, goals, habits, events (counts inserted), or
        {"skipped": True, "reason": "..."} when the guard fires.
    """
    if not force and not _tables_empty():
        return {
            "skipped": True,
            "reason": (
                "Tables already contain data. "
                "Enable 'Force re-seed' to insert anyway."
            ),
        }

    today = date.today()

    # ------------------------------------------------------------------ Goals

    goal_website = crud.create_goal(
        title="Launch Personal Website",
        description=(
            "Build and deploy a personal portfolio site showcasing "
            "projects, writing, and contact info."
        ),
        status="active",
        target_date=today + timedelta(days=60),
        progress_mode="auto",
    )

    goal_fitness = crud.create_goal(
        title="Get Fit for Summer",
        description="Lose 8 kg and establish a consistent workout routine.",
        status="active",
        target_date=today + timedelta(days=120),
        progress_mode="manual",
        progress_pct=35,
    )

    crud.create_goal(
        title="Learn Conversational Spanish",
        description="Reach B1 level — able to hold casual conversations.",
        status="active",
        target_date=today + timedelta(days=365),
        progress_mode="manual",
        progress_pct=15,
    )

    crud.create_goal(
        title="Read 12 Books This Year",
        description="One book per month across fiction and non-fiction.",
        status="active",
        target_date=date(today.year, 12, 31),
        progress_mode="manual",
        progress_pct=25,
    )

    # Sub-goals for "Launch Personal Website"
    crud.create_goal(
        title="Design Homepage Layout",
        description="Wireframe and finalise the landing page design.",
        status="active",
        parent_id=goal_website.id,
        progress_mode="manual",
        progress_pct=60,
    )

    crud.create_goal(
        title="Write About & Projects Sections",
        description="Craft copy for About page and document 3 featured projects.",
        status="active",
        parent_id=goal_website.id,
        progress_mode="manual",
        progress_pct=20,
    )

    # ------------------------------------------------------------------ Tasks

    # Linked to goal_website (drives its auto-progress)
    crud.create_task(
        title="Set up domain and hosting",
        description="Register domain, configure DNS for Netlify deployment.",
        status="done",
        priority="high",
        due_date=today - timedelta(days=5),
        project_id=goal_website.id,
        estimated_minutes=60,
        energy_level="medium",
        tags="dev,web",
    )

    crud.create_task(
        title="Build portfolio homepage",
        description=(
            "Responsive layout with hero section, skills grid, "
            "and contact form."
        ),
        status="in_progress",
        priority="high",
        due_date=today + timedelta(days=7),
        project_id=goal_website.id,
        estimated_minutes=180,
        energy_level="high",
        tags="dev,web",
    )

    crud.create_task(
        title="Write bio and project descriptions",
        description="Draft engaging copy for About section and 3 featured projects.",
        status="todo",
        priority="medium",
        due_date=today + timedelta(days=14),
        project_id=goal_website.id,
        estimated_minutes=90,
        energy_level="medium",
        tags="writing,web",
    )

    crud.create_task(
        title="Deploy to production and QA on mobile",
        description="Final pass across Chrome, Safari, and Firefox on mobile and desktop.",
        status="todo",
        priority="high",
        due_date=today + timedelta(days=21),
        project_id=goal_website.id,
        estimated_minutes=120,
        energy_level="high",
        tags="dev,web",
    )

    # Standalone tasks
    crud.create_task(
        title="Review Q1 budget report",
        description="Cross-check actuals vs forecast; flag variances > 10%.",
        status="in_progress",
        priority="urgent",
        due_date=today + timedelta(days=1),
        estimated_minutes=45,
        energy_level="high",
        tags="finance,work",
    )

    crud.create_task(
        title="Book dentist appointment",
        status="todo",
        priority="low",
        due_date=today + timedelta(days=14),
        estimated_minutes=15,
        energy_level="low",
        tags="health",
    )

    crud.create_task(
        title="Buy groceries",
        description="Oats, eggs, spinach, chicken, Greek yogurt, olive oil.",
        status="todo",
        priority="medium",
        due_date=today,
        estimated_minutes=30,
        energy_level="low",
        tags="personal",
    )

    crud.create_task(
        title="Call accountant about Q1 taxes",
        status="done",
        priority="medium",
        due_date=today - timedelta(days=3),
        estimated_minutes=30,
        energy_level="medium",
        tags="finance",
    )

    crud.create_task(
        title="Read 'Atomic Habits' — Chapters 5–8",
        status="todo",
        priority="low",
        estimated_minutes=60,
        energy_level="low",
        tags="reading",
    )

    crud.create_task(
        title="Prepare Q2 team roadmap presentation",
        description="Slides covering goals, milestones, resourcing, and risks.",
        status="todo",
        priority="high",
        due_date=today + timedelta(days=10),
        estimated_minutes=120,
        energy_level="high",
        tags="work,management",
    )

    # ------------------------------------------------------------------ Habits

    crud.create_habit(
        title="Morning Meditation",
        description="10 minutes of mindfulness before checking phone.",
        frequency="daily",
        time_of_day="morning",
    )

    crud.create_habit(
        title="Exercise",
        description="At least 30 minutes — gym, run, or cycle.",
        frequency="daily",
        time_of_day="morning",
    )

    crud.create_habit(
        title="Take Daily Vitamins",
        description="Vitamin D, magnesium, omega-3.",
        frequency="daily",
        time_of_day="morning",
    )

    crud.create_habit(
        title="Read 30 Minutes",
        description="Fiction or non-fiction — no screens.",
        frequency="daily",
        time_of_day="evening",
    )

    crud.create_habit(
        title="Weekly Review",
        description="Review tasks, goals, habits — plan the week ahead.",
        frequency="weekly",
        time_of_day="anytime",
    )

    # ------------------------------------------------------------------ Calendar events

    crud.create_event(
        title="Team Standup",
        description="Daily sync — blockers, progress, plans.",
        event_type="meeting",
        start_datetime=datetime.combine(today - timedelta(days=1), time(9, 0)),
        end_datetime=datetime.combine(today - timedelta(days=1), time(9, 15)),
    )

    crud.create_event(
        title="Project Kickoff Meeting",
        description="Kick off the new product sprint with the full team.",
        event_type="meeting",
        start_datetime=datetime.combine(today + timedelta(days=1), time(10, 0)),
        end_datetime=datetime.combine(today + timedelta(days=1), time(11, 0)),
        location="Zoom — link in calendar invite",
    )

    crud.create_event(
        title="Gym Session",
        description="Upper body strength + 20 min cardio.",
        event_type="personal",
        start_datetime=datetime.combine(today, time(7, 0)),
        end_datetime=datetime.combine(today, time(8, 0)),
    )

    crud.create_event(
        title="Lunch with Sarah",
        description="Catch-up lunch — confirm venue.",
        event_type="personal",
        start_datetime=datetime.combine(today + timedelta(days=2), time(12, 0)),
        end_datetime=datetime.combine(today + timedelta(days=2), time(13, 0)),
        location="Cafe Nero, High Street",
    )

    crud.create_event(
        title="Doctor Appointment",
        event_type="personal",
        start_datetime=datetime.combine(today + timedelta(days=3), time(14, 0)),
        end_datetime=datetime.combine(today + timedelta(days=3), time(15, 0)),
        location="City Medical Centre",
    )

    crud.create_event(
        title="Q2 Planning Session",
        description="Full-day strategic planning with leadership team.",
        event_type="meeting",
        start_datetime=datetime.combine(today + timedelta(days=7), time(9, 0)),
        end_datetime=datetime.combine(today + timedelta(days=7), time(17, 0)),
        location="HQ — Boardroom B",
    )

    return {
        "tasks": 10,
        "goals": 6,   # 4 top-level + 2 sub-goals
        "habits": 5,
        "events": 6,
    }
