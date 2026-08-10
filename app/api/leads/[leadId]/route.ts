import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateLeadSchema } from '@/lib/validation/schemas'
import {
  updateLead,
  markLeadLost,
  ServiceError,
  SALES_DEPARTMENT_SLUG,
} from '@/lib/services/sales'
import { errorResponse, badRequest } from '@/lib/api/responses'

export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/leads/[leadId]'>) {
  try {
    const user = await requireDepartmentOrThrow(SALES_DEPARTMENT_SLUG)
    const { leadId } = await ctx.params

    const parsed = updateLeadSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid update payload', parsed.error.flatten())

    // Note: the schema rejects status 'won'. Winning a deal has to go through
    // POST /api/leads/[leadId]/close so the customer and closure rows are
    // written in the same transaction.
    const lead = await updateLead(user, leadId, parsed.data)
    return NextResponse.json({ lead })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}

/** Soft delete — marks the lead lost and keeps the row, with an optional reason. */
export async function DELETE(request: NextRequest, ctx: RouteContext<'/api/leads/[leadId]'>) {
  try {
    const user = await requireDepartmentOrThrow(SALES_DEPARTMENT_SLUG)
    const { leadId } = await ctx.params

    // A DELETE body is optional; a bare call just marks the lead lost.
    const body = await request.json().catch(() => ({}))
    const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 5000) : undefined

    const lead = await markLeadLost(user, leadId, reason)
    return NextResponse.json({ lead })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
