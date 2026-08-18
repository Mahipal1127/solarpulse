import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createEmployeeSchema } from '@/lib/validation/schemas'
import { hireEmployee, ServiceError, HR_DEPARTMENT_SLUG } from '@/lib/services/hr'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Onboards a new employee — creates the auth login, users row, and employees row
 * together. HR-lead / CEO only (enforced in the service layer; this route's department
 * guard is the outer gate). See hireEmployee for why this privileged path runs on the
 * service-role client.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(HR_DEPARTMENT_SLUG)

    const parsed = createEmployeeSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid employee payload', parsed.error.flatten())

    const employee = await hireEmployee(user, parsed.data)
    return NextResponse.json({ employee }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
