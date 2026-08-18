import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateNetMeteringSchema } from '@/lib/validation/schemas'
import { updateNetMetering, ServiceError, DISCOM_DEPARTMENT_SLUG } from '@/lib/services/discom'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Edits an application's details. Deliberately cannot change status — that goes
 * through POST /status so a status-history row is always written. updateNetMetering
 * rejects a status field server-side even if one slips past the schema.
 */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/net-metering/[applicationId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(DISCOM_DEPARTMENT_SLUG)
    const { applicationId } = await ctx.params

    const parsed = updateNetMeteringSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid update payload', parsed.error.flatten())

    const application = await updateNetMetering(user, applicationId, parsed.data)
    return NextResponse.json({ application })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
