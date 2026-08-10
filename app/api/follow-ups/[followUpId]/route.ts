import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateFollowUpSchema } from '@/lib/validation/schemas'
import { updateFollowUp, ServiceError, SALES_DEPARTMENT_SLUG } from '@/lib/services/sales'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Marks a follow-up completed or missed. completed_at is stamped server-side. */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/follow-ups/[followUpId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(SALES_DEPARTMENT_SLUG)
    const { followUpId } = await ctx.params

    const parsed = updateFollowUpSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid follow-up payload', parsed.error.flatten())

    const followUp = await updateFollowUp(user, followUpId, parsed.data)
    return NextResponse.json({ followUp })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
