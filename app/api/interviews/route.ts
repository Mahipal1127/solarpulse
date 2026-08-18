import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createInterviewSchema } from '@/lib/validation/schemas'
import { createInterview, ServiceError, HR_DEPARTMENT_SLUG } from '@/lib/services/hr'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Schedules an interview against a visible candidate. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(HR_DEPARTMENT_SLUG)

    const parsed = createInterviewSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid interview payload', parsed.error.flatten())

    const interview = await createInterview(user, parsed.data)
    return NextResponse.json({ interview }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
