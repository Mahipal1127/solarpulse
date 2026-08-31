import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { HR_DEPARTMENT_SLUG } from '@/lib/services/hr'
import { assertCanManage, ServiceError } from '@/lib/services/id-cards'
import { getCompanyDetails, upsertCompanyDetails } from '@/lib/services/company-details'
import { companyDetailsSchema } from '@/lib/validation/schemas'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * The company contact footer printed on every ID card.
 *
 * Both verbs are HR-module gated at the route. GET is readable by any HR member (and
 * the CEO). PUT reuses assertCanManage — the SAME predicate that gates ID-card
 * management (HR lead / CEO only) — so the person who can generate cards is exactly
 * the person who can change what the card's footer says. RLS is the real backstop;
 * this makes the refusal a clean 403.
 */
export async function GET() {
  try {
    const user = await requireDepartmentOrThrow(HR_DEPARTMENT_SLUG)
    const details = await getCompanyDetails(user.organization_id)
    return NextResponse.json({ details })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(HR_DEPARTMENT_SLUG)
    assertCanManage(user)

    const parsed = companyDetailsSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid company details', parsed.error.flatten())

    const details = await upsertCompanyDetails(user, parsed.data)
    return NextResponse.json({ details })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
