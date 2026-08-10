import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createProposalSchema } from '@/lib/validation/schemas'
import { createProposal, ServiceError, SALES_DEPARTMENT_SLUG } from '@/lib/services/sales'
import { errorResponse, badRequest } from '@/lib/api/responses'

export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/leads/[leadId]/proposals'>
) {
  try {
    const user = await requireDepartmentOrThrow(SALES_DEPARTMENT_SLUG)
    const { leadId } = await ctx.params

    const parsed = createProposalSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid proposal payload', parsed.error.flatten())

    // A cited quotation must belong to this same lead — checked in the service.
    const proposal = await createProposal(user, leadId, parsed.data)
    return NextResponse.json({ proposal }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
