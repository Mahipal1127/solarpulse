import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createKpiSchema } from '@/lib/validation/schemas'
import { createKpi, ServiceError, HR_DEPARTMENT_SLUG } from '@/lib/services/hr'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Sets a KPI for an employee. HR-lead / CEO only. The employee reads their own via RLS
 * (employee_view_own_kpis); a plain HR Executive cannot set or see others'.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(HR_DEPARTMENT_SLUG)

    const parsed = createKpiSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid KPI payload', parsed.error.flatten())

    const kpi = await createKpi(user, parsed.data)
    return NextResponse.json({ kpi }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
