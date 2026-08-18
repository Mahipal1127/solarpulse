import { NextResponse } from 'next/server'
import { requireUserOrThrow } from '@/lib/auth/guards'
import { selfCheckIn, ServiceError } from '@/lib/services/hr'
import { errorResponse } from '@/lib/api/responses'

/**
 * Self check-in for the signed-in employee — the company-wide daily surface, open to
 * every active user regardless of department. No body: check_in is stamped now()
 * server-side, and the employee is resolved from the session, never the request.
 */
export async function POST() {
  try {
    const user = await requireUserOrThrow()
    const record = await selfCheckIn(user)
    return NextResponse.json({ record }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
