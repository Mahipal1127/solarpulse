import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createDocumentSchema } from '@/lib/validation/schemas'
import { recordDocument, ServiceError, TENDER_DEPARTMENT_SLUG } from '@/lib/services/tenders'
import { errorResponse, badRequest } from '@/lib/api/responses'
import type { TenderDocument } from '@/lib/types'

/**
 * Registers a file the browser has already pushed to the private bucket. The
 * upload itself is governed by the storage policy; this route makes the row and
 * writes the audit entry.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/tenders/[tenderId]/documents'>
) {
  try {
    const user = await requireDepartmentOrThrow(TENDER_DEPARTMENT_SLUG)
    const { tenderId } = await ctx.params

    const parsed = createDocumentSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid document payload', parsed.error.flatten())

    const document = await recordDocument(user, tenderId, parsed.data)
    return NextResponse.json({ document }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}

/** Lists documents for a tender. Readable by the CEO as well as the department. */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<'/api/tenders/[tenderId]/documents'>
) {
  try {
    await requireDepartmentOrThrow(TENDER_DEPARTMENT_SLUG)
    const { tenderId } = await ctx.params

    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase
      .from('tender_documents')
      .select('id, tender_id, file_path, file_name, document_type, uploaded_by, created_at')
      .eq('tender_id', tenderId)
      .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    // No signed URLs here — a list response would leak N live links at once.
    // Callers mint one on demand via /api/documents/[documentId].
    return NextResponse.json({ documents: (data ?? []) as TenderDocument[] })
  } catch (err) {
    return errorResponse(err)
  }
}
