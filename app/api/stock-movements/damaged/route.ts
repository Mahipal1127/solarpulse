import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { recordDamagedStockSchema } from '@/lib/validation/schemas'
import { recordDamagedStock, ServiceError, STORE_DEPARTMENT_SLUG } from '@/lib/services/store'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Records damaged stock. Creates the 'damaged' movement (decrementing the computed quantity)
 * AND its damaged_stock_records detail row in ONE transaction (the record_damaged_stock RPC),
 * so a partial write can't corrupt the ledger. Any photo is uploaded to the store-media bucket
 * client-side first; only its path is sent here.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(STORE_DEPARTMENT_SLUG)

    const parsed = recordDamagedStockSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid damaged-stock payload', parsed.error.flatten())

    const movementId = await recordDamagedStock(user, parsed.data)
    return NextResponse.json({ stock_movement_id: movementId }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
