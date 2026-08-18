import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createServiceReportSchema } from '@/lib/validation/schemas'
import { addServiceReport, ServiceError, OM_DEPARTMENT_SLUG } from '@/lib/services/operations'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Files a service report. This is what unlocks resolving the ticket; if the report
 * is marked resolved, the ticket is advanced to 'resolved' in the same call.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/service-tickets/[ticketId]/report'>
) {
  try {
    const user = await requireDepartmentOrThrow(OM_DEPARTMENT_SLUG)
    const { ticketId } = await ctx.params

    const parsed = createServiceReportSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid report payload', parsed.error.flatten())

    const { report, ticket } = await addServiceReport(user, ticketId, parsed.data)
    return NextResponse.json({ report, ticket }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
