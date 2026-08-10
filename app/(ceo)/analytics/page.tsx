import 'server-only'

import { requireRole } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  getRevenueSnapshot,
  getAttendanceSnapshot,
  getSalesTrend,
  getProjectPortfolio,
  PENDING_SOURCES,
} from '@/lib/departments/contracts'
import { AwaitingModule, Card, CardHeader, StatCard } from '@/components/ui/primitives'
import { AnalyticsTabs } from '@/components/ceo/Analytics/AnalyticsTabs'
import { isOverdue } from '@/lib/format'
import type { TaskStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function AnalyticsPage() {
  const user = await requireRole('CEO')
  const supabase = await createSupabaseServerClient()

  const [taskRes, revenueSnap, attendance, salesTrend, projects] = await Promise.all([
    supabase
      .from('tasks')
      .select('id, status, due_date, priority, assigned_department_id, departments(name)')
      .eq('organization_id', user.organization_id)
      .neq('status', 'archived')
      .limit(2000),
    getRevenueSnapshot(user.organization_id),
    getAttendanceSnapshot(user.organization_id),
    getSalesTrend(user.organization_id),
    getProjectPortfolio(user.organization_id),
  ])

  type RawTask = {
    id: string
    status: TaskStatus
    due_date: string | null
    priority: string
    assigned_department_id: string
    departments: { name: string } | null
  }
  const tasks = (taskRes.data ?? []) as unknown as RawTask[]

  const taskStats = {
    total: tasks.length,
    pending: tasks.filter((t) => t.status === 'pending').length,
    inProgress: tasks.filter((t) => t.status === 'in_progress').length,
    delayed: tasks.filter((t) => t.status === 'delayed').length,
    completed: tasks.filter((t) => t.status === 'completed').length,
    overdue: tasks.filter((t) => isOverdue({ due_date: t.due_date, status: t.status })).length,
  }

  // department-level breakdown of overdue counts
  const deptOverdue = new Map<string, { name: string; count: number }>()
  for (const task of tasks) {
    if (isOverdue({ due_date: task.due_date, status: task.status })) {
      const key = task.assigned_department_id
      const current = deptOverdue.get(key) ?? { name: task.departments?.name ?? '—', count: 0 }
      deptOverdue.set(key, { ...current, count: current.count + 1 })
    }
  }
  const topDelayed = [...deptOverdue.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  const priorityBreakdown = {
    urgent: tasks.filter((t) => t.priority === 'urgent').length,
    high: tasks.filter((t) => t.priority === 'high').length,
    medium: tasks.filter((t) => t.priority === 'medium').length,
    low: tasks.filter((t) => t.priority === 'low').length,
  }

  const completionRate =
    taskStats.total > 0 ? Math.round((taskStats.completed / taskStats.total) * 100) : 0

  const KPI_CARDS = [
    { label: 'Total Tasks', value: taskStats.total, tone: 'default' as const, icon: '📋' },
    { label: 'Pending', value: taskStats.pending, tone: 'default' as const, icon: '⏳' },
    { label: 'In Progress', value: taskStats.inProgress, tone: 'default' as const, icon: '🔄' },
    { label: 'Delayed', value: taskStats.delayed, tone: taskStats.delayed > 0 ? 'warning' as const : 'default' as const, icon: '⚠️' },
    { label: 'Overdue', value: taskStats.overdue, tone: taskStats.overdue > 0 ? 'danger' as const : 'default' as const, icon: '🔴' },
    { label: 'Completed', value: taskStats.completed, tone: 'success' as const, icon: '✅' },
  ]

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-brand-slate">Analytics</h1>
          <p className="mt-1 text-sm text-text-muted">
            Task metrics are live · Other modules show awaiting state until connected.
          </p>
        </div>
        <div className="rounded-xl border border-border-subtle bg-white px-4 py-3 text-center shadow-sm">
          <p className="text-2xl font-bold text-brand-slate">{completionRate}%</p>
          <p className="text-xs text-text-muted">Completion rate</p>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {KPI_CARDS.map((kpi) => (
          <StatCard key={kpi.label} label={kpi.label} value={kpi.value} tone={kpi.tone} />
        ))}
      </div>

      {/* Charts */}
      <AnalyticsTabs
        taskStats={taskStats}
        priorityBreakdown={priorityBreakdown}
        topDelayed={topDelayed}
        revenueSnapshot={revenueSnap}
        attendance={attendance}
        salesTrend={salesTrend}
        projectPortfolio={projects}
        pendingSources={PENDING_SOURCES}
      />
    </div>
  )
}
