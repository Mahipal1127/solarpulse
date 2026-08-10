import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createGenerationReportSchema } from '@/lib/validation/schemas'
import {
  createGenerationReport,
  ServiceError,
  TECHNICAL_DEPARTMENT_SLUG,
} from '@/lib/services/technical'
import { errorResponse, badRequest } from '@/lib/api/responses'
import type { GenerationReport } from '@/lib/types'

/**
 * Records generation figures for a design.
 *
 * Records, not computes. Estimating solar yield means irradiance data, shading
 * geometry and system-loss modelling — a real engineering calculation. This
 * endpoint stores what an engineer produced in PVsyst or PVWatts, optionally with
 * the tool's own output file attached. A number this system invented and presented
 * as an estimate would be worse than no number at all.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/designs/[designId]/generation-report'>
) {
  try {
    const user = await requireDepartmentOrThrow(TECHNICAL_DEPARTMENT_SLUG)
    const { designId } = await ctx.params

    const parsed = createGenerationReportSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid report payload', parsed.error.flatten())

    const report = await createGenerationReport(user, designId, parsed.data)
    return NextResponse.json({ report }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}

/**
 * Lists a design's reports, newest first. More than one is normal — a revised
 * estimate is a new row rather than an edit, so the history of what was estimated
 * when survives.
 */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<'/api/designs/[designId]/generation-report'>
) {
  try {
    await requireDepartmentOrThrow(TECHNICAL_DEPARTMENT_SLUG)
    const { designId } = await ctx.params

    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase
      .from('generation_reports')
      .select('*')
      .eq('design_id', designId)
      .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ reports: (data ?? []) as GenerationReport[] })
  } catch (err) {
    return errorResponse(err)
  }
}
