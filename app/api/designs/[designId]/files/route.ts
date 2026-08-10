import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { designFileSchema } from '@/lib/validation/schemas'
import {
  setDesignFile,
  signDesignFileDownload,
  ServiceError,
  TECHNICAL_DEPARTMENT_SLUG,
  SIGNED_URL_TTL_SECONDS,
} from '@/lib/services/technical'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Attaches the solar layout or the single line diagram to a design.
 *
 * Both are uploaded documents. This module keeps records of designs; it is not a
 * CAD tool, and nothing here draws or parses a drawing — the file is stored and
 * handed back on request.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/designs/[designId]/files'>
) {
  try {
    const user = await requireDepartmentOrThrow(TECHNICAL_DEPARTMENT_SLUG)
    const { designId } = await ctx.params

    const parsed = designFileSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid file payload', parsed.error.flatten())

    const design = await setDesignFile(user, designId, parsed.data)
    return NextResponse.json({ design }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}

/**
 * Mints a short-lived signed URL for one of the two documents. The design-files
 * bucket is private, so this is the only way to read them.
 *
 * `?kind=layout|sld` picks which. Validated through the same schema as the upload,
 * so an unrecognised value is a 400 rather than a silent fall back to one of them.
 */
export async function GET(
  request: NextRequest,
  ctx: RouteContext<'/api/designs/[designId]/files'>
) {
  try {
    const user = await requireDepartmentOrThrow(TECHNICAL_DEPARTMENT_SLUG)
    const { designId } = await ctx.params

    const kind = request.nextUrl.searchParams.get('kind')
    const parsed = designFileSchema.shape.kind.safeParse(kind)
    if (!parsed.success) {
      return badRequest('Specify kind=layout or kind=sld')
    }

    const { url, fileName } = await signDesignFileDownload(user, designId, parsed.data)
    return NextResponse.json({ url, fileName, expiresIn: SIGNED_URL_TTL_SECONDS })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
