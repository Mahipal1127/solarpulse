import Link from 'next/link'
import { requireDepartment } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { HR_DEPARTMENT_SLUG, isHrLead } from '@/lib/services/hr'
import {
  getHrDashboardStats,
  getHrDepartmentId,
  getHrEmployees,
  getUnownedHrTasks,
  getCandidates,
  getLeaveQueue,
} from '@/lib/hr/dashboard'
import { Card, CardHeader, StatCard, Badge, EmptyState } from '@/components/ui/primitives'
import { MyTaskBoard, type AssignedTask } from '@/components/employee/MyTaskBoard'
import { DepartmentTaskInbox } from '@/components/shared/DepartmentTaskInbox'
import {
  CANDIDATE_STATUS_LABELS,
  CANDIDATE_STATUS_STYLES,
  LEAVE_TYPE_LABELS,
  formatDate,
  leaveDayCount,
} from '@/lib/format'

export const dynamic = 'force-dynamic'

const TASK_SELECT =
  '*, department:departments!tasks_assigned_department_id_fkey(name), creator:users!tasks_created_by_fkey(full_name)'

/**
 * The HR home. Headline counts, the pending-leave and open-recruitment shortlists, the
 * lead's delegation inbox, and the HR person's own assigned tasks.
 *
 * Deliberately shows NO salary or appraisal data — not even a total payroll figure. The
 * sensitive tier is reached only through the gated Payroll and Performance pages, where
 * access is logged; a summary here would be an unlogged side-channel to exactly the data
 * the module is built to protect. Personal shortcuts point to /me/* so every HR person,
 * like everyone else, reaches their own attendance, leave, and payslips.
 */
export default async function HrDashboardPage() {
  const user = await requireDepartment(HR_DEPARTMENT_SLUG)
  const lead = isHrLead(user)
  const supabase = await createSupabaseServerClient()

  const [stats, candidates, leaveQueue, taskResult] = await Promise.all([
    getHrDashboardStats(),
    getCandidates(),
    getLeaveQueue(),
    supabase
      .from('tasks')
      .select(TASK_SELECT)
      .eq('assigned_user_id', user.id)
      .neq('status', 'archived')
      .order('due_date', { ascending: true, nullsFirst: false }),
  ])

  const myTasks = (taskResult.data ?? []) as unknown as AssignedTask[]
  const pendingLeave = leaveQueue.filter((l) => l.status === 'pending').slice(0, 6)
  const openCandidates = candidates
    .filter((c) => c.status !== 'hired' && c.status !== 'rejected')
    .slice(0, 6)

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">
          Welcome back, {firstName(user.full_name)}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          People, hiring, attendance and leave across the company.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Active Employees" value={stats.activeEmployees} />
        <StatCard label="Open Candidates" value={stats.openCandidates} hint="In the pipeline" />
        <StatCard
          label="Pending Leave"
          value={stats.pendingLeave}
          tone={stats.pendingLeave > 0 ? 'warning' : 'default'}
          hint={stats.pendingLeave > 0 ? 'Awaiting a decision' : 'Nothing waiting'}
        />
        <StatCard label="Present Today" value={stats.presentToday} tone="brand" />
      </div>

      <Card className="px-5 py-4">
        <p className="text-sm font-medium text-brand-slate">My workspace</p>
        <p className="mt-0.5 text-xs text-text-muted">
          Your own attendance, leave, and payslips — the same place every employee manages theirs.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href="/me/attendance"
            className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-brand-slate transition-colors hover:bg-surface-bg"
          >
            My attendance
          </Link>
          <Link
            href="/me/applications"
            className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-brand-slate transition-colors hover:bg-surface-bg"
          >
            My applications
          </Link>
          <Link
            href="/me/payslips"
            className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-brand-slate transition-colors hover:bg-surface-bg"
          >
            My payslips
          </Link>
        </div>
      </Card>

      {lead && <DelegationInbox organizationId={user.organization_id} />}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Leave awaiting decision"
            subtitle="Decided from the Approvals page"
            action={
              <Link
                href="/hr/applications"
                className="text-xs font-medium text-brand-slate hover:text-brand-gold"
              >
                All →
              </Link>
            }
          />
          {pendingLeave.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-text-muted">Nothing pending.</p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {pendingLeave.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/hr/employees/${l.employee_id}`}
                      className="block truncate text-sm font-medium text-brand-slate hover:text-brand-gold hover:underline"
                    >
                      {l.employee?.full_name ?? '—'}
                    </Link>
                    <p className="text-xs text-text-muted">
                      {LEAVE_TYPE_LABELS[l.leave_type]} · {leaveDayCount(l.start_date, l.end_date)} day
                      {leaveDayCount(l.start_date, l.end_date) === 1 ? '' : 's'} · from{' '}
                      {formatDate(l.start_date)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Recruitment pipeline"
            subtitle="Candidates still in play"
            action={
              <Link
                href="/hr/recruitment"
                className="text-xs font-medium text-brand-slate hover:text-brand-gold"
              >
                All →
              </Link>
            }
          />
          {openCandidates.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-text-muted">No open candidates.</p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {openCandidates.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-brand-slate">{c.name}</p>
                    <p className="text-xs text-text-muted">{c.applied_for_role ?? 'Role not set'}</p>
                  </div>
                  <Badge className={CANDIDATE_STATUS_STYLES[c.status]}>
                    {CANDIDATE_STATUS_LABELS[c.status]}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-brand-slate">My assigned tasks</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Assigned by the CEO or your lead. Progress updates save live.
          </p>
        </div>
        <MyTaskBoard initialTasks={myTasks} userId={user.id} />
      </section>
    </div>
  )
}

/** The lead-only delegation inbox — CEO tasks handed to HR without a named owner. */
async function DelegationInbox({ organizationId }: { organizationId: string }) {
  const departmentId = await getHrDepartmentId(organizationId)
  const [employees, unowned] = await Promise.all([
    getHrEmployees(organizationId),
    getUnownedHrTasks(organizationId, departmentId),
  ])
  const inboxTasks = unowned as unknown as AssignedTask[]

  return (
    <Card>
      <CardHeader
        title="Tasks awaiting delegation"
        subtitle="Assigned to HR without a named owner. Delegating moves it to that person's dashboard."
      />
      {inboxTasks.length === 0 ? (
        <EmptyState
          title="Nothing waiting to be delegated"
          description="CEO tasks assigned to HR without a named person land here."
        />
      ) : (
        <DepartmentTaskInbox tasks={inboxTasks} employees={employees} departmentName="HR" />
      )}
    </Card>
  )
}

function firstName(fullName: string): string {
  return fullName.split(' ')[0] || fullName
}
