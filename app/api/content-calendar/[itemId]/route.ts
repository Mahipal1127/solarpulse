import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateContentItemSchema } from '@/lib/validation/schemas'
import { updateContentItem, ServiceError, MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Edits a content item — status progression (planned → in_production → ready →
 * posted, or skipped), reassignment, caption and scheduling. Unlike DISCOM's cases,
 * content status is an ordinary field with no history table, so it lives here.
 */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/content-calendar/[itemId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(MARKETING_DEPARTMENT_SLUG)
    const { itemId } = await ctx.params

    const parsed = updateContentItemSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid update payload', parsed.error.flatten())

    const item = await updateContentItem(user, itemId, parsed.data)
    return NextResponse.json({ item })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
