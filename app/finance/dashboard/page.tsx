import Link from 'next/link'
import { requireAnyDepartment } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { FINANCE_DEPARTMENT_SLUGS, isFinanceLead } from '@/lib/services/finance'
import {
  getFinanceDashboardStats,
  getFinanceDepartmentId,
  getFinanceEmployees,
  getUnownedFinanceTasks,
  getOutstandingInvoices,
  getOutstandingBills,
  getPendingHandoffs,
  getPendingPurchaseOrderApprovals,
} from '@/lib/finance/dashboard'
import { Card, CardHeader, StatCard, Badge, EmptyState } from '@/components/ui/primitives'
import { MyTaskBoard, type AssignedTask } from '@/components/employee/MyTaskBoard'
import { DepartmentTaskInbox } from '@/components/shared/DepartmentTaskInbox'
import { PulseAIPanel } from '@/components/shared/PulseAIPanel'
import { formatCurrency, formatDate, daysOverdue } from '@/lib/format'

export const dynamic = 'force-dynamic'

const TASK_SELECT =
  '*, department:departments!tasks_assigned_department_id_fkey(name), creator:users!tasks_created_by_fkey(full_name)'

/**
 * The Finance home. Headline outstanding figures, the pending-handoffs panel (completed work
 * from Sales/O&M with no invoice yet — the single most important queue for a Finance person),
 * outstanding receivables and payables, the lead's delegation inbox, and the person's own
 * tasks.
 *
 * RLS does the scoping: an exec's outstanding lists and stats reflect only rows they own,
 * while a lead/CEO sees the department. So the same page is naturally personal for an exec
 * and team-wide for a lead — no separate toggle needed, the data layer decides. Reports (the
 * sensitive aggregates) are reached only through the gated Reports page, never surfaced here.
 */
