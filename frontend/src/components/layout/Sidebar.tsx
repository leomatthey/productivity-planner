import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, CheckSquare, Target, CalendarDays,
  Repeat2, Bot, BarChart2, Settings2,
} from 'lucide-react'

const navItems = [
  { to: '/',          icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/tasks',     icon: CheckSquare,     label: 'Tasks' },
  { to: '/projects',  icon: Target,          label: 'Projects' },
  { to: '/calendar',  icon: CalendarDays,    label: 'Calendar' },
  { to: '/habits',    icon: Repeat2,         label: 'Habits' },
  { to: '/ai',        icon: Bot,             label: 'AI Assistant' },
  { to: '/analytics', icon: BarChart2,       label: 'Analytics' },
  { to: '/settings',  icon: Settings2,       label: 'Settings' },
]

export function Sidebar() {
  return (
    <aside className="fixed top-0 left-0 h-screen w-[240px] bg-slate-50 dark:bg-slate-800
                      border-r border-slate-200 dark:border-slate-700 flex flex-col z-20">

      {/* Brand */}
      <div className="h-[52px] flex items-center px-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
        <div>
          <div className="text-base font-bold text-slate-900 dark:text-slate-100 tracking-tight leading-none">
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
                     ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 font-semibold'
                     : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100'
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
      <div className="h-[48px] border-t border-slate-200 dark:border-slate-700 flex items-center px-4">
        <span className="text-xs text-slate-400">v2.0</span>
      </div>
    </aside>
  )
}
