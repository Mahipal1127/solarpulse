import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createTenderSchema } from '@/lib/validation/schemas'
import { createTender, ServiceError, TENDER_DEPARTMENT_SLUG } from '@/lib/services/tenders'
import { errorResponse, badRequest } from '@/lib/api/responses'

export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(TENDER_DEPARTMENT_SLUG)

    const parsed = createTenderSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid tender payload', parsed.error.flatten())

    const tender = await createTender(user, parsed.data)
    return NextResponse.json({ tender }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
