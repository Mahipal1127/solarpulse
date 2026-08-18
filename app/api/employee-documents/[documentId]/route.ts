import { NextResponse, type NextRequest } from 'next/server'
import { requireUserOrThrow } from '@/lib/auth/guards'
import { signDocumentDownload, ServiceError, SIGNED_URL_TTL_SECONDS } from '@/lib/services/hr'
import { errorResponse } from '@/lib/api/responses'

/**
 * Mints a short-lived signed URL for one employee document. Open to any active user —
 * RLS decides what they can see (CEO + HR lead any; the employee their own folder), so
 * a document outside the caller's reach is a 404 and no URL is minted. Sensitive types
 * are logged with logSensitiveAccess in the service layer. The bucket is private; there
 * is no public URL to fall back on.
 */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<'/api/employee-documents/[documentId]'>
) {
  try {
    const user = await requireUserOrThrow()
    const { documentId } = await ctx.params

    const { url, fileName } = await signDocumentDownload(user, documentId)
    return NextResponse.json({ url, fileName, expiresIn: SIGNED_URL_TTL_SECONDS })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
