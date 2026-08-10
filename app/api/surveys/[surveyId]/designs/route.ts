import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createDesignSchema } from '@/lib/validation/schemas'
import {
  createDesign,
  ServiceError,
  TECHNICAL_DEPARTMENT_SLUG,
} from '@/lib/services/technical'
import { errorResponse, badRequest } from '@/lib/api/responses'
import type { Design } from '@/lib/types'

/**
 * Starts a design from a completed survey — the "Start Design" step §3.2 asks be
 * prompted rather than automatic, which is why this is its own call and not
 * something marking a survey complete triggers.
 *
 * The service rejects a survey that is not yet complete: a design drawn from
 * measurements still being taken rests on numbers that may still change.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/surveys/[surveyId]/designs'>
) {
  try {
    const user = await requireDepartmentOrThrow(TECHNICAL_DEPARTMENT_SLUG)
    const { surveyId } = await ctx.params

    // Every design field is optional at creation — an engineer often opens the
    // record before the numbers are settled — so a bare POST is valid.
    const parsed = createDesignSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return badRequest('Invalid design payload', parsed.error.flatten())

    const design = await createDesign(user, surveyId, parsed.data)
    return NextResponse.json({ design }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}

/** Lists the designs drawn from a survey. Readable by the CEO as well. */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<'/api/surveys/[surveyId]/designs'>
) {
  try {
    await requireDepartmentOrThrow(TECHNICAL_DEPARTMENT_SLUG)
    const { surveyId } = await ctx.params

    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase
      .from('designs')
      .select('*')
      .eq('survey_id', surveyId)
      .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ designs: (data ?? []) as Design[] })
  } catch (err) {
    return errorResponse(err)
  }
}
