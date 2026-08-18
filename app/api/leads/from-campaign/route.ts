import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createMarketingLeadSchema } from '@/lib/validation/schemas'
import { createMarketingLead, ServiceError, MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * The Marketing → Sales handoff (§3.4), the reason this module sits ahead of Sales in
 * the pipeline. Delegates to createMarketingLead, which calls the create_marketing_
 * lead RPC (migration 0014): one transaction that inserts an unassigned inbound Sales
 * lead, the lead_sources trace row, and bumps the campaign counter. If any step
 * fails, the whole thing rolls back — a lead never lands without its source trace.
 *
 * Returns only the new lead's id: Marketing has no read access to Sales' leads by
 * design (it can originate an inbound lead but never read or steer Sales' pipeline).
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(MARKETING_DEPARTMENT_SLUG)

    const parsed = createMarketingLeadSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid lead payload', parsed.error.flatten())

    const { leadId } = await createMarketingLead(user, parsed.data)
    return NextResponse.json({ leadId }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
