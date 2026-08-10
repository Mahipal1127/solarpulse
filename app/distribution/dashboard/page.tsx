import Link from 'next/link'
import { requireDepartment, isReadOnlyFor, isDepartmentManager } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, CardHeader, Badge, StatCard, EmptyState } from '@/components/ui/primitives'
import { DepartmentTaskInbox } from '@/components/shared/DepartmentTaskInbox'
import { DISTRIBUTION_DEPARTMENT_SLUG } from '@/lib/services/distribution'
import {
  getPurchaseOrderSummary,
  getDispatchSummary,
  getAllocationSummary,
  getReturnSummary,
  getDepartmentTasks,
} from '@/lib/distribution/dashboard'
import {
  formatCurrency,
  formatDate,
  formatQuantity,
  daysSince,
  PO_STATUS_STYLES,
  PO_STATUS_LABELS,
  DISPATCH_STATUS_STYLES,
  DISPATCH_STATUS_LABELS,
  RETURN_STATUS_STYLES,
  RETURN_STATUS_LABELS,
  MATERIAL_CONDITION_LABELS,
} from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * Distribution's department dashboard. Built last, because it is a read-only
 * aggregation of everything else in the module — there was nothing to summarise
 * until POs, allocations, dispatches and returns were flowing.
 *
 * Every count here is derived at read time. There is no stored 'overdue' flag
 * anywhere in this module: a late PO and a lorry that has been out too long are
 * both facts about the clock, computed by the same helpers the lists use.
 */
