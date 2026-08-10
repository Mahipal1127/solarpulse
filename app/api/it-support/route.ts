import { NextResponse, type NextRequest } from 'next/server'
import { requireUserOrThrow } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createITTicketSchema } from '@/lib/validation/schemas'
import { createITTicket, ServiceError } from '@/lib/services/technical'
import { errorResponse, badRequest } from '@/lib/api/responses'
import type { ITSupportTicket } from '@/lib/types'

/**
 * Raises an IT support ticket. Open to any authenticated member of the
 * organization — the module's most important deliberate exception.
 *
 * ERP bugs, lost logins and broken laptops are reported by Sales, Finance, HR and
 * everyone else. A queue only Technical could write to would be a queue nobody
 * files into, so the guard is requireUserOrThrow() rather than
 * requireDepartmentOrThrow('technical'), matching the org_member_raise_it_ticket
 * policy.
 *
 * Managing the queue is not open in the same way: PATCH
 * /api/it-support/[ticketId] is Technical-only.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUserOrThrow()

    const parsed = createITTicketSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid ticket payload', parsed.error.flatten())

    const ticket = await createITTicket(user, parsed.data)
    return NextResponse.json({ ticket }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}

/**
 * Lists tickets, and the response deliberately differs by who is asking.
 *
 * One query, no branching on department here: technical_manage_it_tickets returns
 * the whole queue to a Technical member, while raiser_read_own_it_ticket returns
 * only their own rows to everyone else. Filtering by department in this handler
 * would duplicate that decision in a second place, and the copy in application code
 * is the one that would drift — worse, it would mask a policy regression instead of
 * exposing it.
 */
export async function GET(_request: NextRequest) {
  try {
    await requireUserOrThrow()

    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase
      .from('it_support_tickets')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300)

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ tickets: (data ?? []) as ITSupportTicket[] })
  } catch (err) {
    return errorResponse(err)
  }
}
