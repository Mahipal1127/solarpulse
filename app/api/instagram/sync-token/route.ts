import { NextResponse } from 'next/server'
import { requireDepartmentOrThrow, isReadOnlyFor } from '@/lib/auth/guards'
import { MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'
import { issueSyncToken, SYNC_TOKEN_TTL_MINUTES, ServiceError } from '@/lib/services/instagram'
import { errorResponse } from '@/lib/api/responses'

/**
 * Mint a single-use token for the local collection tool.
 *
 * WHY THIS EXISTS AT ALL. The tool runs on a Marketing member's own laptop, because a
 * logged-in browser session cannot live in a serverless function — that is not a policy
 * choice, it simply cannot work there. So the tool has no ERP cookie and needs some way to
 * say who it is acting for. This is the narrowest thing that does the job: valid for
 * SYNC_TOKEN_TTL_MINUTES, usable exactly once, and authorising exactly one action — posting
 * collected data for an account this org already connected.
 *
 * POST, not GET, although it reads nothing: it creates a credential, and a credential must
 * never be mintable by a link someone can be tricked into following.
 *
 * The plaintext is returned once, here, and there is no endpoint that reads it back. RLS
 * denies instagram_sync_tokens to every client (0020), so after this response the only copy
 * is in the operator's terminal.
 */
export async function POST() {
  try {
    const user = await requireDepartmentOrThrow(MARKETING_DEPARTMENT_SLUG)

    // The CEO reads audits; they do not run the collection tool. Enforced here because the
    // token is minted through the service-role client, which bypasses RLS.
    if (isReadOnlyFor(user, MARKETING_DEPARTMENT_SLUG)) {
      return NextResponse.json(
        { error: 'Read-only — the Marketing team runs the collection tool.' },
        { status: 403 }
      )
    }

    const { token, expiresAt } = await issueSyncToken(user)

    return NextResponse.json({
      token,
      expiresAt,
      ttlMinutes: SYNC_TOKEN_TTL_MINUTES,
    })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
