import { NextResponse } from 'next/server'
import { requireDepartmentOrThrow, isReadOnlyFor } from '@/lib/auth/guards'
import { MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'
import { disconnectAccount, ServiceError } from '@/lib/services/instagram'
import { errorResponse } from '@/lib/api/responses'

/**
 * Disconnect an account.
 *
 * Cascades to its posts and audits (0020), which is deliberate rather than incidental: this
 * is the only way collected Instagram data can be erased, since there is no per-post
 * delete. Deleting the account row is therefore the "remove everything we gathered"
 * action, and the confirmation in the UI says so.
 */
export async function DELETE(
  _request: Request,
  ctx: RouteContext<'/api/instagram/accounts/[accountId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(MARKETING_DEPARTMENT_SLUG)
    if (isReadOnlyFor(user, MARKETING_DEPARTMENT_SLUG)) {
      return NextResponse.json(
        { error: 'Read-only — the Marketing team manages the connection.' },
        { status: 403 }
      )
    }

    const { accountId } = await ctx.params
    await disconnectAccount(user, accountId)

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
