import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createRooftopUpdateSchema } from '@/lib/validation/schemas'
import {
  addRooftopUpdate,
  ServiceError,
  ROOFTOP_DEPARTMENT_SLUG,
} from '@/lib/services/rooftop'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Appends an entry to a rooftop site's work log. */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ projectId: string }> }
) {
  try {
    const user = await requireDepartmentOrThrow(ROOFTOP_DEPARTMENT_SLUG)
    const { projectId } = await ctx.params

    const parsed = createRooftopUpdateSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid site update payload', parsed.error.flatten())

    const update = await addRooftopUpdate(user, projectId, parsed.data)
    return NextResponse.json({ update }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
