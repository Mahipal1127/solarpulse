import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createStockMovementSchema } from '@/lib/validation/schemas'
import { recordStockMovement, ServiceError, STORE_DEPARTMENT_SLUG } from '@/lib/services/store'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Logs a stock movement — the only way a quantity ever changes. Damaged stock does NOT come
 * through here; it uses /stock-movements/damaged so the damage detail is written in the same
 * transaction (the schema here rejects movement_type 'damaged').
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(STORE_DEPARTMENT_SLUG)

    const parsed = createStockMovementSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid movement payload', parsed.error.flatten())

    const movement = await recordStockMovement(user, parsed.data)
    return NextResponse.json({ movement }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