export default async function FinanceDashboardPage() {
  const user = await requireAnyDepartment([...FINANCE_DEPARTMENT_SLUGS])
  const lead = isFinanceLead(user)
  const supabase = await createSupabaseServerClient()

  const [stats, handoffs, outInvoices, outBills, pendingApprovals, taskResult] = await Promise.all([
    getFinanceDashboardStats(),
    getPendingHandoffs(6),
    getOutstandingInvoices(),
    getOutstandingBills(),
    getPendingPurchaseOrderApprovals(),
    supabase
      .from('tasks')
      .select(TASK_SELECT)
      .eq('assigned_user_id', user.id)
      .neq('status', 'archived')
      .order('due_date', { ascending: true, nullsFirst: false }),
  ])

  const myTasks = (taskResult.data ?? []) as unknown as AssignedTask[]
  const myInvoices = outInvoices.slice(0, 6)
  const billsDueSoon = outBills.slice(0, 6)

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">
          Welcome back, {firstName(user.full_name)}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Billing, payments, and reconciliation across the company.
        </p>
      </header>

      <PulseAIPanel user={user} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Receivable"
          value={formatCurrency(stats.outstandingReceivable)}
          hint={`${stats.invoicesDue} invoice${stats.invoicesDue === 1 ? '' : 's'} due`}
          tone="brand"
        />
        <StatCard
          label="Payable"
          value={formatCurrency(stats.outstandingPayable)}
          tone={stats.outstandingPayable > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Awaiting invoice"
          value={stats.pendingHandoffs}
          hint="Completed deals & installs"
          tone={stats.pendingHandoffs > 0 ? 'warning' : 'default'}
        />
        <StatCard label="My open tasks" value={myTasks.length} />
      </div>

      {pendingApprovals.length > 0 && (
        <Link
          href="/finance/approvals"
          className="flex items-center justify-between gap-3 rounded-2xl border border-status-warning/30 bg-status-warning/5 px-5 py-4 transition-colors hover:bg-status-warning/10"
        >
          <div>
            <p className="text-sm font-semibold text-brand-slate">
              {pendingApprovals.length} purchase order
              {pendingApprovals.length === 1 ? '' : 's'} awaiting your approval
            </p>
            <p className="mt-0.5 text-xs text-text-muted">
              Distribution can&apos;t dispatch material until Finance signs these off.
            </p>
          </div>
          <span className="shrink-0 text-xs font-medium text-brand-slate">Review →</span>
        </Link>
      )}

      <Card>
        <CardHeader
          title="Awaiting an invoice"
          subtitle="Closed deals and completed installations with no invoice yet — start billing from here."
          action={
            <Link
              href="/finance/invoices/new"
              className="text-xs font-medium text-brand-slate hover:text-brand-gold"
            >
              New invoice →
            </Link>
          }
        />
        {handoffs.length === 0 ? (
          <EmptyState
            title="Nothing waiting"
            description="Every completed deal and installation has been invoiced."
          />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {handoffs.map((h) => (
              <li
                key={`${h.kind}:${h.source_id}`}
                className="flex items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-brand-slate">
                    {h.customer_name ?? 'Customer'}
                  </p>
                  <p className="text-xs text-text-muted">
                    {h.kind === 'deal' ? 'Closed deal' : 'Completed installation'}
                    {h.reference ? ` · ${h.reference}` : ''}
                    {h.when ? ` · ${formatDate(h.when)}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {h.amount != null && (
                    <span className="text-sm font-semibold tabular-nums text-brand-slate">
                      {formatCurrency(h.amount)}
                    </span>
                  )}
                  <Badge className={h.kind === 'deal' ? 'badge-info' : 'badge-neutral'}>
                    {h.kind === 'deal' ? 'Sales' : 'O&M'}
                  </Badge>
                  <Link
                    href={`/finance/invoices/new?handoff=${h.kind}:${h.source_id}`}
                    className="shrink-0 rounded-lg bg-brand-gold px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-orange"
                  >
                    Bill →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {lead && <DelegationInbox organizationId={user.organization_id} />}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Invoices awaiting payment"
            action={
              <Link
                href="/finance/outstanding?tab=receivables"
                className="text-xs font-medium text-brand-slate hover:text-brand-gold"
              >
                All →
              </Link>
            }
          />
          {myInvoices.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-text-muted">Nothing outstanding.</p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {myInvoices.map((inv) => {
                const overdue = daysOverdue(inv.due_date, inv.status)
                return (
                  <li key={inv.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/finance/invoices/${inv.id}`}
                        className="truncate text-sm font-medium text-brand-slate hover:text-brand-gold"
                      >
                        {inv.invoice_number}
                      </Link>
                      <p className="text-xs text-text-muted">
                        {inv.customer?.name ?? '—'}
                        {overdue > 0 && (
                          <span className="ml-1 font-medium text-status-danger">
                            · {overdue}d overdue
                          </span>
                        )}
                      </p>
                    </div>
                    <span className="text-sm font-semibold tabular-nums text-brand-slate">
                      {formatCurrency(inv.balance)}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Bills to pay"
            action={
              <Link
                href="/finance/outstanding?tab=payables"
                className="text-xs font-medium text-brand-slate hover:text-brand-gold"
              >
                All →
              </Link>
            }
          />
          {billsDueSoon.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-text-muted">Nothing to pay.</p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {billsDueSoon.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/finance/purchases/${b.id}`}
                      className="truncate text-sm font-medium text-brand-slate hover:text-brand-gold"
                    >
                      {b.vendor_name}
                    </Link>
                    <p className="text-xs text-text-muted">
                      {b.due_date ? `Due ${formatDate(b.due_date)}` : 'No due date'}
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-brand-slate">
                    {formatCurrency(b.balance)}
                  </span>
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

/** The lead-only delegation inbox — CEO tasks handed to Finance without a named owner. */
async function DelegationInbox({ organizationId }: { organizationId: string }) {
  const departmentId = await getFinanceDepartmentId(organizationId)
  const [employees, unowned] = await Promise.all([
    getFinanceEmployees(organizationId),
    getUnownedFinanceTasks(organizationId, departmentId),
  ])
  const inboxTasks = unowned as unknown as AssignedTask[]

  return (
    <Card>
      <CardHeader
        title="Tasks awaiting delegation"
        subtitle="Assigned to Finance without a named owner. Delegating moves it to that person's dashboard."
      />
      {inboxTasks.length === 0 ? (
        <EmptyState
          title="Nothing waiting to be delegated"
          description="CEO tasks assigned to Finance without a named person land here."
        />
      ) : (
        <DepartmentTaskInbox tasks={inboxTasks} employees={employees} departmentName="Finance" />
      )}
    </Card>
  )
}

function firstName(fullName: string): string {
  return fullName.split(' ')[0] || fullName
}
