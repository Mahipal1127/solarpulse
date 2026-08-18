import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateServiceTicketSchema } from '@/lib/validation/schemas'
import { updateServiceTicket, ServiceError, OM_DEPARTMENT_SLUG } from '@/lib/services/operations'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Updates a ticket. The report gate on 'resolved' lives inside updateServiceTicket,
 * not here — a hand-crafted PATCH cannot skip it.
 */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/service-tickets/[ticketId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(OM_DEPARTMENT_SLUG)
    const { ticketId } = await ctx.params

    const parsed = updateServiceTicketSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid update payload', parsed.error.flatten())

    const ticket = await updateServiceTicket(user, ticketId, parsed.data)
    return NextResponse.json({ ticket })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
