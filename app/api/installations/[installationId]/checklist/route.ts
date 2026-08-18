import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { checklistItemCreateSchema, checklistItemUpdateSchema } from '@/lib/validation/schemas'
import {
  addChecklistItem,
  setChecklistItemChecked,
  ServiceError,
  OM_DEPARTMENT_SLUG,
} from '@/lib/services/operations'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Adds an ad-hoc checklist item on top of the seeded default list. */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/installations/[installationId]/checklist'>
) {
  try {
    const user = await requireDepartmentOrThrow(OM_DEPARTMENT_SLUG)
    const { installationId } = await ctx.params

    const parsed = checklistItemCreateSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid checklist payload', parsed.error.flatten())

    const item = await addChecklistItem(user, installationId, parsed.data)
    return NextResponse.json({ item }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}

/**
 * Ticks or un-ticks an item. The item id comes as ?itemId= rather than a path
 * segment, so toggling shares this route file with adding.
 */
export async function PATCH(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(OM_DEPARTMENT_SLUG)

    const itemId = request.nextUrl.searchParams.get('itemId')
    if (!itemId) return badRequest('Specify which itemId to update')

    const parsed = checklistItemUpdateSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid checklist payload', parsed.error.flatten())

    const item = await setChecklistItemChecked(user, itemId, parsed.data)
    return NextResponse.json({ item })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
