import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { subsidyStatusChangeSchema } from '@/lib/validation/schemas'
import { changeSubsidyStatus, ServiceError, DISCOM_DEPARTMENT_SLUG } from '@/lib/services/discom'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * The only way a subsidy case's status changes. Appends a subsidy_status_history
 * row, which the staleness dashboard's days-in-current-status clock reads.
 */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/subsidy/[caseId]/status'>) {
  try {
    const user = await requireDepartmentOrThrow(DISCOM_DEPARTMENT_SLUG)
    const { caseId } = await ctx.params

    const parsed = subsidyStatusChangeSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid status payload', parsed.error.flatten())

    const subsidyCase = await changeSubsidyStatus(user, caseId, parsed.data)
    return NextResponse.json({ subsidyCase })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
