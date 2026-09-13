import { NextResponse } from 'next/server'
import { requireUserOrThrow } from '@/lib/auth/guards'
import { getDelegationTargets, ServiceError } from '@/lib/services/tasks'
import { errorResponse } from '@/lib/api/responses'

/**
 * The delegation address book: every department and every active person in the
 * organisation, plus what the caller may address (a manager or the CEO can aim
 * a top-level task anywhere; an employee aims at their own department, or
 * addresses other departments through sub-tasks). Names and departments only —
 * the payload is a company directory, nothing an ID card doesn't already show.
 */
export async function GET() {
  try {
    const user = await requireUserOrThrow()
    const targets = await getDelegationTargets(user)
    return NextResponse.json(targets)
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}