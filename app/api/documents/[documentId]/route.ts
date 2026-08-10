import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import {
  signDocumentDownload,
  deleteDocument,
  ServiceError,
  TENDER_DEPARTMENT_SLUG,
  SIGNED_URL_TTL_SECONDS,
} from '@/lib/services/tenders'
import { errorResponse } from '@/lib/api/responses'

/**
 * Returns a short-lived signed URL rather than streaming the file or exposing a
 * bucket path. The bucket is private; there is no public URL to fall back on.
 */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<'/api/documents/[documentId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(TENDER_DEPARTMENT_SLUG)
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

export async function DELETE(
  _request: NextRequest,
  ctx: RouteContext<'/api/documents/[documentId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(TENDER_DEPARTMENT_SLUG)
    const { documentId } = await ctx.params

    await deleteDocument(user, documentId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
