interface TopBarProps {
  title: string
  action?: React.ReactNode
}

export function TopBar({ title, action }: TopBarProps) {
  return (
    <header className="h-[56px] bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700
                       flex items-center justify-between px-8
                       sticky top-0 z-10">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
        {title}
      </h1>
      {action && <div>{action}</div>}
    </header>
  )
}
