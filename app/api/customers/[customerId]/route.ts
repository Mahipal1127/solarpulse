import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateCustomerSchema } from '@/lib/validation/schemas'
import { updateCustomer, ServiceError, SALES_DEPARTMENT_SLUG } from '@/lib/services/sales'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Edits a customer's contact details.
 *
 * lead_id is not settable — the customer↔lead link is close_deal()'s to write,
 * together with its closure row. See the schema for the full reasoning.
 */
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ customerId: string }> }
) {
  try {
    const user = await requireDepartmentOrThrow(SALES_DEPARTMENT_SLUG)
    const { customerId } = await ctx.params

    const parsed = updateCustomerSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid customer payload', parsed.error.flatten())

    const customer = await updateCustomer(user, customerId, parsed.data)
    return NextResponse.json({ customer })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
