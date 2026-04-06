import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

interface AppShellProps {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}

export function AppShell({ title, action, children }: AppShellProps) {
  return (
    <div className="flex min-h-screen bg-white dark:bg-slate-900">
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
