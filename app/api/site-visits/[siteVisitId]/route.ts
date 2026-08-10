import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateSiteVisitSchema } from '@/lib/validation/schemas'
import { updateSiteVisitRequest, ServiceError, SALES_DEPARTMENT_SLUG } from '@/lib/services/sales'
import { errorResponse, badRequest } from '@/lib/api/responses'

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/site-visits/[siteVisitId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(SALES_DEPARTMENT_SLUG)
    const { siteVisitId } = await ctx.params

    const parsed = updateSiteVisitSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid site visit payload', parsed.error.flatten())

    const siteVisit = await updateSiteVisitRequest(user, siteVisitId, parsed.data)
    return NextResponse.json({ siteVisit })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
