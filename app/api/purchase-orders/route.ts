import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createPurchaseOrderSchema } from '@/lib/validation/schemas'
import {
  createPurchaseOrder,
  ServiceError,
  DISTRIBUTION_DEPARTMENT_SLUG,
} from '@/lib/services/distribution'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Creates a purchase order with its line items in one transaction.
 *
 * The PO number is generated inside the database from a locked counter row, not
 * by the client and not from count(*) + 1 — two people creating a PO at the same
 * moment cannot be handed the same number. total_amount is likewise never
 * accepted from the request; the recompute trigger derives it from the lines.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(DISTRIBUTION_DEPARTMENT_SLUG)

    const parsed = createPurchaseOrderSchema.safeParse(await request.json())
    if (!parsed.success) {
      return badRequest('Invalid purchase order payload', parsed.error.flatten())
    }

    // A new PO lands on 'draft' or 'pending_finance_approval' — never 'approved'.
    // Reaching approval is Finance's transition, at POST .../[poId]/approve.
    const purchaseOrder = await createPurchaseOrder(user, parsed.data)
    return NextResponse.json({ purchaseOrder }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
