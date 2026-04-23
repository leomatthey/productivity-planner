# Stride — Productivity AI

A calm, well-designed personal planner that lives on your laptop, paired with a Claude-powered assistant that has full read/write access to your tasks, projects, habits, and calendar. Built as the **Assignment 1 submission for *Prototyping with Data & AI* (ESADE MiBA, Spring 2026)**.

> **One-line setup:** clone, paste an Anthropic key into `backend/.env`, run `docker-compose up --build`. First boot auto-seeds a rich showcase dataset — the app is populated and ready to demo on `http://localhost:3000`.

---

## Why this is local-only

Stride is intentionally **not deployed online**. It's a single-user personal-productivity app: there is no auth layer, no multi-tenant isolation, no per-user data partition. Deploying it would require building all of that — multi-user auth, per-user OAuth callback URLs, data isolation, hosted DB — for zero user benefit. Your data (chats, tasks, calendar links, OAuth tokens) belongs on your own machine.

The Docker setup in this repo *is* the production setup — for yourself. The professor can clone the repo, run two commands, and have a fully functional copy in five minutes.

---

## Prerequisites

- **[Docker Desktop](https://www.docker.com/products/docker-desktop/)** (only hard dependency).
- **An Anthropic API key.** Free trial credit covers a thorough demo; expect roughly $1–2 of usage if you exercise the AI heavily. Get one at [console.anthropic.com](https://console.anthropic.com).
- **Optional:** a Google Cloud project for Google Calendar sync (see below).

---

## Run it in 5 minutes

```bash
git clone https://github.com/leomatthey/productivity-planner.git
cd productivity-planner

cp backend/.env.example backend/.env
# open backend/.env and paste your Anthropic key into ANTHROPIC_API_KEY=

docker-compose up --build
```

When both containers report healthy, open **http://localhost:3000**.

The first visit auto-redirects to `/welcome` — a landing page with a quick tour and a "Get started" link. Demo data is seeded automatically on the first backend boot, so the app is **populated and ready to explore** without any extra clicks.

To stop:

```bash
docker-compose down          # keeps your data
docker-compose down -v       # also wipes volumes (use carefully)
```

---

## Anthropic API key

The `ANTHROPIC_API_KEY` in `backend/.env` powers two features:

1. **AI Assistant** — every message in the dedicated AI tab and every in-page assistant panel.
2. **Analytics → Generate Insights** — one-shot LLM call that returns a structured JSON insights object.

The model used is `claude-sonnet-4-6`. If the key is missing or invalid, the rest of the app still works — just the AI features are disabled with a clear message.

---

## Google Calendar (optional)

You can ignore this entirely — Stride is fully usable without it. Without Google Calendar:

- The Calendar page still works with locally-created events.
- The smart scheduler still finds free slots in your local events.
- All AI features still work.

If you *do* want to sync your real calendar:

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (or pick an existing one).
3. Enable the **Google Calendar API** (APIs & Services → Library).
4. Create an OAuth client ID:
   - APIs & Services → Credentials → **Create credentials** → OAuth client ID.
   - Application type: **Web application**.
   - Authorised redirect URI: `http://localhost:3000/settings` (or whatever URL Stride is running at).
5. Download the client-secrets JSON.
6. Save it as `backend/data/google_client_secrets.json` (create the `data/` directory if needed).
7. Restart the backend: `docker-compose restart backend`.
8. In the running app, go to **Settings → Connect Google Calendar** and complete the OAuth flow.

Your synced events appear on the Calendar page (read-only, neutral colour) and are respected by the smart scheduler — task blocks won't be placed on top of them.

---

## First-run tour (suggested demo path)

1. **/welcome** — auto-redirected on first visit. Read the hero, click *"Open the app"*.
2. **Dashboard** — today's plan, overdue banner, habits due today.
3. **Projects** — expand the Master's project to see subprojects + rolled-up status. Try the inline AI panel: *"Add 3 next tasks for the PDAI subproject."*
4. **Tasks** — open the inline AI panel, click the workout chip → *"Generate a workout — 60 minutes light cardio"* → watch a richly-described task appear.
5. **Calendar** — see scheduled task blocks alongside seeded meetings; drag to reschedule.
6. **Habits** — 4 habits with 30 days of completion history; one ("Meditate") is deliberately slipping for the analytics insight to catch.
7. **Analytics** → click **Generate Insights**. The AI returns a concrete executive summary that names a specific project + numbers, and chart cards highlighted by the LLM glow.
8. **Settings** → **Reset & Seed Demo Data** if you want a clean slate at any point.

---

## Features at a glance

| Tab | What it does |
|---|---|
| **Dashboard** | Greeting + overdue banner + Today's Plan timeline + habits due. |
| **Tasks** | Quick-add, list & kanban views, filter by project / priority / status, inline AI panel. |
| **Projects** | Top-level → subprojects → tasks. Auto-progress, RAG status. Inline AI restricted to task-level changes. |
| **Calendar** | Month / Week / Day views via react-big-calendar, drag-to-reschedule, Google Calendar sync. |
| **Habits** | Daily / weekday / weekly / custom frequency, streak tracking, 30-day grid, inline AI for habit plans. |
| **AI Assistant** | Full Claude chat, multi-session history, 27 tools, SSE streaming. |
| **Analytics** | Executive hero strip, Project Health Board (RAG), Time Allocation donut, Habit-rate bars, Calendar Load heatmap, AI Insights. |
| **Settings** | Work hours, Google Calendar OAuth, Reset & Seed Demo Data. |

Every tab has a one-time explainer modal on first session visit — click the `?` icon in the top bar to reopen it.

---

## AI integration (assignment compliance)

This submission ships **two distinct LLM-powered features**, as required:

### Feature 1 — AI Assistant (multi-call tool-use loop)

- 27 tools registered with the agent: full CRUD for tasks, projects, habits, calendar events; atomic `schedule_task` / `unschedule_task` / `move_event`; `apply_schedule` for batch scheduling; preference get/set; Google Calendar sync.
- Streaming SSE responses; non-streaming tool-use iterations precede the final streamed text.
- Multi-session history with sidebar navigation.
- Three **per-tab inline panels** (Projects, Tasks, Habits) reuse the same agent. The Projects panel is **scope-restricted via backend tool filtering** — `create_goal / update_goal / delete_goal` are stripped from the tool list when the chat originates from that panel, with a positive-framing system-prompt addendum explaining the restriction.
- Timezone-correct: a single conversion boundary (`backend/utils/tz.py`) ensures the agent reads and writes user-local times despite the DB storing naive UTC.
- "Smart Creation" guidance in the system prompt steers the model to fill descriptions with structured content (workouts with warm-up/main/cool-down; project plans with parent + 2–4 subprojects + 5–12 tasks; habit plans with deliberate frequency + time-of-day).

### Feature 2 — Analytics Insights (data → LLM structured JSON → chart visual state)

- `crud.get_analytics_stats` aggregates the live DB into a payload covering tasks (completion-by-week), project health (RAG status, velocity, projected finish), per-project time allocation this week vs last, habit completion rates (7- and 30-day), calendar load.
- `POST /api/analytics/insights` sends that payload to Claude with a strict JSON schema requiring a `headline`, 3–5 `highlights` (each with a `metric` enum), `patterns`, `recommendations`, and a `focus_suggestion`.
- The frontend maps each `metric` enum value to a chart card identifier (`METRIC_TO_CHART`) and adds a primary ring around any chart the LLM flagged. **The LLM's structured output directly drives visual chart state** — the assignment's "non-straightforward LLM feature" requirement.
- The system prompt requires specificity: highlights and patterns must reference real project names, habit names, and numbers from the data — never generic phrasing.

---

## Data & privacy

- The SQLite database lives at `backend/data/planner.db` on your filesystem (bind-mounted into the container at `/app/data`).
- Chat history is stored in the same DB (`ai_conversation_history` table).
- Google OAuth tokens (if you connect Google Calendar) live in `backend/data/google_token.json` — never sent anywhere.
- **Nothing leaves your machine** except the chat content sent to Anthropic when you message the AI.

To wipe everything:

```bash
docker-compose down
rm -rf backend/data
```

The next `docker-compose up` will re-create an empty DB and re-seed demo data on first boot.

---

## Tech stack

- **Backend** — FastAPI (Python 3.12, packaged with [`uv`](https://github.com/astral-sh/uv)), SQLAlchemy 2 over SQLite, Anthropic Python SDK (`claude-sonnet-4-6`), Google API Python Client.
- **Frontend** — React 18 + TypeScript + Vite + nginx (production build), TailwindCSS + [shadcn/ui](https://ui.shadcn.com/), TanStack Query, react-big-calendar, recharts.
- **Container** — Docker Compose with two services (backend on `:8000`, frontend on `:3000`); single bind-mount for the SQLite DB.

---

## Project layout

```
productivity-planner/
├── backend/
│   ├── agent/         # Claude tool-use loop and tool registry
│   ├── routers/       # FastAPI endpoints (one file per domain)
│   ├── db/            # SQLAlchemy schema + CRUD layer
│   ├── integrations/  # Google Calendar OAuth + sync
│   ├── utils/         # Timezone, scheduling engine, seed data
│   ├── data/          # (gitignored) SQLite DB + Google tokens
│   ├── main.py        # FastAPI app entry point
│   └── .env.example   # copy to .env and add your key
├── frontend/
│   ├── src/
│   │   ├── pages/     # One file per tab (Welcome, Dashboard, Tasks, …)
│   │   ├── components/# Reusable UI: layout, ai/AIChatPanel, brand/Logo, …
│   │   └── lib/       # Typed API client, theme, colour helpers
│   └── …
├── legacy/            # Historical Streamlit prototype — ignore for grading
├── docker-compose.yml
└── README.md          # you are here
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| **`AI error: Connection error`** in the chat | `ANTHROPIC_API_KEY` missing or invalid in `backend/.env`. Edit, then `docker-compose restart backend`. |
| **Port 3000 or 8000 already in use** | Free the port (`lsof -i :3000` then kill) or remap in `docker-compose.yml`. |
| **App times look 1–2h off** | `TZ` in `backend/.env` doesn't match your local timezone. Set it (e.g. `TZ=America/New_York`) and restart the backend. |
| **DB feels stale or you want a clean slate** | Settings → **Reset & Seed Demo Data** (preserves Google events) — or `docker-compose down && rm -rf backend/data && docker-compose up`. |
| **Google "Connect" silently fails** | `backend/data/google_client_secrets.json` is missing, or the redirect URI registered in Google Cloud Console doesn't include `http://localhost:3000/settings`. |
| **Frontend builds but page is blank** | Hard reload (Cmd+Shift+R) to bust Vite's cached chunks; check the browser console. |

---

## Acknowledgements

PDAI submission · ESADE MiBA · Spring 2026 · paired with Claude as a coding collaborator throughout.
