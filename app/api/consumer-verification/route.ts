import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createConsumerVerificationSchema } from '@/lib/validation/schemas'
import {
  createConsumerVerification,
  ServiceError,
  DISCOM_DEPARTMENT_SLUG,
} from '@/lib/services/discom'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Records a consumer-verification check against a completed installation. verified_by
 * is the session user; customer_id is derived from the installation server-side.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(DISCOM_DEPARTMENT_SLUG)

    const parsed = createConsumerVerificationSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid verification payload', parsed.error.flatten())

    const verification = await createConsumerVerification(user, parsed.data)
    return NextResponse.json({ verification }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
