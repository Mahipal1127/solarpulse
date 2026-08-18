import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateEmployeeSchema } from '@/lib/validation/schemas'
import { updateEmployee, ServiceError, HR_DEPARTMENT_SLUG } from '@/lib/services/hr'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Edits an employee's personnel fields (designation, code, phone, reporting line, role).
 * HR-lead / CEO only. employment_status is NOT settable here — it moves only through
 * onboarding and process_employee_exit().
 */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/employees/[employeeId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(HR_DEPARTMENT_SLUG)
    const { employeeId } = await ctx.params

    const parsed = updateEmployeeSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid update payload', parsed.error.flatten())

    const employee = await updateEmployee(user, employeeId, parsed.data)
    return NextResponse.json({ employee })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
