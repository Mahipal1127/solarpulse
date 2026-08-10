import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { surveyPhotoMetaSchema } from '@/lib/validation/schemas'
import {
  addSurveyPhoto,
  ServiceError,
  TECHNICAL_DEPARTMENT_SLUG,
} from '@/lib/services/technical'
import { errorResponse, badRequest } from '@/lib/api/responses'
import type { SurveyPhoto } from '@/lib/types'

/**
 * Registers a photo the browser has already pushed to the private survey-media
 * bucket, the same two-step the tender module uses: the storage policy governs the
 * upload itself, and this route creates the row that makes the file findable.
 *
 * Drone imagery included — `is_drone_survey` is a flag on the survey and aerial
 * shots upload exactly like any other photo. Nothing here talks to a drone.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/surveys/[surveyId]/photos'>
) {
  try {
    const user = await requireDepartmentOrThrow(TECHNICAL_DEPARTMENT_SLUG)
    const { surveyId } = await ctx.params

    const parsed = surveyPhotoMetaSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid photo payload', parsed.error.flatten())

    const photo = await addSurveyPhoto(user, surveyId, parsed.data)
    return NextResponse.json({ photo }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}

/** Lists a survey's photos. Readable by the CEO as well as the department. */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<'/api/surveys/[surveyId]/photos'>
) {
  try {
    await requireDepartmentOrThrow(TECHNICAL_DEPARTMENT_SLUG)
    const { surveyId } = await ctx.params

    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase
      .from('survey_photos')
      .select('id, survey_id, file_path, file_name, photo_type, uploaded_by, created_at')
      .eq('survey_id', surveyId)
      .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    // No signed URLs here — a list response would hand out N live links at once,
    // each a bearer token for a customer's property. Callers mint one on demand
    // from /api/survey-photos/[photoId].
    return NextResponse.json({ photos: (data ?? []) as SurveyPhoto[] })
  } catch (err) {
    return errorResponse(err)
  }
}
