import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createInventoryItemSchema } from '@/lib/validation/schemas'
import { createInventoryItem, ServiceError, STORE_DEPARTMENT_SLUG } from '@/lib/services/store'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Creates an inventory item type. Stock quantity is never set here — it moves via a movement. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(STORE_DEPARTMENT_SLUG)

    const parsed = createInventoryItemSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid item payload', parsed.error.flatten())

    const item = await createInventoryItem(user, parsed.data)
    return NextResponse.json({ item }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
