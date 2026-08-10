import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createSiteVisitSchema } from '@/lib/validation/schemas'
import { createSiteVisitRequest, ServiceError, SALES_DEPARTMENT_SLUG } from '@/lib/services/sales'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Records Sales' request for Technical to survey this lead, and advances the
 * lead to 'site_visit_scheduled'. The survey itself belongs to the Technical
 * module, which does not exist yet.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/leads/[leadId]/site-visit'>
) {
  try {
    const user = await requireDepartmentOrThrow(SALES_DEPARTMENT_SLUG)
    const { leadId } = await ctx.params

    const parsed = createSiteVisitSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return badRequest('Invalid site visit payload', parsed.error.flatten())

    const siteVisit = await createSiteVisitRequest(user, leadId, parsed.data)
    return NextResponse.json({ siteVisit }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
