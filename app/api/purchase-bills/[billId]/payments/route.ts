import { NextResponse, type NextRequest } from 'next/server'
import { requireAnyDepartmentOrThrow } from '@/lib/auth/guards'
import { recordVendorPaymentSchema } from '@/lib/validation/schemas'
import { recordVendorPayment, ServiceError, FINANCE_DEPARTMENT_SLUGS } from '@/lib/services/finance'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Records a vendor payment against a bill. Runs record_vendor_payment(): the payment, the
 * recomputed bill status, and a matching cash-flow outflow — one transaction.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/purchase-bills/[billId]/payments'>
) {
  try {
    const user = await requireAnyDepartmentOrThrow([...FINANCE_DEPARTMENT_SLUGS])
    const { billId } = await ctx.params

    const parsed = recordVendorPaymentSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid vendor payment payload', parsed.error.flatten())

    const result = await recordVendorPayment(user, billId, parsed.data)
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
