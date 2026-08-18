import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createDealerSchema } from '@/lib/validation/schemas'
import { createDealer, ServiceError, STORE_DEPARTMENT_SLUG } from '@/lib/services/store'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Creates a dealer contact record. A simple relationship log, not a Sales pipeline. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(STORE_DEPARTMENT_SLUG)

    const parsed = createDealerSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid dealer payload', parsed.error.flatten())

    const dealer = await createDealer(user, parsed.data)
    return NextResponse.json({ dealer }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
