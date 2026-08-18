import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateDealerSchema } from '@/lib/validation/schemas'
import { updateDealer, ServiceError, STORE_DEPARTMENT_SLUG } from '@/lib/services/store'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Edits a dealer record (details or relationship status). */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/dealers/[dealerId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(STORE_DEPARTMENT_SLUG)
    const { dealerId } = await ctx.params

    const parsed = updateDealerSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid update payload', parsed.error.flatten())

    const dealer = await updateDealer(user, dealerId, parsed.data)
    return NextResponse.json({ dealer })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
