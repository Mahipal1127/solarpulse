import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import {
  signSurveyPhotoDownload,
  ServiceError,
  TECHNICAL_DEPARTMENT_SLUG,
  SIGNED_URL_TTL_SECONDS,
} from '@/lib/services/technical'
import { errorResponse } from '@/lib/api/responses'

/**
 * Mints a short-lived signed URL for one photo. The survey-media bucket is
 * private, so this is the only way to read a file in it — there is no public URL
 * to fall back on.
 *
 * One photo per request, on purpose: the list endpoint returns metadata only,
 * because a gallery response carrying N signed links would hand out N bearer
 * tokens for customer property in a single call.
 */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<'/api/survey-photos/[photoId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(TECHNICAL_DEPARTMENT_SLUG)
    const { photoId } = await ctx.params

    const { url, fileName } = await signSurveyPhotoDownload(user, photoId)
    return NextResponse.json({ url, fileName, expiresIn: SIGNED_URL_TTL_SECONDS })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
