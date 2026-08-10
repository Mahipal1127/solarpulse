import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createLeadSchema } from '@/lib/validation/schemas'
import { createLead, ServiceError, SALES_DEPARTMENT_SLUG } from '@/lib/services/sales'
import { errorResponse, badRequest } from '@/lib/api/responses'

export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(SALES_DEPARTMENT_SLUG)

    const parsed = createLeadSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid lead payload', parsed.error.flatten())

    // Who the lead may be assigned to is decided in createLead: an executive
    // always gets their own lead, only a manager can hand it to someone else.
    const lead = await createLead(user, parsed.data)
    return NextResponse.json({ lead }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
