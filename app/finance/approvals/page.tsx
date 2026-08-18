import { requireAnyDepartment } from '@/lib/auth/guards'
import { FINANCE_DEPARTMENT_SLUGS, isFinanceMember } from '@/lib/services/finance'
import { getPendingPurchaseOrderApprovals } from '@/lib/finance/dashboard'
import { Card, CardHeader } from '@/components/ui/primitives'
import { PurchaseOrderApprovalList } from '@/components/finance/PurchaseOrderApprovalList'

export const dynamic = 'force-dynamic'

/**
 * Finance's approval queue — the mid-pipeline "Finance Approval" gate in the company
 * workflow. Distribution raises a purchase order and it waits at
 * 'pending_finance_approval' until Finance signs it off; only then can material dispatch.
 *
 * The capability already lives in Distribution's module (the approve route, the
 * finance_approve_purchase_orders RLS policy, and the enforce_po_approval_authority
 * trigger). This page just gives Finance a discoverable home for it, so a Finance user
 * doesn't have to navigate into Distribution's PO detail to approve. Any Finance/Accounts
 * member may approve (matching PO_APPROVER_DEPARTMENT_SLUGS); a CEO viewing sees the queue
 * read-only and follows the link through to approve on the PO itself.
 *
 * Budget and expense approvals run the other way — Finance requests, the CEO signs off on
 * the CEO Approvals page — so they are not surfaced here.
 */
export default async function FinanceApprovalsPage() {
  const user = await requireAnyDepartment([...FINANCE_DEPARTMENT_SLUGS])
  const canApprove = isFinanceMember(user)
  const orders = await getPendingPurchaseOrderApprovals()

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">Approvals</h1>
        <p className="mt-1 text-sm text-text-muted">
          Purchase orders from Distribution waiting on Finance sign-off. Approving one lets
          Distribution dispatch the material against it.
        </p>
      </header>

      <Card>
        <CardHeader title="Purchase orders awaiting approval" subtitle={`${orders.length} pending`} />
        <PurchaseOrderApprovalList orders={orders} readOnly={!canApprove} />
      </Card>
    </div>
  )
}
