import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateSubsidySchema } from '@/lib/validation/schemas'
import { updateSubsidy, ServiceError, DISCOM_DEPARTMENT_SLUG } from '@/lib/services/discom'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Edits a subsidy case's details, including the disbursed amount. Cannot change
 * status — that goes through POST /status so a subsidy_status_history row is written.
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/subsidy/[caseId]'>) {
  try {
    const user = await requireDepartmentOrThrow(DISCOM_DEPARTMENT_SLUG)
    const { caseId } = await ctx.params

    const parsed = updateSubsidySchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid update payload', parsed.error.flatten())

    const subsidyCase = await updateSubsidy(user, caseId, parsed.data)
    return NextResponse.json({ subsidyCase })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
