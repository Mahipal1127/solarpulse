import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { electricityBillSchema } from '@/lib/validation/schemas'
import {
  setElectricityBill,
  signElectricityBillDownload,
  ServiceError,
  TECHNICAL_DEPARTMENT_SLUG,
  SIGNED_URL_TTL_SECONDS,
} from '@/lib/services/technical'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Attaches the customer's electricity bill, and optionally the monthly average read
 * off it. One bill per survey, so this sets two columns rather than making rows.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/surveys/[surveyId]/electricity-bill'>
) {
  try {
    const user = await requireDepartmentOrThrow(TECHNICAL_DEPARTMENT_SLUG)
    const { surveyId } = await ctx.params

    const parsed = electricityBillSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid bill payload', parsed.error.flatten())

    const survey = await setElectricityBill(user, surveyId, parsed.data)
    return NextResponse.json({ survey }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}

/**
 * Mints a short-lived signed URL for the bill. The bucket is private, so this is
 * the only way to read it.
 *
 * The download is logged as a sensitive access, not a routine one: an electricity
 * bill is a household's consumption history, and the security blueprint requires
 * access to personal documents to be recorded even when the reader is the CEO.
 */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<'/api/surveys/[surveyId]/electricity-bill'>
) {
  try {
    const user = await requireDepartmentOrThrow(TECHNICAL_DEPARTMENT_SLUG)
    const { surveyId } = await ctx.params

    const { url, fileName } = await signElectricityBillDownload(user, surveyId)
    return NextResponse.json({ url, fileName, expiresIn: SIGNED_URL_TTL_SECONDS })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
