import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { convertDealSchema } from '@/lib/validation/schemas'
import { convertDeal, ServiceError, OM_DEPARTMENT_SLUG } from '@/lib/services/operations'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Turns a Sales deal closure into an installation, atomically — the pipeline
 * handoff. Customer, design and system size are derived from the closure
 * server-side, so the client only names the deal and the team lead.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(OM_DEPARTMENT_SLUG)

    const parsed = convertDealSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid conversion payload', parsed.error.flatten())

    const installation = await convertDeal(user, parsed.data)
    return NextResponse.json({ installation }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
