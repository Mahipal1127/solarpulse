import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updatePurchaseOrderSchema } from '@/lib/validation/schemas'
import {
  updatePurchaseOrder,
  ServiceError,
  DISTRIBUTION_DEPARTMENT_SLUG,
} from '@/lib/services/distribution'
import { errorResponse, badRequest } from '@/lib/api/responses'

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/purchase-orders/[poId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(DISTRIBUTION_DEPARTMENT_SLUG)
    const { poId } = await ctx.params

    const parsed = updatePurchaseOrderSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid update payload', parsed.error.flatten())

    /**
     * The status vocabulary here excludes 'approved', so this endpoint cannot
     * reach it however the body is crafted. Distribution moves a PO
     * draft -> pending_finance_approval, and once Finance has approved it,
     * approved -> ordered -> partially_received -> received. Anything that skips
     * the approval step is not an edge in PO_TRANSITIONS and comes back a 400.
     */
    const purchaseOrder = await updatePurchaseOrder(user, poId, parsed.data)
    return NextResponse.json({ purchaseOrder })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