export default async function DistributionDashboardPage() {
  const user = await requireDepartment(DISTRIBUTION_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, DISTRIBUTION_DEPARTMENT_SLUG)
  const manager = isDepartmentManager(user) && !readOnly

  const supabase = await createSupabaseServerClient()

  const [orders, dispatches, allocations, returns, tasks] = await Promise.all([
    getPurchaseOrderSummary(user.organization_id),
    getDispatchSummary(user.organization_id),
    getAllocationSummary(user.organization_id),
    getReturnSummary(user.organization_id),
    getDepartmentTasks(user.organization_id, user.department_id),
  ])

  // Only a manager needs the roster, and only for delegating department tasks.
  const { data: rosterData } = manager
    ? await supabase
        .from('users')
        .select('id, full_name')
        .eq('organization_id', user.organization_id)
        .eq('department_id', user.department_id)
        .eq('is_active', true)
        .order('full_name', { ascending: true })
    : { data: null }

  const employees = (rosterData ?? []) as { id: string; full_name: string }[]

  // Tasks the CEO gave the department without naming anyone — the manager's to
  // hand out. Assigning one moves it to that person's own task list.
  const inboxTasks = tasks.filter((task) => !task.assigned_user_id)

  /**
   * Distinct things wanting a person, across three tables. Summing is right
   * between them — a PO, a lorry and a return are different objects — but not
   * within purchase orders, where awaiting-approval and overdue overlap. That
   * union is computed in getPurchaseOrderSummary(), which has the rows to do it.
   */
  const needsAttention =
    orders.needingAttention + dispatches.runningLate.length + returns.pending

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-slate">Distribution</h1>
        <p className="mt-1 text-sm text-text-muted">
          Procurement, dispatch, and material movement across every live project.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Awaiting Finance"
          value={orders.awaitingApproval}
          tone={orders.awaitingApproval > 0 ? 'warning' : 'default'}
          hint={
            orders.awaitingApproval > 0
              ? formatCurrency(orders.awaitingApprovalValue)
              : 'Nothing pending'
          }
        />
        <StatCard
          label="On the Road"
          value={dispatches.inTransit}
          hint={`${dispatches.preparing} preparing to leave`}
        />
        <StatCard
          label="Awaiting Dispatch"
          value={allocations.awaitingDispatch}
          hint={`Across ${allocations.projectsWithPending} project${
            allocations.projectsWithPending === 1 ? '' : 's'
          }`}
        />
        <StatCard
          label="Needs Attention"
          value={needsAttention}
          tone={needsAttention > 0 ? 'danger' : 'success'}
          hint="Approvals, overdue orders, late lorries, returns"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Awaiting Finance comes first: it is the one queue Distribution cannot
            clear itself, so it is where work most often stalls. */}
        <Card>
          <CardHeader
            title="Purchase orders"
            subtitle="Finance approval precedes ordering"
            action={
              <Link
                href="/distribution/purchase-orders"
                className="text-xs font-medium text-brand-slate hover:text-brand-slate"
              >
                View all →
              </Link>
            }
          />
          <div className="grid grid-cols-3 gap-3 border-b border-border-subtle px-5 py-4">
            <MiniStat label="Approved" value={orders.approved} />
            <MiniStat label="Ordered" value={orders.ordered} />
            <MiniStat
              label="Committed"
              value={formatCurrency(orders.committedValue)}
              small
            />
          </div>

          {orders.recent.length === 0 ? (
            <EmptyState
              title="No purchase orders yet"
              description="Raise one against a vendor to get material moving."
            />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {orders.recent.map((po) => (
                <li key={po.id} className="flex items-start justify-between gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/distribution/purchase-orders/${po.id}`}
                        className="text-sm font-medium text-brand-slate hover:text-brand-slate"
                      >
                        {po.po_number}
                      </Link>
                      <Badge className={PO_STATUS_STYLES[po.status]}>
                        {PO_STATUS_LABELS[po.status]}
                      </Badge>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-text-muted">
                      {po.vendor?.name ?? 'Vendor not recorded'}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-brand-slate">
                    {formatCurrency(po.total_amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Active dispatches"
            subtitle="Preparing or on the road"
            action={
              <Link
                href="/distribution/dispatches"
                className="text-xs font-medium text-brand-slate hover:text-brand-slate"
              >
                View all →
              </Link>
            }
          />
          {dispatches.active.length === 0 ? (
            <EmptyState
              title="Nothing out for delivery"
              description="Dispatches on their way to site show up here."
            />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {dispatches.active.map((dispatch) => (
                <li
                  key={dispatch.id}
                  className="flex items-start justify-between gap-3 px-5 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/distribution/dispatches/${dispatch.id}`}
                        className="text-sm font-medium text-brand-slate hover:text-brand-slate"
                      >
                        {dispatch.dispatch_number}
                      </Link>
                      <Badge className={DISPATCH_STATUS_STYLES[dispatch.status]}>
                        {DISPATCH_STATUS_LABELS[dispatch.status]}
                      </Badge>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-text-muted">
                      {dispatch.lead?.name ?? 'Internal transfer'}
                      {dispatch.dispatched_at
                        ? ` · out ${daysSince(dispatch.dispatched_at)}d`
                        : ''}
                    </p>
                  </div>
                  {dispatch.vehicle_details && (
                    <span className="shrink-0 text-xs text-text-muted/60">
                      {dispatch.vehicle_details}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* The two derived-overdue panels. Shown only when there is something in
          them: an always-visible empty "overdue" card trains people to ignore it. */}
      {(orders.overdue.length > 0 || dispatches.runningLate.length > 0) && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {orders.overdue.length > 0 && (
            <Card className="border-status-danger/25">
              <CardHeader
                title="Overdue orders"
                subtitle="Past expected delivery and not yet received"
              />
              <ul className="divide-y divide-border-subtle">
                {orders.overdue.slice(0, 6).map((po) => (
                  <li key={po.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <Link
                        href={`/distribution/purchase-orders/${po.id}`}
                        className="text-sm font-medium text-brand-slate hover:text-brand-slate"
                      >
                        {po.po_number}
                      </Link>
                      <p className="mt-0.5 text-xs text-status-danger">
                        Expected {formatDate(po.expected_delivery_date)}
                      </p>
                    </div>
                    <Badge className={PO_STATUS_STYLES[po.status]}>
                      {PO_STATUS_LABELS[po.status]}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {dispatches.runningLate.length > 0 && (
            <Card className="border-status-warning/25">
              <CardHeader
                title="Running late"
                subtitle="In transit longer than expected — worth a call to the driver"
              />
              <ul className="divide-y divide-border-subtle">
                {dispatches.runningLate.slice(0, 6).map((dispatch) => (
                  <li
                    key={dispatch.id}
                    className="flex items-center justify-between gap-3 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/distribution/dispatches/${dispatch.id}`}
                        className="text-sm font-medium text-brand-slate hover:text-brand-slate"
                      >
                        {dispatch.dispatch_number}
                      </Link>
                      <p className="mt-0.5 truncate text-xs text-text-muted">
                        {dispatch.lead?.name ?? 'Internal transfer'}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-medium text-status-warning">
                      {daysSince(dispatch.dispatched_at!)} days out
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Material awaiting dispatch"
            subtitle="Allocated to a project, not yet sent"
            action={
              <Link
                href="/distribution/allocations"
                className="text-xs font-medium text-brand-slate hover:text-brand-slate"
              >
                Open board →
              </Link>
            }
          />
          {allocations.pendingByProject.length === 0 ? (
            <EmptyState
              title="Everything allocated has gone out"
              description="Plan material against a won project to see it here."
            />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {allocations.pendingByProject.map((group) => (
                <li
                  key={group.leadId}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-brand-slate">
                    {group.project}
                  </span>
                  <span className="shrink-0 text-xs font-medium text-text-muted">
                    {group.items} item{group.items === 1 ? '' : 's'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Recent returns"
            subtitle={`${returns.pending} awaiting check-in`}
            action={
              <Link
                href="/distribution/returns"
                className="text-xs font-medium text-brand-slate hover:text-brand-slate"
              >
                View all →
              </Link>
            }
          />
          {returns.recent.length === 0 ? (
            <EmptyState
              title="Nothing returned"
              description="Material coming back from site gets logged here."
            />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {returns.recent.map((materialReturn) => (
                <li
                  key={materialReturn.id}
                  className="flex items-start justify-between gap-3 px-5 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-brand-slate">
                      {materialReturn.item_name}
                    </p>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {formatQuantity(materialReturn.quantity, materialReturn.unit)} ·{' '}
                      {MATERIAL_CONDITION_LABELS[materialReturn.condition]} ·{' '}
                      {materialReturn.lead?.name ?? 'No project'}
                    </p>
                  </div>
                  <Badge className={RETURN_STATUS_STYLES[materialReturn.status]}>
                    {RETURN_STATUS_LABELS[materialReturn.status]}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {manager && (
        <Card>
          <CardHeader
            title="Department task inbox"
            subtitle="Assigned to Distribution by the CEO, waiting to be handed out"
          />
          <DepartmentTaskInbox
            tasks={inboxTasks}
            employees={employees}
            departmentName="Distribution"
          />
        </Card>
      )}
    </div>
  )
}

function MiniStat({
  label,
  value,
  small = false,
}: {
  label: string
  value: string | number
  small?: boolean
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</p>
      <p className={`mt-1 font-semibold text-brand-slate ${small ? 'text-sm' : 'text-xl'}`}>
        {value}
      </p>
    </div>
  )
}
