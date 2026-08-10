import { NextResponse, type NextRequest } from 'next/server'
import { requireRoleOrThrow } from '@/lib/auth/guards'
import { approvalDecisionSchema } from '@/lib/validation/schemas'
import { decideApproval } from '@/lib/services/approvals'
import { ServiceError } from '@/lib/services/tasks'
import { errorResponse, badRequest } from '@/lib/api/responses'

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/approvals/[approvalId]'>
) {
  try {
    const user = await requireRoleOrThrow('CEO')
    const { approvalId } = await ctx.params

    const parsed = approvalDecisionSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid decision payload', parsed.error.flatten())

    const approval = await decideApproval(user, approvalId, parsed.data, 'manual')
    return NextResponse.json({ approval })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
