import { NextResponse, type NextRequest } from 'next/server'
import { requireAnyDepartmentOrThrow } from '@/lib/auth/guards'
import { updateGstFilingSchema } from '@/lib/validation/schemas'
import { updateGstFiling, ServiceError, FINANCE_DEPARTMENT_SLUGS } from '@/lib/services/finance'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Updates a GST filing — adjusting figures or marking it filed (stamps filed_date). */
export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/tax/gst/[filingId]'>) {
  try {
    const user = await requireAnyDepartmentOrThrow([...FINANCE_DEPARTMENT_SLUGS])
    const { filingId } = await ctx.params

    const parsed = updateGstFilingSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid GST filing payload', parsed.error.flatten())

    const filing = await updateGstFiling(user, filingId, parsed.data)
    return NextResponse.json({ filing })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
