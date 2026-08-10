import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateVendorSchema } from '@/lib/validation/schemas'
import {
  updateVendor,
  deactivateVendor,
  ServiceError,
  DISTRIBUTION_DEPARTMENT_SLUG,
} from '@/lib/services/distribution'
import { errorResponse, badRequest } from '@/lib/api/responses'

export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/vendors/[vendorId]'>) {
  try {
    const user = await requireDepartmentOrThrow(DISTRIBUTION_DEPARTMENT_SLUG)
    const { vendorId } = await ctx.params

    const parsed = updateVendorSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid update payload', parsed.error.flatten())

    const vendor = await updateVendor(user, vendorId, parsed.data)
    return NextResponse.json({ vendor })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}

/**
 * Soft delete, and the only kind available here — the row stays and is_active
 * goes false. Historical purchase orders reference the vendor by foreign key, so
 * a hard delete would either be refused by the database or orphan the paperwork.
 * There is deliberately no endpoint that removes a vendor row.
 */
export async function DELETE(_request: NextRequest, ctx: RouteContext<'/api/vendors/[vendorId]'>) {
  try {
    const user = await requireDepartmentOrThrow(DISTRIBUTION_DEPARTMENT_SLUG)
    const { vendorId } = await ctx.params

    const vendor = await deactivateVendor(user, vendorId)
    return NextResponse.json({ vendor })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
