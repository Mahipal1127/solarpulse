import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateQuotationSchema } from '@/lib/validation/schemas'
import { updateQuotation, ServiceError, SALES_DEPARTMENT_SLUG } from '@/lib/services/sales'
import { errorResponse, badRequest } from '@/lib/api/responses'

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/quotations/[quotationId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(SALES_DEPARTMENT_SLUG)
    const { quotationId } = await ctx.params

    const parsed = updateQuotationSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid quotation payload', parsed.error.flatten())

    // Moving a quotation to 'sent' also advances the parent lead — handled in
    // the service so every caller gets the same behaviour.
    const quotation = await updateQuotation(user, quotationId, parsed.data)
    return NextResponse.json({ quotation })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
