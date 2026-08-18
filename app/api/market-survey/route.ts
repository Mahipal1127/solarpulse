import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createMarketSurveyNoteSchema } from '@/lib/validation/schemas'
import { createMarketSurveyNote, ServiceError, STORE_DEPARTMENT_SLUG } from '@/lib/services/store'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Logs a market-survey field note. surveyed_by is the session user, set server-side. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(STORE_DEPARTMENT_SLUG)

    const parsed = createMarketSurveyNoteSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid survey payload', parsed.error.flatten())

    const note = await createMarketSurveyNote(user, parsed.data)
    return NextResponse.json({ note }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
