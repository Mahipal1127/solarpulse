import { NextResponse, type NextRequest } from 'next/server'
import { requireUserOrThrow } from '@/lib/auth/guards'
import { signReportAttachment, ServiceError } from '@/lib/services/employee-reports'
import { errorResponse } from '@/lib/api/responses'

/**
 * Mints a short-lived signed URL for a report's attachment.
 *
 * POST rather than GET because it has a side effect — it audits the access and hands
 * out a bearer token. The service loads the row under RLS before signing anything, so
 * the author, their manager and the CEO get a link and nobody else gets one.
 */
export async function POST(
  _request: NextRequest,
  ctx: RouteContext<'/api/employee-reports/[reportId]/attachment'>
) {
  try {
    const user = await requireUserOrThrow()
    const { reportId } = await ctx.params

    const signed = await signReportAttachment(user, reportId)
    return NextResponse.json(signed)
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
