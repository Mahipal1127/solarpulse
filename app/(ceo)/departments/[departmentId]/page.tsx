import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, CardHeader, EmptyState, Badge } from '@/components/ui/primitives'
import { TenderList } from '@/components/tender/TenderList/TenderList'
import {
  getTenderSummary,
  getBidSummary,
  CLOSING_SOON_DAYS,
  type TenderSummary,
  type BidSummary,
} from '@/lib/tender/dashboard'
import { LeadList } from '@/components/sales/LeadList/LeadList'
import { getSalesSummary, type SalesSummary } from '@/lib/sales/dashboard'
import {
  getPurchaseOrderSummary,
  getDispatchSummary,
  type PurchaseOrderSummary,
  type DispatchSummary,
} from '@/lib/distribution/dashboard'
import { HandoffQueue } from '@/components/technical/Dashboard/HandoffQueue'
import { DesignBoard } from '@/components/technical/Dashboard/DesignBoard'
import {
  getSurveySummary,
  getDesignSummary,
  type SurveySummary,
  type DesignSummary,
} from '@/lib/technical/dashboard'
import {
  formatCurrency,
  formatDate,
  isOverdue,
  STATUS_STYLES,
  STATUS_LABELS,
  LEAD_OPEN_STAGES,
  PO_STATUS_STYLES,
  PO_STATUS_LABELS,
  DISPATCH_STATUS_STYLES,
  DISPATCH_STATUS_LABELS,
} from '@/lib/format'
import type { DepartmentReport, TaskStatus, Task } from '@/lib/types'

type DepartmentTask = Pick<
  Task,
  'id' | 'title' | 'status' | 'due_date' | 'progress_percent' | 'assigned_user_id'
> & { assignee: { full_name: string } | null }

/**
 * A compact figure for a drill-down header. Not StatCard: that primitive is sized for
 * a dashboard's top row, and four of them here would out-shout the department name
 * and the panels underneath, which are what this page is actually for.
 */
function MiniStat({
  label,
  value,
  note,
  alarm = false,
}: {
  label: string
  value: number
  note?: string
  alarm?: boolean
}) {
  return (
    <div className="rounded-lg border border-border-subtle bg-white px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${alarm ? 'text-status-warning' : 'text-brand-slate'}`}>
        {value}
      </p>
      {note && <p className="mt-0.5 text-xs text-text-muted">{note}</p>}
    </div>
  )
}

/**
 * A label/figure pair for inside a card, where MiniStat's border and padding would
 * nest a box in a box. Same role Technical's local `Row` plays on its own dashboard.
 */
function MiniRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</p>
      <p className="text-lg font-semibold text-brand-slate">{value}</p>
    </div>
  )
}

