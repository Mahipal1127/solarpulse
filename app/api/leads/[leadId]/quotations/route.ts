import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createQuotationSchema } from '@/lib/validation/schemas'
import { createQuotation, ServiceError, SALES_DEPARTMENT_SLUG } from '@/lib/services/sales'
import { errorResponse, badRequest } from '@/lib/api/responses'

export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/leads/[leadId]/quotations'>
) {
  try {
    const user = await requireDepartmentOrThrow(SALES_DEPARTMENT_SLUG)
    const { leadId } = await ctx.params

    const parsed = createQuotationSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid quotation payload', parsed.error.flatten())

    const quotation = await createQuotation(user, leadId, parsed.data)
    return NextResponse.json({ quotation }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
