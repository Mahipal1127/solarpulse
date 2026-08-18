import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createGovernmentDocumentSchema } from '@/lib/validation/schemas'
import {
  addGovernmentDocument,
  signDocumentDownload,
  deleteGovernmentDocument,
  ServiceError,
  DISCOM_DEPARTMENT_SLUG,
  SIGNED_URL_TTL_SECONDS,
} from '@/lib/services/discom'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Records an already-uploaded government document. The browser uploads straight to
 * the private discom-documents bucket (governed by the storage policy), then calls
 * this so the row exists and the upload is audited.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(DISCOM_DEPARTMENT_SLUG)

    const parsed = createGovernmentDocumentSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid document payload', parsed.error.flatten())

    const document = await addGovernmentDocument(user, parsed.data)
    return NextResponse.json({ document }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}

/**
 * Mints a short-lived signed URL for one document. The bucket is private, so this is
 * the only way to read it. `?documentId=` picks which. Every read is audited as
 * sensitive access — these are personal documents (consumer ID proofs, bank
 * passbooks).
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(DISCOM_DEPARTMENT_SLUG)

    const documentId = request.nextUrl.searchParams.get('documentId')
    if (!documentId) return badRequest('Specify which documentId to sign')

    const { url, fileName } = await signDocumentDownload(user, documentId)
    return NextResponse.json({ url, fileName, expiresIn: SIGNED_URL_TTL_SECONDS })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}

/** Removes a document row. `?documentId=` picks which. */
export async function DELETE(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(DISCOM_DEPARTMENT_SLUG)

    const documentId = request.nextUrl.searchParams.get('documentId')
    if (!documentId) return badRequest('Specify which documentId to delete')

    await deleteGovernmentDocument(user, documentId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
