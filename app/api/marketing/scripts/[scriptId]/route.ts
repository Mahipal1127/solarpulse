import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow, isReadOnlyFor } from '@/lib/auth/guards'
import { MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'
import { updateScriptSchema } from '@/lib/validation/schemas'
import { updateScript, ServiceError } from '@/lib/services/marketing-creative'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Save the team's edits to a draft before they approve it.
 *
 * PATCH only; approve and reject are their own sub-routes so each is a distinct, auditable
 * action rather than a status field a general update could flip. The CEO is refused by
 * isReadOnlyFor.
 */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/marketing/scripts/[scriptId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(MARKETING_DEPARTMENT_SLUG)
    if (isReadOnlyFor(user, MARKETING_DEPARTMENT_SLUG)) {
      return NextResponse.json({ error: 'Read-only — the Marketing team edits scripts.' }, { status: 403 })
    }

    const { scriptId } = await ctx.params
    const parsed = updateScriptSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid script edit', parsed.error.flatten())

    const script = await updateScript(user, scriptId, parsed.data)
    return NextResponse.json({ script })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
