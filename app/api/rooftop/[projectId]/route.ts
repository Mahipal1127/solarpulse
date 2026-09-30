import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateRooftopProjectSchema } from '@/lib/validation/schemas'
import {
  updateRooftopProject,
  ServiceError,
  ROOFTOP_DEPARTMENT_SLUG,
} from '@/lib/services/rooftop'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Updates a rooftop project — status transitions and site detail edits. */
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ projectId: string }> }
) {
  try {
    const user = await requireDepartmentOrThrow(ROOFTOP_DEPARTMENT_SLUG)
    const { projectId } = await ctx.params

    const parsed = updateRooftopProjectSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid rooftop project payload', parsed.error.flatten())

    const project = await updateRooftopProject(user, projectId, parsed.data)
    return NextResponse.json({ project })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
