import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createSubsidySchema } from '@/lib/validation/schemas'
import { createSubsidy, ServiceError, DISCOM_DEPARTMENT_SLUG } from '@/lib/services/discom'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Creates a subsidy case from a completed installation. Customer and org are derived
 * from the installation server-side; the client names the installation, the scheme,
 * and the liaison to own it.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(DISCOM_DEPARTMENT_SLUG)

    const parsed = createSubsidySchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid subsidy payload', parsed.error.flatten())

    const subsidyCase = await createSubsidy(user, parsed.data)
    return NextResponse.json({ subsidyCase }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
