import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createSalaryRecordSchema } from '@/lib/validation/schemas'
import { createSalaryRecord, ServiceError, HR_DEPARTMENT_SLUG } from '@/lib/services/hr'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Creates a salary record — SENSITIVE TIER. HR-lead / CEO only (enforced in the service
 * layer, backed by RLS in 0015). net_payable is a generated column and never accepted
 * from the client. The department guard is the outer gate; the sensitive-tier check
 * inside rejects a plain HR Executive.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(HR_DEPARTMENT_SLUG)

    const parsed = createSalaryRecordSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid salary payload', parsed.error.flatten())

    const record = await createSalaryRecord(user, parsed.data)
    return NextResponse.json({ record }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
