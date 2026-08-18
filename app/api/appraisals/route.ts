import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createAppraisalSchema } from '@/lib/validation/schemas'
import { createAppraisal, ServiceError, HR_DEPARTMENT_SLUG } from '@/lib/services/hr'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Records an appraisal — SENSITIVE TIER, as private as pay. HR-lead / CEO only; the
 * employee reads their own via RLS (employee_view_own_appraisals). Access is logged
 * with logSensitiveAccess in the service layer.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(HR_DEPARTMENT_SLUG)

    const parsed = createAppraisalSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid appraisal payload', parsed.error.flatten())

    const appraisal = await createAppraisal(user, parsed.data)
    return NextResponse.json({ appraisal }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
