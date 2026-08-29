import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow, isReadOnlyFor } from '@/lib/auth/guards'
import { MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'
import { addScriptReferenceSchema } from '@/lib/validation/schemas'
import { listLibrary, addLibraryEntry, ServiceError } from '@/lib/services/marketing-creative'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * The reference library — the two upload lanes ('own' and 'competitor'/'inspiration') plus the
 * 'ai_approved' examples the approve flow writes. GET returns all of it for the department and
 * the CEO; POST adds one reference.
 *
 * The schema accepts only 'own' | 'competitor' | 'inspiration' — a client cannot forge an
 * 'ai_approved' example, which is written server-side only when a real script is approved.
 * CEO refused on write by isReadOnlyFor.
 */
export async function GET() {
  try {
    await requireDepartmentOrThrow(MARKETING_DEPARTMENT_SLUG)
    const entries = await listLibrary()
    return NextResponse.json({ entries })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(MARKETING_DEPARTMENT_SLUG)
    if (isReadOnlyFor(user, MARKETING_DEPARTMENT_SLUG)) {
      return NextResponse.json(
        { error: 'Read-only — the Marketing team maintains the reference library.' },
        { status: 403 }
      )
    }

    const parsed = addScriptReferenceSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid reference', parsed.error.flatten())

    const entry = await addLibraryEntry(user, parsed.data)
    return NextResponse.json({ entry }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
