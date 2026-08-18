import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { acknowledgeInsight, ServiceError, MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'
import { errorResponse } from '@/lib/api/responses'

/**
 * Acknowledges an AI marketing insight — the only write the team may make to that
 * table (there is no client insert path; the CEO module's AI system populates it via
 * the service-role client). The Marketing guard admits the CEO too, matching the RLS
 * update policy that lets both the team and the CEO acknowledge.
 */
export async function PATCH(
  _request: NextRequest,
  ctx: RouteContext<'/api/insights/[insightId]/acknowledge'>
) {
  try {
    const user = await requireDepartmentOrThrow(MARKETING_DEPARTMENT_SLUG)
    const { insightId } = await ctx.params

    await acknowledgeInsight(user, insightId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
