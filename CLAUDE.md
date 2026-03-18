# Productivity Planner — Claude Code Briefing (v3)

Read this file **fully** before touching any file, every session.
The most important section is **CURRENT SPRINT** directly below.
Do exactly what it says and nothing outside it.

---

## CURRENT SPRINT

**→ Sprint 0: Project Setup & Design System**

### What to build

Set up the full frontend project scaffold and implement the complete design system.
Do not write any page components yet — only the shell, the tokens, and the plumbing.

### Files to create

```
frontend/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── package.json                  (see dependencies list below)
├── tailwind.config.ts            (full config — see design spec section)
├── postcss.config.js
└── src/
    ├── main.tsx
    ├── App.tsx                   (router setup with placeholder routes)
    ├── styles/
    │   └── globals.css           (full CSS — see design spec section)
    ├── lib/
    │   ├── theme.ts              (design tokens as TS constants)
    │   └── api.ts                (typed API client stub — empty for now)
    ├── components/
    │   ├── ui/                   (shadcn/ui components land here — do not create manually)
    │   └── layout/
    │       ├── Sidebar.tsx       (full sidebar with nav items)
    │       ├── TopBar.tsx        (page title + action slot)
    │       └── AppShell.tsx      (Sidebar + TopBar + content area)
    ├── pages/
    │   ├── Dashboard.tsx         (stub: just <h1>Dashboard</h1>)
    │   ├── Tasks.tsx             (stub)
    │   ├── Goals.tsx             (stub)
    │   ├── Calendar.tsx          (stub)
    │   ├── Habits.tsx            (stub)
    │   ├── AIAssistant.tsx       (stub)
    │   ├── Analytics.tsx         (stub)
    │   └── Settings.tsx          (stub)
    └── types/
        └── index.ts              (TypeScript types mirroring DB schema)
```

### Do not create

Any backend files. Any page logic. Any API calls.

### Step-by-step execution

**Step 1 — Initialise the frontend project**
```bash
cd /path/to/productivity-planner
npm create vite@latest frontend -- --template react-ts
cd frontend
```

**Step 2 — Install all dependencies**
```bash
# Core
npm install react-router-dom

# Tailwind
npm install -D tailwindcss postcss autoprefixer tailwindcss-animate
npx tailwindcss init -p

# shadcn/ui
npx shadcn@latest init
# When prompted: Style=Default, Base colour=Slate, CSS variables=Yes
# Then override the CSS variables with the exact values in the design spec below

# shadcn/ui components
npx shadcn@latest add button input textarea select checkbox badge
npx shadcn@latest add dialog drawer sheet popover tooltip
npx shadcn@latest add card separator progress tabs
npx shadcn@latest add sonner command

# Fonts (no network dependency, no FOUC)
npm install @fontsource/inter @fontsource/jetbrains-mono

# Icons
npm install lucide-react

# Charts (for Analytics page, install now)
npm install recharts

# Utility
npm install clsx tailwind-merge class-variance-authority
```

**Step 3 — Write `tailwind.config.ts`** (exact content in design spec below)

**Step 4 — Write `src/styles/globals.css`** (exact content in design spec below)

**Step 5 — Write `src/lib/theme.ts`** (exact content in design spec below)

**Step 6 — Write `src/types/index.ts`** (TypeScript types — see schema section below)

**Step 7 — Write `src/lib/api.ts`** (typed API client — see API section below)

**Step 8 — Build the AppShell** (`Sidebar.tsx`, `TopBar.tsx`, `AppShell.tsx`)
Full implementation of sidebar and top bar — see layout spec below.
All page stubs just render `<AppShell><h1>Page Name</h1></AppShell>`.

**Step 9 — Wire up routing in `App.tsx`**
React Router v6 with all 8 routes pointing to stub pages.

**Step 10 — Run and verify**
```bash
npm run dev
```
The app must start, show the sidebar with all 8 nav items, navigate between stub pages.

---

## Sprint Plan

| Sprint | Name | Stack Layer | Assignment |
|---|---|---|---|
| **0** | Project Setup & Design System | Frontend only | — |
| **1** | Backend Layer | Python: fixes + FastAPI routes | — |
| **2** | Agent Core Upgrades | Python: agent.py + tools.py | Improves existing LLM |
| **3** | React Pages — All 7 pages | Frontend: full page implementations | — |
| **4** | Analytics Page | Python endpoint + React + LLM insights | **Second LLM feature** |

