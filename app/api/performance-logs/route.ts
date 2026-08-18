import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createPerformanceLogSchema } from '@/lib/validation/schemas'
import { addPerformanceLog, ServiceError, OM_DEPARTMENT_SLUG } from '@/lib/services/operations'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Records a manual generation reading against an installation. The installation id
 * comes as ?installationId= — a performance log always belongs to one, and this
 * keeps a single flat collection route rather than nesting it under installations.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(OM_DEPARTMENT_SLUG)

    const installationId = request.nextUrl.searchParams.get('installationId')
    if (!installationId) return badRequest('Specify which installationId this reading is for')

    const parsed = createPerformanceLogSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid performance log payload', parsed.error.flatten())

    const log = await addPerformanceLog(user, installationId, parsed.data)
    return NextResponse.json({ log }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
