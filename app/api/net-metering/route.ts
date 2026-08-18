import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createNetMeteringSchema } from '@/lib/validation/schemas'
import { createNetMetering, ServiceError, DISCOM_DEPARTMENT_SLUG } from '@/lib/services/discom'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Creates a net-metering application from a completed installation — the O&M →
 * DISCOM handoff. Customer and org are derived from the installation server-side,
 * so the client only names the installation and the liaison to own it.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(DISCOM_DEPARTMENT_SLUG)

    const parsed = createNetMeteringSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid application payload', parsed.error.flatten())

    const application = await createNetMetering(user, parsed.data)
    return NextResponse.json({ application }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
