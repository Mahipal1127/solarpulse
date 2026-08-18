import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createCandidateSchema } from '@/lib/validation/schemas'
import { createCandidate, ServiceError, HR_DEPARTMENT_SLUG } from '@/lib/services/hr'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Adds a recruitment candidate. Any HR member; the CEO passes the guard but reads only. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(HR_DEPARTMENT_SLUG)

    const parsed = createCandidateSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid candidate payload', parsed.error.flatten())

    const candidate = await createCandidate(user, parsed.data)
    return NextResponse.json({ candidate }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
