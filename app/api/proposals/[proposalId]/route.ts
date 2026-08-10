import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateProposalSchema } from '@/lib/validation/schemas'
import { updateProposal, ServiceError, SALES_DEPARTMENT_SLUG } from '@/lib/services/sales'
import { errorResponse, badRequest } from '@/lib/api/responses'

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/proposals/[proposalId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(SALES_DEPARTMENT_SLUG)
    const { proposalId } = await ctx.params

    const parsed = updateProposalSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid proposal payload', parsed.error.flatten())

    // 'sent' advances the lead to proposal_sent, 'accepted' to negotiation.
    // Accepting a proposal does NOT win the lead — that is the close endpoint.
    const proposal = await updateProposal(user, proposalId, parsed.data)
    return NextResponse.json({ proposal })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
