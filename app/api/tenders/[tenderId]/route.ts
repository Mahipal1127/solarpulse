import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateTenderSchema } from '@/lib/validation/schemas'
import {
  updateTender,
  cancelTender,
  ServiceError,
  TENDER_DEPARTMENT_SLUG,
} from '@/lib/services/tenders'
import { errorResponse, badRequest } from '@/lib/api/responses'

export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/tenders/[tenderId]'>) {
  try {
    const user = await requireDepartmentOrThrow(TENDER_DEPARTMENT_SLUG)
    const { tenderId } = await ctx.params

    const parsed = updateTenderSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid update payload', parsed.error.flatten())

    // Status transitions are validated inside updateTender, not here — the UI
    // only greys out invalid options, which is not enforcement.
    const tender = await updateTender(user, tenderId, parsed.data)
    return NextResponse.json({ tender })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}

/** Soft delete — moves the tender to 'cancelled' and keeps the row. */
export async function DELETE(
  _request: NextRequest,
  ctx: RouteContext<'/api/tenders/[tenderId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(TENDER_DEPARTMENT_SLUG)
    const { tenderId } = await ctx.params

    const tender = await cancelTender(user, tenderId)
    return NextResponse.json({ tender })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
