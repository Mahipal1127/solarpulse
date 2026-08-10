import { requireAnyDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { StatCard } from '@/components/ui/primitives'
import {
  PurchaseOrderList,
  type PurchaseOrderRow,
} from '@/components/distribution/PurchaseOrderList/PurchaseOrderList'
import {
  DISTRIBUTION_DEPARTMENT_SLUG,
  PO_APPROVER_DEPARTMENT_SLUGS,
} from '@/lib/services/distribution'
import { formatCurrency, isPurchaseOrderOverdue } from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * The one Distribution page Finance can reach, because approving is theirs to do.
 * Every other page in the module re-guards to Distribution alone.
 */
export default async function PurchaseOrdersPage() {
  const user = await requireAnyDepartment([
    DISTRIBUTION_DEPARTMENT_SLUG,
    ...PO_APPROVER_DEPARTMENT_SLUGS,
  ])
  const readOnly = isReadOnlyFor(user, DISTRIBUTION_DEPARTMENT_SLUG)
  // A Finance visitor, as opposed to the CEO looking in: the guard above admits
  // only these three kinds of caller, so anyone here who is neither Distribution
  // nor the CEO is an approver.
  const isApprover = readOnly && user.roleName !== 'CEO'

  const supabase = await createSupabaseServerClient()

  // No status filter here. Which orders come back is RLS's decision — Distribution
  // and Finance both get the department's whole register, from the same query.
  const { data } = await supabase
    .from('purchase_orders')
    .select('*, vendor:vendors(name)')
    .eq('organization_id', user.organization_id)
    .order('created_at', { ascending: false })
    .limit(500)

  const purchaseOrders = (data ?? []) as unknown as PurchaseOrderRow[]

  const awaitingApproval = purchaseOrders.filter(
    (po) => po.status === 'pending_finance_approval'
  )
  const overdue = purchaseOrders.filter(isPurchaseOrderOverdue)

  // Approved and beyond is money committed. A draft or an order still waiting on
  // Finance is not a commitment yet, so counting it would overstate the number.
  const committed = purchaseOrders
    .filter(
      (po) =>
        po.status !== 'draft' &&
        po.status !== 'pending_finance_approval' &&
        po.status !== 'cancelled'
    )
    .reduce((sum, po) => sum + Number(po.total_amount), 0)

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-slate">Purchase Orders</h1>
        <p className="mt-1 text-sm text-text-muted">
          {isApprover
            ? 'Orders Distribution has raised. Approving one releases it for ordering.'
            : 'Finance approval comes before material is ordered — an order cannot skip it.'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total Orders" value={purchaseOrders.length} />
        <StatCard
          label="Awaiting Finance"
          value={awaitingApproval.length}
          tone={awaitingApproval.length > 0 ? 'warning' : 'default'}
          hint={
            awaitingApproval.length > 0
              ? formatCurrency(
                  awaitingApproval.reduce((sum, po) => sum + Number(po.total_amount), 0)
                )
              : 'Nothing pending'
          }
        />
        <StatCard
          label="Overdue"
          value={overdue.length}
          tone={overdue.length > 0 ? 'danger' : 'default'}
          hint="Past expected delivery"
        />
        <StatCard
          label="Committed Value"
          value={formatCurrency(committed)}
          hint="Approved and later"
        />
      </div>

      <PurchaseOrderList
        purchaseOrders={purchaseOrders}
        readOnly={readOnly}
        approverView={isApprover}
      />
    </div>
  )
}
