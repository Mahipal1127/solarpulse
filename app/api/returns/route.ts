import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createReturnSchema } from '@/lib/validation/schemas'
import {
  createReturn,
  ServiceError,
  DISTRIBUTION_DEPARTMENT_SLUG,
} from '@/lib/services/distribution'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Logs material coming back from site. Starts at 'pending' — the receiving end of
 * a return is Store's, and that module does not exist yet.
 *
 * Where a dispatch is named, the project is taken from that dispatch rather than
 * from the request body, so a return cannot be filed against the wrong project.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(DISTRIBUTION_DEPARTMENT_SLUG)

    const parsed = createReturnSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid return payload', parsed.error.flatten())

    const materialReturn = await createReturn(user, parsed.data)
    return NextResponse.json({ return: materialReturn }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
