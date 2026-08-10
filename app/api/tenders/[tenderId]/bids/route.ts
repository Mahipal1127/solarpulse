import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createBidSchema } from '@/lib/validation/schemas'
import { createBid, ServiceError, TENDER_DEPARTMENT_SLUG } from '@/lib/services/tenders'
import { errorResponse, badRequest } from '@/lib/api/responses'

export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/tenders/[tenderId]/bids'>
) {
  try {
    const user = await requireDepartmentOrThrow(TENDER_DEPARTMENT_SLUG)
    const { tenderId } = await ctx.params

    const parsed = createBidSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid bid payload', parsed.error.flatten())

    const bid = await createBid(user, tenderId, parsed.data)
    return NextResponse.json({ bid }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
