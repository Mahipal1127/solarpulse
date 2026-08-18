import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { progressUpdateSchema } from '@/lib/validation/schemas'
import { addProgressUpdate, ServiceError, OM_DEPARTMENT_SLUG } from '@/lib/services/operations'
import { errorResponse, badRequest } from '@/lib/api/responses'

export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/installations/[installationId]/progress'>
) {
  try {
    const user = await requireDepartmentOrThrow(OM_DEPARTMENT_SLUG)
    const { installationId } = await ctx.params

    const parsed = progressUpdateSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid progress payload', parsed.error.flatten())

    const update = await addProgressUpdate(user, installationId, parsed.data)
    return NextResponse.json({ update }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
