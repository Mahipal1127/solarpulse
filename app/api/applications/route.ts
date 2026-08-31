import { NextResponse, type NextRequest } from 'next/server'
import { requireUserOrThrow } from '@/lib/auth/guards'
import { submitApplicationSchema } from '@/lib/validation/schemas'
import { submitApplication, ServiceError } from '@/lib/services/applications'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Files a free-text application for the signed-in employee, addressed to HR, the CEO, or
 * both. Open to every active user regardless of department — the employee_id is derived
 * from the session, never the body. Distinct from leave (which has its own approvals
 * flow); this is the general channel for writing to management.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUserOrThrow()

    const parsed = submitApplicationSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid application payload', parsed.error.flatten())

    const result = await submitApplication(user, parsed.data)
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
