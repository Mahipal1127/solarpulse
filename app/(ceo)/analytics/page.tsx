import 'server-only'

import { requireRole } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  getRevenueSnapshot,
  getAttendanceSnapshot,
  getSalesTrend,
  getProjectPortfolio,
  getPipelineFunnel,
  PENDING_SOURCES,
} from '@/lib/departments/contracts'
import { getCrossDepartmentMetrics } from '@/lib/ceo/metrics'
import { StatCard } from '@/components/ui/primitives'
import { AnalyticsTabs } from '@/components/ceo/Analytics/AnalyticsTabs'
import { DepartmentMetrics } from '@/components/ceo/Dashboard/DepartmentMetrics'
import { KPIPerformanceChart } from '@/components/ceo/Dashboard/KPIPerformanceChart'
import { TimeWorkedChart } from '@/components/ceo/Dashboard/TimeWorkedChart'
import { EmploymentStatusWidget } from '@/components/ceo/Dashboard/EmploymentStatusWidget'
import { ScheduleWidget } from '@/components/ceo/Dashboard/ScheduleWidget'
import { AISummaryCard } from '@/components/ceo/Dashboard/AISummaryCard'
import { buildDailySummary } from '@/lib/ai/summary'
import { isOverdue } from '@/lib/format'
import {
  ListChecks,
  Clock,
  Loader,
  AlertTriangle,
  CircleAlert,
  CircleCheck,
} from 'lucide-react'
import type { TaskStatus, TaskPriority, ApprovalStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * Everything measurable about the business, in one place.
 *
 * WHY THIS PAGE ABSORBED THE DASHBOARD
 * The charts, the KPI row and the cross-department tiles below used to live on
 * /dashboard, which meant there were two places to look at numbers and neither held
 * all of them. The dashboard is now the assistant, and this is the analytics surface —
 * so a question ("how is Sales doing?") and its evidence no longer sit on separate
 * pages competing to be the same thing.
 *
 * DEEP, BUT ORDERED
 * Read top to bottom it goes: headline task counts → the business beyond tasks →
 * trends over time → per-department and per-status breakdowns. Each band answers one
 * question, so depth comes from going further down rather than from density. The tabs
 * at the bottom hold the module-specific detail that only matters once you know which
 * module you care about.
 */
export default async function AnalyticsPage() {
  const user = await requireRole('CEO')
  const supabase = await createSupabaseServerClient()

  const now = new Date()
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const todayISO = todayStart.toISOString()
  const tomorrowISO = new Date(todayStart.getTime() + 86_400_000).toISOString()

  const [
    taskRes,
    approvalRes,
    summaryResult,
    deptMetrics,
    revenueSnap,
    attendance,
    salesTrend,
    projects,
    pipeline,
  ] = await Promise.all([
    supabase
      .from('tasks')
      .select(
        'id, status, due_date, priority, created_at, completed_at, assigned_department_id, departments(name)'
      )
      .eq('organization_id', user.organization_id)
      .neq('status', 'archived')
      .limit(2000),

    supabase
      .from('approvals')
      .select(
        `id, approval_type, status, created_at, notes,
         requester:users!approvals_requested_by_fkey(full_name),
         departments(name)`
      )
      .eq('organization_id', user.organization_id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(20),

    buildDailySummary(user),
    getCrossDepartmentMetrics(user.organization_id),
    getRevenueSnapshot(user.organization_id),
    getAttendanceSnapshot(user.organization_id),
    getSalesTrend(user.organization_id),
    getProjectPortfolio(user.organization_id),
    getPipelineFunnel(user.organization_id),
  ])

  type RawTask = {
    id: string
    status: TaskStatus
    due_date: string | null
    priority: TaskPriority
    created_at: string
    completed_at: string | null
    assigned_department_id: string
    departments: { name: string } | null
  }

  type RawApproval = {
    id: string
    approval_type: string
    status: ApprovalStatus
    created_at: string
    notes: string | null
    requester: { full_name: string } | null
    departments: { name: string } | null
  }

  const tasks = (taskRes.data ?? []) as unknown as RawTask[]
  const pendingApprovals = (approvalRes.data ?? []) as unknown as RawApproval[]
  const { narrative, narrativeUnavailableReason, facts } = summaryResult

  const taskStats = {
    total: tasks.length,
    pending: tasks.filter((t) => t.status === 'pending').length,
    inProgress: tasks.filter((t) => t.status === 'in_progress').length,
    delayed: tasks.filter((t) => t.status === 'delayed').length,
    completed: tasks.filter((t) => t.status === 'completed').length,
    overdue: tasks.filter((t) => isOverdue({ due_date: t.due_date, status: t.status })).length,
    dueToday: tasks.filter(
      (t) =>
        t.due_date && t.due_date >= todayISO && t.due_date < tomorrowISO && t.status !== 'completed'
    ).length,
  }

  const completionRate =
    taskStats.total > 0 ? Math.round((taskStats.completed / taskStats.total) * 100) : 0

  // ── Monthly completion trend (last 12 months) ──────────────────────────────
  const months: { key: string; label: string; total: number; completed: number }[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleString('en-IN', { month: 'short' }),
      total: 0,
      completed: 0,
    })
  }
  const monthMap = new Map(months.map((m) => [m.key, m]))
  for (const task of tasks) {
    const entry = monthMap.get(task.created_at.slice(0, 7))
    if (entry) {
      entry.total += 1
      if (task.status === 'completed') entry.completed += 1
    }
  }
  const monthlyTrend = months.map((m) => ({
    month: m.label,
    value: m.total > 0 ? Math.round((m.completed / m.total) * 100) : 0,
    total: m.total,
  }))

  // ── Weekly activity (last 7 days) ──────────────────────────────────────────
  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const weeklyActivity = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(todayStart)
    d.setDate(d.getDate() - (6 - i))
    const dayStart = d.toISOString()
    const dayEnd = new Date(d.getTime() + 86_400_000).toISOString()
    const dow = d.getDay()
    return {
      day: DAY_LABELS[dow === 0 ? 6 : dow - 1],
      completed: tasks.filter(
        (t) => t.completed_at && t.completed_at >= dayStart && t.completed_at < dayEnd
      ).length,
      created: tasks.filter((t) => t.created_at >= dayStart && t.created_at < dayEnd).length,
    }
  })
  const completedThisWeek = weeklyActivity.reduce((sum, d) => sum + d.completed, 0)

  // ── Overdue by department ──────────────────────────────────────────────────
  const deptOverdue = new Map<string, { name: string; count: number }>()
  for (const task of tasks) {
    if (!isOverdue({ due_date: task.due_date, status: task.status })) continue
    const key = task.assigned_department_id
    const current = deptOverdue.get(key) ?? { name: task.departments?.name ?? '—', count: 0 }
    deptOverdue.set(key, { ...current, count: current.count + 1 })
  }
  const rankedOverdue = [...deptOverdue.values()].sort((a, b) => b.count - a.count)
  const topDelayed = rankedOverdue.slice(0, 5)
  const maxOverdue = rankedOverdue[0]?.count ?? 1

  const priorityBreakdown = {
    urgent: tasks.filter((t) => t.priority === 'urgent').length,
    high: tasks.filter((t) => t.priority === 'high').length,
    medium: tasks.filter((t) => t.priority === 'medium').length,
    low: tasks.filter((t) => t.priority === 'low').length,
  }

  /*
   * Muted grey label glyphs. These previously carried emoji (📋 ⏳ 🔄 ⚠️ 🔴 ✅) in a
   * field StatCard never rendered, so they were invisible either way — and an emoji
   * set brings its own palette, which is the reason the design system uses lucide.
   */
  const KPI_CARDS = [
    { label: 'Total tasks', value: taskStats.total, tone: 'default' as const, Icon: ListChecks },
    { label: 'Pending', value: taskStats.pending, tone: 'default' as const, Icon: Clock },
    { label: 'In progress', value: taskStats.inProgress, tone: 'default' as const, Icon: Loader },
    {
      label: 'Delayed',
      value: taskStats.delayed,
      tone: taskStats.delayed > 0 ? ('warning' as const) : ('default' as const),
      Icon: AlertTriangle,
    },
    {
      label: 'Overdue',
      value: taskStats.overdue,
      tone: taskStats.overdue > 0 ? ('danger' as const) : ('default' as const),
      Icon: CircleAlert,
    },
    {
      label: 'Completed',
      value: taskStats.completed,
      tone: 'success' as const,
      Icon: CircleCheck,
    },
  ]

  return (
    <div className="space-y-8 p-6 sm:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {/*
            "Dashboard", on a route called /analytics. The label moved and the URL did
            not — see the note in components/ceo/SidebarNav.tsx. This heading has to
            agree with the nav item that leads here, not with the path.
          */}
          <h1 className="text-2xl font-semibold tracking-tight text-brand-slate">Dashboard</h1>
          <p className="mt-1 text-sm text-text-muted">
            Task and department figures are live. Modules without an owner yet show an awaiting
            state rather than a zero.
          </p>
        </div>

        {/* The one figure worth pulling out of the grid, so the page has a headline. */}
        <div className="dashboard-card px-5 py-3 text-center">
          <p className="text-2xl font-bold tracking-tight text-brand-gold">{completionRate}%</p>
          <p className="mt-0.5 text-xs text-text-muted">Completion rate</p>
        </div>
      </header>

      <AISummaryCard
        narrative={narrative}
        unavailableReason={narrativeUnavailableReason}
        date={facts.date}
      />

      <section>
        <SectionLabel>Tasks at a glance</SectionLabel>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {KPI_CARDS.map(({ label, value, tone, Icon }) => (
            <StatCard
              key={label}
              label={label}
              value={value}
              tone={tone}
              icon={<Icon className="h-3.5 w-3.5" />}
            />
          ))}
        </div>
      </section>

      <DepartmentMetrics metrics={deptMetrics} />

      <section>
        <SectionLabel>Trends</SectionLabel>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <KPIPerformanceChart
              data={monthlyTrend}
              currentRate={completionRate}
              totalTasks={taskStats.total}
              completedTasks={taskStats.completed}
            />
          </div>
          <div>
            <ScheduleWidget approvals={pendingApprovals.slice(0, 4)} />
          </div>
        </div>
      </section>

      <section>
        <SectionLabel>Breakdowns</SectionLabel>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <TimeWorkedChart data={weeklyActivity} completedThisWeek={completedThisWeek} />
          <EmploymentStatusWidget
            taskStats={taskStats}
            topDeptOverdue={topDelayed.slice(0, 4)}
            maxOverdue={maxOverdue}
          />
        </div>
      </section>

      <section>
        <SectionLabel>By module</SectionLabel>
        <AnalyticsTabs
          taskStats={taskStats}
          priorityBreakdown={priorityBreakdown}
          topDelayed={topDelayed}
          revenueSnapshot={revenueSnap}
          attendance={attendance}
          salesTrend={salesTrend}
          projectPortfolio={projects}
          pipeline={pipeline}
          pendingSources={PENDING_SOURCES}
        />
      </section>
    </div>
  )
}

/** Band heading. Small and muted — it orders the page without competing with the data. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
      {children}
    </h2>
  )
}
