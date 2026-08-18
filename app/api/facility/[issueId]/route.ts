import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateFacilityLogSchema } from '@/lib/validation/schemas'
import { updateFacilityLog, ServiceError, STORE_DEPARTMENT_SLUG } from '@/lib/services/store'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Moves a facility issue's status. Resolving stamps resolved_by/resolved_at server-side. */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/facility/[issueId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(STORE_DEPARTMENT_SLUG)
    const { issueId } = await ctx.params

    const parsed = updateFacilityLogSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid update payload', parsed.error.flatten())

    const log = await updateFacilityLog(user, issueId, parsed.data)
    return NextResponse.json({ log })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
