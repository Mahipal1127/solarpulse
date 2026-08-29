import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow, isReadOnlyFor } from '@/lib/auth/guards'
import { MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'
import { generatePlanSchema } from '@/lib/validation/schemas'
import { listPlans, generatePlanForRange, ServiceError } from '@/lib/services/marketing-creative'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * AI content plans — the "AI Calendar".
 *
 * POST proposes a week or a month of ideas grounded in the brand profile and the latest IG
 * audit. NOTHING lands on the live calendar here: the plan is stored 'proposed' and the team
 * commits the parts it wants through the commit sub-route (the user's explicit "propose, then
 * you commit" choice). AI off returns a 201 with an empty plan and a reason. CEO refused on
 * write by isReadOnlyFor.
 */
export async function GET() {
  try {
    await requireDepartmentOrThrow(MARKETING_DEPARTMENT_SLUG)
    const plans = await listPlans()
    return NextResponse.json({ plans })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(MARKETING_DEPARTMENT_SLUG)
    if (isReadOnlyFor(user, MARKETING_DEPARTMENT_SLUG)) {
      return NextResponse.json(
        { error: 'Read-only — the Marketing team plans the calendar. You can read every plan.' },
        { status: 403 }
      )
    }

    const parsed = generatePlanSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid plan request', parsed.error.flatten())

    const plan = await generatePlanForRange(user, {
      range_kind: parsed.data.range_kind,
      start_date: parsed.data.start_date,
      brief: parsed.data.brief,
    })
    return NextResponse.json({ plan }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
