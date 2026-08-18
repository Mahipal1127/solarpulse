import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateInstallationSchema } from '@/lib/validation/schemas'
import { updateInstallation, ServiceError, OM_DEPARTMENT_SLUG } from '@/lib/services/operations'
import { errorResponse, badRequest } from '@/lib/api/responses'

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/installations/[installationId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(OM_DEPARTMENT_SLUG)
    const { installationId } = await ctx.params

    const parsed = updateInstallationSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid update payload', parsed.error.flatten())

    // Status transitions are validated inside updateInstallation, not here.
    const installation = await updateInstallation(user, installationId, parsed.data)
    return NextResponse.json({ installation })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
