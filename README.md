# Productivity Planner

A personal AI-powered productivity planner built with FastAPI, React, and Anthropic Claude. It combines task management, goal tracking, habit streaks, and a calendar with an AI assistant that can read and modify your data through natural language.

This is a **work-in-progress prototype** submitted as Assignment 1 for the Prototyping with Data & AI course (ESADE MiBA, Term 2, 2026).

---

## What This Is

The planner solves a personal pain point: fragmented productivity tools. Instead of switching between a task app, a calendar, and a habit tracker, everything lives in one place — with an AI assistant that understands your full context and can take action on your behalf.

The two LLM features required by the assignment are:
1. **AI Assistant** — a Claude-powered chat agent with tool-use: it can create tasks, reschedule events, check your habits, and query your goals in real time
2. **Analytics Insights** — Claude analyzes your aggregated productivity data (task completion rates, habit streaks, busiest calendar hours) and returns structured JSON highlights, patterns, and recommendations that are displayed alongside the charts

---

## Current Features

| Feature | Status | Notes |
|---|---|---|
| Task management | Working | CRUD, priorities (low/medium/high/urgent), status flow, soft deletes |
| Projects / Goals | Working | Hierarchical goals, auto-progress from linked tasks, color labels |
| Calendar | Working | Week/month views, local event creation, event types |
| Habits | Working | Streak tracking, daily/weekly/weekday frequencies, completion marking |
| AI Assistant | Working* | Claude claude-sonnet-4-6, tool-use loop, streaming SSE, conversation history |
| Analytics | Working* | Recharts visualisations + LLM-generated insights panel |
| Dark mode | Working | Toggle in top bar |
| Google Calendar sync | Partial | OAuth flow implemented; requires personal Google Cloud credentials (see below) |

\* Requires `ANTHROPIC_API_KEY` in `backend/.env`

---

## Known Limitations / Work in Progress

- **Projects page**: being refactored — task linking and sub-goal views are partially complete
- **Tasks page**: filter/sort UI being improved; some edge cases in date filtering
- **Calendar**: minor timezone edge cases when displaying events near midnight
- **Google Calendar**: fully functional OAuth + sync flow, but **requires the reviewer to set up their own Google Cloud credentials** — it will not work out of the box (see Google Calendar section below)
- **Mobile layout**: not optimised; designed for desktop (1280px+)
- **No authentication**: single-user local app, no login system

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Styling | TailwindCSS + shadcn/ui |
| Charts | Recharts |
| Icons | Lucide React |
| Backend | FastAPI + Uvicorn (Python 3.9+) |
| Database | SQLite via SQLAlchemy 2.x |
| AI | Anthropic Claude (`claude-sonnet-4-6`) |
| Google Calendar | google-api-python-client |

---

## Quick Start

### Prerequisites

