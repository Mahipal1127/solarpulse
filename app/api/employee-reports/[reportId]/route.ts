import { NextResponse, type NextRequest } from 'next/server'
import { requireUserOrThrow } from '@/lib/auth/guards'
import { updateEmployeeReportSchema } from '@/lib/validation/schemas'
import {
  deleteDraftReport,
  updateEmployeeReport,
  ServiceError,
} from '@/lib/services/employee-reports'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Edits a draft, and submits it when `submit` is set.
 *
 * No ownership check here: RLS's own-rows policy is what scopes the update, and the
 * service refuses a report that is already submitted. Someone else's report id resolves
 * to nothing and comes back as a 404 rather than a 403 — which is deliberate, since a
 * 403 would confirm the id exists.
 */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/employee-reports/[reportId]'>
) {
  try {
    const user = await requireUserOrThrow()
    const { reportId } = await ctx.params

    const parsed = updateEmployeeReportSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid report payload', parsed.error.flatten())

    const report = await updateEmployeeReport(user, reportId, parsed.data)
    return NextResponse.json({ report })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}

/** Discards a draft and its attachment. A submitted report cannot be deleted. */
export async function DELETE(
  _request: NextRequest,
  ctx: RouteContext<'/api/employee-reports/[reportId]'>
) {
  try {
    const user = await requireUserOrThrow()
    const { reportId } = await ctx.params

    await deleteDraftReport(user, reportId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