**One sprint per session. Commit after each. Verify app runs before starting next.**

**Scope rule:** Do not modify files outside the current sprint's listed scope,
even if you see an improvement. Flag it as a comment, do not implement it.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend  (frontend/)                                      │
│  React 18 + TypeScript + Vite                               │
│  TailwindCSS + shadcn/ui                                    │
│  Port 5173 (dev) / nginx (prod)                             │
└─────────────────────┬───────────────────────────────────────┘
                      │  REST API  (JSON)
                      │  SSE stream (AI chat)
┌─────────────────────▼───────────────────────────────────────┐
│  Backend  (backend/)                                        │
│  FastAPI + Uvicorn                                          │
│  Port 8000                                                  │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ routers/     │  │ agent/       │  │ integrations/    │  │
│  │ tasks.py     │  │ agent.py ✓   │  │ google_cal.py ✓  │  │
│  │ goals.py     │  │ tools.py ✓   │  └──────────────────┘  │
│  │ habits.py    │  └──────────────┘                        │
│  │ calendar.py  │  ┌──────────────┐  ┌──────────────────┐  │
│  │ ai.py        │  │ db/          │  │ utils/           │  │
│  │ analytics.py │  │ schema.py ✓  │  │ date_utils.py ✓  │  │
│  │ preferences  │  │ crud.py ✓    │  └──────────────────┘  │
│  └──────────────┘  └──────────────┘                        │
└─────────────────────────────────────────────────────────────┘
                      │  SQLAlchemy
┌─────────────────────▼───────────────────────────────────────┐
│  data/planner.db  (SQLite, git-ignored)                     │
└─────────────────────────────────────────────────────────────┘
```

**✓ = unchanged from v1 Streamlit prototype. Zero edits needed.**

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend framework | React 18 + TypeScript | Vite for bundling |
| Styling | TailwindCSS + shadcn/ui | Full design system |
| Routing | React Router v6 | Client-side |
| Charts | Recharts | Analytics page |
| Icons | Lucide React | Stroke icons only |
| Backend | FastAPI + Uvicorn | Python 3.9 |
| Database | SQLite via SQLAlchemy 2.x | Unchanged |
| AI Agent | Anthropic `claude-sonnet-4-6` | Unchanged |
| Google Calendar | google-api-python-client | Unchanged |

---

## Project Structure

```
productivity-planner/
│
├── backend/                          Python / FastAPI
│   ├── main.py                       FastAPI app, CORS, startup (Sprint 1)
│   ├── routers/                      One router per domain (Sprint 1)
│   │   ├── tasks.py
│   │   ├── goals.py
│   │   ├── habits.py
│   │   ├── calendar.py
│   │   ├── ai.py                     SSE streaming endpoint
│   │   ├── analytics.py
│   │   └── preferences.py
│   ├── db/
│   │   ├── __init__.py
│   │   ├── schema.py                 UNCHANGED from v1
│   │   └── crud.py                   UNCHANGED from v1 (Sprint 1 adds functions)
│   ├── agent/
│   │   ├── __init__.py
│   │   ├── tools.py                  UNCHANGED (Sprint 2 adds tools)
│   │   └── agent.py                  UNCHANGED (Sprint 2 rewrites)
│   ├── integrations/
│   │   └── google_calendar.py        UNCHANGED
│   ├── utils/
│   │   ├── __init__.py
│   │   └── date_utils.py             UNCHANGED
│   ├── .env                          ANTHROPIC_API_KEY (git-ignored)
│   └── requirements.txt              fastapi, uvicorn + existing deps minus streamlit
│
└── frontend/                         React / TypeScript / Vite
    ├── index.html
    ├── vite.config.ts
    ├── tailwind.config.ts
    ├── postcss.config.js
    ├── tsconfig.json
    ├── package.json
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── styles/
        │   └── globals.css
        ├── lib/
        │   ├── theme.ts
        │   └── api.ts
        ├── components/
        │   ├── ui/                   shadcn/ui components
        │   └── layout/
        │       ├── Sidebar.tsx
        │       ├── TopBar.tsx
        │       └── AppShell.tsx
        ├── pages/
        │   ├── Dashboard.tsx
        │   ├── Tasks.tsx
        │   ├── Goals.tsx
        │   ├── Calendar.tsx
        │   ├── Habits.tsx
        │   ├── AIAssistant.tsx
        │   ├── Analytics.tsx
        │   └── Settings.tsx
        └── types/
            └── index.ts
