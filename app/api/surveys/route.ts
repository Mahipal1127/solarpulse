import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createSurveySchema, convertVisitRequestSchema } from '@/lib/validation/schemas'
import {
  createSurvey,
  convertVisitRequest,
  ServiceError,
  TECHNICAL_DEPARTMENT_SLUG,
} from '@/lib/services/technical'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Creates a survey, by either of the two routes it can arrive from.
 *
 * A body carrying `site_visit_request_id` is the Sales handoff, and takes the
 * atomic path: create_survey_from_visit_request() inserts the survey and marks the
 * source request 'scheduled' in one transaction. Anything else is a standalone
 * survey Technical logged itself.
 *
 * One endpoint rather than two because the caller's intent is the same either way —
 * "log a survey" — and the difference is visible in the payload. What must not
 * differ is atomicity: the handoff path can never be a create followed by a
 * separate update, or a failure between them leaves Sales' request and Technical's
 * survey disagreeing about whether the work was accepted.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(TECHNICAL_DEPARTMENT_SLUG)

    const body = await request.json()

    if (body?.site_visit_request_id) {
      const parsed = convertVisitRequestSchema.safeParse(body)
      if (!parsed.success) {
        return badRequest('Invalid conversion payload', parsed.error.flatten())
      }

      const survey = await convertVisitRequest(user, parsed.data)
      return NextResponse.json({ survey, fromRequest: true }, { status: 201 })
    }

    const parsed = createSurveySchema.safeParse(body)
    if (!parsed.success) return badRequest('Invalid survey payload', parsed.error.flatten())

    const survey = await createSurvey(user, parsed.data)
    return NextResponse.json({ survey, fromRequest: false }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
