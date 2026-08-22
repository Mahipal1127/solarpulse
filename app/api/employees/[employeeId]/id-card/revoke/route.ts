import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { HR_DEPARTMENT_SLUG } from '@/lib/services/hr'
import { assertCanManage, revokeAndReissueToken, ServiceError } from '@/lib/services/id-cards'
import { generateAndStoreCard } from '@/lib/services/card-render'
import { errorResponse } from '@/lib/api/responses'

/**
 * The "card reported lost" path — the ONLY endpoint that rotates a token.
 *
 * revokeAndReissueToken flips the old qr_tokens row inactive (its QR stops resolving instantly,
 * without touching the employee's login) and mints a fresh one, auditing id_card_token_revoked.
 * We then regenerate the card image so it carries the NEW QR. Contrast POST /id-card, which
 * re-renders against the existing token and never revokes.
 *
 * HR lead / CEO only — assertCanManage inside revokeAndReissueToken, echoed here so the refusal
 * is a clean 403 before any work begins.
 */
export async function POST(
  _request: NextRequest,
  ctx: RouteContext<'/api/employees/[employeeId]/id-card/revoke'>
) {
  try {
    const user = await requireDepartmentOrThrow(HR_DEPARTMENT_SLUG)
    assertCanManage(user)
    const { employeeId } = await ctx.params

    await revokeAndReissueToken(user, employeeId)
    const path = await generateAndStoreCard(employeeId)

    return NextResponse.json({ id_card_file_path: path }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
