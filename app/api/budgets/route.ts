import { NextResponse, type NextRequest } from 'next/server'
import { requireAnyDepartmentOrThrow } from '@/lib/auth/guards'
import { createBudgetSchema } from '@/lib/validation/schemas'
import { createBudget, ServiceError, FINANCE_DEPARTMENT_SLUGS } from '@/lib/services/finance'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Creates a budget (lead/CEO only — enforced in the service). Spend is computed at read time. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAnyDepartmentOrThrow([...FINANCE_DEPARTMENT_SLUGS])

    const parsed = createBudgetSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid budget payload', parsed.error.flatten())

    const budget = await createBudget(user, parsed.data)
    return NextResponse.json({ budget }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
