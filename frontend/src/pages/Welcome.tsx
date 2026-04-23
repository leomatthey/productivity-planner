import { Link } from 'react-router-dom'
import {
  Calendar, Sparkles, BarChart2, Target, CheckSquare, Repeat2,
  Settings2, Database, ArrowRight,
} from 'lucide-react'
import { Logo } from '../components/brand/Logo'

// ---------------------------------------------------------------------------
// Welcome / landing page — first impression for new visitors and a permanent
// "About this app" surface for returning users (sidebar logo links here).
// ---------------------------------------------------------------------------

interface FeatureCardProps {
  icon: React.ComponentType<{ size?: number; className?: string }>
  title: string
  description: string
  accent: 'primary' | 'emerald' | 'amber'
}

const ACCENT_CLASSES: Record<FeatureCardProps['accent'], { bg: string; text: string }> = {
  primary: { bg: 'bg-primary-50',   text: 'text-primary-600' },
  emerald: { bg: 'bg-emerald-50',   text: 'text-emerald-600' },
  amber:   { bg: 'bg-amber-50',     text: 'text-amber-600' },
}

function FeatureCard({ icon: Icon, title, description, accent }: FeatureCardProps) {
  const classes = ACCENT_CLASSES[accent]
  return (
    <div className="card p-6 hover:shadow-md transition-shadow">
      <div className={`w-12 h-12 rounded-xl ${classes.bg} flex items-center justify-center mb-4`}>
        <Icon size={22} className={classes.text} />
      </div>
      <h3 className="text-base font-semibold text-slate-900 mb-1.5">{title}</h3>
      <p className="text-sm text-slate-600 leading-relaxed">{description}</p>
    </div>
  )
}

interface StepCardProps {
  step: number
  icon: React.ComponentType<{ size?: number; className?: string }>
  title: string
  description: string
}

function StepCard({ step, icon: Icon, title, description }: StepCardProps) {
  return (
    <div className="flex items-start gap-4">
      <div className="shrink-0 w-9 h-9 rounded-full bg-primary text-white text-sm font-bold flex items-center justify-center">
        {step}
      </div>
      <div className="flex-1 pt-1">
        <div className="flex items-center gap-2 mb-1">
          <Icon size={15} className="text-slate-400" />
          <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
        </div>
        <p className="text-sm text-slate-600 leading-relaxed">{description}</p>
      </div>
    </div>
  )
}