```

---

## How to Run

```bash
# Backend (from productivity-planner/backend/)
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend (from productivity-planner/frontend/)
npm run dev
# Opens at http://localhost:5173
# Vite proxies /api/* → http://localhost:8000
```

Configure Vite proxy in `vite.config.ts`:
```typescript
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
```

---

## Design System — Sprint 0 Implementation

### Colour Decisions (final, do not change)

```
Primary:       #4F46E5   (indigo-600)
Primary hover: #4338CA   (indigo-700)
Primary tint:  #EEF2FF   (indigo-50)

Neutral scale: Tailwind Slate (slate-50 through slate-900)
  Main backgrounds: #FFFFFF (white)
  Sidebar/surface:  #F8FAFC (slate-50)
  Standard border:  #E2E8F0 (slate-200)
  Strong border:    #CBD5E1 (slate-300)
  Muted text:       #94A3B8 (slate-400)
  Secondary text:   #475569 (slate-600)
  Body text:        #334155 (slate-700)
  Headings:         #0F172A (slate-900)

Success: #059669 / light #D1FAE5   (emerald)
Warning: #D97706 / light #FEF3C7   (amber)
Danger:  #DC2626 / light #FEE2E2   (red)

Calendar event colours (MUST NOT CHANGE — established in v1):
  meeting:    #3B82F6   (blue-500)
  personal:   #8B5CF6   (violet-500)
  reminder:   #F59E0B   (amber-500)
  task_block: #10B981   (emerald-500)
  google:     #94A3B8   (slate-400)
