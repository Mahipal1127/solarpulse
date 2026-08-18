import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { completionReportSchema } from '@/lib/validation/schemas'
import { submitCompletionReport, ServiceError, OM_DEPARTMENT_SLUG } from '@/lib/services/operations'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Files the completion report. Does NOT mark the installation completed — that is a
 * separate, deliberate PATCH, per §3.2. The UI prompts for it after this succeeds.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/installations/[installationId]/completion-report'>
) {
  try {
    const user = await requireDepartmentOrThrow(OM_DEPARTMENT_SLUG)
    const { installationId } = await ctx.params

    const parsed = completionReportSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid completion report payload', parsed.error.flatten())

    const report = await submitCompletionReport(user, installationId, parsed.data)
    return NextResponse.json({ report }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
