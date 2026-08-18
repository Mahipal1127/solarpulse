import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateAmcVisitSchema } from '@/lib/validation/schemas'
import { updateAmcVisit, ServiceError, OM_DEPARTMENT_SLUG } from '@/lib/services/operations'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Completes or reschedules a visit. Top-level route (not nested under the contract):
 * a visit id is globally unique and the caller acting on one already has it, so
 * threading the contract id through the URL would buy nothing.
 */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/amc-visits/[visitId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(OM_DEPARTMENT_SLUG)
    const { visitId } = await ctx.params

    const parsed = updateAmcVisitSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid visit payload', parsed.error.flatten())

    const visit = await updateAmcVisit(user, visitId, parsed.data)
    return NextResponse.json({ visit })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
