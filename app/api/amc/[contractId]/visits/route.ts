import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { scheduleAmcVisitSchema } from '@/lib/validation/schemas'
import { scheduleAmcVisit, ServiceError, OM_DEPARTMENT_SLUG } from '@/lib/services/operations'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Schedules the next visit. v1 has no recurrence engine — visits are added by hand. */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/amc/[contractId]/visits'>
) {
  try {
    const user = await requireDepartmentOrThrow(OM_DEPARTMENT_SLUG)
    const { contractId } = await ctx.params

    const parsed = scheduleAmcVisitSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid visit payload', parsed.error.flatten())

    const visit = await scheduleAmcVisit(user, contractId, parsed.data)
    return NextResponse.json({ visit }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
