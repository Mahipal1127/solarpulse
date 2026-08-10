import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateBidSchema } from '@/lib/validation/schemas'
import { updateBid, ServiceError, TENDER_DEPARTMENT_SLUG } from '@/lib/services/tenders'
import { errorResponse, badRequest } from '@/lib/api/responses'

export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/bids/[bidId]'>) {
  try {
    const user = await requireDepartmentOrThrow(TENDER_DEPARTMENT_SLUG)
    const { bidId } = await ctx.params

    const parsed = updateBidSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid bid payload', parsed.error.flatten())

    const bid = await updateBid(user, bidId, parsed.data)
    return NextResponse.json({ bid })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
