import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createFacilityLogSchema } from '@/lib/validation/schemas'
import { createFacilityLog, ServiceError, STORE_DEPARTMENT_SLUG } from '@/lib/services/store'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Logs a facility/office maintenance issue. reported_by is the session user. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(STORE_DEPARTMENT_SLUG)

    const parsed = createFacilityLogSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid facility payload', parsed.error.flatten())

    const log = await createFacilityLog(user, parsed.data)
    return NextResponse.json({ log }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
