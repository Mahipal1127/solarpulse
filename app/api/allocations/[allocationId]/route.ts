import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateAllocationSchema } from '@/lib/validation/schemas'
import {
  updateAllocation,
  ServiceError,
  DISTRIBUTION_DEPARTMENT_SLUG,
} from '@/lib/services/distribution'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Cancels an allocation, or marks a dispatched one returned.
 *
 * 'dispatched' is not in this endpoint's vocabulary. An allocation reaches that
 * state only through POST /api/dispatches, which sets linked_dispatch_id in the
 * same transaction — allowing it here would let someone mark material dispatched
 * with no dispatch behind it, and the plan record would be lying.
 */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/allocations/[allocationId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(DISTRIBUTION_DEPARTMENT_SLUG)
    const { allocationId } = await ctx.params

    const parsed = updateAllocationSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid update payload', parsed.error.flatten())

    const allocation = await updateAllocation(user, allocationId, parsed.data)
    return NextResponse.json({ allocation })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
