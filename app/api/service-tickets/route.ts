import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createServiceTicketSchema } from '@/lib/validation/schemas'
import { createServiceTicket, ServiceError, OM_DEPARTMENT_SLUG } from '@/lib/services/operations'
import { errorResponse, badRequest } from '@/lib/api/responses'

export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(OM_DEPARTMENT_SLUG)

    const parsed = createServiceTicketSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid ticket payload', parsed.error.flatten())

    const ticket = await createServiceTicket(user, parsed.data)
    return NextResponse.json({ ticket }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
