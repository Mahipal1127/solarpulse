import { NextResponse, type NextRequest } from 'next/server'
import { requireAnyDepartmentOrThrow } from '@/lib/auth/guards'
import { recordReceiptSchema } from '@/lib/validation/schemas'
import { recordReceipt, ServiceError, FINANCE_DEPARTMENT_SLUGS } from '@/lib/services/finance'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Records a customer payment against an invoice. Runs record_customer_receipt(): the
 * receipt, the recomputed invoice status, and a matching cash-flow inflow — one transaction.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/invoices/[invoiceId]/receipts'>
) {
  try {
    const user = await requireAnyDepartmentOrThrow([...FINANCE_DEPARTMENT_SLUGS])
    const { invoiceId } = await ctx.params

    const parsed = recordReceiptSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid receipt payload', parsed.error.flatten())

    const result = await recordReceipt(user, invoiceId, parsed.data)
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
