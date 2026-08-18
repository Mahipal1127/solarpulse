import { NextResponse, type NextRequest } from 'next/server'
import { requireAnyDepartmentOrThrow } from '@/lib/auth/guards'
import { createTdsRecordSchema } from '@/lib/validation/schemas'
import { createTdsRecord, ServiceError, FINANCE_DEPARTMENT_SLUGS } from '@/lib/services/finance'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Records a TDS deduction. The deposited flag is toggled later via PATCH. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAnyDepartmentOrThrow([...FINANCE_DEPARTMENT_SLUGS])

    const parsed = createTdsRecordSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid TDS payload', parsed.error.flatten())

    const record = await createTdsRecord(user, parsed.data)
    return NextResponse.json({ record }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
