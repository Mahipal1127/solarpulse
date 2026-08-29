import { NextResponse, type NextRequest } from 'next/server'
import { requireUserOrThrow } from '@/lib/auth/guards'
import { generateEmployeeReportSchema } from '@/lib/validation/schemas'
import { buildEmployeeReportDraft } from '@/lib/ai/employee-report'
import { ServiceError } from '@/lib/services/employee-reports'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Writes an AI draft of the caller's own report for a period.
 *
 * Returns the draft WITHOUT saving anything. The employee reviews and edits it, then
 * POSTs to /api/employee-reports themselves — so nothing the model wrote is ever filed
 * under their name without them reading it first, which is the whole point of the
 * generate → review → submit flow.
 *
 * The response carries `facts` alongside the prose. Two reasons: the employee can check
 * the draft against the numbers it was built from, and when the model is unavailable the
 * form can still show them what their period looked like so they can write it themselves.
 * The 200-with-null-draft shape is deliberate — AI being off is a normal state here, not
 * an error, exactly as the CEO briefing treats it.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUserOrThrow()

    const parsed = generateEmployeeReportSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid generate payload', parsed.error.flatten())

    const result = await buildEmployeeReportDraft(user, parsed.data.period)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
