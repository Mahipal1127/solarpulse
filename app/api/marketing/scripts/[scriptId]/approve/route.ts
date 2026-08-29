import { NextResponse } from 'next/server'
import { requireDepartmentOrThrow, isReadOnlyFor } from '@/lib/auth/guards'
import { MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'
import { approveScript, ServiceError } from '@/lib/services/marketing-creative'
import { errorResponse } from '@/lib/api/responses'

/**
 * Approve a script — and close the refinement loop.
 *
 * approveScript flips the status AND copies the script into the reference library as
 * 'ai_approved', which is what makes future generations write in the approved house style.
 * That is the "goes to training data" the user asked for: not fine-tuning, but a growing set
 * of worked examples the model is shown each time. POST, not PATCH: it is a discrete action
 * with a side effect, not a field edit. CEO refused by isReadOnlyFor.
 */
export async function POST(
  _request: Request,
  ctx: RouteContext<'/api/marketing/scripts/[scriptId]/approve'>
) {
  try {
    const user = await requireDepartmentOrThrow(MARKETING_DEPARTMENT_SLUG)
    if (isReadOnlyFor(user, MARKETING_DEPARTMENT_SLUG)) {
      return NextResponse.json({ error: 'Read-only — the Marketing team approves scripts.' }, { status: 403 })
    }

    const { scriptId } = await ctx.params
    const script = await approveScript(user, scriptId)
    return NextResponse.json({ script })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
