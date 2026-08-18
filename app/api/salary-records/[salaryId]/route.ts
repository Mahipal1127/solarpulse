import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateSalaryRecordSchema } from '@/lib/validation/schemas'
import { updateSalaryRecord, ServiceError, HR_DEPARTMENT_SLUG } from '@/lib/services/hr'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Updates a salary record — SENSITIVE TIER, HR-lead / CEO only. Editing the parts
 * re-derives net_payable at the database (generated column). Used to move a draft to
 * finalized/paid or correct an amount.
 */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/salary-records/[salaryId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(HR_DEPARTMENT_SLUG)
    const { salaryId } = await ctx.params

    const parsed = updateSalaryRecordSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid update payload', parsed.error.flatten())

    const record = await updateSalaryRecord(user, salaryId, parsed.data)
    return NextResponse.json({ record })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