export default async function DepartmentDetailPage(props: PageProps<'/departments/[departmentId]'>) {
  const user = await requireRole('CEO')
  const { departmentId } = await props.params
  const supabase = await createSupabaseServerClient()

  const { data: department } = await supabase
    .from('departments')
    .select('id, name, slug, parent_department_id')
    .eq('id', departmentId)
    .eq('organization_id', user.organization_id)
    .maybeSingle()

  if (!department) notFound()

  const [{ data: reportData }, { data: taskData }] = await Promise.all([
    supabase
      .from('department_reports')
      .select('id, department_id, report_date, summary, tasks_completed, tasks_pending, tasks_delayed, created_at')
      .eq('department_id', departmentId)
      .order('report_date', { ascending: false })
      .limit(60),
    supabase
      .from('tasks')
      .select(
        'id, title, status, due_date, progress_percent, assigned_user_id, assignee:users!tasks_assigned_user_id_fkey(full_name)'
      )
      .eq('assigned_department_id', departmentId)
      .neq('status', 'archived')
      .order('created_at', { ascending: false })
      .limit(300),
  ])

  const reports = (reportData ?? []) as DepartmentReport[]
  const tasks = (taskData ?? []) as unknown as DepartmentTask[]

  /**
   * Tender drill-down, now reusing the module's own aggregations for the same reason
   * Distribution's and Technical's do: overdue is derived from the clock, and
   * re-deriving it here is how the CEO's number and the department's number drift
   * apart.
   *
   * This section used to be a bare ten-row list with a standing TODO and no figures
   * at all — so the CEO could see ten tender titles but not how many were past their
   * deadline, which is the one thing about a tender that cannot be recovered. The
   * TODO said to wait for a department_reports rollup job; that job still does not
   * exist, and it was never needed for this. getTenderSummary() reads the same rows
   * with the same policy and counts them once.
   *
   * `tenders` has no department_id — the table is the Tender department's data by
   * definition, so the slug check is the department filter and organization_id is the
   * tenancy filter.
   *
   * Read-only for the CEO: ceo_full_access_tenders grants the select, and
   * assertCanWrite() in the tender service refuses every write, so nothing actionable
   * is rendered here.
   */
  let tender: { tenders: TenderSummary; bids: BidSummary } | null = null
  if (department.slug === 'tender') {
    const [tenderSummary, bidSummary] = await Promise.all([
      getTenderSummary(user.organization_id),
      getBidSummary(),
    ])
    tender = { tenders: tenderSummary, bids: bidSummary }
  }

  /**
   * Sales drill-down, now reusing the module's own aggregation for the same reason
   * Distribution's, Technical's and Tender's do — so the CEO's numbers and the
   * department's cannot drift apart.
   *
   * This section used to fetch ten open leads inline and render them with no figures
   * at all: the CEO could see ten names but not how many leads were unassigned, how
   * many sat in negotiation, or what had closed this month. Those are the questions a
   * drill-down exists to answer, and every other department's answered them.
   *
   * `leads` has no department_id — the table is the Sales department's data by
   * definition, so the slug check is the department filter and organization_id is the
   * tenancy filter. Revenue comes from deal_closures, which has no organization_id at
   * all: RLS scopes it through the parent lead (auth_lead_in_org), so there is nothing
   * to filter on here.
   *
   * Read-only: ceo_full_access_leads grants the select org-wide, and assertCanWrite()
   * in the sales service refuses every write from outside the department. Sales
   * targets are the one documented exception, and they are set on the Reports page
   * rather than here.
   */
  let sales: SalesSummary | null = null
  if (department.slug === 'sales') {
    sales = await getSalesSummary(user.organization_id)
  }

  /**
   * Distribution drill-down. Unlike the two above this reuses the module's own
   * aggregation functions rather than re-querying here — the overdue and
   * running-late counts are derived from the clock, and re-deriving them in a
   * second place is how the CEO's number and the department's number drift apart.
   *
   * Read-only like the others: the ceo_full_access_* policies grant the selects
   * org-wide, and assertCanWrite() in the distribution service refuses every write
   * from outside the department — including the CEO's.
   */
  let distribution: { orders: PurchaseOrderSummary; dispatches: DispatchSummary } | null = null
  if (department.slug === 'distribution') {
    const [orders, dispatches] = await Promise.all([
      getPurchaseOrderSummary(user.organization_id),
      getDispatchSummary(user.organization_id),
    ])
    distribution = { orders, dispatches }
  }

  /**
   * Technical drill-down, reusing the module's own aggregations for the same reason
   * Distribution's does: overdue and awaiting-a-date are derived from the clock and
   * from three columns, and re-deriving them here is how the CEO's number and the
   * department's number drift apart.
   *
   * The handoff queue is the point of this section. It is the delay the client named
   * — Sales asks for a site visit and nobody schedules it — so the CEO gets the same
   * rows the department sees rather than a rolled-up count.
   *
   * Read-only like the others: ceo_full_access_* grants the selects org-wide, and
   * assertCanWrite() in the technical service refuses every write from outside the
   * department, the CEO included. Both panels render with canOperate={false}, so no
   * "set a date" or "hand over" button appears here at all.
   */
  let technical: { surveys: SurveySummary; designs: DesignSummary } | null = null
  if (department.slug === 'technical') {
    const [surveys, designs] = await Promise.all([getSurveySummary(), getDesignSummary()])
    technical = { surveys, designs }
  }

  // Employee-wise completion, derived from the tasks the CEO module owns.
  const byEmployee = new Map<string, { name: string; completed: number; open: number; overdue: number }>()
  for (const task of tasks) {
    const key = task.assigned_user_id ?? 'unassigned'
    const name = task.assignee?.full_name ?? 'Unassigned'
    const entry = byEmployee.get(key) ?? { name, completed: 0, open: 0, overdue: 0 }

    if (task.status === 'completed') entry.completed += 1
    else entry.open += 1
    if (isOverdue({ due_date: task.due_date, status: task.status })) entry.overdue += 1

    byEmployee.set(key, entry)
  }

  const employeeRows = [...byEmployee.values()].sort((a, b) => b.completed - a.completed)

  return (
    <div className="space-y-6">
      <header>
        <Link href="/departments" className="text-xs text-text-muted hover:text-brand-slate">
          ← Back to departments
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-brand-slate">{department.name}</h1>
        <p className="text-sm text-text-muted">
          Read-only. Department data is written by the {department.name} module.
        </p>
      </header>

      {tender && (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="grid flex-1 grid-cols-3 gap-3">
              <MiniStat
                label="Active tenders"
                value={tender.tenders.active}
                note={
                  tender.tenders.overdue.length > 0
                    ? `${tender.tenders.overdue.length} past their deadline`
                    : `${tender.tenders.won} won of ${tender.tenders.total} logged`
                }
                alarm={tender.tenders.overdue.length > 0}
              />
              <MiniStat
                label={`Closing in ${CLOSING_SOON_DAYS} days`}
                value={tender.tenders.closingSoon.length}
                note="Still open, deadline near"
                alarm={tender.tenders.closingSoon.length > 0}
              />
              <MiniStat
                label="Unassigned"
                value={tender.tenders.unassigned.length}
                note="Active, with nobody named"
                alarm={tender.tenders.unassigned.length > 0}
              />
            </div>

            <Link
              href="/overview"
              className="shrink-0 text-xs font-medium text-brand-slate hover:text-brand-slate"
            >
              Open Tender module →
            </Link>
          </div>

          {/*
            Past the deadline gets its own panel above the list, the same treatment
            Technical's handoff queue gets. It is the only thing in this department
            that represents work already lost rather than outstanding, and a CEO
            scanning a drill-down should not have to infer it from a date column.
          */}
          {tender.tenders.overdue.length > 0 && (
            <Card className="border-status-danger/30">
              <CardHeader
                title="Past the deadline"
                subtitle="Never submitted — the submission window has closed · read-only"
              />
              <TenderList tenders={tender.tenders.overdue.slice(0, 5)} compact />
            </Card>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Next deadlines"
                subtitle={`Active tenders, soonest first · ${formatCurrency(
                  tender.tenders.pipelineValue
                )} in play · read-only`}
              />
              <TenderList
                tenders={tender.tenders.upcoming}
                compact
                emptyTitle="No active tenders"
                emptyDescription="Tenders logged by the Tender department will appear here."
              />
            </Card>

            <Card>
              <CardHeader
                title="Bids"
                subtitle="Where the department's submissions stand · read-only"
              />
              <div className="space-y-3 px-5 py-4">
                <MiniRow label="In play" value={tender.bids.inPlay} />
                <MiniRow label="Won" value={tender.bids.won} />
                <MiniRow label="Lost" value={tender.bids.lost} />
                <div className="flex items-center justify-between border-t border-border-subtle pt-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                    Value in play
                  </p>
                  <p className="text-sm font-semibold text-brand-slate">
                    {formatCurrency(tender.bids.valueInPlay)}
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </>
      )}

      {sales && (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="grid flex-1 grid-cols-3 gap-3">
              <MiniStat
                label="Open leads"
                value={sales.open}
                note={`${sales.total} logged · ${sales.won} won`}
              />
              <MiniStat
                label="Unassigned"
                value={sales.unassigned}
                note="Nobody is chasing these"
                alarm={sales.unassigned > 0}
              />
              <MiniStat
                label="In negotiation"
                value={sales.inNegotiation}
                note="The stage that goes stale unchased"
              />
            </div>

            <Link
              href="/sales/dashboard"
              className="shrink-0 text-xs font-medium text-brand-slate hover:text-brand-slate"
            >
              Open Sales module →
            </Link>
          </div>

          <Card>
            <CardHeader
              title="Open pipeline"
              subtitle={`Newest leads first, with their owner · ${formatCurrency(
                sales.revenueThisMonth
              )} closed this month across ${sales.dealsThisMonth} ${
                sales.dealsThisMonth === 1 ? 'deal' : 'deals'
              } · read-only`}
            />
            <LeadList
              leads={sales.all.filter((l) => LEAD_OPEN_STAGES.includes(l.status)).slice(0, 10)}
              showAssignee
              emptyTitle="No open leads"
              emptyDescription="Leads logged by the Sales department will appear here."
            />
          </Card>
        </>
      )}

      {distribution && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Procurement"
              subtitle="Purchase orders, newest first · read-only"
              action={
                <Link
                  href="/distribution/dashboard"
                  className="text-xs font-medium text-brand-slate hover:text-brand-slate"
                >
                  Open Distribution module →
                </Link>
              }
            />
            <div className="grid grid-cols-3 gap-3 border-b border-border-subtle px-5 py-4 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wide text-text-muted">Awaiting Finance</p>
                <p className="mt-1 text-xl font-semibold text-brand-slate">
                  {distribution.orders.awaitingApproval}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-text-muted">Overdue</p>
                <p
                  className={`mt-1 text-xl font-semibold ${
                    distribution.orders.overdue.length > 0 ? 'text-status-danger' : 'text-brand-slate'
                  }`}
                >
                  {distribution.orders.overdue.length}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-text-muted">Committed</p>
                <p className="mt-1 text-sm font-semibold text-brand-slate">
                  {formatCurrency(distribution.orders.committedValue)}
                </p>
              </div>
            </div>
            {distribution.orders.recent.length === 0 ? (
              <EmptyState
                title="No purchase orders yet"
                description="Orders raised by the Distribution department will appear here."
              />
            ) : (
              <ul className="divide-y divide-border-subtle">
                {distribution.orders.recent.map((po) => (
                  <li key={po.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-brand-slate">{po.po_number}</p>
                      <p className="truncate text-xs text-text-muted">
                        {po.vendor?.name ?? 'Vendor not recorded'}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-sm text-text-muted">
                        {formatCurrency(po.total_amount)}
                      </span>
                      <Badge className={PO_STATUS_STYLES[po.status]}>
                        {PO_STATUS_LABELS[po.status]}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Material on the move"
              subtitle={
                distribution.dispatches.runningLate.length > 0
                  ? `${distribution.dispatches.runningLate.length} running late · read-only`
                  : 'Preparing or in transit · read-only'
              }
            />
            {distribution.dispatches.active.length === 0 ? (
              <EmptyState
                title="Nothing out for delivery"
                description="Dispatches on their way to site will appear here."
              />
            ) : (
              <ul className="divide-y divide-border-subtle">
                {distribution.dispatches.active.map((dispatch) => (
                  <li
                    key={dispatch.id}
                    className="flex items-center justify-between gap-3 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-brand-slate">
                        {dispatch.dispatch_number}
                      </p>
                      <p className="truncate text-xs text-text-muted">
                        {dispatch.lead?.name ?? 'Internal transfer'}
                        {dispatch.dispatched_at ? ` · out ${formatDate(dispatch.dispatched_at)}` : ''}
                      </p>
                    </div>
                    <Badge className={DISPATCH_STATUS_STYLES[dispatch.status]}>
                      {DISPATCH_STATUS_LABELS[dispatch.status]}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {technical && (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="grid flex-1 grid-cols-3 gap-3">
              <MiniStat
                label="Open surveys"
                value={technical.surveys.open}
                note={
                  technical.surveys.overdue.length > 0
                    ? `${technical.surveys.overdue.length} past their slot`
                    : `${technical.surveys.completed} completed`
                }
                alarm={technical.surveys.overdue.length > 0}
              />
              <MiniStat
                label="Awaiting a date"
                value={technical.surveys.awaitingSchedule.length}
                note="Sales requested, not scheduled"
                alarm={technical.surveys.awaitingSchedule.length > 0}
              />
              <MiniStat
                label="Designs in review"
                value={technical.designs.awaitingReview}
                note={`${technical.designs.sentToSales} handed to Sales`}
              />
            </div>

            <Link
              href="/technical/dashboard"
              className="shrink-0 text-xs font-medium text-brand-slate hover:text-brand-slate"
            >
              Open Technical module →
            </Link>
          </div>

          <HandoffQueue
            surveys={technical.surveys.awaitingSchedule}
            canOperate={false}
            scope="team"
          />

          <DesignBoard
            wip={technical.designs.wip}
            readyForSales={technical.designs.readyForSales}
            canOperate={false}
            scope="team"
          />
        </>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Report history" subtitle="Daily rollups published by the department" />
          {reports.length === 0 ? (
            <EmptyState
              title={`Awaiting ${department.name} module`}
              description="Daily rollups will appear here once the department module starts publishing."
            />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {reports.map((report) => (
                <li key={report.id} className="px-5 py-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-brand-slate">
                      {formatDate(report.report_date)}
                    </p>
                    <div className="flex gap-2 text-xs">
                      <span className="text-status-success">{report.tasks_completed} done</span>
                      <span className="text-text-muted">{report.tasks_pending} pending</span>
                      <span className="text-status-danger">{report.tasks_delayed} delayed</span>
                    </div>
                  </div>
                  {report.summary && (
                    <p className="mt-1 text-xs text-text-muted">{report.summary}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Employee-wise task completion"
            subtitle="Derived from CEO-assigned tasks"
          />
          {employeeRows.length === 0 ? (
            <EmptyState title="No tasks assigned to this department yet" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wide text-text-muted">
                  <th className="px-5 py-2 font-medium">Employee</th>
                  <th className="px-3 py-2 text-right font-medium">Completed</th>
                  <th className="px-3 py-2 text-right font-medium">Open</th>
                  <th className="px-5 py-2 text-right font-medium">Overdue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {employeeRows.map((row) => (
                  <tr key={row.name}>
                    <td className="px-5 py-2 text-brand-slate">{row.name}</td>
                    <td className="px-3 py-2 text-right text-status-success">{row.completed}</td>
                    <td className="px-3 py-2 text-right text-text-muted">{row.open}</td>
                    <td className="px-5 py-2 text-right text-status-danger">{row.overdue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Open tasks" subtitle={`${tasks.length} non-archived tasks`} />
        {tasks.length === 0 ? (
          <EmptyState title="No tasks for this department" />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {tasks.slice(0, 50).map((task) => (
              <li key={task.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <Link
                  href={`/tasks/${task.id}`}
                  className="min-w-0 flex-1 text-sm text-brand-slate hover:underline"
                >
                  <span className="truncate">{task.title}</span>
                  <span className="ml-2 text-xs text-text-muted">
                    {task.assignee?.full_name ?? 'Unassigned'}
                    {task.due_date ? ` · Due ${formatDate(task.due_date)}` : ''}
                  </span>
                </Link>
                <div className="flex shrink-0 gap-2">
                  {isOverdue(task) && (
                    <Badge className="bg-status-danger/10 text-status-danger ring-status-danger/25">Overdue</Badge>
                  )}
                  <Badge className={STATUS_STYLES[task.status as TaskStatus]}>
                    {STATUS_LABELS[task.status as TaskStatus]}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
