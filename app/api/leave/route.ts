import { NextResponse, type NextRequest } from 'next/server'
import { requireUserOrThrow } from '@/lib/auth/guards'
import { submitLeaveSchema } from '@/lib/validation/schemas'
import { submitLeave, ServiceError } from '@/lib/services/hr'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Submits a leave request for the signed-in employee. Open to every active user
 * regardless of department — the employee_id is derived from the session, never the
 * body. Runs submit_leave_request(), which also creates the linked approvals row so the
 * request surfaces on the CEO's Approvals page; deciding it there propagates the status
 * back here (see decideApproval).
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUserOrThrow()

    const parsed = submitLeaveSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid leave payload', parsed.error.flatten())

    const result = await submitLeave(user, parsed.data)
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
