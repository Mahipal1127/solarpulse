import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateInventoryItemSchema } from '@/lib/validation/schemas'
import { updateInventoryItem, ServiceError, STORE_DEPARTMENT_SLUG } from '@/lib/services/store'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Edits an item's catalogue fields. Never touches quantity — there is no quantity to edit. */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/inventory/[itemId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(STORE_DEPARTMENT_SLUG)
    const { itemId } = await ctx.params

    const parsed = updateInventoryItemSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid update payload', parsed.error.flatten())

    const item = await updateInventoryItem(user, itemId, parsed.data)
    return NextResponse.json({ item })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
