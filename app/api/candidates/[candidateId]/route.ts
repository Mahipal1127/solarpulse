import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateCandidateSchema } from '@/lib/validation/schemas'
import { updateCandidate, ServiceError, HR_DEPARTMENT_SLUG } from '@/lib/services/hr'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Updates a candidate — moving them through the recruitment pipeline. */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/candidates/[candidateId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(HR_DEPARTMENT_SLUG)
    const { candidateId } = await ctx.params

    const parsed = updateCandidateSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid update payload', parsed.error.flatten())

    const candidate = await updateCandidate(user, candidateId, parsed.data)
    return NextResponse.json({ candidate })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
