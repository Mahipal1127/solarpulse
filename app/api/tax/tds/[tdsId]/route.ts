import { NextResponse, type NextRequest } from 'next/server'
import { requireAnyDepartmentOrThrow } from '@/lib/auth/guards'
import { updateTdsRecordSchema } from '@/lib/validation/schemas'
import { updateTdsRecord, ServiceError, FINANCE_DEPARTMENT_SLUGS } from '@/lib/services/finance'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Toggles a TDS record's deposited flag (stamps deposited_date when set true). */
export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/tax/tds/[tdsId]'>) {
  try {
    const user = await requireAnyDepartmentOrThrow([...FINANCE_DEPARTMENT_SLUGS])
    const { tdsId } = await ctx.params

    const parsed = updateTdsRecordSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid TDS payload', parsed.error.flatten())

    const record = await updateTdsRecord(user, tdsId, parsed.data)
    return NextResponse.json({ record })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
