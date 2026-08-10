import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createDispatchSchema } from '@/lib/validation/schemas'
import {
  createDispatch,
  ServiceError,
  DISTRIBUTION_DEPARTMENT_SLUG,
} from '@/lib/services/distribution'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Creates a dispatch and, where it draws on planned allocations, marks those
 * allocations dispatched — in one database transaction.
 *
 * The atomicity matters: two separate client calls could leave a dispatch whose
 * allocations still read 'allocated', so the same material gets sent out twice,
 * or allocations pointing at a dispatch that was never created. Same principle
 * as Sales' deal closure, and the reason this is one RPC rather than an insert
 * followed by an update.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(DISTRIBUTION_DEPARTMENT_SLUG)

    const parsed = createDispatchSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid dispatch payload', parsed.error.flatten())

    const dispatch = await createDispatch(user, parsed.data)
    return NextResponse.json({ dispatch }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
