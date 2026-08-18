import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { netMeteringStatusChangeSchema } from '@/lib/validation/schemas'
import { changeNetMeteringStatus, ServiceError, DISCOM_DEPARTMENT_SLUG } from '@/lib/services/discom'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * The ONLY way an application's status changes. Moving status here appends a
 * net_metering_status_history row, which is what the staleness dashboard's
 * days-in-current-status clock reads. The ordinary PATCH endpoint refuses status
 * edits precisely so every move lands here and leaves an aging trail.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/net-metering/[applicationId]/status'>
) {
  try {
    const user = await requireDepartmentOrThrow(DISCOM_DEPARTMENT_SLUG)
    const { applicationId } = await ctx.params

    const parsed = netMeteringStatusChangeSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid status payload', parsed.error.flatten())

    const application = await changeNetMeteringStatus(user, applicationId, parsed.data)
    return NextResponse.json({ application })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
