import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createEmployeeDocumentSchema } from '@/lib/validation/schemas'
import { addEmployeeDocument, ServiceError, HR_DEPARTMENT_SLUG } from '@/lib/services/hr'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Records an already-uploaded employee document. The browser uploads to the private
 * hr-documents bucket at '{employee_id}/{filename}', then calls this so the row exists
 * and the upload is audited. Ordinary paperwork is HR-member work; sensitive types
 * (offer letter, contract, exit letter) are gated to the HR lead in the service layer.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/employees/[employeeId]/documents'>
) {
  try {
    const user = await requireDepartmentOrThrow(HR_DEPARTMENT_SLUG)
    const { employeeId } = await ctx.params

    const parsed = createEmployeeDocumentSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid document payload', parsed.error.flatten())

    const document = await addEmployeeDocument(user, employeeId, parsed.data)
    return NextResponse.json({ document }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
