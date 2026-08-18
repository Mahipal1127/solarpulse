import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { finalInspectionSchema } from '@/lib/validation/schemas'
import { recordInspection, ServiceError, OM_DEPARTMENT_SLUG } from '@/lib/services/operations'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Records a final inspection result. Does not gate installation completion in v1. */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/installations/[installationId]/inspection'>
) {
  try {
    const user = await requireDepartmentOrThrow(OM_DEPARTMENT_SLUG)
    const { installationId } = await ctx.params

    const parsed = finalInspectionSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid inspection payload', parsed.error.flatten())

    const inspection = await recordInspection(user, installationId, parsed.data)
    return NextResponse.json({ inspection }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
