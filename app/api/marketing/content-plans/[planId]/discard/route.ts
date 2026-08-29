import { NextResponse } from 'next/server'
import { requireDepartmentOrThrow, isReadOnlyFor } from '@/lib/auth/guards'
import { MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'
import { discardPlan, ServiceError } from '@/lib/services/marketing-creative'
import { errorResponse } from '@/lib/api/responses'

/**
 * Discard a proposed plan. Marked 'discarded', not deleted, so the record of what was proposed
 * survives. CEO refused by isReadOnlyFor.
 */
export async function POST(
  _request: Request,
  ctx: RouteContext<'/api/marketing/content-plans/[planId]/discard'>
) {
  try {
    const user = await requireDepartmentOrThrow(MARKETING_DEPARTMENT_SLUG)
    if (isReadOnlyFor(user, MARKETING_DEPARTMENT_SLUG)) {
      return NextResponse.json(
        { error: 'Read-only — the Marketing team manages plans.' },
        { status: 403 }
      )
    }

    const { planId } = await ctx.params
    await discardPlan(user, planId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
