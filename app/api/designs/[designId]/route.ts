import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateDesignSchema } from '@/lib/validation/schemas'
import {
  updateDesign,
  ServiceError,
  TECHNICAL_DEPARTMENT_SLUG,
} from '@/lib/services/technical'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Updates a design's figures, BOQ or status.
 *
 * Two rules the service enforces and this route relies on: the status change must
 * be an edge in DESIGN_TRANSITIONS, and a design already sent to Sales is frozen —
 * a quotation may rest on its numbers, so a revision is a new design rather than an
 * edit to the old one.
 */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/designs/[designId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(TECHNICAL_DEPARTMENT_SLUG)
    const { designId } = await ctx.params

    const parsed = updateDesignSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid design payload', parsed.error.flatten())

    const design = await updateDesign(user, designId, parsed.data)
    return NextResponse.json({ design })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