export function Welcome() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-primary-50/30 to-white">
      {/* Top header — always visible */}
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Logo size={22} className="text-primary" />
            <span className="text-base font-bold text-slate-900 tracking-tight">Stride</span>
          </div>
          <Link
            to="/"
            className="flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary-700 transition-colors"
          >
            Open the app
            <ArrowRight size={14} />
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-3xl mx-auto px-6 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-1.5 bg-primary-50 text-primary-700 text-xs font-medium px-3 py-1.5 rounded-full mb-6">
          <Sparkles size={12} />
          AI-augmented productivity
        </div>
        <h1 className="text-5xl font-bold text-slate-900 tracking-tight mb-5 leading-[1.1]">
          The planner that<br />
          <span className="text-primary">thinks with you.</span>
        </h1>
        <p className="text-lg text-slate-600 leading-relaxed mb-8 max-w-xl mx-auto">
          Stride pairs a calm, well-designed planner with a Claude-powered assistant that
          reads, writes, and reasons across your tasks, projects, habits, and calendar.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            to="/settings"
            className="inline-flex items-center gap-2 bg-primary text-white text-sm font-semibold
                       px-5 py-2.5 rounded-lg hover:bg-primary-700 transition-colors shadow-sm"
          >
            Get started
            <ArrowRight size={15} />
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700
                       px-5 py-2.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            Skip to the dashboard
          </Link>
        </div>
      </section>

      {/* Three-feature overview */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold text-slate-900 mb-2">
            One app for everything you're trying to get done.
          </h2>
          <p className="text-sm text-slate-500 max-w-xl mx-auto">
            Plan ambitiously, schedule honestly, and reflect with real signal — not vanity metrics.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <FeatureCard
            icon={Target}
            title="Plan"
            description="Projects with subprojects, tasks with priorities, durations, and energy levels. The assistant can plan whole project structures from a single prompt."
            accent="primary"
          />
          <FeatureCard
            icon={Calendar}
            title="Schedule"
            description="Google Calendar synced in. Drag tasks onto open slots. The smart scheduler proposes time blocks and you confirm — never overbooked."
            accent="emerald"
          />
          <FeatureCard
            icon={BarChart2}
            title="Reflect"
            description="Project health board with RAG status. Time-allocation donut. AI-generated insights that name specific projects and habits — never generic."
            accent="amber"
          />
        </div>
      </section>

      {/* Get started */}
      <section className="max-w-3xl mx-auto px-6 py-16">
        <div className="card p-8">
          <div className="flex items-center gap-2 text-xs font-semibold text-primary uppercase tracking-widest mb-2">
            <Settings2 size={12} />
            Get started in three steps
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-6">
            From empty to demo-ready in under a minute.
          </h2>
          <div className="space-y-6">
            <StepCard
              step={1}
              icon={Calendar}
              title="Connect Google Calendar (optional)"
              description="In Settings, link your Google account so the planner can see your real meetings and avoid scheduling task blocks on top of them."
            />
            <StepCard
              step={2}
              icon={Database}
              title="Click 'Reset & Seed Demo Data'"
              description="Loads a rich, deterministic dataset — projects with subprojects, scheduled tasks, 30 days of habit history, and calendar blocks placed around any Google events."
            />
            <StepCard
              step={3}
              icon={CheckSquare}
              title="Explore"
              description="Open Dashboard for today's plan, Projects to see hierarchy + AI assistant, or jump into Analytics for the executive overview."
            />
          </div>
          <div className="mt-8 flex items-center gap-3">
            <Link
              to="/settings"
              className="inline-flex items-center gap-2 bg-primary text-white text-sm font-semibold
                         px-4 py-2 rounded-lg hover:bg-primary-700 transition-colors"
            >
              Open Settings
              <ArrowRight size={14} />
            </Link>
            <Link
              to="/"
              className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700
                         px-4 py-2 rounded-lg hover:bg-slate-100 transition-colors"
            >
              Or jump to the dashboard
            </Link>
          </div>
        </div>
      </section>

      {/* Tab quick-tour */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold text-slate-900 mb-2">What's in the app</h2>
          <p className="text-sm text-slate-500">
            Each tab is purpose-built. A short explainer pops up the first time you visit each one.
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          {[
            { to: '/',          icon: Sparkles,   label: 'Dashboard',     hint: 'Today at a glance' },
            { to: '/tasks',     icon: CheckSquare,label: 'Tasks',         hint: 'Capture & complete' },
            { to: '/projects',  icon: Target,     label: 'Projects',      hint: 'Goals & subprojects' },
            { to: '/calendar',  icon: Calendar,   label: 'Calendar',      hint: 'Schedule + Google sync' },
            { to: '/habits',    icon: Repeat2,    label: 'Habits',        hint: 'Streaks & consistency' },
            { to: '/ai',        icon: Sparkles,   label: 'AI Assistant',  hint: 'Full Claude chat' },
            { to: '/analytics', icon: BarChart2,  label: 'Analytics',     hint: 'Health & insights' },
            { to: '/settings',  icon: Settings2,  label: 'Settings',      hint: 'Prefs · Google · Seed' },
          ].map(t => (
            <Link
              key={t.to}
              to={t.to}
              className="card p-4 hover:border-primary-200 hover:shadow-sm transition-all group"
            >
              <div className="flex items-center gap-2 mb-1">
                <t.icon size={14} className="text-primary group-hover:text-primary-700" />
                <span className="font-semibold text-slate-900">{t.label}</span>
              </div>
              <p className="text-xs text-slate-500">{t.hint}</p>
            </Link>
          ))}
        </div>
      </section>

      <footer className="max-w-5xl mx-auto px-6 py-10 text-center">
        <p className="text-xs text-slate-400">
          Stride · Productivity AI · Built for the PDAI submission
        </p>
      </footer>
    </div>
  )
}
