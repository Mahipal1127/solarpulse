import { NextResponse } from 'next/server'
import { requireDepartmentOrThrow, isReadOnlyFor } from '@/lib/auth/guards'
import { MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'
import { rejectScript, ServiceError } from '@/lib/services/marketing-creative'
import { errorResponse } from '@/lib/api/responses'

/**
 * Reject a draft. A rejected script is kept, not deleted — it stays in the list marked
 * rejected, so the team can see what they tried and why they passed on it, and it never
 * enters the reference library. CEO refused by isReadOnlyFor.
 */
export async function POST(
  _request: Request,
  ctx: RouteContext<'/api/marketing/scripts/[scriptId]/reject'>
) {
  try {
    const user = await requireDepartmentOrThrow(MARKETING_DEPARTMENT_SLUG)
    if (isReadOnlyFor(user, MARKETING_DEPARTMENT_SLUG)) {
      return NextResponse.json({ error: 'Read-only — the Marketing team reviews scripts.' }, { status: 403 })
    }

    const { scriptId } = await ctx.params
    const script = await rejectScript(user, scriptId)
    return NextResponse.json({ script })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
