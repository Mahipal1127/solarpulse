import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateSurveySchema } from '@/lib/validation/schemas'
import {
  updateSurvey,
  ServiceError,
  TECHNICAL_DEPARTMENT_SLUG,
} from '@/lib/services/technical'
import { errorResponse, badRequest } from '@/lib/api/responses'

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/surveys/[surveyId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(TECHNICAL_DEPARTMENT_SLUG)
    const { surveyId } = await ctx.params

    const parsed = updateSurveySchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid survey payload', parsed.error.flatten())

    const survey = await updateSurvey(user, surveyId, parsed.data)
    return NextResponse.json({ survey })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}

/**
 * Cancels a survey. There is no hard delete and no is_active column — cancelling
 * is what soft-deleting means here, and survey_status carries the value for it.
 *
 * Deliberately not a row removal: a survey may already have photos, a bill and a
 * design hanging off it, and the measurements taken on site are a record of what
 * was found there. A cancelled survey drops out of the queues while its findings
 * stay readable, the same choice as a deactivated vendor and an archived task.
 */
export async function DELETE(
  _request: NextRequest,
  ctx: RouteContext<'/api/surveys/[surveyId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(TECHNICAL_DEPARTMENT_SLUG)
    const { surveyId } = await ctx.params

    // Goes through updateSurvey so the transition table still applies: a completed
    // survey is terminal and cannot be cancelled after the fact.
    const survey = await updateSurvey(user, surveyId, { status: 'cancelled' })
    return NextResponse.json({ survey })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
