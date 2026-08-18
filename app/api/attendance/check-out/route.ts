import { NextResponse } from 'next/server'
import { requireUserOrThrow } from '@/lib/auth/guards'
import { selfCheckOut, ServiceError } from '@/lib/services/hr'
import { errorResponse } from '@/lib/api/responses'

/**
 * Self check-out for the signed-in employee — stamps check_out = now() on today's row.
 * Open to every active user; requires a prior check-in the same day.
 */
export async function POST() {
  try {
    const user = await requireUserOrThrow()
    const record = await selfCheckOut(user)
    return NextResponse.json({ record })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
