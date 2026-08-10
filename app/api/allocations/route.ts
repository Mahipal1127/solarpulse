import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createAllocationSchema } from '@/lib/validation/schemas'
import {
  createAllocations,
  ServiceError,
  DISTRIBUTION_DEPARTMENT_SLUG,
} from '@/lib/services/distribution'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Plans material for a project — one row per item, all against the same lead.
 *
 * No stock-availability check, deliberately: Store owns the master inventory count
 * and that module does not exist yet, so there is no balance to validate against.
 * These rows are Distribution's plan and commitment record, not a live inventory
 * reservation.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(DISTRIBUTION_DEPARTMENT_SLUG)

    const parsed = createAllocationSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid allocation payload', parsed.error.flatten())

    const allocations = await createAllocations(user, parsed.data)
    return NextResponse.json({ allocations }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
