import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createCustomerSchema } from '@/lib/validation/schemas'
import { createCustomer, ServiceError, SALES_DEPARTMENT_SLUG } from '@/lib/services/sales'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Creates a customer directly, with no won lead behind it.
 *
 * The ordinary path remains POST /api/leads/[leadId]/close, whose close_deal()
 * RPC writes the customer and the closure together. This endpoint is the
 * documented direct-entry allowance of the customers table — a walk-in or a
 * service-only client — and takes no lead_id by design.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(SALES_DEPARTMENT_SLUG)

    const parsed = createCustomerSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid customer payload', parsed.error.flatten())

    const customer = await createCustomer(user, parsed.data)
    return NextResponse.json({ customer }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
