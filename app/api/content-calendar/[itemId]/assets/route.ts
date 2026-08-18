import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createContentAssetSchema } from '@/lib/validation/schemas'
import {
  addContentAsset,
  signAssetDownload,
  deleteContentAsset,
  ServiceError,
  MARKETING_DEPARTMENT_SLUG,
  SIGNED_URL_TTL_SECONDS,
} from '@/lib/services/marketing'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Records an already-uploaded asset. The browser uploads straight to the private
 * marketing-assets bucket (governed by the storage policy at
 * '{content_calendar_item_id}/{filename}'), then calls this so the row exists and the
 * upload is audited. The itemId in the path is the parent; the body carries it too
 * and the service confirms the file_path sits under that item's folder.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/content-calendar/[itemId]/assets'>
) {
  try {
    const user = await requireDepartmentOrThrow(MARKETING_DEPARTMENT_SLUG)
    const { itemId } = await ctx.params

    const body = await request.json()
    const parsed = createContentAssetSchema.safeParse({
      ...body,
      content_calendar_item_id: itemId,
    })
    if (!parsed.success) return badRequest('Invalid asset payload', parsed.error.flatten())

    const asset = await addContentAsset(user, parsed.data)
    return NextResponse.json({ asset }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}

/** Mints a short-lived signed URL for one asset. `?assetId=` picks which. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(MARKETING_DEPARTMENT_SLUG)

    const assetId = request.nextUrl.searchParams.get('assetId')
    if (!assetId) return badRequest('Specify which assetId to sign')

    const { url, fileName } = await signAssetDownload(user, assetId)
    return NextResponse.json({ url, fileName, expiresIn: SIGNED_URL_TTL_SECONDS })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}

/** Removes an asset row. `?assetId=` picks which. */
export async function DELETE(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(MARKETING_DEPARTMENT_SLUG)

    const assetId = request.nextUrl.searchParams.get('assetId')
    if (!assetId) return badRequest('Specify which assetId to delete')

    await deleteContentAsset(user, assetId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