```

### `tailwind.config.ts` — exact file content

```typescript
import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#4F46E5',
          50:  '#EEF2FF',
          100: '#E0E7FF',
          200: '#C7D2FE',
          300: '#A5B4FC',
          400: '#818CF8',
          500: '#6366F1',
          600: '#4F46E5',
          700: '#4338CA',
          800: '#3730A3',
          900: '#312E81',
        },
        success: { light: '#D1FAE5', DEFAULT: '#059669', dark: '#047857' },
        warning: { light: '#FEF3C7', DEFAULT: '#D97706', dark: '#B45309' },
        danger:  { light: '#FEE2E2', DEFAULT: '#DC2626', dark: '#B91C1C' },
        event: {
          meeting:   '#3B82F6',
          personal:  '#8B5CF6',
          reminder:  '#F59E0B',
          taskblock: '#10B981',
          google:    '#94A3B8',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        'xs':   ['11px', { lineHeight: '16px' }],
        'sm':   ['13px', { lineHeight: '20px' }],
        'base': ['14px', { lineHeight: '22px' }],
        'md':   ['15px', { lineHeight: '24px' }],
        'lg':   ['17px', { lineHeight: '26px' }],
        'xl':   ['20px', { lineHeight: '28px' }],
        '2xl':  ['24px', { lineHeight: '32px' }],
        '3xl':  ['30px', { lineHeight: '36px' }],
      },
      borderRadius: {
        'xs':    '4px',
        'sm':    '6px',
        DEFAULT: '8px',
        'md':    '8px',
        'lg':    '10px',
        'xl':    '12px',
        '2xl':   '16px',
      },
      boxShadow: {
        'xs':      '0 1px 2px rgba(0,0,0,0.05)',
        'sm':      '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        DEFAULT:   '0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -1px rgba(0,0,0,0.04)',
        'md':      '0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -1px rgba(0,0,0,0.04)',
        'lg':      '0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -2px rgba(0,0,0,0.04)',
        'xl':      '0 20px 25px -5px rgba(0,0,0,0.10), 0 10px 10px -5px rgba(0,0,0,0.04)',
        'primary': '0 0 0 3px rgba(79,70,229,0.15)',
        'danger':  '0 0 0 3px rgba(220,38,38,0.15)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
```

### `src/styles/globals.css` — exact file content

```css
@import '@fontsource/inter/400.css';
@import '@fontsource/inter/500.css';
@import '@fontsource/inter/600.css';
@import '@fontsource/inter/700.css';
@import '@fontsource/jetbrains-mono/400.css';
@import '@fontsource/jetbrains-mono/500.css';

@tailwind base;
@tailwind components;
@tailwind utilities;

/* shadcn/ui CSS variables */
:root {
  --background:           0 0% 100%;
  --foreground:           222 47% 11%;
  --card:                 0 0% 100%;
  --card-foreground:      222 47% 11%;
  --popover:              0 0% 100%;
  --popover-foreground:   222 47% 11%;
  --primary:              243 75% 59%;
  --primary-foreground:   0 0% 100%;
  --secondary:            214 32% 91%;
  --secondary-foreground: 215 25% 27%;
  --muted:                214 32% 91%;
  --muted-foreground:     215 16% 47%;
  --accent:               226 100% 97%;
  --accent-foreground:    243 75% 59%;
  --destructive:          0 72% 51%;
  --destructive-foreground: 0 0% 100%;
  --border:               214 32% 91%;
  --input:                214 32% 91%;
  --ring:                 243 75% 59%;
  --radius:               0.5rem;
}

@layer base {
  *, *::before, *::after { box-sizing: border-box; }

  html {
    font-size: 14px;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: optimizeLegibility;
  }

  body {
    background-color: #FFFFFF;
    color: #334155;
    font-family: theme('fontFamily.sans');
    line-height: 1.571;
  }

  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: #E2E8F0;
    border-radius: 9999px;
  }
  ::-webkit-scrollbar-thumb:hover { background: #CBD5E1; }

  *:focus { outline: none; }
  *:focus-visible {
    outline: 2px solid #4F46E5;
    outline-offset: 2px;
    border-radius: 4px;
  }

  h1 { font-size: 24px; font-weight: 700; letter-spacing: -0.5px;
       color: #0F172A; line-height: 1.25; }
  h2 { font-size: 18px; font-weight: 600; letter-spacing: -0.3px;
       color: #0F172A; line-height: 1.35; }
  h3 { font-size: 15px; font-weight: 600; color: #1E293B; line-height: 1.4; }
  h4 { font-size: 14px; font-weight: 600; color: #1E293B; }
}

@layer components {
  /* Cards */
  .card         { @apply bg-white border border-slate-200 rounded-lg shadow-xs; }
  .card-hover   { @apply card transition-all duration-150 hover:border-slate-300 hover:shadow-sm cursor-pointer; }
  .card-subtle  { @apply bg-slate-50 border border-slate-200 rounded-lg; }
  .card-elevated{ @apply bg-white border border-slate-200 rounded-xl shadow-lg; }

  /* Metric tile */
  .metric-tile  { @apply card p-4 flex flex-col gap-1; }
  .metric-value { @apply text-3xl font-bold text-slate-900 tracking-tight; }
  .metric-label { @apply text-xs font-medium text-slate-400 uppercase tracking-widest; }

  /* Section headers (task/goal groupings) */
  .section-header {
    @apply text-xs font-semibold text-slate-400 uppercase tracking-widest
           pt-3 pb-1.5 border-t border-slate-100 mt-1;
  }
  .section-header:first-of-type { @apply border-t-0 pt-0; }

  /* Badges */
  .badge { @apply inline-flex items-center px-1.5 py-0.5 rounded-xs text-xs font-medium leading-none; }
  .badge-urgent      { @apply badge bg-danger-light  text-danger; }
  .badge-high        { @apply badge bg-warning-light text-warning; }
  .badge-medium      { @apply badge bg-slate-100 text-slate-600; }
  .badge-low         { @apply badge text-slate-400; }
  .badge-todo        { @apply badge bg-slate-100 text-slate-600; }
  .badge-in_progress { @apply badge bg-primary-50 text-primary-700; }
  .badge-done        { @apply badge bg-success-light text-success; }
  .badge-cancelled   { @apply badge text-slate-400; }
  .badge-active      { @apply badge bg-success-light text-success; }
  .badge-paused      { @apply badge bg-warning-light text-warning; }
  .badge-archived    { @apply badge text-slate-400; }
  .badge-completed   { @apply badge bg-success-light text-success; }

  /* Tags */
  .tag {
    @apply inline-flex items-center px-2 py-0.5 rounded-full
           text-xs font-medium font-mono
           bg-primary-50 text-primary-700 border border-primary-200;
  }

  /* AI chat messages */
  .msg-user {
    @apply self-end max-w-[78%] bg-primary-50 border border-primary-200
           rounded-xl rounded-br-sm px-3.5 py-2.5 text-base text-slate-800;
  }
  .msg-assistant {
    @apply self-start max-w-[85%] bg-white border border-slate-200 shadow-xs
           rounded-xl rounded-tl-sm px-3.5 py-2.5 text-base text-slate-800;
  }
  .msg-tool {
    @apply self-start max-w-[85%] bg-slate-50 border border-slate-200 rounded-md
           px-2.5 py-1.5 text-xs text-slate-500 cursor-pointer
           hover:border-slate-300 transition-colors duration-100;
  }

  /* Habit grid cells */
  .habit-cell-done          { @apply bg-success text-white; }
  .habit-cell-missed        { @apply bg-slate-100 text-slate-300; }
  .habit-cell-today-pending { @apply bg-white border-2 border-primary text-primary font-medium; }
  .habit-cell-today-done    { @apply bg-success text-white ring-2 ring-success ring-offset-1; }
  .habit-cell-empty         { @apply bg-transparent; }
}

@layer utilities {
  .text-balance { text-wrap: balance; }
  .streaming-cursor {
    @apply inline-block w-0.5 h-3.5 bg-primary rounded-sm align-middle ml-0.5 animate-pulse;
  }
}
```

### `src/lib/theme.ts` — exact file content

```typescript
export const colors = {
  primary: {
    DEFAULT: '#4F46E5', 50: '#EEF2FF', 100: '#E0E7FF', 200: '#C7D2FE',
    300: '#A5B4FC', 400: '#818CF8', 500: '#6366F1', 600: '#4F46E5',
    700: '#4338CA', 800: '#3730A3', 900: '#312E81',
  },
  slate: {
    50: '#F8FAFC', 100: '#F1F5F9', 200: '#E2E8F0', 300: '#CBD5E1',
    400: '#94A3B8', 500: '#64748B', 600: '#475569', 700: '#334155',
    800: '#1E293B', 900: '#0F172A',
  },
  success: { light: '#D1FAE5', DEFAULT: '#059669', dark: '#047857' },
  warning: { light: '#FEF3C7', DEFAULT: '#D97706', dark: '#B45309' },
  danger:  { light: '#FEE2E2', DEFAULT: '#DC2626', dark: '#B91C1C' },
  event: {
    meeting:   '#3B82F6',
    personal:  '#8B5CF6',
    reminder:  '#F59E0B',
    task_block:'#10B981',
    google:    '#94A3B8',
  },
} as const

export const priority = {
  urgent: { bg: '#FEE2E2', text: '#DC2626' },
  high:   { bg: '#FEF3C7', text: '#D97706' },
  medium: { bg: '#F1F5F9', text: '#475569' },
  low:    { bg: 'transparent', text: '#94A3B8' },
} as const

export const taskStatus = {
  todo:        { bg: '#F1F5F9', text: '#475569', label: 'To Do' },
  in_progress: { bg: '#EEF2FF', text: '#4F46E5', label: 'In Progress' },
  done:        { bg: '#D1FAE5', text: '#059669', label: 'Done' },
  cancelled:   { bg: 'transparent', text: '#94A3B8', label: 'Cancelled' },
} as const

export const goalStatus = {
  active:    { bg: '#D1FAE5', text: '#059669', label: 'Active' },
  paused:    { bg: '#FEF3C7', text: '#D97706', label: 'Paused' },
  completed: { bg: '#D1FAE5', text: '#059669', label: 'Completed' },
  archived:  { bg: 'transparent', text: '#94A3B8', label: 'Archived' },
} as const

// For Recharts and chart libraries — use in order
export const chartPalette = [
  '#4F46E5', // primary
  '#10B981', // emerald
  '#3B82F6', // blue
  '#F59E0B', // amber
  '#8B5CF6', // violet
  '#DC2626', // red
] as const
```

### `src/types/index.ts` — TypeScript types

```typescript
// Mirrors the Python SQLAlchemy schema exactly

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled'
export type Priority = 'low' | 'medium' | 'high' | 'urgent'
export type EnergyLevel = 'low' | 'medium' | 'high'
export type GoalStatus = 'active' | 'paused' | 'completed' | 'archived'
export type ProgressMode = 'manual' | 'auto'
export type HabitFrequency = 'daily' | 'weekdays' | 'weekly' | 'custom'
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'anytime'
export type EventType = 'task_block' | 'meeting' | 'personal' | 'reminder' | 'google_import'
export type EventSource = 'local' | 'google'
export type MessageRole = 'user' | 'assistant' | 'tool'

export interface Task {
  id: number
  title: string
  description?: string
  status: TaskStatus
  priority: Priority
  due_date?: string          // ISO date: YYYY-MM-DD
  project_id?: number
  scheduled_at?: string      // ISO datetime
  estimated_minutes?: number
  energy_level?: EnergyLevel
  tags?: string              // comma-separated
  created_at: string
  updated_at: string
  deleted_at?: string
}

export interface Goal {
  id: number
  title: string
  description?: string
  status: GoalStatus
  target_date?: string
  progress_pct: number
  progress_mode: ProgressMode
  parent_id?: number
  created_at: string
  updated_at: string
  deleted_at?: string
  tasks?: Task[]
  subgoals?: Goal[]
}

export interface CalendarEvent {
  id: number
  title: string
  description?: string
  event_type: EventType
  start_datetime: string
  end_datetime: string
  location?: string
  task_id?: number
  is_recurring: boolean
  recurrence_rule?: string
  source: EventSource
  google_event_id?: string
  google_calendar_id?: string
  is_read_only: boolean
  sync_stale: boolean
  created_at: string
  deleted_at?: string
}

export interface Habit {
  id: number
  title: string
  description?: string
  frequency: HabitFrequency
  target_days?: string       // JSON array of day indices 0=Mon
  time_of_day: TimeOfDay
  streak_current: number
  streak_best: number
  is_active: boolean
  created_at: string
}

export interface HabitCompletion {
  id: number
  habit_id: number
  completed_date: string     // ISO date
  completed_at: string
  note?: string
}

export interface UserPreference {
  key: string
  value: string
  updated_at: string
}

export interface AIMessage {
  role: MessageRole
  content: string
}

// API request/response shapes
export interface CreateTaskRequest {
  title: string
  description?: string
  status?: TaskStatus
  priority?: Priority
  due_date?: string
  project_id?: number
  estimated_minutes?: number
  energy_level?: EnergyLevel
  tags?: string
}

export interface UpdateTaskRequest extends Partial<CreateTaskRequest> {
  scheduled_at?: string
}

export interface CreateGoalRequest {
  title: string
  description?: string
  status?: GoalStatus
  target_date?: string
  progress_pct?: number
  progress_mode?: ProgressMode
  parent_id?: number
}

export interface CreateEventRequest {
  title: string
  start_datetime: string
  end_datetime: string
  description?: string
  event_type?: EventType
  location?: string
  task_id?: number
}

export interface CreateHabitRequest {
  title: string
  description?: string
  frequency?: HabitFrequency
  target_days?: string
  time_of_day?: TimeOfDay
}

export interface ChatRequest {
  messages: AIMessage[]
  session_id: string
}
```

### AppShell, Sidebar, TopBar implementation

**`src/components/layout/Sidebar.tsx`**

```tsx
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, CheckSquare, Target, CalendarDays,
  Repeat2, Bot, BarChart2, Settings2,
} from 'lucide-react'

const navItems = [
  { to: '/',          icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/tasks',     icon: CheckSquare,     label: 'Tasks' },
  { to: '/goals',     icon: Target,          label: 'Goals' },
  { to: '/calendar',  icon: CalendarDays,    label: 'Calendar' },
  { to: '/habits',    icon: Repeat2,         label: 'Habits' },
  { to: '/ai',        icon: Bot,             label: 'AI Assistant' },
  { to: '/analytics', icon: BarChart2,       label: 'Analytics' },
  { to: '/settings',  icon: Settings2,       label: 'Settings' },
]

export function Sidebar() {
  return (
    <aside className="fixed top-0 left-0 h-screen w-[240px] bg-slate-50
                      border-r border-slate-200 flex flex-col z-20">

      {/* Brand */}
      <div className="h-[52px] flex items-center px-4 border-b border-slate-200 shrink-0">
        <div>
          <div className="text-base font-bold text-slate-900 tracking-tight leading-none">
            Planner
          </div>
          <div className="text-xs font-medium text-slate-400 uppercase tracking-widest
                          leading-none mt-0.5">
            Personal
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="flex flex-col gap-0.5">
          {navItems.map(({ to, icon: Icon, label }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-2.5 h-8 rounded-sm text-sm font-medium
                   transition-colors duration-100 select-none
                   ${isActive
                     ? 'bg-primary-50 text-primary-600 font-semibold'
                     : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                   }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      size={16}
                      strokeWidth={1.75}
                      className={isActive ? 'text-primary-600' : 'text-slate-400'}
                    />
                    {label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* Bottom */}
      <div className="h-[48px] border-t border-slate-200 flex items-center px-4">
        <span className="text-xs text-slate-400">v2.0</span>
      </div>
    </aside>
  )
}
```

**`src/components/layout/TopBar.tsx`**

```tsx
interface TopBarProps {
  title: string
  action?: React.ReactNode
}

export function TopBar({ title, action }: TopBarProps) {
  return (
    <header className="h-[56px] bg-white border-b border-slate-200
                       flex items-center justify-between px-8
                       sticky top-0 z-10">
      <h1 className="text-xl font-semibold text-slate-900 tracking-tight">
        {title}
      </h1>
      {action && <div>{action}</div>}
    </header>
  )
}
```

**`src/components/layout/AppShell.tsx`**

```tsx
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

interface AppShellProps {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}

export function AppShell({ title, action, children }: AppShellProps) {
  return (
    <div className="flex min-h-screen bg-white">
      <Sidebar />
      <div className="ml-[240px] flex-1 flex flex-col min-h-screen">
        <TopBar title={title} action={action} />
        <main className="flex-1 p-8 max-w-[1200px] w-full">
          {children}
        </main>
      </div>
    </div>
  )
}
```

**`src/App.tsx`**

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Dashboard }    from './pages/Dashboard'
import { Tasks }        from './pages/Tasks'
import { Goals }        from './pages/Goals'
import { Calendar }     from './pages/Calendar'
import { Habits }       from './pages/Habits'
import { AIAssistant }  from './pages/AIAssistant'
import { Analytics }    from './pages/Analytics'
import { Settings }     from './pages/Settings'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"          element={<Dashboard />} />
        <Route path="/tasks"     element={<Tasks />} />
        <Route path="/goals"     element={<Goals />} />
        <Route path="/calendar"  element={<Calendar />} />
        <Route path="/habits"    element={<Habits />} />
        <Route path="/ai"        element={<AIAssistant />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/settings"  element={<Settings />} />
      </Routes>
    </BrowserRouter>
  )
}
```

Each stub page (e.g., `Tasks.tsx`):
```tsx
import { AppShell } from '../components/layout/AppShell'

export function Tasks() {
  return (
    <AppShell title="Tasks">
      <p className="text-slate-400">Tasks page — coming in Sprint 3</p>
    </AppShell>
  )
}
```

### `src/lib/api.ts` — typed API client (stub)

```typescript
// Typed API client — routes populated in Sprint 1 & 3
// All paths are relative (/api/...) — Vite proxies to localhost:8000

const BASE = '/api'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`)
  return res.json()
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`)
  return res.json()
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`PUT ${path} failed: ${res.status}`)
  return res.json()
}

async function del(path: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`)
}

export const api = { get, post, put, del }
```

---

## Sprint 1 Preview — FastAPI Backend

Sprint 1 creates `backend/main.py` and all routers. Full spec will be in CURRENT SPRINT
when Sprint 0 is complete. Key points to know now:

The backend keeps every Python file from v1 **unchanged**. FastAPI wraps the existing
`crud.py` functions in HTTP routes. No business logic lives in the routers.

New `backend/requirements.txt` (replaces old one):
```
fastapi>=0.110.0
uvicorn[standard]>=0.27.0
sqlalchemy>=2.0.0
anthropic>=0.25.0
arrow>=1.3.0
python-dotenv>=1.0.0
google-api-python-client>=2.100.0
google-auth-oauthlib>=1.1.0
google-auth-httplib2>=0.1.1
```

Sprint 1 also fixes these bugs in Python (unchanged from previous plan):
- N+1 habit completions query → `get_habit_completions_bulk()` in crud.py
- Add `UserPreferences` table to schema.py + crud.py
- Fix `_load_session` → now done in the FastAPI AI router, not the frontend
- Fix habit streak logic for non-daily habits
- Harden NL quick-add parser (now a FastAPI endpoint, not Streamlit)
- Fix duplicate calendar edit form code

---

## Sprint 2 Preview — Agent Upgrades

Touches only `backend/agent/agent.py` and `backend/agent/tools.py`:
- Dynamic system prompt with live context (depends on Sprint 1 N+1 fix)
- `apply_schedule` bulk tool
- `set_user_preference` / `get_user_preferences` tools
- Streaming via `StreamingResponse` in `backend/routers/ai.py`
- Context window truncation
- Raise `_MAX_ITERATIONS` to 20

---

## Sprint 3 Preview — React Pages

Build all 7 page implementations in `frontend/src/pages/`.
Each page fetches from the FastAPI backend via `src/lib/api.ts`.
Full spec in CURRENT SPRINT when Sprint 2 is complete.

---

## Sprint 4 Preview — Analytics (Assignment Deliverable)

The second non-straightforward LLM feature:
- Python: aggregate CRUD functions + FastAPI endpoint + LLM structured JSON output
- React: Recharts visualisations + insights panel
- Non-straightforward: data aggregation → LLM → structured JSON parsing → visual highlighting
Full spec in CURRENT SPRINT when Sprint 3 is complete.

---

## Critical Rules — Never Violate

- **Python 3.9:** `Optional[X]` always. No `X | Y` union syntax.
- **All DB access via `crud.py`:** No direct ORM queries anywhere else.
- **Habits use `is_active`, not `deleted_at`:** Archive ≠ soft-delete.
- **Tasks/Goals/Events use `deleted_at`:** Soft delete only.
- **`execute_tool()` never raises:** Always returns `{"error": "..."}` on failure.
- **`is_read_only` events:** Never allow edits. CRUD layer enforces with `PermissionError`.
- **Optimistic locking (UI only):** UI passes `current_updated_at`; agent does not.
- **FastAPI routers are thin:** No business logic in routers. All logic stays in crud.py / agent/.
- **Scope rule:** Only touch files in the current sprint's scope.
- **TypeScript:** No `any` types. Every API response typed against `src/types/index.ts`.
- **Components:** All styling via Tailwind utility classes. No inline `style={{}}` except for
  dynamic values (colours from `theme.ts`, chart dimensions).

---

## Database Schema Reference

All unchanged from v1. Full schema documented below for reference when writing FastAPI
Pydantic response models and TypeScript types.

**`tasks`** — soft delete (`deleted_at`), optimistic locking (`updated_at`)
Fields: `id`, `title`, `description`, `status`, `priority`, `due_date`, `project_id`,
`scheduled_at`, `estimated_minutes`, `energy_level`, `tags`, `created_at`, `updated_at`, `deleted_at`

**`goals`** — soft delete, optimistic locking, self-referential (`parent_id`)
Fields: `id`, `title`, `description`, `status`, `target_date`, `progress_pct`,
`progress_mode`, `parent_id`, `created_at`, `updated_at`, `deleted_at`
Auto-progress: when `progress_mode="auto"`, `progress_pct` recalculates from linked task completion.

**`calendar_events`** — soft delete (local only), read-only for Google events
Fields: `id`, `title`, `description`, `event_type`, `start_datetime`, `end_datetime`,
`location`, `task_id`, `is_recurring`, `recurrence_rule`, `source`, `google_event_id`,
`google_calendar_id`, `is_read_only`, `sync_stale`, `created_at`, `deleted_at`

**`habits`** — `is_active` flag (not `deleted_at`), no soft delete
Fields: `id`, `title`, `description`, `frequency`, `target_days` (JSON int array),
`time_of_day`, `streak_current`, `streak_best`, `is_active`, `created_at`

**`habit_completions`**
Fields: `id`, `habit_id`, `completed_date`, `completed_at`, `note`
`mark_habit_complete()` is idempotent.

**`ai_conversation_history`**
Fields: `id`, `session_id`, `role` (user|assistant|tool), `content`, `tool_name`,
`token_count`, `created_at`

**`user_preferences`** — NEW (added Sprint 1)
Fields: `key` (PK), `value`, `updated_at`

---

## Completed Log

| Sprint | Date | Notes |
|---|---|---|
| v1 Phases 1–11 | Feb 2026 | Full Streamlit prototype — all 11 phases complete |
| Stack decision | Mar 2026 | Moved from Streamlit to FastAPI + React + Tailwind + shadcn/ui |
| Design spec | Mar 2026 | Full design system defined (productivity_planner_design_spec.md) |
| Sprint 0 | Mar 2026 | Frontend scaffold, design system, all stubs — complete |
| Sprint 1 | Mar 2026 | FastAPI backend, all 7 routers, bug fixes — complete |
| Sprint 2 | Mar 2026 | Agent upgrades, streaming SSE, context truncation — complete |
| Sprint 3 | Mar 2026 | All 8 React pages fully implemented, React Query, Toaster — complete |
