import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createFollowUpSchema } from '@/lib/validation/schemas'
import { createFollowUp, ServiceError, SALES_DEPARTMENT_SLUG } from '@/lib/services/sales'
import { errorResponse, badRequest } from '@/lib/api/responses'

export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/leads/[leadId]/follow-ups'>
) {
  try {
    const user = await requireDepartmentOrThrow(SALES_DEPARTMENT_SLUG)
    const { leadId } = await ctx.params

    const parsed = createFollowUpSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid follow-up payload', parsed.error.flatten())

    const followUp = await createFollowUp(user, leadId, parsed.data)
    return NextResponse.json({ followUp }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
