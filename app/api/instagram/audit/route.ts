import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow, isReadOnlyFor } from '@/lib/auth/guards'
import { MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'
import { generateInstagramAuditSchema } from '@/lib/validation/schemas'
import { generateAudit, ServiceError } from '@/lib/services/instagram'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Generate an audit for a connected account.
 *
 * Computes the figures from stored posts, asks the model to phrase them, and stores both.
 * The facts are computed in lib/instagram/metrics.ts and stored alongside the narrative, so
 * a reader can always check the prose against the numbers it was written from — the AI rule
 * from lib/ai/summary.ts, made inspectable.
 *
 * AI BEING OFF IS A SUCCESS, NOT A 500. generateAudit stores the facts with a null narrative
 * and a reason, and returns 201 either way. The numbers are the audit; the prose is a
 * reading of it, and a team with no AI configured should still get the numbers.
 *
 * The CEO is refused, matching every other write in this module. Generating an audit inserts
 * a row through the service-role client — instagram_audits has no client insert policy — so
 * this guard is the only thing standing between the CEO's read-only status and a write.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(MARKETING_DEPARTMENT_SLUG)
    if (isReadOnlyFor(user, MARKETING_DEPARTMENT_SLUG)) {
      return NextResponse.json(
        { error: 'Read-only — the Marketing team generates audits. You can read every one they run.' },
        { status: 403 }
      )
    }

    const parsed = generateInstagramAuditSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid audit request', parsed.error.flatten())

    const audit = await generateAudit(user, {
      accountId: parsed.data.account_id,
      days: parsed.data.days,
    })

    return NextResponse.json({ audit }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
