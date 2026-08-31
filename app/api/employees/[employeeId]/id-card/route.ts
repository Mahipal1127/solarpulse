import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { HR_DEPARTMENT_SLUG } from '@/lib/services/hr'
import { assertCanManage, signCardDownload, ServiceError } from '@/lib/services/id-cards'
import { generateAndStoreCard } from '@/lib/services/card-render'
import { logAction } from '@/lib/audit/log'
import { errorResponse } from '@/lib/api/responses'

/**
 * Generate or regenerate an employee's ID-card image.
 *
 * This is the COSMETIC path — it re-renders the PNG (e.g. after a new profile photo) against the
 * employee's EXISTING active token, so the old card's QR keeps resolving. It never rotates the
 * token; that is /id-card/revoke's job alone. generateAndStoreCard mints a token only if the
 * employee has none yet (first generation).
 *
 * HR-module gated at the route; assertCanManage narrows to HR lead / CEO inside — a plain HR
 * Executive is refused, matching the qr_tokens access tier.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/employees/[employeeId]/id-card'>
) {
  try {
    const user = await requireDepartmentOrThrow(HR_DEPARTMENT_SLUG)
    assertCanManage(user)
    const { employeeId } = await ctx.params

    const paths = await generateAndStoreCard(employeeId)

    await logAction({
      organizationId: user.organization_id,
      userId: user.id,
      action: 'id_card_generated',
      entityType: 'employee',
      entityId: employeeId,
      metadata: { front_path: paths.frontPath, back_path: paths.backPath },
    })

    return NextResponse.json(
      { id_card_file_path: paths.frontPath, id_card_back_file_path: paths.backPath },
      { status: 201 }
    )
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}

/**
 * Returns a short-lived signed URL for the employee's current card image (null if none generated
 * yet). Used by the ID-card view and the Download button.
 */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<'/api/employees/[employeeId]/id-card'>
) {
  try {
    const user = await requireDepartmentOrThrow(HR_DEPARTMENT_SLUG)
    const { employeeId } = await ctx.params

    const card = await signCardDownload(user, employeeId)
    if (!card) return NextResponse.json({ card: null })

    return NextResponse.json({ card })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
