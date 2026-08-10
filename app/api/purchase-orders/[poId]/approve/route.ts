import { NextResponse, type NextRequest } from 'next/server'
import { requireAnyDepartmentOrThrow } from '@/lib/auth/guards'
import { approvePurchaseOrderSchema } from '@/lib/validation/schemas'
import {
  approvePurchaseOrder,
  ServiceError,
  PO_APPROVER_DEPARTMENT_SLUGS,
} from '@/lib/services/distribution'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * The Finance approval gate: the only route that can move a purchase order to
 * 'approved'.
 *
 * The company workflow in the blueprint puts Finance approval before Distribution
 * dispatches material, so the department that raises a PO is not the one that
 * signs it off. That is enforced three ways, none of which relies on the frontend
 * hiding a button:
 *
 *   1. this guard, which admits Finance (and Accounts, its child department) or
 *      the CEO — note it is deliberately NOT requireDepartmentOrThrow('distribution'),
 *      since a Distribution member must fail here;
 *   2. the finance_approve_purchase_orders RLS policy, which is what allows a
 *      Finance user — who has no Distribution membership — to update the row;
 *   3. enforce_po_approval_authority(), a database trigger that compares the old
 *      status to the new one and raises if the caller is not Finance or the CEO.
 *      It is the only one of the three that cannot be routed around, and it also
 *      stamps approved_by from auth.uid() so the record of who approved cannot be
 *      forged.
 *
 * Approving a PO that was never submitted (still 'draft') is rejected with a 400
 * by the transition table, so approval cannot be used to skip its own queue.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/purchase-orders/[poId]/approve'>
) {
  try {
    const user = await requireAnyDepartmentOrThrow(PO_APPROVER_DEPARTMENT_SLUGS)
    const { poId } = await ctx.params

    // An approval note is optional, so a bare POST is a valid approval.
    const parsed = approvePurchaseOrderSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return badRequest('Invalid approval payload', parsed.error.flatten())

    const purchaseOrder = await approvePurchaseOrder(user, poId, parsed.data)
    return NextResponse.json({ purchaseOrder })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