- Python 3.9+
- Node.js 18+
- An Anthropic API key — get one free at [console.anthropic.com](https://console.anthropic.com)

### 1. Backend

```bash
cd backend

# Install Python dependencies
pip install -r requirements.txt

# Set up environment
cp .env.example .env
# Open .env and replace 'your-anthropic-api-key-here' with your actual key

# Start the API server
python3 -m uvicorn main:app --reload --port 8000
# (or just: uvicorn main:app --reload --port 8000 if uvicorn is in your PATH)
```

On first startup, the server automatically creates the SQLite database and seeds it with realistic demo data (tasks, goals, habits, calendar events). You will see a confirmation in the terminal.

### 2. Frontend

```bash
cd frontend

# Install Node dependencies
npm install

# Start the dev server
npm run dev
# Opens at http://localhost:5173
```

Both servers must be running simultaneously. Vite proxies all `/api/*` requests to the backend on port 8000.

---

## Demo Data

On first run, the backend auto-seeds the database with:

- **6 goals** — "Launch Personal Website" (with 2 sub-goals), "Get Fit for Summer", "Learn Conversational Spanish", "Read 12 Books This Year"
- **10 tasks** — various priorities, statuses, and tags; 4 linked to the website goal
- **5 habits** — Morning Meditation, Exercise, Vitamins, Read 30 Min, Weekly Review
- **6 calendar events** — standup meetings, a gym session, a doctor appointment

To force a fresh re-seed (clears all data):

```bash
cd backend
python -c "from utils.seed import seed_database; seed_database(force=True)"
```

---

## Feature Tour — What to Try

The goal is to see how the AI assistant interacts with your real data:

1. **Tasks page** — create a task, change its priority, mark it done. Notice how task completion auto-updates linked goal progress.

2. **AI Assistant** — try these prompts:
   - *"What are my highest-priority tasks this week?"*
   - *"Schedule my urgent tasks for tomorrow morning"*
   - *"Create a task to review the analytics dashboard by Friday"*
   - *"What habits have I been skipping?"*

3. **Analytics page** — click **Generate Insights** to call Claude with your aggregated data. Watch the highlights panel populate with personalised observations and recommendations.

4. **Calendar** — view your seeded events, create a new one. Switch between week and month views.

5. **Habits** — mark today's habits complete and watch streaks update in real time.

6. **Projects** — see the goal hierarchy (parent goal → sub-goals → linked tasks) and progress bars.

---

## Architecture

```
┌─────────────────────────────────┐
│  React 18 + TypeScript (Vite)   │
│  Port 5173 (dev)                │
│  TailwindCSS + shadcn/ui        │
└──────────────┬──────────────────┘
               │  REST + SSE  (/api/*)
┌──────────────▼──────────────────┐
│  FastAPI + Uvicorn              │
│  Port 8000                      │
│                                 │
│  routers/   tasks, goals,       │
│             habits, calendar,   │
│             ai (SSE), analytics │
│  agent/     tool-use loop       │
│  db/        schema + crud       │
└──────────────┬──────────────────┘
               │  SQLAlchemy
┌──────────────▼──────────────────┐
│  SQLite  (backend/data/)        │
│  Auto-created on first run      │
└─────────────────────────────────┘
               │  Anthropic API
┌──────────────▼──────────────────┐
│  Claude claude-sonnet-4-6           │
│  Tool-use: read/write tasks,    │
│  events, habits, goals          │
└─────────────────────────────────┘
```

---

## Google Calendar (Optional)

The Google Calendar integration is fully implemented (OAuth 2.0 flow, bidirectional sync, read-only import of Google events). However, it **cannot work on another machine** without its own credentials.

To set it up on your machine:

1. Create a Google Cloud project with the Calendar API enabled
2. Create OAuth 2.0 credentials (Web application type)
3. Add `http://localhost:8000` as an authorised redirect URI
4. Download the credentials JSON and save it as `backend/data/google_client_secrets.json`
5. In the app, go to **Settings → Google Calendar** and complete the OAuth flow

All other features work without Google Calendar.

---

## Project Structure

```
productivity-planner/
├── backend/               FastAPI + Python
│   ├── main.py            App entry point, lifespan, CORS
│   ├── requirements.txt   Python dependencies
│   ├── .env.example       Environment template (copy to .env)
│   ├── routers/           One router per domain
│   ├── agent/             Claude tool-use agent
│   ├── db/                SQLAlchemy schema + CRUD layer
│   ├── integrations/      Google Calendar client
│   └── utils/             seed.py, date_utils.py
├── frontend/              React + TypeScript + Vite
│   ├── src/
│   │   ├── pages/         8 page components
│   │   ├── components/    Shared UI + layout (AppShell, Sidebar)
│   │   ├── lib/           api.ts, theme.ts, scheduling.ts
│   │   └── types/         TypeScript types mirroring DB schema
│   └── package.json
├── legacy/                v1 Streamlit prototype (reference only)
├── CLAUDE.md              Full development briefing (sprint-by-sprint)
├── FIXES_V3.md            Sprint 4+ change log
└── README.md              This file
```

---

## Development Notes

The development process followed a sprint structure documented in `CLAUDE.md`:

- **Sprint 0** — Vite + React scaffold, full design system (Tailwind + shadcn/ui)
- **Sprint 1** — FastAPI backend, 7 routers, bug fixes from v1
- **Sprint 2** — Agent upgrades: dynamic system prompt, streaming SSE, tool additions
- **Sprint 3** — All 8 React pages fully implemented
- **Sprint 4** — Analytics page (LLM insights, second LLM feature)
- **Sprint 4+** (current) — Projects page, task/calendar improvements, fixes

The `legacy/` folder contains the original Streamlit v1 prototype from which the backend logic was preserved.
