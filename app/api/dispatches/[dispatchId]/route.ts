import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateDispatchSchema } from '@/lib/validation/schemas'
import {
  updateDispatch,
  ServiceError,
  DISTRIBUTION_DEPARTMENT_SLUG,
} from '@/lib/services/distribution'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Delivery status updates. This is a manually-maintained field, not a tracking
 * integration — there is no GPS or carrier feed behind it, and dispatched_at /
 * delivered_at are stamped server-side when the status moves so a client clock
 * cannot backdate a departure or a delivery.
 */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/dispatches/[dispatchId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(DISTRIBUTION_DEPARTMENT_SLUG)
    const { dispatchId } = await ctx.params

    const parsed = updateDispatchSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid update payload', parsed.error.flatten())

    // Cancelling here releases any allocations this dispatch had claimed, back to
    // 'allocated' — handled by a database trigger so the invariant holds whichever
    // path cancels the dispatch.
    const dispatch = await updateDispatch(user, dispatchId, parsed.data)
    return NextResponse.json({ dispatch })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
