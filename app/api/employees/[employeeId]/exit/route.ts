import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { processExitSchema } from '@/lib/validation/schemas'
import { processExit, ServiceError, HR_DEPARTMENT_SLUG } from '@/lib/services/hr'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Processes an employee exit atomically: the exits record, employees.employment_status
 * = 'exited', and users.is_active = false, all in one transaction (process_employee_exit
 * RPC). HR-lead / CEO only. A half-completed exit is a real security and payroll risk,
 * which is why this is one call and not three.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/employees/[employeeId]/exit'>
) {
  try {
    const user = await requireDepartmentOrThrow(HR_DEPARTMENT_SLUG)
    const { employeeId } = await ctx.params

    const parsed = processExitSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid exit payload', parsed.error.flatten())

    const result = await processExit(user, employeeId, parsed.data)
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
