import { NextResponse } from 'next/server'
import { requireDepartmentOrThrow, isReadOnlyFor } from '@/lib/auth/guards'
import { MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'
import { deleteLibraryEntry, ServiceError } from '@/lib/services/marketing-creative'
import { errorResponse } from '@/lib/api/responses'

/**
 * Remove one reference from the library.
 *
 * Deleting an 'ai_approved' example is allowed — the team curating what the model learns from
 * is the point of the loop, not a corruption of it. RLS scopes the delete to the org; the CEO
 * is refused by isReadOnlyFor.
 */
export async function DELETE(
  _request: Request,
  ctx: RouteContext<'/api/marketing/script-library/[entryId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(MARKETING_DEPARTMENT_SLUG)
    if (isReadOnlyFor(user, MARKETING_DEPARTMENT_SLUG)) {
      return NextResponse.json(
        { error: 'Read-only — the Marketing team maintains the reference library.' },
        { status: 403 }
      )
    }

    const { entryId } = await ctx.params
    await deleteLibraryEntry(user, entryId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
