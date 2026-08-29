import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow, isReadOnlyFor } from '@/lib/auth/guards'
import { MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'
import { commitPlanSchema } from '@/lib/validation/schemas'
import { commitPlan, ServiceError } from '@/lib/services/marketing-creative'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Commit selected proposed items into the real content calendar.
 *
 * This is the one place the AI Calendar touches live calendar data, and only on the user's
 * explicit commit. The service validates the chosen indices against the stored plan, so a
 * request cannot create a calendar item that was never proposed, and the committed items are
 * owned by the committer (content_calendar_items.assigned_to is NOT NULL). CEO refused by
 * isReadOnlyFor.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/marketing/content-plans/[planId]/commit'>
) {
  try {
    const user = await requireDepartmentOrThrow(MARKETING_DEPARTMENT_SLUG)
    if (isReadOnlyFor(user, MARKETING_DEPARTMENT_SLUG)) {
      return NextResponse.json(
        { error: 'Read-only — the Marketing team commits calendar items.' },
        { status: 403 }
      )
    }

    const { planId } = await ctx.params
    const parsed = commitPlanSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid commit request', parsed.error.flatten())

    const result = await commitPlan(user, planId, parsed.data.item_indices)
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
