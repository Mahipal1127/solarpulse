import { NextResponse, type NextRequest } from 'next/server'
import { requireUserOrThrow } from '@/lib/auth/guards'
import { updateApplicationStatusSchema } from '@/lib/validation/schemas'
import { updateApplicationStatus, ServiceError } from '@/lib/services/applications'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Advances an application's lifecycle (submitted → acknowledged → closed). Reachable by
 * any active user, but RLS admits the update only for the addressed side — HR members for
 * an hr/both application, the CEO for a ceo/both one. A caller not on the addressed side
 * updates zero rows and gets a clean 404, never someone else's inbox.
 */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/applications/[applicationId]/status'>
) {
  try {
    const user = await requireUserOrThrow()
    const { applicationId } = await ctx.params

    const parsed = updateApplicationStatusSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid status payload', parsed.error.flatten())

    const result = await updateApplicationStatus(user, applicationId, parsed.data)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
