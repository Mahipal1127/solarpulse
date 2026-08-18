import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { markAttendanceSchema } from '@/lib/validation/schemas'
import { markAttendance, ServiceError, HR_DEPARTMENT_SLUG } from '@/lib/services/hr'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * HR marks (or corrects) attendance for an employee — for field staff who could not
 * self-check-in, or to record absence/leave/holiday. Upserts on (employee_id, date) and
 * stamps marked_by. Self check-in/out is the separate /api/attendance/check-in|out path.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(HR_DEPARTMENT_SLUG)

    const parsed = markAttendanceSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid attendance payload', parsed.error.flatten())

    const record = await markAttendance(user, parsed.data)
    return NextResponse.json({ record }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
