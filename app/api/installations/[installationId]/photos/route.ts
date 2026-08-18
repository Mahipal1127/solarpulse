import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { installationPhotoMetaSchema } from '@/lib/validation/schemas'
import {
  addPhoto,
  signPhotoDownload,
  ServiceError,
  OM_DEPARTMENT_SLUG,
  SIGNED_URL_TTL_SECONDS,
} from '@/lib/services/operations'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Records an already-uploaded photo. The browser uploads straight to the private
 * installation-media bucket (governed by the storage policy), then calls this so
 * the row exists and the upload is audited.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/installations/[installationId]/photos'>
) {
  try {
    const user = await requireDepartmentOrThrow(OM_DEPARTMENT_SLUG)
    const { installationId } = await ctx.params

    const parsed = installationPhotoMetaSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid photo payload', parsed.error.flatten())

    const photo = await addPhoto(user, installationId, parsed.data)
    return NextResponse.json({ photo }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}

/**
 * Mints a short-lived signed URL for one photo. The bucket is private, so this is
 * the only way to read it. `?photoId=` picks which.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(OM_DEPARTMENT_SLUG)

    const photoId = request.nextUrl.searchParams.get('photoId')
    if (!photoId) return badRequest('Specify which photoId to sign')

    const { url, fileName } = await signPhotoDownload(user, photoId)
    return NextResponse.json({ url, fileName, expiresIn: SIGNED_URL_TTL_SECONDS })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
