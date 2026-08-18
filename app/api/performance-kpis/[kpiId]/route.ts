import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateKpiSchema } from '@/lib/validation/schemas'
import { updateKpi, ServiceError, HR_DEPARTMENT_SLUG } from '@/lib/services/hr'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Updates a KPI — recording actuals and marking it met/not met. HR-lead / CEO only. */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/performance-kpis/[kpiId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(HR_DEPARTMENT_SLUG)
    const { kpiId } = await ctx.params

    const parsed = updateKpiSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid update payload', parsed.error.flatten())

    const kpi = await updateKpi(user, kpiId, parsed.data)
    return NextResponse.json({ kpi })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
