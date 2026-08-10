import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateITTicketSchema } from '@/lib/validation/schemas'
import {
  updateITTicket,
  ServiceError,
  TECHNICAL_DEPARTMENT_SLUG,
} from '@/lib/services/technical'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Triages a ticket: assign it, move its status, correct its type.
 *
 * Technical-only, which is the other half of the exception POST makes. Anyone in
 * the company may report a problem; only Technical decides what happens to it. A
 * reporter can watch their own ticket through GET but cannot mark it resolved.
 *
 * resolved_at is stamped server-side, and cleared when a ticket reopens — a
 * resolution date sitting on an unresolved ticket would misreport how long the fix
 * actually took.
 */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/it-support/[ticketId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(TECHNICAL_DEPARTMENT_SLUG)
    const { ticketId } = await ctx.params

    const parsed = updateITTicketSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid ticket payload', parsed.error.flatten())

    const ticket = await updateITTicket(user, ticketId, parsed.data)
    return NextResponse.json({ ticket })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
