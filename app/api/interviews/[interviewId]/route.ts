import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateInterviewSchema } from '@/lib/validation/schemas'
import { updateInterview, ServiceError, HR_DEPARTMENT_SLUG } from '@/lib/services/hr'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Updates an interview — recording result and feedback, or rescheduling. */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/interviews/[interviewId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(HR_DEPARTMENT_SLUG)
    const { interviewId } = await ctx.params

    const parsed = updateInterviewSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid update payload', parsed.error.flatten())

    const interview = await updateInterview(user, interviewId, parsed.data)
    return NextResponse.json({ interview })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
