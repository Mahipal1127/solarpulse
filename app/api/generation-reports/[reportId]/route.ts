import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import {
  signGenerationReportDownload,
  ServiceError,
  TECHNICAL_DEPARTMENT_SLUG,
  SIGNED_URL_TTL_SECONDS,
} from '@/lib/services/technical'
import { errorResponse } from '@/lib/api/responses'

/**
 * Mints a short-lived signed URL for a report's attached file — the PVsyst or
 * PVWatts output an engineer uploaded. Reports whose figures were typed in directly
 * have no file, and get a 404 with that said plainly.
 */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<'/api/generation-reports/[reportId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(TECHNICAL_DEPARTMENT_SLUG)
    const { reportId } = await ctx.params

    const { url, fileName } = await signGenerationReportDownload(user, reportId)
    return NextResponse.json({ url, fileName, expiresIn: SIGNED_URL_TTL_SECONDS })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
