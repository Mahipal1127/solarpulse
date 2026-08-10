import 'server-only'

import { requireRole } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { buildDailySummary } from '@/lib/ai/summary'
import { OverviewHeader } from '@/components/ceo/Dashboard/OverviewHeader'
import { KPIPerformanceChart } from '@/components/ceo/Dashboard/KPIPerformanceChart'
import { ScheduleWidget } from '@/components/ceo/Dashboard/ScheduleWidget'
import { TimeWorkedChart } from '@/components/ceo/Dashboard/TimeWorkedChart'
import { EmploymentStatusWidget } from '@/components/ceo/Dashboard/EmploymentStatusWidget'
import { AISummaryCard } from '@/components/ceo/Dashboard/AISummaryCard'
import { isOverdue } from '@/lib/format'
import Link from 'next/link'
import { ListChecks, ClipboardCheck, AlertTriangle, ArrowUpRight } from 'lucide-react'
import type { TaskStatus, TaskPriority, ApprovalStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const user = await requireRole('CEO')
  const supabase = await createSupabaseServerClient()

  const now = new Date()
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const todayISO = todayStart.toISOString()
  const tomorrowISO = new Date(todayStart.getTime() + 86_400_000).toISOString()

  const [taskRes, approvalRes, summaryResult] = await Promise.all([
    supabase
      .from('tasks')
      .select(`
        id, title, status, priority, due_date,
        created_at, completed_at, assigned_department_id,
        departments(name),
        assignee:users!tasks_assigned_user_id_fkey(full_name)
      `)
      .eq('organization_id', user.organization_id)
      .neq('status', 'archived')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(500),

    supabase
      .from('approvals')
      .select(`
        id, approval_type, status, created_at, notes,
        requester:users!approvals_requested_by_fkey(full_name),
        departments(name)
      `)
      .eq('organization_id', user.organization_id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(20),

    buildDailySummary(user),
  ])

  type RawTask = {
    id: string
    title: string
    status: TaskStatus
    priority: TaskPriority
    due_date: string | null
    created_at: string
    completed_at: string | null
    assigned_department_id: string
    departments: { name: string } | null
    assignee: { full_name: string } | null
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

  // ── Task stat counts ───────────────────────────────────────────────────────
  const taskStats = {
    total: tasks.length,
    pending: tasks.filter((t) => t.status === 'pending').length,
    inProgress: tasks.filter((t) => t.status === 'in_progress').length,
    delayed: tasks.filter((t) => t.status === 'delayed').length,
    completed: tasks.filter((t) => t.status === 'completed').length,
    overdue: tasks.filter((t) => isOverdue({ due_date: t.due_date, status: t.status })).length,
    dueToday: tasks.filter(
      (t) =>
        t.due_date &&
        t.due_date >= todayISO &&
        t.due_date < tomorrowISO &&
        t.status !== 'completed',
    ).length,
  }

  // ── Monthly task-completion trend (last 12 months) ─────────────────────────
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
    const key = task.created_at.slice(0, 7)
    const entry = monthMap.get(key)
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
  const overallRate =
    taskStats.total > 0 ? Math.round((taskStats.completed / taskStats.total) * 100) : 0

  // ── Weekly task activity (last 7 days) ─────────────────────────────────────
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
        (t) => t.completed_at && t.completed_at >= dayStart && t.completed_at < dayEnd,
      ).length,
      created: tasks.filter((t) => t.created_at >= dayStart && t.created_at < dayEnd).length,
    }
  })
  const completedThisWeek = weeklyActivity.reduce((s, d) => s + d.completed, 0)

  // ── Department health (top 5 by overdue task count) ───────────────────────
  const deptOverdue = new Map<string, { name: string; count: number }>()
  for (const task of tasks) {
    if (!isOverdue({ due_date: task.due_date, status: task.status })) continue
    const id = task.assigned_department_id
    if (!deptOverdue.has(id)) {
      deptOverdue.set(id, { name: task.departments?.name ?? 'Unknown', count: 0 })
    }
    deptOverdue.get(id)!.count += 1
  }
  const topDeptOverdue = [...deptOverdue.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 4)
  const maxOverdue = topDeptOverdue[0]?.count ?? 1

  return (
    <div className="flex flex-col min-h-full">
      {/* Top Header Bar */}
      <OverviewHeader user={user} />

      {/* Main Dashboard Grid */}
      <div className="flex-1 space-y-6 p-6 sm:p-8">

        {/* Optional AI Briefing strip */}
        <AISummaryCard
          narrative={narrative}
          unavailableReason={narrativeUnavailableReason}
          date={facts.date}
        />

        {/*
          Row 1: Task KPI Stat Cards — real numbers from DB.

          These lift on hover with a soft shadow rather than a gold ring. Gold marks
          active state and primary actions; spending it on "the cursor is here"
          dilutes that, and the design system caps ordinary cards at shadow-sm.
        */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* Active Tasks */}
          <Link href="/tasks" className="dashboard-card flex cursor-pointer flex-col justify-between p-5 transition-shadow hover:shadow-sm">
            {/*
              Label glyph plus a corner arrow, both muted grey. The arrow is honest
              here in a way it would not be on a plain StatCard: these three cards are
              links, so it points at something.
            */}
            <span className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
              <span className="flex items-center gap-1.5">
                <ListChecks className="h-3.5 w-3.5 shrink-0" />
                Active Tasks
              </span>
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-text-muted/60" />
            </span>
            <div className="mt-3 flex items-baseline justify-between">
              <span className="text-3xl font-extrabold text-brand-slate tracking-tight">
                {taskStats.pending + taskStats.inProgress}
              </span>
              {taskStats.dueToday > 0 ? (
                <span className="inline-flex items-center gap-0.5 rounded-md bg-status-warning/5 px-2 py-0.5 text-xs font-bold text-status-warning border border-status-warning/15">
                  {taskStats.dueToday} due today
                </span>
              ) : (
                <span className="inline-flex items-center gap-0.5 rounded-md bg-status-success/5 px-2 py-0.5 text-xs font-bold text-status-success border border-status-success/15">
                  On track
                </span>
              )}
            </div>
          </Link>

          {/* Pending Approvals */}
          <Link href="/approvals" className="dashboard-card flex cursor-pointer flex-col justify-between p-5 transition-shadow hover:shadow-sm">
            <span className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
              <span className="flex items-center gap-1.5">
                <ClipboardCheck className="h-3.5 w-3.5 shrink-0" />
                Pending Approvals
              </span>
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-text-muted/60" />
            </span>
            <div className="mt-3 flex items-baseline justify-between">
              <span className="text-3xl font-extrabold text-brand-slate tracking-tight">
                {pendingApprovals.length}
              </span>
              {pendingApprovals.length > 0 ? (
                <span className="inline-flex items-center gap-0.5 rounded-md bg-status-danger/5 px-2 py-0.5 text-xs font-bold text-status-danger border border-status-danger/15">
                  Needs review
                </span>
              ) : (
                <span className="inline-flex items-center gap-0.5 rounded-md bg-status-success/5 px-2 py-0.5 text-xs font-bold text-status-success border border-status-success/15">
                  All clear
                </span>
              )}
            </div>
          </Link>

          {/* Overdue Tasks */}
          <Link href="/tasks?status=overdue" className="dashboard-card flex cursor-pointer flex-col justify-between p-5 transition-shadow hover:shadow-sm">
            <span className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Overdue Tasks
              </span>
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-text-muted/60" />
            </span>
            <div className="mt-3 flex items-baseline justify-between">
              <span className={`text-3xl font-extrabold tracking-tight ${taskStats.overdue > 0 ? 'text-status-danger' : 'text-brand-slate'}`}>
                {taskStats.overdue}
              </span>
              <span className={`inline-flex items-center gap-0.5 rounded-md px-2 py-0.5 text-xs font-bold border ${
                taskStats.overdue > 5
                  ? 'bg-status-danger/5 text-status-danger border-status-danger/15'
                  : taskStats.overdue > 0
                  ? 'bg-status-warning/5 text-status-warning border-status-warning/15'
                  : 'bg-status-success/5 text-status-success border-status-success/15'
              }`}>
                {taskStats.overdue > 5 ? 'Critical' : taskStats.overdue > 0 ? 'Attention' : 'Clear'}
              </span>
            </div>
          </Link>
        </div>

        {/* Row 2: Task Completion Trend + Pending Approvals Widget */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <KPIPerformanceChart
              data={monthlyTrend}
              currentRate={overallRate}
              totalTasks={taskStats.total}
              completedTasks={taskStats.completed}
            />
          </div>
          <div className="lg:col-span-1">
            <ScheduleWidget approvals={pendingApprovals.slice(0, 4)} />
          </div>
        </div>

        {/* Row 3: Weekly Activity Chart + Department Health */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <TimeWorkedChart
              data={weeklyActivity}
              completedThisWeek={completedThisWeek}
            />
          </div>
          <div>
            <EmploymentStatusWidget
              taskStats={taskStats}
              topDeptOverdue={topDeptOverdue}
              maxOverdue={maxOverdue}
            />
          </div>
        </div>

      </div>
    </div>
  )
}
