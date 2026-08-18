import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateCampaignSchema } from '@/lib/validation/schemas'
import { updateCampaign, ServiceError, MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Updates a campaign — status, dates, budget, and the periodically-logged
 * amount_spent (no live ad-platform sync). leads_generated is owned by the lead
 * handoff and rejected here.
 */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/campaigns/[campaignId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(MARKETING_DEPARTMENT_SLUG)
    const { campaignId } = await ctx.params

    const parsed = updateCampaignSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid update payload', parsed.error.flatten())

    const campaign = await updateCampaign(user, campaignId, parsed.data)
    return NextResponse.json({ campaign })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
