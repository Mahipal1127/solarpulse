import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { closeDealSchema } from '@/lib/validation/schemas'
import { closeDeal, ServiceError, SALES_DEPARTMENT_SLUG } from '@/lib/services/sales'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Atomic deal closure. One RPC call into close_deal(), which creates the
 * customer, writes the deal_closures row, and sets lead.status = 'won' in a
 * single statement — so a failure part-way through cannot leave a closure
 * without a customer, or a won lead with no closure record.
 */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/leads/[leadId]/close'>) {
  try {
    const user = await requireDepartmentOrThrow(SALES_DEPARTMENT_SLUG)
    const { leadId } = await ctx.params

    const parsed = closeDealSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid closure payload', parsed.error.flatten())

    const { closureId } = await closeDeal(user, leadId, parsed.data)
    return NextResponse.json({ closureId }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
