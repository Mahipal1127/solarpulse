import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateReturnSchema } from '@/lib/validation/schemas'
import {
  updateReturn,
  ServiceError,
  DISTRIBUTION_DEPARTMENT_SLUG,
} from '@/lib/services/distribution'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Moves a return out of 'pending'.
 *
 * TODO: this should eventually be confirmed by the Store department module, not
 * self-confirmed by Distribution. Store physically receives returned material, so
 * 'received_by_store' is properly Store's action to record — but that module does
 * not exist yet. Rather than fake a cross-department confirmation, Distribution
 * self-marks it for now and the audit row carries self_confirmed: true so the
 * trail does not later look like Store signed for it.
 */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/returns/[returnId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(DISTRIBUTION_DEPARTMENT_SLUG)
    const { returnId } = await ctx.params

    const parsed = updateReturnSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid update payload', parsed.error.flatten())

    const materialReturn = await updateReturn(user, returnId, parsed.data)
    return NextResponse.json({ return: materialReturn })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
